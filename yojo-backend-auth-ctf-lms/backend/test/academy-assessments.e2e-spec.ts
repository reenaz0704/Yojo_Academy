import { makeStaff, makeStudent, startApp, type StaffUser, type TestCtx } from './helpers';

/**
 * Slice (d): assessment access, quiz scoring with hidden keys, attempt limits, deadlines and extensions, time
 * limits, manual grading with release rules, regrade reasons, revision, trainer scope, and the XP/lesson link.
 */
describe('Student Academy: assessments', () => {
  let ctx: TestCtx;
  let admin: StaffUser, trainer: StaffUser, otherTrainer: StaffUser;
  let st: Awaited<ReturnType<typeof makeStudent>>, outsider: Awaited<ReturnType<typeof makeStudent>>;
  const tag = Date.now().toString(36).toUpperCase().slice(-6);
  const D = 86_400_000;
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
  let courseId = '';

  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    trainer = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    otherTrainer = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    st = await makeStudent(ctx);
    outsider = await makeStudent(ctx);
    const c = await admin.client.post('/admin/courses', {
      code: `AS-${tag}`,
      slug: `as-${tag.toLowerCase()}`,
      title: `Assess ${tag}`,
      category: 'Defensive Security and SOC',
      summary: 'x',
      access: 'paid',
    });
    courseId = c.body.id;
    await admin.client.post(`/admin/courses/${courseId}/status`, { status: 'published' });
    const b = await admin.client.post('/admin/batches', {
      code: `AB-${tag}`,
      name: 'Assess batch',
      courseId,
      trainerId: trainer.id,
      status: 'active',
    });
    await admin.client.post(`/admin/students/${st.id}/enrolments`, { batchId: b.body.id });
    await ctx.prisma.entitlement.create({
      data: { studentId: st.id, key: 'plan:paid', source: 'manual', reason: 'test paid access' },
    });
  });
  afterAll(async () => ctx.app.close());

  const create = (body: object, who = trainer) =>
    who.client.post(admin === who ? '/admin/assessments' : '/trainer/assessments', { courseId, ...body });

  it('quiz: hidden keys, server scoring, one attempt, XP and the quiz_passed result once', async () => {
    const q = await create({
      code: `Q-${tag}`,
      title: 'Quiz 1',
      kind: 'quiz',
      format: 'questions',
      maxMarks: 5,
      passMarks: 3,
    });
    expect(q.status).toBe(201);
    const id = q.body.id;
    expect(
      (
        await otherTrainer.client.post('/trainer/assessments', {
          courseId,
          code: `QX-${tag}`,
          title: 'Not mine',
          kind: 'quiz',
          format: 'questions',
          maxMarks: 1,
          passMarks: 1,
        })
      ).status,
    ).toBe(403);
    expect((await otherTrainer.client.get(`/trainer/assessments/${id}`)).status).toBe(404);
    expect((await trainer.client.post(`/trainer/assessments/${id}/status`, { status: 'published' })).status).toBe(409);
    const qs = [
      {
        kind: 'single',
        prompt: 'SIEM stands for?',
        options: ['A', 'Security information and event management', 'C'],
        answerKey: 1,
        marks: 2,
      },
      {
        kind: 'multi',
        prompt: 'Pick log sources',
        options: ['auth.log', 'a song', 'syslog'],
        answerKey: [0, 2],
        marks: 2,
      },
      { kind: 'short_text', prompt: 'Abbreviation?', answerKey: ['SIEM'], marks: 1 },
    ];
    const ids = [];
    for (const x of qs) {
      const r = await trainer.client.post(`/trainer/assessments/${id}/questions`, x);
      expect(r.status).toBe(201);
      ids.push(r.body.id);
    }
    expect(
      (
        await trainer.client.post(`/trainer/assessments/${id}/questions`, {
          kind: 'single',
          prompt: 'Bad key',
          options: ['a', 'b'],
          answerKey: 5,
        })
      ).status,
    ).toBe(400);
    expect((await trainer.client.post(`/trainer/assessments/${id}/status`, { status: 'published' })).status).toBe(200);

    expect(
      (await outsider.client.get('/student/assessments')).body.items.map((x: { id: string }) => x.id),
    ).not.toContain(id);
    expect((await outsider.client.post(`/student/assessments/${id}/attempts`)).status).toBe(404);
    const list = await st.client.get('/student/assessments');
    expect(list.body.items.find((x: { id: string }) => x.id === id)).toMatchObject({ status: 'pending', maxMarks: 5 });

    const a1 = await st.client.post(`/student/assessments/${id}/attempts`);
    expect(a1.status).toBe(200);
    expect(JSON.stringify(a1.body)).not.toMatch(/answerKey|"SIEM"/);
    expect((await st.client.post(`/student/assessments/${id}/attempts`)).body.attemptId).toBe(a1.body.attemptId); // resume, not a second attempt
    const sub = await st.client.post(`/student/attempts/${a1.body.attemptId}/submit`, {
      answers: { [ids[0]]: 1, [ids[1]]: [2, 0], [ids[2]]: '  siem ' },
    });
    expect(sub.body).toMatchObject({ status: 'graded', score: 5, passed: true });
    expect((await st.client.post(`/student/attempts/${a1.body.attemptId}/submit`, { answers: {} })).status).toBe(409);
    expect((await st.client.post(`/student/assessments/${id}/attempts`)).body.code).toBe('NO_ATTEMPTS_LEFT');
    expect(
      await ctx.prisma.studentActivity.count({ where: { userId: st.id, kind: 'quiz_passed', refId: `Q-${tag}` } }),
    ).toBe(1);
    const xp = await ctx.prisma.xpLedger.findMany({ where: { userId: st.id, source: `quiz:Q-${tag}:pass` } });
    expect(xp).toHaveLength(1);
    expect((await st.client.get('/student/results')).body.map((x: { id: string }) => x.id)).toContain(id);
    // trainer cannot change questions after students started
    expect((await trainer.client.post(`/trainer/assessments/${id}/questions`, qs[0])).status).toBe(409);
  });

  it('assignment: due soon, manual grading, marks hidden until released, regrade needs a reason, revision', async () => {
    const a = await create({
      code: `A-${tag}`,
      title: 'Phishing report',
      kind: 'assignment',
      format: 'text',
      maxMarks: 10,
      passMarks: 5,
      resultsRelease: 'manual',
      dueAt: iso(2 * D),
      attemptsAllowed: 1,
    });
    const id = a.body.id;
    await trainer.client.post(`/trainer/assessments/${id}/status`, { status: 'published' });
    const item = (await st.client.get('/student/assessments?status=due_soon')).body.items.find(
      (x: { id: string }) => x.id === id,
    );
    expect(item).toMatchObject({ dueSoon: true, status: 'pending' });
    const att = await st.client.post(`/student/assessments/${id}/attempts`);
    expect((await st.client.post(`/student/attempts/${att.body.attemptId}/submit`, { text: '   ' })).status).toBe(400);
    expect(
      (await st.client.post(`/student/attempts/${att.body.attemptId}/submit`, { text: 'Timeline, IOCs and headers.' }))
        .body.status,
    ).toBe('submitted');
    expect((await outsider.client.post(`/student/attempts/${att.body.attemptId}/submit`, { text: 'x' })).status).toBe(
      404,
    );

    expect(
      (await otherTrainer.client.post(`/trainer/attempts/${att.body.attemptId}/grade`, { score: 10 })).status,
    ).toBe(404);
    expect((await trainer.client.post(`/trainer/attempts/${att.body.attemptId}/grade`, { score: 11 })).status).toBe(
      400,
    );
    expect(
      (
        await trainer.client.post(`/trainer/attempts/${att.body.attemptId}/grade`, {
          score: 8,
          feedback: 'Good timeline.',
        })
      ).status,
    ).toBe(200);
    const hidden = await st.client.get(`/student/assessments/${id}`);
    expect(hidden.body.attempts[0].score).toBeNull();
    expect(hidden.body.resultsVisible).toBe(false);
    await trainer.client.post(`/trainer/assessments/${id}/release`);
    const shown = await st.client.get(`/student/assessments/${id}`);
    expect(shown.body.attempts[0]).toMatchObject({ score: 8, feedback: 'Good timeline.' });
    expect((await trainer.client.post(`/trainer/attempts/${att.body.attemptId}/grade`, { score: 9 })).status).toBe(428);
    expect(
      (
        await trainer.client.post(`/trainer/attempts/${att.body.attemptId}/grade`, {
          score: 9,
          reason: 'Missed the IOC table',
        })
      ).status,
    ).toBe(200);
    expect(await ctx.prisma.gradeHistory.count({ where: { attemptId: att.body.attemptId } })).toBe(2);
    await expect(ctx.prisma.gradeHistory.deleteMany({ where: { attemptId: att.body.attemptId } })).rejects.toThrow();

    // return for revision, then the student resubmits the same attempt
    await trainer.client.post(`/trainer/attempts/${att.body.attemptId}/grade`, {
      score: 4,
      returnForRevision: true,
      reason: 'Please add the mail headers',
      feedback: 'Add headers',
    });
    expect((await st.client.get(`/student/assessments/${id}`)).body.status).toBe('returned');
    expect(
      (await st.client.post(`/student/attempts/${att.body.attemptId}/submit`, { text: 'Now with headers.' })).body
        .status,
    ).toBe('submitted');
    const rep = await admin.client.get(`/admin/assessments/${id}/report`);
    expect(rep.status).toBe(200);
    expect(rep.body).toMatchObject({ maxMarks: 10 });
  });

  it('deadlines and extensions; time limits close expired attempts', async () => {
    const late = await create({
      code: `L-${tag}`,
      title: 'Late one',
      kind: 'practical',
      format: 'text',
      maxMarks: 10,
      passMarks: 5,
      opensAt: iso(-3 * D),
      dueAt: iso(-D),
    });
    await trainer.client.post(`/trainer/assessments/${late.body.id}/status`, { status: 'published' });
    expect(
      (await st.client.get('/student/assessments')).body.items.find((x: { id: string }) => x.id === late.body.id)
        .status,
    ).toBe('missed');
    expect((await st.client.post(`/student/assessments/${late.body.id}/attempts`)).body.code).toBe('DEADLINE_PASSED');
    expect(
      (
        await trainer.client.post(`/trainer/assessments/${late.body.id}/extensions`, {
          studentId: st.id,
          dueAt: iso(D),
          reason: 'Medical leave',
        })
      ).status,
    ).toBe(201);
    expect((await st.client.post(`/student/assessments/${late.body.id}/attempts`)).status).toBe(200);

    const timed = await create({
      code: `T-${tag}`,
      title: 'Timed',
      kind: 'quiz',
      format: 'questions',
      maxMarks: 1,
      passMarks: 1,
      durationMin: 1,
      attemptsAllowed: 2,
    });
    await trainer.client.post(`/trainer/assessments/${timed.body.id}/questions`, {
      kind: 'single',
      prompt: 'Pick a',
      options: ['a', 'b'],
      answerKey: 0,
      marks: 1,
    });
    await trainer.client.post(`/trainer/assessments/${timed.body.id}/status`, { status: 'published' });
    const t1 = await st.client.post(`/student/assessments/${timed.body.id}/attempts`);
    await ctx.prisma.attempt.update({
      where: { id: t1.body.attemptId },
      data: { expiresAt: new Date(Date.now() - 10 * 60_000) },
    });
    expect((await st.client.post(`/student/attempts/${t1.body.attemptId}/submit`, { answers: {} })).body.code).toBe(
      'TIME_UP',
    );
    const t2 = await st.client.post(`/student/assessments/${timed.body.id}/attempts`);
    expect(t2.body.number).toBe(2);
  });

  it('calendar shows deadlines; students and trainers cannot use admin routes', async () => {
    const cal = await st.client.get(
      `/student/calendar?from=${new Date().toISOString().slice(0, 10)}&to=${iso(5 * D).slice(0, 10)}`,
    );
    expect(
      cal.body.events.some(
        (e: { kind: string; title: string }) => e.kind === 'assessment' && e.title === 'Due: Phishing report',
      ),
    ).toBe(true);
    expect((await st.client.get('/trainer/assessments')).status).toBe(403);
    expect((await trainer.client.get('/admin/assessments')).status).toBe(403);
    expect((await admin.client.get('/admin/assessments')).status).toBe(200);
  });
});
