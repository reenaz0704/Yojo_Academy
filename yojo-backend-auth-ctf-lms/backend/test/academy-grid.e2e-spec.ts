import { makeStaff, makeStudent, startApp, type StaffUser, type TestCtx } from './helpers';

/**
 * Slice (c): sessions, attendance (rule, corrections, windows), schedule join links, calendar limits, bookings
 * (no double booking, proposals), leave requests, messages, trainer credentials — with batch isolation.
 */
describe('Student Academy: Training Grid', () => {
  let ctx: TestCtx;
  let admin: StaffUser, trainer: StaffUser, otherTrainer: StaffUser;
  let st: Awaited<ReturnType<typeof makeStudent>>,
    mate: Awaited<ReturnType<typeof makeStudent>>,
    outsider: Awaited<ReturnType<typeof makeStudent>>;
  let batchId = '';
  const H = 3600_000;
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    trainer = await makeStaff(ctx, 'trainer', { capability: 'trainer_mentor' });
    otherTrainer = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    st = await makeStudent(ctx);
    mate = await makeStudent(ctx);
    outsider = await makeStudent(ctx);
    const b = await admin.client.post('/admin/batches', {
      code: `GRID-${Date.now().toString(36)}`,
      name: 'Grid batch',
      trainerId: trainer.id,
      status: 'active',
    });
    expect(b.status).toBe(201);
    batchId = b.body.id;
    for (const s of [st, mate])
      expect((await admin.client.post(`/admin/students/${s.id}/enrolments`, { batchId })).status).toBe(201);
    const mk = async (body: object) => {
      const r = await trainer.client.post('/trainer/sessions', { batchId, ...body });
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    ids.past = await mk({ type: 'class', title: 'Log analysis', startsAt: iso(-26 * H), endsAt: iso(-25 * H) });
    ids.pastLab = await mk({ type: 'lab', title: 'SIEM lab', startsAt: iso(-24 * H), endsAt: iso(-23 * H) });
    ids.mentor = await mk({ type: 'mentor', title: 'Mentor hour', startsAt: iso(-22 * H), endsAt: iso(-21 * H) });
    ids.soon = await mk({
      type: 'class',
      title: 'Starting soon',
      startsAt: iso(10 * 60_000),
      endsAt: iso(70 * 60_000),
      joinUrl: 'https://meet.example.invalid/soon',
    });
    ids.later = await mk({
      type: 'quiz',
      title: 'Quiz tomorrow',
      startsAt: iso(26 * H),
      endsAt: iso(27 * H),
      joinUrl: 'https://meet.example.invalid/later',
    });
  });
  afterAll(async () => ctx.app.close());

  it('trainers manage only their own batches', async () => {
    const r = await otherTrainer.client.post('/trainer/sessions', {
      batchId,
      type: 'class',
      title: 'Hijack',
      startsAt: iso(48 * H),
      endsAt: iso(49 * H),
    });
    expect(r.status).toBe(404);
    expect((await otherTrainer.client.get(`/trainer/sessions/${ids.past}/attendance`)).status).toBe(404);
    const clash = await trainer.client.post('/trainer/sessions', {
      batchId,
      type: 'class',
      title: 'Overlap',
      startsAt: iso(26 * H + 60_000),
      endsAt: iso(27 * H),
    });
    expect(clash.status).toBe(409);
  });

  it('attendance: marking, the documented % rule, corrections need a reason, windows and isolation', async () => {
    const roster = await trainer.client.get(`/trainer/sessions/${ids.past}/attendance`);
    expect(roster.body.students.map((x: { id: string }) => x.id).sort()).toEqual([st.id, mate.id].sort());
    expect(
      (
        await trainer.client.send('put', `/trainer/sessions/${ids.past}/attendance`, {
          marks: [
            { studentId: st.id, mark: 'present' },
            { studentId: mate.id, mark: 'absent' },
          ],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await trainer.client.send('put', `/trainer/sessions/${ids.pastLab}/attendance`, {
          marks: [{ studentId: st.id, mark: 'late' }],
        })
      ).status,
    ).toBe(200);
    // outsider is not enrolled; a future session cannot be marked; students cannot mark
    expect(
      (
        await trainer.client.send('put', `/trainer/sessions/${ids.past}/attendance`, {
          marks: [{ studentId: outsider.id, mark: 'present' }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await trainer.client.send('put', `/trainer/sessions/${ids.later}/attendance`, {
          marks: [{ studentId: st.id, mark: 'present' }],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await st.client.send('put', `/trainer/sessions/${ids.past}/attendance`, {
          marks: [{ studentId: st.id, mark: 'present' }],
        })
      ).status,
    ).toBe(403);

    const a = await st.client.get('/student/attendance');
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ pct: 100, counts: { present: 1, late: 1, absent: 0 }, requiredPct: 75 });
    expect(a.body.sessions.find((x: { id: string }) => x.id === ids.mentor)).toBeUndefined(); // mentor hour does not count
    expect((await mate.client.get('/student/attendance')).body.pct).toBe(0);
    expect((await outsider.client.get('/student/attendance')).body.sessions).toEqual([]);

    // change an existing mark: reason required, history kept
    const noReason = await trainer.client.send('put', `/trainer/sessions/${ids.past}/attendance`, {
      marks: [{ studentId: st.id, mark: 'absent' }],
    });
    expect(noReason.status).toBe(428);
    const fixed = await trainer.client.send('put', `/trainer/sessions/${ids.past}/attendance`, {
      marks: [{ studentId: st.id, mark: 'absent' }],
      reason: 'Marked the wrong row',
    });
    expect(fixed.body).toMatchObject({ written: 1, corrections: 1 });
    expect(await ctx.prisma.attendanceHistory.count({ where: { sessionId: ids.past, studentId: st.id } })).toBe(2);
    expect((await st.client.get('/student/attendance')).body.pct).toBe(50);

    // after 7 days only an admin can correct, with a reason
    await ctx.prisma.classSession.update({
      where: { id: ids.past },
      data: { startsAt: new Date(Date.now() - 9 * 24 * H), endsAt: new Date(Date.now() - 9 * 24 * H + H) },
    });
    const late = await trainer.client.send('put', `/trainer/sessions/${ids.past}/attendance`, {
      marks: [{ studentId: st.id, mark: 'present' }],
      reason: 'Late fix',
    });
    expect(late.status).toBe(403);
    expect(late.body.code).toBe('CORRECTION_WINDOW_CLOSED');
    expect(
      (
        await admin.client.send('put', `/admin/sessions/${ids.past}/attendance`, {
          marks: [{ studentId: st.id, mark: 'present' }],
        })
      ).status,
    ).toBe(428);
    expect(
      (
        await admin.client.send('put', `/admin/sessions/${ids.past}/attendance`, {
          marks: [{ studentId: st.id, mark: 'present' }],
          reason: 'Trainer confirmed by email',
        })
      ).status,
    ).toBe(200);
    const rep = await admin.client.get(`/admin/attendance/report?batchId=${batchId}`);
    expect(rep.body.students.find((x: { studentId: string }) => x.studentId === st.id).pct).toBe(100);
  });

  it('schedule: join links only for enrolled students and only from 30 minutes before', async () => {
    const w = await st.client.get('/student/schedule');
    expect(w.status).toBe(200);
    const soon = w.body.events.find((e: { id: string }) => e.id === ids.soon);
    expect(soon.joinUrl).toBe('https://meet.example.invalid/soon');
    const all = [...w.body.events];
    const nextWeek = await st.client.get(
      `/student/schedule?week=${new Date(Date.now() + 26 * H).toISOString().slice(0, 10)}`,
    );
    all.push(...nextWeek.body.events);
    const later = all.find((e: { id: string }) => e.id === ids.later);
    expect(later.joinUrl ?? null).toBeNull();
    expect(JSON.stringify((await outsider.client.get('/student/schedule')).body)).not.toContain('meet.example.invalid');
    expect((await st.client.get('/student/calendar?from=2026-01-01&to=2026-06-01')).status).toBe(400);
  });

  it('bookings: open slots for own trainers, no double booking, proposals, cancel', async () => {
    const slot = await trainer.client.post('/trainer/slots', { startsAt: iso(30 * H), endsAt: iso(30.5 * H) });
    expect(slot.status).toBe(201);
    const card = await st.client.get('/student/trainer');
    const t = card.body.trainers.find((x: { id: string }) => x.id === trainer.id);
    expect(t.openSlots.map((x: { id: string }) => x.id)).toContain(slot.body.id);
    expect(t.certificationsVerified).toBe(false);
    expect(
      (await outsider.client.post('/student/session-requests', { slotId: slot.body.id, purpose: 'doubt' })).status,
    ).toBe(404);
    const b1 = await st.client.post('/student/session-requests', {
      slotId: slot.body.id,
      purpose: 'mock_interview',
      note: 'SOC interview',
    });
    expect(b1.status).toBe(201);
    const b2 = await mate.client.post('/student/session-requests', { slotId: slot.body.id, purpose: 'doubt' });
    expect(b2.status).toBe(409);
    expect(b2.body.code).toBe('SLOT_TAKEN');
    expect((await trainer.client.send('delete', `/trainer/slots/${slot.body.id}`)).status).toBe(409);
    const prop = await trainer.client.post(`/trainer/session-requests/${b1.body.id}/decide`, {
      decision: 'propose',
      proposedStart: iso(40 * H),
      note: 'Can we move it?',
    });
    expect(prop.body.status).toBe('proposed');
    expect((await mate.client.post(`/student/session-requests/${b1.body.id}/respond`, { accept: true })).status).toBe(
      404,
    );
    const acc = await st.client.post(`/student/session-requests/${b1.body.id}/respond`, { accept: true });
    expect(acc.body.status).toBe('approved');
    expect((await st.client.post(`/student/session-requests/${b1.body.id}/cancel`)).body.status).toBe('cancelled');
  });

  it('leave: requested by the student, decided by their trainer, never auto-excused', async () => {
    const day = new Date(Date.now() + 26 * H).toISOString().slice(0, 10);
    const l = await st.client.post('/student/leave-requests', { from: day, to: day, reason: 'Family function' });
    expect(l.status).toBe(201);
    expect(
      (await st.client.post('/student/leave-requests', { from: day, to: day, reason: 'Again please' })).status,
    ).toBe(409);
    expect(
      (await outsider.client.post('/student/leave-requests', { from: day, to: day, reason: 'Not in a batch' })).status,
    ).toBe(409);
    expect(
      (await otherTrainer.client.post(`/trainer/leave-requests/${l.body.id}/decide`, { approve: true })).status,
    ).toBe(404);
    expect(
      (await trainer.client.post(`/trainer/leave-requests/${l.body.id}/decide`, { approve: true, note: 'OK' })).body
        .status,
    ).toBe('approved');
    expect((await trainer.client.post(`/trainer/leave-requests/${l.body.id}/decide`, { approve: false })).status).toBe(
      409,
    );
    expect(await ctx.prisma.attendance.count({ where: { sessionId: ids.later, studentId: st.id } })).toBe(0);
  });

  it('messages: only between a student and their own trainer', async () => {
    const c = await st.client.post('/student/conversations', {
      staffId: trainer.id,
      subject: 'Doubt on Sigma rules',
      body: 'How do I filter service accounts?',
    });
    expect(c.status).toBe(201);
    expect(
      (await st.client.post('/student/conversations', { staffId: otherTrainer.id, subject: 'Hi', body: 'x' })).status,
    ).toBe(403);
    const inbox = await trainer.client.get('/trainer/conversations');
    expect(inbox.body.find((x: { id: string }) => x.id === c.body.id).unread).toBe(1);
    expect(
      (
        await trainer.client.post(`/trainer/conversations/${c.body.id}/messages`, {
          body: 'Add a filter on the account name.',
        })
      ).status,
    ).toBe(201);
    const thread = await st.client.get(`/student/conversations/${c.body.id}`);
    expect(thread.body.messages.map((m: { mine: boolean }) => m.mine)).toEqual([true, false]);
    expect((await mate.client.get(`/student/conversations/${c.body.id}`)).status).toBe(404);
    expect((await otherTrainer.client.get(`/trainer/conversations/${c.body.id}`)).status).toBe(404);
  });

  it('trainer credentials show as verified only after an admin checks them', async () => {
    expect((await trainer.client.post(`/admin/trainers/${trainer.id}/credentials`, { verified: true })).status).toBe(
      403,
    );
    expect((await admin.client.post(`/admin/trainers/${trainer.id}/credentials`, { verified: true })).status).toBe(200);
    const card = await st.client.get('/student/trainer');
    expect(card.body.trainers.find((x: { id: string }) => x.id === trainer.id).certificationsVerified).toBe(true);
  });
});
