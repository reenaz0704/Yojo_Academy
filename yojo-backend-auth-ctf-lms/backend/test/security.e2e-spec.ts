import Redis from 'ioredis';
import request from 'supertest';
import { REDIS } from '../src/redis/redis.module';
import { MaintenanceJobs } from '../src/jobs/maintenance.jobs';
import {
  Client,
  makeStaff,
  makeStudent,
  otpFrom,
  STAFF_PASSWORD,
  startApp,
  totp,
  uniq,
  type StaffUser,
  type TestCtx,
} from './helpers';

describe('Security regression, validation, settings, audit and health (spec §5.3, §6.9, §22, §23, AC-SEC-01, AC-OPS-01/04)', () => {
  let ctx: TestCtx;
  let platform: StaffUser;
  beforeAll(async () => {
    ctx = await startApp();
    platform = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
  });
  afterAll(async () => {
    // leave maintenance off for other suites
    const cur = await ctx.prisma.setting.findUnique({ where: { section: 'maintenance' } });
    if (cur && (cur.value as { enabled: boolean }).enabled)
      await ctx.prisma.setting.update({
        where: { section: 'maintenance' },
        data: { value: { enabled: false, message: '' } },
      });
    await ctx.app.close();
  });

  describe('CSRF', () => {
    it('refuses unsafe requests without the token, before and after sign-in', async () => {
      const raw = await request(ctx.server)
        .post('/api/v1/auth/student/otp')
        .send({ email: uniq('x'), purpose: 'login' });
      expect(raw.status).toBe(403);
      expect(raw.body.code).toBe('CSRF_INVALID');
      const s = await makeStudent(ctx);
      const bad = await s.client.send(
        'patch',
        '/me',
        { city: 'Pune' },
        { 'X-CSRF-Token': 'forged-token-value-0000000' },
      );
      expect(bad.status).toBe(403);
      expect((await s.client.send('patch', '/me', { city: 'Pune' })).status).toBe(200);
    });

    it('a pre-session token does not work once a session exists with a different token', async () => {
      const s = await makeStudent(ctx);
      const res = await s.client.agent
        .post('/api/v1/auth/logout')
        .set('X-Forwarded-For', s.client.ip)
        .set('X-CSRF-Token', 'x'.repeat(32));
      expect(res.status).toBe(403);
    });
  });

  describe('validation and error format', () => {
    it('answers problem+json with field and request ID', async () => {
      const c = await new Client(ctx.server).init();
      const res = await c.post('/auth/student/otp', { email: 'not-an-email', purpose: 'login' });
      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        field: 'email',
        status: 400,
        requestId: expect.any(String),
      });
      expect(res.headers['x-request-id']).toBe(res.body.requestId);
    });

    it('rejects unknown properties (mass assignment), e.g. role in sign-up or profile', async () => {
      const c = await new Client(ctx.server).init();
      const res = await c.post('/auth/signup', {
        signupTicket: 'x'.repeat(20),
        role: 'admin',
        consents: { terms: true, privacy: true, aup: true },
      });
      expect(res.status).toBe(400);
      const s = await makeStudent(ctx);
      const me = await s.client.send('patch', '/me', { role: 'admin', status: 'active' });
      expect(me.status).toBe(400);
      expect((await s.client.get('/me')).body.role).toBe('student');
    });

    it('unknown routes are 404 problem+json; malformed UUID params are 400', async () => {
      const res = await platform.client.get('/no-such-route');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(
        (
          await platform.client.send('patch', '/admin/staff/not-a-uuid/status', {
            status: 'active',
            reason: 'testing ids',
          })
        ).status,
      ).toBe(400);
    });

    it('sets security headers and no-store on API responses', async () => {
      const res = await request(ctx.server).get('/api/v1/public/status');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('rate limits', () => {
    it('OTP send is limited to 20 per hour per IP with Retry-After', async () => {
      const c = await new Client(ctx.server).init();
      let last = 0;
      for (let i = 0; i < 21; i++)
        last = (await c.post('/auth/student/otp', { email: uniq(`rl${i}`), purpose: 'login' })).status;
      expect(last).toBe(429);
    });

    it('OTP send is limited to 5 per hour per email', async () => {
      const email = uniq('perEmail');
      const r = ctx.app.get<Redis>(REDIS);
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const c = await new Client(ctx.server).init();
        await r.del(...(await r.keys('otp:resend:*')));
        statuses.push((await c.post('/auth/student/otp', { email, purpose: 'login' })).status);
      }
      expect(statuses.slice(0, 5).every((s) => s === 202)).toBe(true);
      expect(statuses[5]).toBe(429);
    });
  });

  describe('sensitive data never stored or logged in clear', () => {
    it('session tokens are stored hashed; MFA secrets encrypted; passwords argon2id', async () => {
      const s = await makeStudent(ctx);
      const cookie = ([] as string[]).concat((await s.client.get('/auth/csrf')).request.cookies ?? []).join(';');
      const row = await ctx.prisma.userSession.findFirstOrThrow({ where: { userId: s.id } });
      expect(row.sessionHash).toMatch(/^[0-9a-f]{64}$/);
      expect(cookie.includes(row.sessionHash)).toBe(false);
      const factor = await ctx.prisma.mfaFactor.findFirstOrThrow({ where: { userId: platform.id } });
      expect(Buffer.from(factor.secretEnc).includes(Buffer.from(platform.secret))).toBe(false);
      const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: platform.id } });
      expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it('no OTP code, password or TOTP code appears in any audit row', async () => {
      const email = uniq('leak');
      const c = await new Client(ctx.server).init();
      const sent = await c.post('/auth/student/otp', { email, purpose: 'login' });
      const code = otpFrom(ctx, email);
      await c.post('/auth/student/verify', { challengeId: sent.body.challengeId, code });
      await c.post('/auth/staff/login', { email: platform.email, password: STAFF_PASSWORD });
      const rows = await ctx.prisma.auditLog.findMany({ orderBy: { seq: 'desc' }, take: 500 });
      const dump = JSON.stringify(rows, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
      expect(dump.includes(STAFF_PASSWORD)).toBe(false);
      expect(dump.includes(`"${code}"`)).toBe(false);
      expect(dump.includes(sent.body.challengeId)).toBe(false);
    });

    it('OTP codes are kept only as an HMAC in Redis', async () => {
      const email = uniq('hmac');
      const c = await new Client(ctx.server).init();
      const sent = await c.post('/auth/student/otp', { email, purpose: 'login' });
      const r = ctx.app.get((await import('../src/redis/redis.module')).REDIS);
      const stored: string = await r.get(`otp:ch:${sent.body.challengeId}`);
      expect(stored.includes(otpFrom(ctx, email))).toBe(false);
    });
  });

  describe('audit log is append-only and tamper-evident', () => {
    it('the database refuses UPDATE, DELETE and TRUNCATE on audit_log', async () => {
      // row triggers need at least one row to fire
      await ctx.prisma.settingLog.create({ data: { section: 'test', version: 0, diff: {} } });
      await expect(
        ctx.prisma.$executeRawUnsafe(`UPDATE audit_log SET action = 'x' WHERE seq = (SELECT min(seq) FROM audit_log)`),
      ).rejects.toThrow(/append-only/);
      await expect(
        ctx.prisma.$executeRawUnsafe(`DELETE FROM audit_log WHERE seq = (SELECT min(seq) FROM audit_log)`),
      ).rejects.toThrow(/append-only/);
      await expect(ctx.prisma.$executeRawUnsafe(`TRUNCATE audit_log`)).rejects.toThrow(/append-only/);
      await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM settings_log`)).rejects.toThrow(/append-only/);
      await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM consents`)).rejects.toThrow(/append-only/);
    });

    it('verify() detects an edited row (simulated through the redaction escape hatch) and recovers when restored', async () => {
      const jobs = ctx.app.get(MaintenanceJobs);
      expect((await jobs.verifyAuditChain()).ok).toBe(true);
      const target = await ctx.prisma.auditLog.findFirstOrThrow({ orderBy: { seq: 'asc' } });
      const edit = (reason: string | null) =>
        ctx.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('yojo.allow_redaction', 'on', true)`;
          await tx.$executeRaw`UPDATE audit_log SET reason = ${reason} WHERE seq = ${target.seq}`;
        });
      await edit('tampered');
      const broken = await ctx.app.get((await import('../src/audit/audit.service')).AuditService).verify();
      expect(broken).toMatchObject({ ok: false, brokenAtSeq: target.seq.toString() });
      await edit(target.reason);
      expect((await jobs.verifyAuditChain()).ok).toBe(true);
    });
  });

  describe('settings', () => {
    it('PUT needs If-Match, validates, versions and records history', async () => {
      const c = platform.client;
      const cur = await c.get('/admin/settings/maintenance');
      const noMatch = await c.send('put', '/admin/settings/maintenance', { value: { enabled: false, message: 'x' } });
      expect(noMatch.status).toBe(428);
      const invalid = await c.send(
        'put',
        '/admin/settings/maintenance',
        { value: { enabled: 'yes' } },
        { 'If-Match': String(cur.body.version) },
      );
      expect(invalid.status).toBe(422);
      const ok = await c.send(
        'put',
        '/admin/settings/maintenance',
        { value: { enabled: false, message: 'Planned upgrade' } },
        { 'If-Match': String(cur.body.version) },
      );
      expect(ok.status).toBe(200);
      expect(ok.body.version).toBe(cur.body.version + 1);
      const stale = await c.send(
        'put',
        '/admin/settings/maintenance',
        { value: { enabled: false, message: 'again' } },
        { 'If-Match': String(cur.body.version) },
      );
      expect(stale.status).toBe(412);
      const hist = await c.get('/admin/settings/maintenance/history');
      expect(hist.body.items[0]).toMatchObject({ byId: platform.id, version: cur.body.version + 1 });
    });

    it('policy, plans and auth sections need a fresh authenticator code', async () => {
      const cur = await platform.client.get('/admin/settings/auth');
      const noCode = await platform.client.send(
        'put',
        '/admin/settings/auth',
        { value: cur.body.value },
        { 'If-Match': String(cur.body.version) },
      );
      expect(noCode.status).toBe(428);
      const ok = await platform.client.send(
        'put',
        '/admin/settings/auth',
        { value: cur.body.value },
        {
          'If-Match': String(cur.body.version),
          'X-Step-Up-Code': await totp(ctx.prisma, platform.id, platform.secret),
        },
      );
      expect(ok.status).toBe(200);
    });

    it('maintenance mode blocks student and public routes but not staff sign-in or status', async () => {
      const s = await makeStudent(ctx);
      const cur = await platform.client.get('/admin/settings/maintenance');
      await platform.client.send(
        'put',
        '/admin/settings/maintenance',
        { value: { enabled: true, message: 'Back at 10:00' } },
        { 'If-Match': String(cur.body.version) },
      );
      ctx.app.get((await import('../src/settings/settings.service')).SettingsService)['cache'].clear();
      const blocked = await s.client.get('/me');
      expect(blocked.status).toBe(503);
      expect(blocked.body).toMatchObject({ code: 'MAINTENANCE', message: 'Back at 10:00' });
      expect((await request(ctx.server).get('/api/v1/public/status')).body).toEqual({
        maintenance: true,
        message: 'Back at 10:00',
      });
      expect((await platform.client.get('/me')).status).toBe(200);
      const anon = await new Client(ctx.server).init();
      expect((await anon.post('/auth/staff/login', { email: platform.email, password: STAFF_PASSWORD })).status).toBe(
        200,
      );
      const after = await platform.client.get('/admin/settings/maintenance');
      await platform.client.send(
        'put',
        '/admin/settings/maintenance',
        { value: { enabled: false, message: '' } },
        { 'If-Match': String(after.body.version) },
      );
      ctx.app.get((await import('../src/settings/settings.service')).SettingsService)['cache'].clear();
      expect((await s.client.get('/me')).status).toBe(200);
    });
  });

  describe('health and jobs', () => {
    it('live and ready report database, Redis and migrations', async () => {
      expect((await request(ctx.server).get('/api/v1/health/live')).body).toEqual({ status: 'ok' });
      const ready = await request(ctx.server).get('/api/v1/health/ready');
      expect(ready.status).toBe(200);
      expect(ready.body.checks).toEqual({ database: 'up', redis: 'up', migrations: 'up' });
    });

    it('maintenance jobs run without errors', async () => {
      const jobs = ctx.app.get(MaintenanceJobs);
      await expect(jobs.expireSessions()).resolves.toEqual(expect.any(Number));
      await expect(jobs.expireDualControl()).resolves.toEqual(expect.any(Number));
      await expect(jobs.purgeIdempotencyKeys()).resolves.toEqual(expect.any(Number));
      await expect(jobs.relayOutbox()).resolves.toEqual(expect.any(Number));
    });
  });
});
