import { SettingsService } from '../src/settings/settings.service';
import { makeStaff, makeStudent, startApp, type StaffUser, type TestCtx } from './helpers';

/**
 * Slice (e): the honest lab-service boundary, native missions checked on the server, hints (order, escalating cost,
 * never refunded), both hint bases, replays at 0 XP, locks, the World Breach Map, and admin-only secrets.
 */
describe('Student Academy: missions and hints', () => {
  let ctx: TestCtx;
  let admin: StaffUser;
  const tag = Date.now().toString(36).toUpperCase().slice(-5);
  const N = `NT-${tag}`;
  const FLAG = 'YOJO{test_flag_' + tag + '}';

  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    // earlier runs' test missions must not keep Tokyo from being secured
    await ctx.prisma.mission.updateMany({ where: { code: { startsWith: 'NT-' } }, data: { status: 'retired' } });
    const m = await admin.client.post('/admin/missions', {
      code: N,
      title: 'Decode the beacon',
      category: 'Offensive',
      xpReward: 100,
      cityCode: 'tokyo',
      status: 'published',
    });
    expect(m.status).toBe(201);
    for (const n of [1, 2, 3])
      expect(
        (await admin.client.send('put', `/admin/missions/${N}/hints`, { n, text: `Hint number ${n}` })).status,
      ).toBe(200);
    expect((await admin.client.send('put', `/admin/missions/${N}/flag`, { flag: FLAG })).status).toBe(200);
  });
  afterAll(async () => ctx.app.close());

  it('labs that need the Python lab service say so honestly (24 Oct: their steps still run here)', async () => {
    const st = await makeStudent(ctx);
    const list = await st.client.get('/student/missions');
    expect(list.body.providerAvailable).toBe(false);
    const web = list.body.items.find((m: { code: string }) => m.code === 'WEB-01');
    expect(web).toMatchObject({ serviceAvailable: false, provider: 'mission-api', xp: 50 });
    // INT-01 (lesson + quiz) now runs entirely on this server
    expect(list.body.items.find((m: { code: string }) => m.code === 'INT-01')).toMatchObject({
      serviceAvailable: true,
      provider: 'native',
      xp: 100,
    });
    // a lab with steps can be started while the lab service is offline; per-session flags then answer 503
    expect((await st.client.post('/student/missions/WEB-01/attempts')).status).toBe(200);
    const d = await st.client.get('/student/dashboard');
    expect(d.body.tiles.freeLabsTotal).toBeGreaterThanOrEqual(10);
  });

  it('answers never leave the server (student or admin views)', async () => {
    const st = await makeStudent(ctx);
    const blob = JSON.stringify([
      (await st.client.get(`/student/missions/${N}`)).body,
      (await admin.client.get('/admin/missions')).body,
    ]);
    expect(blob).not.toContain(FLAG);
    expect(blob).not.toMatch(/flagHash|flagSalt|Hint number/);
  });

  it('the admin editor gets hint texts but never the answer hash', async () => {
    const one = await admin.client.get(`/admin/missions/${N}`);
    expect(one.status).toBe(200);
    expect(one.body.hints.map((h: { n: number }) => h.n)).toEqual([1, 2, 3]);
    expect(one.body.hasFlag).toBe(true);
    expect(JSON.stringify(one.body)).not.toMatch(new RegExp(`flagHash|flagSalt|${FLAG}`));
    expect((await admin.client.get('/admin/missions/NOPE-99')).status).toBe(404);
    const st = await makeStudent(ctx);
    expect((await st.client.get(`/admin/missions/${N}`)).status).toBe(403);
  });

  it('hints in order at 5% then 10%, reward cut at clear, wrong answers counted, replay pays 0', async () => {
    const st = await makeStudent(ctx);
    expect((await st.client.post(`/student/missions/${N}/hints`)).body.code).toBe('NO_ACTIVE_ATTEMPT');
    expect((await st.client.post(`/student/missions/${N}/attempts`)).status).toBe(200);
    const h1 = await st.client.post(`/student/missions/${N}/hints`);
    expect(h1.body).toMatchObject({
      n: 1,
      text: 'Hint number 1',
      pct: 5,
      basis: 'lab_reward',
      xpCost: null,
      hintsLeft: 2,
    });
    const h2 = await st.client.post(`/student/missions/${N}/hints`);
    expect(h2.body).toMatchObject({ n: 2, pct: 10 });
    const d = await st.client.get(`/student/missions/${N}`);
    expect(d.body.hints).toMatchObject({ nextCostPct: 15, rewardIfClearedNow: 85 });
    expect(d.body.hints.used.map((u: { text: string }) => u.text)).toEqual(['Hint number 1', 'Hint number 2']);
    const wrong = await st.client.post(`/student/missions/${N}/submit`, { flag: 'YOJO{nope}' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.details.submissionsLeft).toBe(19);
    const ok = await st.client.post(`/student/missions/${N}/submit`, { flag: `  ${FLAG} ` });
    expect(ok.body).toMatchObject({ cleared: true, firstClear: true, xp: 85, hintCutPct: 15 });
    const ledger = await ctx.prisma.xpLedger.findMany({ where: { userId: st.id, source: `lab:${N}:clear` } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: 85, qualifies: true });
    // verified lab → daily patch, streak, trophy
    expect((await st.client.post('/student/daily/lab/claim')).status).toBe(200);
    expect((await st.client.get('/student/streak')).body.current).toBe(1);
    expect(
      (await st.client.get('/student/achievements')).body.items.find(
        (x: { code: string }) => x.code === 'first-offensive',
      ).earned,
    ).toBe(true);
    // replay: allowed, 0 XP, no hint
    await st.client.post(`/student/missions/${N}/attempts`);
    expect((await st.client.post(`/student/missions/${N}/hints`)).body.code).toBe('MISSION_CLEARED');
    expect((await st.client.post(`/student/missions/${N}/submit`, { flag: FLAG })).body).toMatchObject({
      firstClear: false,
      xp: 0,
    });
    expect(await ctx.prisma.xpLedger.count({ where: { userId: st.id, source: { startsWith: `lab:${N}` } } })).toBe(1);
  });

  it('hints are never refunded by abandoning and restarting; max 3', async () => {
    const st = await makeStudent(ctx);
    await st.client.post(`/student/missions/${N}/attempts`);
    await st.client.post(`/student/missions/${N}/hints`);
    expect((await st.client.post(`/student/missions/${N}/abandon`)).status).toBe(200);
    await st.client.post(`/student/missions/${N}/attempts`);
    expect((await st.client.post(`/student/missions/${N}/hints`)).body.n).toBe(2);
    expect((await st.client.post(`/student/missions/${N}/hints`)).body.n).toBe(3);
    expect((await st.client.post(`/student/missions/${N}/hints`)).body.code).toBe('NO_HINTS_LEFT');
    expect((await st.client.post(`/student/missions/${N}/submit`, { flag: FLAG })).body.xp).toBe(70); // 100 − 30%
  });

  it('total-XP basis: each hint is charged at once from the total, whole numbers; the lab pays in full', async () => {
    const settings = ctx.app.get(SettingsService);
    const cur = await settings.get('gamification');
    const actor = { userId: admin.id, adminRole: 'platform' as const };
    const v1 = await settings.update('gamification', { ...cur.value, hintBase: 'total_xp' }, cur.version, actor);
    try {
      const st = await makeStudent(ctx);
      await ctx.prisma.xpLedger.create({
        data: {
          userId: st.id,
          delta: 1005,
          kind: 'award',
          source: 'test:seed',
          reason: 'test seed',
          weekStart: new Date(),
        },
      });
      await st.client.post(`/student/missions/${N}/attempts`);
      const h = await st.client.post(`/student/missions/${N}/hints`);
      expect(h.body).toMatchObject({ basis: 'total_xp', xpCost: 50 }); // 5% of 1005 = 50.25 → 50
      expect((await st.client.post(`/student/missions/${N}/submit`, { flag: FLAG })).body.xp).toBe(100);
      const total = await ctx.prisma.xpLedger.aggregate({ where: { userId: st.id }, _sum: { delta: true } });
      expect(total._sum.delta).toBe(1005 - 50 + 100);
    } finally {
      await settings.update('gamification', cur.value, v1.version, actor);
    }
  });

  it('premium and prerequisite locks; the World Breach Map secures a city only when its missions are cleared', async () => {
    const P = `NP-${tag}`;
    await admin.client.post('/admin/missions', {
      code: P,
      title: 'Premium op',
      category: 'Defensive',
      xpReward: 10,
      premium: true,
      prerequisites: [N],
      status: 'published',
    });
    const st = await makeStudent(ctx);
    const lock = await st.client.post(`/student/missions/${P}/attempts`);
    expect(lock.status).toBe(403);
    expect(lock.body.details.reason).toBe('premium');
    await ctx.prisma.entitlement.create({
      data: { studentId: st.id, key: 'plan:paid', source: 'manual', reason: 'test paid access' },
    });
    expect((await st.client.post(`/student/missions/${P}/attempts`)).body.details.reason).toBe('prerequisite');

    const before = (await st.client.get('/student/cities')).body.find((c: { code: string }) => c.code === 'tokyo');
    expect(before).toMatchObject({ secured: false, cleared: 0 });
    await st.client.post(`/student/missions/${N}/attempts`);
    await st.client.post(`/student/missions/${N}/submit`, { flag: FLAG });
    const after = (await st.client.get('/student/cities')).body.find((c: { code: string }) => c.code === 'tokyo');
    expect(after).toMatchObject({ secured: true, progressPct: 100 });
    const empty = (await st.client.get('/student/cities')).body.find((c: { code: string }) => c.code === 'cairo');
    expect(empty).toMatchObject({ missions: 0, secured: false });
  });

  it('mission admin and answers are for admins only', async () => {
    const st = await makeStudent(ctx);
    const t = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    for (const c of [st.client, t.client]) {
      expect((await c.get('/admin/missions')).status).toBe(403);
      expect((await c.send('put', `/admin/missions/${N}/flag`, { flag: 'x' })).status).toBe(403);
    }
  });
});
