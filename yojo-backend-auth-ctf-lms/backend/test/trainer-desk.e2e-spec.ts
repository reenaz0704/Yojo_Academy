import { Client, makeStaff, makeStudent, startApp, type StaffUser, type TestCtx } from './helpers';

/**
 * Trainer desk (26 Oct): student 360, remarks and private notes, requests to the Platform Admin, Lab Monitor and
 * nudges, trainer-started messages, mentoring outcomes, and student feedback on trainers. The scope rule is checked
 * from every side: trainer A never reaches trainer B's students by changing an ID, unauthenticated calls are refused,
 * and students cannot reach trainer routes.
 */
describe('Trainer desk: scope, remarks, requests, labs, messages, outcomes, feedback', () => {
  let ctx: TestCtx;
  let admin: StaffUser, trainerA: StaffUser, trainerB: StaffUser, coTrainer: StaffUser;
  let st: Awaited<ReturnType<typeof makeStudent>>, other: Awaited<ReturnType<typeof makeStudent>>;
  let batchA: string, batchB: string;
  const H = 3600_000;
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    trainerA = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    trainerB = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    coTrainer = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    st = await makeStudent(ctx);
    other = await makeStudent(ctx);
    const tag = Date.now().toString(36);
    batchA = (
      await admin.client.post('/admin/batches', {
        code: `TD-A-${tag}`,
        name: 'Desk A',
        trainerId: trainerA.id,
        coTrainerIds: [coTrainer.id],
        status: 'active',
      })
    ).body.id;
    batchB = (
      await admin.client.post('/admin/batches', {
        code: `TD-B-${tag}`,
        name: 'Desk B',
        trainerId: trainerB.id,
        status: 'active',
      })
    ).body.id;
    await admin.client.post(`/admin/students/${st.id}/enrolments`, { batchId: batchA });
    await admin.client.post(`/admin/students/${other.id}/enrolments`, { batchId: batchB });
  });
  afterAll(async () => ctx.app.close());

  it('authorization: no session → 401, a student → 403, another trainer’s student → 404 everywhere', async () => {
    const anon = await new Client(ctx.server).init();
    expect((await anon.get(`/trainer/students/${st.id}`)).status).toBe(401);
    expect((await st.client.get(`/trainer/students/${st.id}`)).status).toBe(403);
    expect((await st.client.get('/trainer/labs')).status).toBe(403);
    expect((await st.client.get('/trainer/feedback')).status).toBe(403);
    // trainer A asks for trainer B's student by ID (IDOR): same answer as an unknown ID
    const idor = await trainerA.client.get(`/trainer/students/${other.id}`);
    expect(idor.status).toBe(404);
    const unknown = await trainerA.client.get('/trainer/students/00000000-0000-0000-0000-000000000001');
    expect(unknown.status).toBe(404);
    expect(idor.body.code).toBe(unknown.body.code);
    const c = trainerA.client;
    expect((await c.post(`/trainer/students/${other.id}/remarks`, { kind: 'remark', text: 'Nope' })).status).toBe(404);
    expect(
      (await c.post(`/trainer/students/${other.id}/requests`, { kind: 'escalation', reason: 'Not mine' })).status,
    ).toBe(404);
    expect((await c.post('/trainer/labs/nudge', { studentId: other.id, missionCode: 'INT-01' })).status).toBe(404);
    expect(
      (await c.post('/trainer/conversations', { studentId: other.id, subject: 'Hi', body: 'Hello there' })).status,
    ).toBe(404);
    expect((await c.get(`/trainer/labs?batchId=${batchB}`)).status).toBe(404);
    // admin-only course pricing stays admin-only
    expect(
      (await c.send('patch', '/admin/courses/00000000-0000-0000-0000-000000000001', { pricePaise: 1 })).status,
    ).toBe(403);
    // the co-trainer of batch A does see the student
    expect((await coTrainer.client.get(`/trainer/students/${st.id}`)).status).toBe(200);
  });

  it('student 360 returns real records only, and never fees, guardian details or answers', async () => {
    const r = await trainerA.client.get(`/trainer/students/${st.id}`);
    expect(r.status).toBe(200);
    expect(r.body.student).toMatchObject({ id: st.id, name: 'Test Student' });
    expect(r.body.batches.map((b: { id: string }) => b.id)).toEqual([batchA]);
    expect(r.body.attendance).toMatchObject({ pct: null, sessions: [] });
    expect(r.body.labs.length).toBeGreaterThan(0);
    expect(r.body.labs.every((l: { state: string }) => l.state === 'not_started')).toBe(true);
    const json = JSON.stringify(r.body);
    expect(json).not.toMatch(/guardian"|pricePaise|answerHash|answer_hash|flag"/);
    expect(json).not.toContain(st.email);
  });

  it('remarks are shared with the student’s trainers, private notes stay with the author; edits keep history', async () => {
    const add = await trainerA.client.post(`/trainer/students/${st.id}/remarks`, {
      kind: 'remark',
      text: 'Completed INT-01 without hints.',
    });
    expect(add.status).toBe(201);
    const note = await trainerA.client.post(`/trainer/students/${st.id}/remarks`, {
      kind: 'private_note',
      text: 'Seems tired in morning classes.',
    });
    expect(note.status).toBe(201);
    expect(
      (await trainerA.client.post(`/trainer/students/${st.id}/remarks`, { kind: 'remark', text: 'x' })).status,
    ).toBe(400);
    // the co-trainer sees the remark but not A's private note, and cannot edit A's remark
    const co = (await coTrainer.client.get(`/trainer/students/${st.id}`)).body.remarks;
    expect(co.map((x: { kind: string }) => x.kind)).toEqual(['remark']);
    expect(
      (await coTrainer.client.send('patch', `/trainer/remarks/${add.body.id}`, { text: 'Hijacked text' })).status,
    ).toBe(404);
    const ed = await trainerA.client.send('patch', `/trainer/remarks/${add.body.id}`, {
      text: 'Completed INT-01 and REC-01 without hints.',
    });
    expect(ed.status).toBe(200);
    const mine = (await trainerA.client.get(`/trainer/students/${st.id}`)).body.remarks;
    const edited = mine.find((x: { id: string }) => x.id === add.body.id);
    expect(edited.text).toMatch(/REC-01/);
    expect(edited.history).toHaveLength(1);
    expect(edited.history[0].text).toBe('Completed INT-01 without hints.');
    // admins see both kinds in the student report
    const rep = await admin.client.get(`/admin/student-reports/${st.id}`);
    expect(rep.body.remarks.map((x: { kind: string }) => x.kind).sort()).toEqual(['private_note', 'remark']);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'trainer.remark.edited', targetId: st.id } })).toBe(1);
  });

  it('escalation and guardian-contact requests reach the admin, who resolves them; trainers never see guardian details', async () => {
    const esc = await trainerA.client.post(`/trainer/students/${st.id}/requests`, {
      kind: 'escalation',
      reason: 'Attendance dropped for three weeks.',
    });
    expect(esc.status).toBe(201);
    expect(esc.body.code).toMatch(/^SR-\d+$/);
    const dup = await trainerA.client.post(`/trainer/students/${st.id}/requests`, {
      kind: 'escalation',
      reason: 'Second time asking.',
    });
    expect(dup.body.code).toBe('REQUEST_OPEN');
    const g = await trainerA.client.post(`/trainer/students/${st.id}/requests`, {
      kind: 'guardian_contact',
      reason: 'Please let the guardian know about the missed exam.',
    });
    expect(g.status).toBe(201);
    expect(
      await ctx.prisma.notification.count({ where: { userId: admin.id, kind: 'staff_request' } }),
    ).toBeGreaterThanOrEqual(2);
    expect((await trainerA.client.get('/admin/student-requests')).status).toBe(403);
    const open = await admin.client.get('/admin/student-requests?status=open');
    const row = open.body.items.find((x: { id: string }) => x.id === esc.body.id);
    expect(row).toMatchObject({ kind: 'escalation', studentId: st.id, status: 'open' });
    const res = await admin.client.post(`/admin/student-requests/${esc.body.id}/resolve`, {
      resolution: 'Called the student; back from Monday.',
    });
    expect(res.status).toBe(201);
    expect(
      (await admin.client.post(`/admin/student-requests/${esc.body.id}/resolve`, { resolution: 'Again please' })).body
        .code,
    ).toBe('REQUEST_RESOLVED');
    const view = (await trainerA.client.get(`/trainer/students/${st.id}`)).body.requests;
    expect(view.find((x: { id: string }) => x.id === esc.body.id)).toMatchObject({ status: 'resolved', mine: true });
    expect(await ctx.prisma.notification.count({ where: { userId: trainerA.id, kind: 'staff_request' } })).toBe(1);
    const dash = await trainerA.client.get('/trainer/dashboard');
    expect(dash.body.pending.openRequests).toBe(1); // the guardian request is still open
  });

  it('Lab Monitor shows step progress and hints without answers; one nudge per lab and day', async () => {
    await st.client.post('/student/missions/INT-01/attempts');
    await st.client.post('/student/missions/INT-01/steps/1/read');
    const m = await trainerA.client.get(`/trainer/labs?batchId=${batchA}`);
    expect(m.status).toBe(200);
    const row = m.body.students.find((s: { studentId: string }) => s.studentId === st.id);
    const int = row.labs.find((l: { code: string }) => l.code === 'INT-01');
    expect(int).toMatchObject({ state: 'in_progress', stepsDone: 1 });
    expect(m.body.students.some((s: { studentId: string }) => s.studentId === other.id)).toBe(false);
    expect(JSON.stringify(m.body)).not.toMatch(/answerHash|answer_hash|quizKey|salt|YOJO_/i);
    const n1 = await trainerA.client.post('/trainer/labs/nudge', { studentId: st.id, missionCode: 'INT-01' });
    expect(n1.status).toBe(201);
    const n2 = await trainerA.client.post('/trainer/labs/nudge', { studentId: st.id, missionCode: 'INT-01' });
    expect(n2.body.code).toBe('ALREADY_NUDGED');
    expect(await ctx.prisma.notification.count({ where: { userId: st.id, kind: 'nudge' } })).toBe(1);
  });

  it('a trainer starts a message to their student; the student sees it and can reply', async () => {
    const c = await trainerA.client.post('/trainer/conversations', {
      studentId: st.id,
      subject: 'Lab check-in',
      body: 'How is INT-01 going?',
    });
    expect(c.status).toBe(201);
    const list = await st.client.get('/student/conversations');
    expect(list.body.some((x: { id: string }) => x.id === c.body.id)).toBe(true);
    expect((await st.client.post(`/student/conversations/${c.body.id}/messages`, { body: 'Going well!' })).status).toBe(
      201,
    );
    expect((await trainerB.client.get(`/trainer/conversations/${c.body.id}`)).status).toBe(404); // not B's message
  });

  it('feedback: only for sessions the student attended, one rating each (changeable, no time limit), anonymous to the trainer', async () => {
    const sess = await trainerA.client.post('/trainer/sessions', {
      batchId: batchA,
      type: 'class',
      title: 'SIEM basics',
      startsAt: iso(-26 * H),
      endsAt: iso(-25 * H),
    });
    const absent = await trainerA.client.post('/trainer/sessions', {
      batchId: batchA,
      type: 'class',
      title: 'Log hunting',
      startsAt: iso(-24 * H),
      endsAt: iso(-23 * H),
    });
    await trainerA.client.send('put', `/trainer/sessions/${sess.body.id}/attendance`, {
      marks: [{ studentId: st.id, mark: 'present' }],
    });
    await trainerA.client.send('put', `/trainer/sessions/${absent.body.id}/attendance`, {
      marks: [{ studentId: st.id, mark: 'absent' }],
    });
    const mine = await st.client.get('/student/feedback');
    expect(mine.body.rateable.map((x: { sessionId: string }) => x.sessionId)).toEqual([sess.body.id]);
    expect((await st.client.post('/student/feedback', { sessionId: absent.body.id, rating: 1 })).status).toBe(404);
    expect((await other.client.post('/student/feedback', { sessionId: sess.body.id, rating: 1 })).status).toBe(404);
    expect((await st.client.post('/student/feedback', { sessionId: sess.body.id, rating: 6 })).status).toBe(400);
    const ok = await st.client.post('/student/feedback', {
      sessionId: sess.body.id,
      rating: 4,
      comment: 'Clear examples.',
    });
    expect(ok.status).toBe(201);
    expect((await st.client.get('/student/feedback')).body.rateable).toEqual([]); // rated: no longer waiting
    // OI-60: no time limit. Months later the student changes the same rating; it still counts once.
    await ctx.prisma.classSession.update({
      where: { id: sess.body.id },
      data: { startsAt: new Date(Date.now() - 60 * 24 * H), endsAt: new Date(Date.now() - 60 * 24 * H + H) },
    });
    const changed = await st.client.post('/student/feedback', {
      sessionId: sess.body.id,
      rating: 5,
      comment: 'Clear examples, and the recap helped.',
    });
    expect(changed.body).toMatchObject({ id: ok.body.id, changed: true });
    const fb = await trainerA.client.get('/trainer/feedback');
    expect(fb.body.summary).toMatchObject({ count: 1, average: 5 });
    expect(fb.body.items[0]).toMatchObject({
      rating: 5,
      comment: 'Clear examples, and the recap helped.',
      context: { title: 'SIEM basics' },
    });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'student.feedback.changed', actorId: st.id } })).toBe(1);
    expect(JSON.stringify(fb.body)).not.toMatch(new RegExp(`${st.id}|Test Student|${st.email}`));
    expect((await trainerB.client.get('/trainer/feedback')).body.summary.count).toBe(0);
    // no trainer route changes feedback; admins see who wrote it
    expect((await trainerA.client.send('patch', `/trainer/feedback/${ok.body.id}`, { rating: 5 })).status).toBe(404);
    const adm = await admin.client.get(`/admin/trainers/${trainerA.id}/feedback`);
    expect(adm.body.items[0].student).toBe('Test Student');
  });

  it('mentoring: the outcome is recorded after the session, then the student may rate it', async () => {
    const slot = await trainerA.client.post('/trainer/slots', {
      startsAt: iso(30 * H),
      endsAt: iso(31 * H),
      kind: 'one_to_one',
    });
    const req = await st.client.post('/student/session-requests', { slotId: slot.body.id, purpose: 'mentoring' });
    expect(req.status).toBe(201);
    await trainerA.client.post(`/trainer/session-requests/${req.body.id}/decide`, { decision: 'approve' });
    expect(
      (
        await trainerA.client.post(`/trainer/session-requests/${req.body.id}/outcome`, {
          outcome: 'Covered SIEM rules.',
        })
      ).body.code,
    ).toBe('NOT_STARTED');
    await ctx.prisma.sessionRequest.update({
      where: { id: req.body.id },
      data: { startsAt: new Date(Date.now() - 2 * H), endsAt: new Date(Date.now() - H) },
    });
    expect((await trainerA.client.get('/trainer/dashboard')).body.pending.mentoringOutcomes).toBe(1);
    expect(
      (await trainerB.client.post(`/trainer/session-requests/${req.body.id}/outcome`, { outcome: 'Not my session.' }))
        .status,
    ).toBe(404);
    const out = await trainerA.client.post(`/trainer/session-requests/${req.body.id}/outcome`, {
      outcome: 'Covered SIEM rules and log sources.',
      followUp: 'Write two Sigma rules by Friday.',
    });
    expect(out.status).toBe(201);
    expect((await trainerA.client.get('/trainer/dashboard')).body.pending.mentoringOutcomes).toBe(0);
    const v = (await trainerA.client.get(`/trainer/students/${st.id}`)).body.mentoring[0];
    expect(v).toMatchObject({ status: 'completed', followUp: 'Write two Sigma rules by Friday.' });
    const r = await st.client.post('/student/feedback', { sessionRequestId: req.body.id, rating: 5 });
    expect(r.status).toBe(201);
  });

  it('the batch overview explains each flag with the actual figure', async () => {
    const o = await trainerA.client.get(`/trainer/batches/${batchA}/overview`);
    const me = o.body.students.find((s: { studentId: string }) => s.studentId === st.id);
    expect(me.flags).toContain('Low attendance'); // 1 present, 1 absent = 50 %
    expect(me.flagReasons).toContain(`Attendance 50% (needs ${o.body.requiredAttendancePct}%)`);
    expect(o.body.rules.weights).toEqual({ attendance: 20, quiz: 40, labs: 40 });
  });
});
