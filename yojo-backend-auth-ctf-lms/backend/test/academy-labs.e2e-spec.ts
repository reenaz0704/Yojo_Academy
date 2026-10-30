import { makeStudent, startApp, type TestCtx } from './helpers';

/**
 * The 9 Academy labs as server missions (24 Oct): steps (read, quiz, answer, lab answer), answers and quiz keys as
 * salted hashes only, each step paid once through the ledger with the hint cut, the lab cleared when every step is
 * done (streak and daily-patch credit), and per-session flags left to the lab service (honest 503 while offline).
 * Uses the labs seeded from prisma/lab-content.ts.
 */
describe('Student Academy: labs with steps', () => {
  let ctx: TestCtx;
  type Student = Awaited<ReturnType<typeof makeStudent>>;
  const xp = async (s: Student) => (await s.client.get('/student/xp')).body;
  const total = async (s: Student) => (await s.client.get('/student/dashboard')).body.xp.total as number;
  const start = (s: Student, code: string) => s.client.post(`/student/missions/${code}/attempts`);

  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(async () => ctx.app.close());

  it('lab detail shows steps but never answers, hashes, salts or quiz keys', async () => {
    const s = await makeStudent(ctx);
    const blobs: string[] = [];
    for (const code of ['INT-01', 'DOM-01', 'WEB-01', 'SUB-01', 'END-01', 'INFO-01']) {
      const d = await s.client.get(`/student/missions/${code}`);
      expect(d.status).toBe(200);
      expect(d.body.steps.length).toBeGreaterThanOrEqual(2);
      blobs.push(JSON.stringify(d.body));
    }
    const all = blobs.join('');
    expect(all).not.toMatch(/answerHash|answerSalt|quizKey|"answer":/);
    expect(all).not.toMatch(/2028-12-18|node\.js"|"10"|"8"/i);
    const int = JSON.parse(blobs[0]);
    expect(int.steps[1].questions).toHaveLength(8);
    expect(int.steps[1].questions[0]).toEqual({ id: 'q1', prompt: expect.any(String), options: expect.any(Array) });
  });

  it('INT-01: lesson pays 20 once, the first quiz attempt pays 10 per correct answer, practice pays 0, then the lab clears', async () => {
    const s = await makeStudent(ctx);
    expect((await s.client.post('/student/missions/INT-01/steps/1/read')).body.code).toBe('NO_ACTIVE_ATTEMPT');
    await start(s, 'INT-01');
    const r = await s.client.post('/student/missions/INT-01/steps/1/read');
    expect(r.body).toMatchObject({ stepDone: true, xp: 20, cleared: false });
    expect((await s.client.post('/student/missions/INT-01/steps/1/read')).body).toMatchObject({ xp: 0, already: true });
    expect((await s.client.post('/student/missions/INT-01/steps/2/quiz', { answers: [0, 2] })).status).toBe(400);
    expect(
      (await s.client.post('/student/missions/INT-01/steps/2/quiz', { answers: [9, 2, 1, 0, 1, 2, 2, 2] })).status,
    ).toBe(400);
    // 6 of 8 correct (the keys from mission-api: 0,2,1,0,1,2,2,2)
    const q = await s.client.post('/student/missions/INT-01/steps/2/quiz', { answers: [0, 2, 1, 0, 0, 2, 2, 0] });
    expect(q.status).toBe(200);
    expect(q.body).toMatchObject({ score: 6, total: 8, scored: true, xp: 60, cleared: true });
    expect(q.body.correct).toEqual([true, true, true, true, false, true, true, false]);
    expect((await start(s, 'INT-01')).body.replay).toBe(true); // practice after clearing needs a replay attempt
    const again = await s.client.post('/student/missions/INT-01/steps/2/quiz', { answers: [0, 2, 1, 0, 1, 2, 2, 2] });
    expect(again.body).toMatchObject({ score: 8, scored: false, xp: 0 });
    expect(await total(s)).toBe(80);
    const d = (await s.client.get('/student/missions/INT-01')).body;
    expect(d.state).toBe('cleared');
    expect(d.steps.map((x: { done: boolean }) => x.done)).toEqual([true, true]);
    const dash = (await s.client.get('/student/dashboard')).body;
    expect(dash.streak.todayCounts).toBe(true); // lab XP qualifies for the streak
    expect(dash.daily.items.find((i: { key: string }) => i.key === 'lab').done).toBe(true);
    expect(dash.tiles.labsCleared).toBe(1);
    const ledger = (await xp(s)).items ?? (await xp(s));
    expect(JSON.stringify(ledger)).toMatch(/lab:INT-01:step:1/);
  });

  it('DOM-01: dates in many formats, ambiguous dates refused without using a try, wrong answers counted, hint cut applied', async () => {
    const s = await makeStudent(ctx);
    await start(s, 'DOM-01');
    await s.client.post('/student/missions/DOM-01/steps/1/read');
    const amb = await s.client.post('/student/missions/DOM-01/steps/2/answer', { answer: '05-06-2028' });
    expect(amb.status).toBe(422);
    expect(amb.body.code).toBe('ANSWER_FORMAT');
    const wrong = await s.client.post('/student/missions/DOM-01/steps/2/answer', { answer: '2027-12-18' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('WRONG_ANSWER');
    expect((await s.client.get('/student/missions/DOM-01')).body.steps[1].tries).toBe(1);
    const h1 = await s.client.post('/student/missions/DOM-01/hints');
    expect(h1.body).toMatchObject({ n: 1, pct: 5 });
    expect((await s.client.post('/student/missions/DOM-01/hints')).body).toMatchObject({ n: 2, pct: 10 });
    const ok = await s.client.post('/student/missions/DOM-01/steps/2/answer', { answer: '18 December 2028' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ stepDone: true, cleared: true, xp: 43 }); // 50 × (100 − 15)% = 42.5 → 43
    expect(await total(s)).toBe(43);
    // hints are charged once per student and lab: the hint list shows both, no third charge happened
    const d = (await s.client.get('/student/missions/DOM-01')).body;
    expect(d.hints.used.map((u: { n: number }) => u.n)).toEqual([1, 2]);
  });

  it('WEB-01 (lab service offline): the answer is still checked here; the technology list needs every required item', async () => {
    const s = await makeStudent(ctx);
    expect((await start(s, 'WEB-01')).status).toBe(200);
    await s.client.post('/student/missions/WEB-01/steps/1/read');
    expect(
      (await s.client.post('/student/missions/WEB-01/steps/2/answer', { answer: 'Apache, Express' })).body.code,
    ).toBe('WRONG_ANSWER');
    const ok = await s.client.post('/student/missions/WEB-01/steps/2/answer', {
      answer: 'nodejs; express.js, Apache HTTP Server, HTML5',
    });
    expect(ok.body).toMatchObject({ stepDone: true, cleared: true, xp: 50 });
  });

  it('SUB-01 and END-01: whole-number counts only', async () => {
    const s = await makeStudent(ctx);
    await start(s, 'END-01');
    expect((await s.client.post('/student/missions/END-01/steps/2/answer', { answer: '8.0' })).body.code).toBe(
      'ANSWER_FORMAT',
    );
    expect((await s.client.post('/student/missions/END-01/steps/2/answer', { answer: '7' })).body.code).toBe(
      'WRONG_ANSWER',
    );
    expect((await s.client.post('/student/missions/END-01/steps/2/answer', { answer: ' 8 ' })).body).toMatchObject({
      stepDone: true,
      xp: 50,
      cleared: false,
    });
    await s.client.post('/student/missions/END-01/steps/1/read');
    expect((await s.client.get('/student/missions/END-01')).body.state).toBe('cleared');
  });

  it('per-session flags (INFO-01) are left to the lab service: honest 503, no try used, no XP', async () => {
    const s = await makeStudent(ctx);
    await start(s, 'INFO-01');
    const r = await s.client.post('/student/missions/INFO-01/steps/2/answer', {
      answer: 'YOJO_information_disclose_123456',
    });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('LAB_SERVICE_UNAVAILABLE');
    expect((await s.client.get('/student/missions/INFO-01')).body.steps[1].tries).toBe(0);
    expect(await total(s)).toBe(0);
  });

  it('a cleared lab pays nothing on replay', async () => {
    const s = await makeStudent(ctx);
    await start(s, 'SUB-01');
    await s.client.post('/student/missions/SUB-01/steps/1/read');
    await s.client.post('/student/missions/SUB-01/steps/2/answer', { answer: '10' });
    expect(await total(s)).toBe(50);
    const re = await start(s, 'SUB-01');
    expect(re.body.replay).toBe(true);
    expect((await s.client.post('/student/missions/SUB-01/steps/2/answer', { answer: '10' })).body).toMatchObject({
      xp: 0,
      already: true,
    });
    expect(await total(s)).toBe(50);
  });
});
