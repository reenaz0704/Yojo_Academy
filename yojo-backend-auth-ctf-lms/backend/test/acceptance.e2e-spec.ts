import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import Redis from 'ioredis';
import request from 'supertest';
import { sha256 } from '../src/common/crypto/crypto.util';
import { REDIS } from '../src/redis/redis.module';
import { Client, makeStaff, makeStudent, STAFF_PASSWORD, startApp, uniq, type TestCtx } from './helpers';

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1];

describe('M1 acceptance checks that need timing, expiry or real logs (AC-AUTH-05, AC-AUTH-09, AC-AUTH-10, AC-OPS-01)', () => {
  let ctx: TestCtx;
  beforeAll(async () => (ctx = await startApp()));
  afterAll(async () => ctx.app.close());

  it('AC-AUTH-05: a staff session ends after 30 minutes idle', async () => {
    const s = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    const row = await ctx.prisma.userSession.findFirstOrThrow({ where: { userId: s.id, revokedAt: null } });
    const redis = ctx.app.get<Redis>(REDIS);
    const key = `sess:${row.sessionHash}`;
    const data = JSON.parse((await redis.get(key))!) as { lastActivity: number; idleMs: number };
    expect(data.idleMs).toBe(30 * 60_000);
    data.lastActivity -= 31 * 60_000;
    await redis.set(key, JSON.stringify(data), 'KEEPTTL');
    expect((await s.client.get('/me')).status).toBe(401);
    expect((await ctx.prisma.userSession.findUniqueOrThrow({ where: { id: row.id } })).revokeReason).toBe('expired');
  });

  it('AC-AUTH-10: staff get 403 on student-only routes; students 403 on trainer and admin routes', async () => {
    const t = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    const st = await makeStudent(ctx);
    expect((await t.client.get('/me/missing-fields')).status).toBe(403);
    expect((await st.client.get('/trainer/audit')).status).toBe(403);
    expect((await st.client.get('/admin/staff')).status).toBe(403);
  });

  it('AC-AUTH-09: staff login and password reset answer the same for existing and unknown accounts (content, p95 timing within 50 ms)', async () => {
    const s = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    const c = await new Client(ctx.server).init();
    const time = async (fn: () => Promise<request.Response>) => {
      const t0 = process.hrtime.bigint();
      const res = await fn();
      return { ms: Number(process.hrtime.bigint() - t0) / 1e6, res };
    };
    const known: number[] = [];
    const unknown: number[] = [];
    let kBody: unknown, uBody: unknown;
    for (let i = 0; i < 12; i++) {
      const a = await time(() => c.post('/auth/staff/login', { email: s.email, password: 'Wrong-Pass-123!' }));
      const b = await time(() =>
        c.post('/auth/staff/login', { email: uniq('nobody', 'yojosolutions.com'), password: 'Wrong-Pass-123!' }),
      );
      known.push(a.ms);
      unknown.push(b.ms);
      kBody = { ...a.res.body, requestId: undefined };
      uBody = { ...b.res.body, requestId: undefined };
      // stay under the lock threshold
      await ctx.prisma.user.update({ where: { id: s.id }, data: { failedLogins: 0 } });
    }
    expect(kBody).toEqual(uBody);
    expect(Math.abs(p95(known) - p95(unknown))).toBeLessThan(50);

    const fk: number[] = [];
    const fu: number[] = [];
    for (let i = 0; i < 8; i++) {
      const f = await new Client(ctx.server).init(); // its own IP: the forgot route allows 10 per hour per IP
      const a = await time(() => f.post('/auth/password/forgot', { email: s.email }));
      const b = await time(() => f.post('/auth/password/forgot', { email: uniq('ghost', 'yojosolutions.com') }));
      expect(a.res.status).toBe(202);
      expect(a.res.body).toEqual(b.res.body);
      fk.push(a.ms);
      fu.push(b.ms);
    }
    expect(Math.abs(p95(fk) - p95(fu))).toBeLessThan(50);
  });

  it('AC-AUTH-09: OTP send does not depend on whether the account exists', async () => {
    const st = await makeStudent(ctx);
    const r = ctx.app.get<Redis>(REDIS);
    await r.del(...(await r.keys(`otp:resend:*:${sha256(st.email)}`)));
    const c = await new Client(ctx.server).init();
    const a = await c.post('/auth/student/otp', { email: st.email, purpose: 'login' });
    const b = await c.post('/auth/student/otp', { email: uniq('nobody'), purpose: 'login' });
    expect(a.status).toBe(b.status);
    expect(Object.keys(a.body)).toEqual(Object.keys(b.body));
  });
});

describe('AC-OPS-01: request IDs and trace IDs in real logs; no secrets in logs', () => {
  let proc: ChildProcessWithoutNullStreams;
  let out = '';
  const port = 3900 + Math.floor(Math.random() * 90);
  const base = `http://127.0.0.1:${port}`;

  beforeAll(async () => {
    proc = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/main.ts'], {
      env: { ...process.env, PORT: String(port), LOG_LEVEL: 'debug', DEV_MAIL_DIR: '' },
    });
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (out += d.toString()));
    const end = Date.now() + 25_000;
    while (!out.includes('Nest application successfully started')) {
      if (Date.now() > end) throw new Error(`server did not start:\n${out}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }, 30_000);

  afterAll(() => {
    proc.kill('SIGTERM');
  });

  it('logs carry request and trace IDs; codes, passwords, cookies and tokens never appear', async () => {
    const agent = request.agent(base);
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string;
    const email = uniq('logscan');
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const sent = await agent
      .post('/api/v1/auth/student/otp')
      .set('X-CSRF-Token', csrf)
      .set('traceparent', `00-${traceId}-00f067aa0ba902b7-01`)
      .send({ email, purpose: 'login' });
    expect(sent.status).toBe(202);
    await agent
      .post('/api/v1/auth/student/verify')
      .set('X-CSRF-Token', csrf)
      .send({ challengeId: sent.body.challengeId, code: '123456' });
    await agent
      .post('/api/v1/auth/staff/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'x@yojosolutions.com', password: STAFF_PASSWORD });
    await new Promise((r) => setTimeout(r, 300));

    const lines = out
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const httpLines = lines.filter((l) => l.req);
    expect(httpLines.length).toBeGreaterThanOrEqual(4);
    for (const l of httpLines) {
      expect((l.req as { id: string }).id).toEqual(expect.any(String));
      expect(l.traceId).toEqual(expect.any(String));
    }
    expect(httpLines.some((l) => l.traceId === traceId)).toBe(true);
    expect(out).not.toContain(STAFF_PASSWORD);
    expect(out).not.toContain(csrf);
    expect(out).not.toContain(sent.body.challengeId);
    expect(out).not.toMatch(/"cookie"\s*:\s*"[^[]/i);
    expect(out).not.toMatch(/set-cookie/i);
  });
});
