import { CAREER_QUESTIONS, type Track } from '../src/academy/career-quiz';
import { makeStaff, makeStudent, startApp, type StaffUser, type TestCtx } from './helpers';

/**
 * Career-path quiz (owner, 24 Oct): 15 scenarios, every answer counts for one track, percentages on the server,
 * mapping never sent, optional (skip), the student chooses the path, one take per 30 days, admins see the result.
 */
describe('Student Academy: career-path quiz', () => {
  let ctx: TestCtx;
  let admin: StaffUser;
  const pick = (plan: Track[]) => CAREER_QUESTIONS.map((q, i) => q.options.find((o) => o.track === plan[i])!.id);
  const plan = (o: number, d: number, g: number): Track[] => [
    ...Array<Track>(o).fill('Offensive'),
    ...Array<Track>(d).fill('Defensive'),
    ...Array<Track>(g).fill('GRC'),
  ];

  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
  });
  afterAll(async () => ctx.app.close());

  it('is asked first for a new self-signed-up student and never reveals the option → track mapping', async () => {
    const st = await makeStudent(ctx);
    const s = await st.client.get('/student/career-quiz');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ required: true, needsPath: true, path: null, canTake: true });
    expect(s.body.questions).toHaveLength(15);
    const raw = JSON.stringify(s.body.questions);
    expect(raw).not.toMatch(/Offensive|Defensive|GRC|track|theme/);
    for (const q of s.body.questions) expect(q.options).toHaveLength(3);
  });

  it('scores 15 answers into whole-number percentages, then the student keeps or changes the suggestion', async () => {
    const st = await makeStudent(ctx);
    expect((await st.client.post('/student/career-quiz', { answers: ['a', 'b'] })).status).toBe(400);
    expect((await st.client.post('/student/career-quiz', { answers: Array(15).fill('z') })).status).toBe(400);
    const r = await st.client.post('/student/career-quiz', { answers: pick(plan(8, 4, 3)) });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      skipped: false,
      percentages: { Offensive: 53, Defensive: 27, GRC: 20 },
      suggested: 'Offensive',
      tiedWith: [],
      chosenPath: null,
    });
    // a result without a choice is not yet a path
    expect((await st.client.get('/student/career-quiz')).body).toMatchObject({
      path: null,
      needsPath: true,
      required: false,
    });
    const c = await st.client.post('/student/career-path', { path: 'GRC' });
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ suggested: 'Offensive', chosenPath: 'GRC' });
    const d = (await st.client.get('/student/dashboard')).body;
    expect(d.profile.path).toBe('GRC');
    expect(d.powerLevels).toEqual({ Offensive: 53, Defensive: 27, GRC: 20 });
    expect(d.trophies.items.find((t: { code: string }) => t.code === 'pathfinder').earned).toBe(true);
    expect((await st.client.post('/student/career-path', { path: 'Hacker' })).status).toBe(400);
  });

  it('ties are reported and broken Defensive, Offensive, GRC', async () => {
    const st = await makeStudent(ctx);
    const r = await st.client.post('/student/career-quiz', { answers: pick(plan(5, 5, 5)) });
    expect(r.body).toMatchObject({
      percentages: { Offensive: 33, Defensive: 33, GRC: 33 },
      suggested: 'Defensive',
      tiedWith: ['Offensive', 'GRC'],
    });
  });

  it('can be skipped: the student just picks a path', async () => {
    const st = await makeStudent(ctx);
    const r = await st.client.post('/student/career-path', { path: 'Defensive' });
    expect(r.body).toMatchObject({ skipped: true, percentages: null, suggested: null, chosenPath: 'Defensive' });
    const s = (await st.client.get('/student/career-quiz')).body;
    expect(s).toMatchObject({ path: 'Defensive', needsPath: false, required: false, canTake: true });
    // taking it later is still allowed (a skip does not start the 30-day wait)
    expect((await st.client.post('/student/career-quiz', { answers: pick(plan(2, 3, 10)) })).body.suggested).toBe(
      'GRC',
    );
  });

  it('one take per 30 days', async () => {
    const st = await makeStudent(ctx);
    await st.client.post('/student/career-quiz', { answers: pick(plan(15, 0, 0)) });
    const again = await st.client.post('/student/career-quiz', { answers: pick(plan(0, 15, 0)) });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('RETAKE_TOO_SOON');
    const s = (await st.client.get('/student/career-quiz')).body;
    expect(s.canTake).toBe(false);
    expect(s.questions).toBeNull();
    await ctx.prisma.careerPathResult.updateMany({
      where: { userId: st.id },
      data: { createdAt: new Date(Date.now() - 31 * 86_400_000) },
    });
    expect((await st.client.post('/student/career-quiz', { answers: pick(plan(0, 15, 0)) })).status).toBe(201);
  });

  it('a Yojo-origin student is not forced, but may take it', async () => {
    const st = await makeStudent(ctx);
    await ctx.prisma.user.update({ where: { id: st.id }, data: { origin: 'yojo' } });
    const s = (await st.client.get('/student/career-quiz')).body;
    expect(s).toMatchObject({ required: false, needsPath: true, canTake: true });
    expect((await st.client.post('/student/career-quiz', { answers: pick(plan(3, 9, 3)) })).body.suggested).toBe(
      'Defensive',
    );
  });

  it('students see only their own result; admins see it in Student reports with filters; others are refused', async () => {
    const a = await makeStudent(ctx);
    const b = await makeStudent(ctx);
    await a.client.post('/student/career-quiz', { answers: pick(plan(4, 4, 7)) });
    await a.client.post('/student/career-path', { path: 'GRC' });
    expect((await b.client.get('/student/career-quiz')).body.result).toBeNull();
    expect((await b.client.get(`/admin/student-reports/${a.id}`)).status).toBe(403);
    const trainer = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    expect((await trainer.client.get('/admin/student-reports')).status).toBe(403);

    const list = await admin.client.get(`/admin/student-reports?quiz=taken&path=GRC&q=${encodeURIComponent(a.email)}`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: a.id,
      path: 'GRC',
      quiz: {
        status: 'taken',
        suggested: 'GRC',
        chosenPath: 'GRC',
        percentages: { Offensive: 27, Defensive: 27, GRC: 47 },
      },
    });
    const none = await admin.client.get(`/admin/student-reports?quiz=none&q=${encodeURIComponent(b.email)}`);
    expect(none.body.items.map((x: { id: string }) => x.id)).toEqual([b.id]);

    const rep = await admin.client.get(`/admin/student-reports/${a.id}`);
    expect(rep.status).toBe(200);
    expect(rep.body.careerPath.path).toBe('GRC');
    expect(rep.body.careerPath.history[0]).toMatchObject({ skipped: false, suggested: 'GRC', chosenPath: 'GRC' });
    expect(rep.body).toHaveProperty('attendance.counts');
    expect(rep.body).toHaveProperty('gamification.xp');
    expect(rep.body).toHaveProperty('placement.overall');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'admin.student.report_viewed', targetId: a.id } })).toBe(
      1,
    );
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: { in: ['academy.career_quiz.taken', 'academy.career_path.chosen'] }, actorId: a.id },
      }),
    ).toBe(2);
  });
});
