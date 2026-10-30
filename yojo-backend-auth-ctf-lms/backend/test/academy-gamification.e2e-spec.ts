import { GamificationService } from '../src/academy/gamification.service';
import { addDays, dateCol, istWeekStart } from '../src/academy/ist';
import { makeStaff, makeStudent, startApp, Client, type StaffUser, type TestCtx } from './helpers';

/**
 * Slice (a): XP ledger, streak with 48 h grace and the keep/reset decision, daily patches, weekly ops,
 * achievements, onboarding, leaderboard, admin corrections, league close. Learning events are recorded through
 * GamificationService, exactly as the lesson/lab/blog modules will record them (never from a client call).
 */
describe('Student Academy: XP, streaks, patches, ops, trophies, league', () => {
  let ctx: TestCtx;
  let game: GamificationService;
  let admin: StaffUser;
  beforeAll(async () => {
    ctx = await startApp();
    game = ctx.app.get(GamificationService);
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
  });
  afterAll(async () => ctx.app.close());

  const total = (id: string) => game.totalXp(id);
  const seedXp = (userId: string, delta: number, source: string) =>
    ctx.prisma.xpLedger.create({
      data: { userId, delta, kind: 'award', source, reason: 'test seed', weekStart: dateCol(istWeekStart()) },
    });

  it('only signed-in students reach /student/*; the dashboard starts empty and honest', async () => {
    expect((await (await new Client(ctx.server).init()).get('/student/dashboard')).status).toBe(401);
    expect((await admin.client.get('/student/dashboard')).status).toBe(403);
    const st = await makeStudent(ctx);
    const d = await st.client.get('/student/dashboard');
    expect(d.status).toBe(200);
    expect(d.body.xp).toMatchObject({ total: 0, thisWeek: 0, rank: { name: 'Rookie' } });
    expect(d.body.tiles).toMatchObject({
      totalXp: 0,
      streakDays: 0,
      labsCleared: 0,
      campaignsWon: 0,
    });
    expect(d.body.tiles.freeLabsTotal).toEqual(expect.any(Number)); // published free missions
    expect(d.body.profile.plan).toBe('free');
    expect(d.body.streak.pendingDecision).toBeNull();
    expect(d.body.activeOperation).toBeNull();
    expect(d.body.trophies.total).toBe(12);
  });

  it('daily patch: refused until the server saw the activity, paid once, and it starts the streak', async () => {
    const st = await makeStudent(ctx);
    const early = await st.client.post('/student/daily/lab/claim');
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('PATCH_NOT_DONE');
    await game.recordActivity(st.id, 'lab_completed', 'INT-01', { category: 'Defensive' });
    const ok = await st.client.post('/student/daily/lab/claim');
    expect(ok.status).toBe(200);
    expect(ok.body.xp).toBe(60);
    const again = await st.client.post('/student/daily/lab/claim');
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_CLAIMED');
    expect(await total(st.id)).toBe(60);
    const s = await st.client.get('/student/streak');
    expect(s.body).toMatchObject({ current: 1, todayCounts: true, pendingDecision: null });
    expect((await st.client.post('/student/daily/hack/claim')).status).toBe(404);
    // The same activity recorded twice on one day is one row.
    expect(await game.recordActivity(st.id, 'lab_completed', 'INT-01')).toBe(false);
  });

  it('weekly ops pay once when the verified count reaches the target', async () => {
    const st = await makeStudent(ctx);
    for (const ref of ['L1', 'L2', 'L3'])
      await game.recordActivity(st.id, 'lab_completed', ref, { category: 'Offensive' });
    const w1 = await st.client.get('/student/weekly-ops');
    const labs = w1.body.ops.find((o: { key: string }) => o.key === 'labs');
    expect(labs).toMatchObject({ progress: 3, target: 3, completed: true, paid: true });
    await st.client.get('/student/weekly-ops');
    const rows = await ctx.prisma.xpLedger.findMany({ where: { userId: st.id, source: { startsWith: 'weekly:' } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].delta).toBe(150);
    // first-offensive trophy came from the verified lab category
    const a = await st.client.get('/student/achievements');
    expect(a.body.items.find((x: { code: string }) => x.code === 'first-offensive').earned).toBe(true);
  });

  describe('streak grace (48 h) and the keep/reset decision', () => {
    async function brokenStudent(xp: number, hoursAgo: number, length = 5) {
      const st = await makeStudent(ctx);
      await seedXp(st.id, xp, 'test:seed');
      const at = new Date(Date.now() - hoursAgo * 3600_000);
      await ctx.prisma.streakState.create({
        data: {
          userId: st.id,
          current: length,
          longest: length,
          lastQualifiedAt: at,
          lastQualifiedDay: dateCol(addDays(istWeekStart(), 0)),
        },
      });
      return st;
    }

    it('inside 48 h the streak is alive; after 48 h the pop-up data appears with 10% of total XP, rounded', async () => {
      const alive = await brokenStudent(1650, 47);
      expect((await alive.client.get('/student/streak')).body.pendingDecision).toBeNull();

      const st = await brokenStudent(1650, 49);
      const s = await st.client.get('/student/streak');
      expect(s.body.pendingDecision).toMatchObject({
        streakLength: 5,
        keepCostXp: 165,
        xpNow: 1650,
        xpAfterKeep: 1485,
        keepCostPct: 10,
      });
      expect(s.body.current).toBe(5);

      const half = await brokenStudent(1655, 60);
      expect((await half.client.get('/student/streak')).body.pendingDecision.keepCostXp).toBe(166); // 165.5 rounds half up
    });

    it('Keep: −10% recorded in the ledger, streak continues, the decision is final and idempotent', async () => {
      // 3 days, so the weekly "keep a 5-day streak" op does not pay in the middle of this check
      const st = await brokenStudent(1650, 72, 3);
      const { breakId } = (await st.client.get('/student/streak')).body.pendingDecision;
      const r = await st.client.post('/student/streak/decision', { breakId, decision: 'keep' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ decision: 'keep', xpCost: 165, totalXp: 1485, replay: false });
      expect(r.body.streak).toMatchObject({ current: 3, pendingDecision: null });
      const pen = await ctx.prisma.xpLedger.findFirstOrThrow({ where: { userId: st.id, kind: 'penalty' } });
      expect(pen).toMatchObject({ delta: -165, source: `streak_keep:${breakId}` });
      const replay = await st.client.post('/student/streak/decision', { breakId, decision: 'keep' });
      expect(replay.body).toMatchObject({ replay: true, totalXp: 1485 });
      expect((await st.client.post('/student/streak/decision', { breakId, decision: 'reset' })).status).toBe(409);
      expect(await total(st.id)).toBe(1485);
      // the next lab day continues the kept streak
      await game.recordActivity(st.id, 'lab_completed', 'K1');
      await st.client.post('/student/daily/lab/claim');
      expect((await st.client.get('/student/streak')).body.current).toBe(4);
    });

    it('Reset: XP unchanged, streak 0; another student cannot answer it', async () => {
      const st = await brokenStudent(900, 50);
      const other = await makeStudent(ctx);
      const { breakId } = (await st.client.get('/student/streak')).body.pendingDecision;
      expect((await other.client.post('/student/streak/decision', { breakId, decision: 'keep' })).status).toBe(404);
      const r = await st.client.post('/student/streak/decision', { breakId, decision: 'reset' });
      expect(r.body).toMatchObject({ xpCost: 0, totalXp: 900 });
      expect(r.body.streak.current).toBe(0);
      expect(await ctx.prisma.xpLedger.count({ where: { userId: st.id, kind: 'penalty' } })).toBe(0);
    });

    it('a lab after the grace ran out opens the decision instead of silently extending the streak', async () => {
      const st = await brokenStudent(500, 55, 3);
      await game.recordActivity(st.id, 'lab_completed', 'LATE');
      await st.client.post('/student/daily/lab/claim');
      const s = (await st.client.get('/student/streak')).body;
      expect(s.pendingDecision).toMatchObject({ streakLength: 3 });
      const r = await st.client.post('/student/streak/decision', {
        breakId: s.pendingDecision.breakId,
        decision: 'reset',
      });
      expect(r.body.streak.current).toBe(1); // today's lab counts after the reset
    });
  });

  it('onboarding: questions without answer keys, scored once on the server, sets path and power levels', async () => {
    const st = await makeStudent(ctx);
    const q = await st.client.get('/student/onboarding');
    expect(q.body.done).toBe(false);
    expect(q.body.questions).toHaveLength(18);
    expect(JSON.stringify(q.body.questions)).not.toMatch(/"(key|w|map|forced|part)":/);
    const tooManySkips = Array(18)
      .fill(0)
      .map((_, i) => (i < 4 ? 'skip' : 1));
    expect((await st.client.post('/student/onboarding/quiz', { answers: tooManySkips })).status).toBe(400);
    const answers = [2, 1, 2, 1, 0, 0, 1, 1, 0, 1, 1, 1, 3, 5, 3, 2, 5, 0];
    const r = await st.client.post('/student/onboarding/quiz', { answers });
    expect(r.status).toBe(201);
    expect(r.body.primary).toBe('Defensive');
    expect((await st.client.post('/student/onboarding/quiz', { answers })).status).toBe(409);
    const d = (await st.client.get('/student/dashboard')).body;
    expect(d.profile.path).toBe('Defensive');
    expect(d.powerLevels).toEqual(r.body.scores);
    expect(d.trophies.items.find((x: { code: string }) => x.code === 'pathfinder').earned).toBe(true);
  });

  it('leaderboard: display names only, opt-out respected, ranks by XP', async () => {
    const a = await makeStudent(ctx);
    const b = await makeStudent(ctx);
    await seedXp(a.id, 50_000, 'test:lb');
    await seedXp(b.id, 40_000, 'test:lb');
    await ctx.prisma.studentProfile.update({ where: { userId: b.id }, data: { showOnBoard: false } });
    const ra = await a.client.get('/student/leaderboard?tab=all');
    expect(ra.status).toBe(200);
    expect(JSON.stringify(ra.body)).not.toContain('@');
    expect(ra.body.me).toMatchObject({ xp: 50_000 });
    expect(ra.body.rows.some((r: { xp: number; me: boolean }) => r.xp === 40_000 && !r.me)).toBe(false);
    const rb = await b.client.get('/student/leaderboard?tab=all');
    expect(rb.body.me).toMatchObject({ name: 'Hidden learner (you)', xp: 40_000 });
    expect(rb.body.me.rank).toBe(ra.body.me.rank + 1);
    expect((await a.client.get('/student/leaderboard?tab=college')).status).toBe(200);
    // OI-51: the weekly board explains the league and shows where the student stands
    const w = (await a.client.get('/student/leaderboard?tab=week')).body;
    expect(w.league).toMatchObject({
      division: 'bronze',
      divisionName: 'Bronze',
      promoteTop: 7,
      demoteBottom: 0, // nobody drops below Bronze
    });
    expect(w.league.divisions.map((d: { name: string }) => d.name)).toEqual([
      'Bronze',
      'Silver',
      'Gold',
      'Platinum',
      'Diamond',
    ]);
    expect(['promotion', 'safe', 'not_started']).toContain(w.league.zone);
    expect(w.league.guide.join(' ')).toMatch(/top 7 move up/);
    expect(ra.body.league).toBeNull();
    const fresh = await makeStudent(ctx);
    expect((await fresh.client.get('/student/leaderboard?tab=week')).body.league.zone).toBe('not_started');
  });

  it('achievements are awarded once from verified totals', async () => {
    const st = await makeStudent(ctx);
    await seedXp(st.id, 1200, 'test:ach');
    await game.afterChange(st.id);
    await game.afterChange(st.id);
    expect(await ctx.prisma.userAchievement.count({ where: { userId: st.id, code: 'xp-1000' } })).toBe(1);
  });

  it('admin XP correction: reason required, never below zero, audited; students and trainers refused', async () => {
    const st = await makeStudent(ctx);
    await seedXp(st.id, 100, 'test:corr');
    expect((await admin.client.post(`/admin/students/${st.id}/xp-corrections`, { delta: -50 })).status).toBe(400);
    expect(
      (
        await admin.client.post(`/admin/students/${st.id}/xp-corrections`, {
          delta: -500,
          reason: 'Duplicate lab award',
        })
      ).status,
    ).toBe(400);
    const ok = await admin.client.post(`/admin/students/${st.id}/xp-corrections`, {
      delta: -40,
      reason: 'Duplicate lab award',
    });
    expect(ok.status).toBe(201);
    expect(ok.body.total).toBe(60);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'admin.xp.corrected', targetId: st.id } })).toBe(1);
    expect((await admin.client.get(`/admin/students/${st.id}/xp`)).body.total).toBe(60);
    expect(
      (await st.client.post(`/admin/students/${st.id}/xp-corrections`, { delta: 999, reason: 'self help' })).status,
    ).toBe(403);
    const t = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    expect(
      (await t.client.post(`/admin/students/${st.id}/xp-corrections`, { delta: 1, reason: 'trainer try' })).status,
    ).toBe(403);
  });

  it('the ledger is append-only and one reward per source', async () => {
    const st = await makeStudent(ctx);
    const row = await seedXp(st.id, 10, 'test:once');
    await expect(ctx.prisma.xpLedger.update({ where: { id: row.id }, data: { delta: 9999 } })).rejects.toThrow();
    await expect(ctx.prisma.xpLedger.delete({ where: { id: row.id } })).rejects.toThrow();
    expect(await game.award({ userId: st.id, delta: 10, source: 'test:once', reason: 'retry' })).toBe(false);
    expect(await total(st.id)).toBe(10);
  });

  it('closing a past week ranks each division, promotes the top, and is idempotent', async () => {
    // a random far-past week, so reruns against the same test database never meet an already closed week
    const week = addDays(istWeekStart(), -7 * (200 + Math.floor(Math.random() * 20_000)));
    const users = [];
    for (let i = 0; i < 3; i++) {
      const st = await makeStudent(ctx);
      await ctx.prisma.xpLedger.create({
        data: {
          userId: st.id,
          delta: 100 * (3 - i),
          kind: 'award',
          source: 'test:league',
          reason: 'test league',
          weekStart: dateCol(week),
        },
      });
      users.push(st);
    }
    const r = await game.closeWeek(week);
    expect(r).toMatchObject({ closed: true, results: 3 });
    const first = await ctx.prisma.leagueResult.findUniqueOrThrow({
      where: { weekStart_userId: { weekStart: dateCol(week), userId: users[0].id } },
    });
    expect(first).toMatchObject({ rank: 1, outcome: 'promoted', division: 'bronze' });
    expect((await ctx.prisma.leagueMembership.findUniqueOrThrow({ where: { userId: users[0].id } })).division).toBe(
      'silver',
    );
    expect((await game.closeWeek(week)).closed).toBe(false);
    const ach = await users[0].client.get('/student/achievements');
    expect(ach.body.items.find((x: { code: string }) => x.code === 'league-win').earned).toBe(true);
  });
});
