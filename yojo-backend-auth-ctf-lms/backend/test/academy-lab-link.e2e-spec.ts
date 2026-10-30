import { createHmac, randomInt } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeStudent, startApp, type TestCtx } from './helpers';

/**
 * Server-to-server link to the lab service (mission-api), 24 Oct. A stand-in implements the routes the Academy uses
 * and checks the signature exactly as mission-api's _service_identity does (HMAC-SHA256 over
 * "<user>|<ts>|<METHOD>|<path>"). This proves the Academy's side of the contract; the real mission-api is tested by
 * mission-api/tests/test_academy_link.py.
 */
const SECRET = 'test-mission-service-secret-0123456789abcdef';

interface LabSession {
  id: string;
  user: string;
  status: 'active' | 'stopped';
  flag: string;
}

function stubLabService() {
  const sessions = new Map<string, LabSession>();
  const seen: { user: string; path: string }[] = [];
  const body = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((res) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => res(d ? (JSON.parse(d) as Record<string, unknown>) : {}));
    });
  const server: Server = createServer(async (req, res) => {
    const send = (code: number, j: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(j));
    };
    const path = (req.url ?? '').split('?')[0];
    if (path === '/healthz') return send(200, { ok: true });
    const user = String(req.headers['x-academy-user'] ?? '');
    const ts = String(req.headers['x-academy-ts'] ?? '');
    const sig = String(req.headers['x-academy-sig'] ?? '');
    const want = createHmac('sha256', SECRET).update(`${user}|${ts}|${req.method}|${path}`).digest('hex');
    if (!sig || sig !== want || Math.abs(Date.now() / 1000 - Number(ts)) > 120)
      return send(401, { detail: 'Sign in again to continue.' });
    seen.push({ user, path });
    const m = /^\/api\/(m\d)\/(session\/current|session\/start|session\/stop|submit)$/.exec(path);
    if (!m) return send(404, { detail: 'Not found.' });
    const key = `${user}:${m[1]}`;
    const cur = sessions.get(key);
    const view = (s?: LabSession) =>
      s
        ? {
            session_id: s.id,
            status: s.status,
            url: s.status === 'active' ? `http://info-01-${s.id.slice(0, 4)}.ctf.localhost:8088/` : null,
          }
        : { status: 'none' };
    if (m[2] === 'session/current') return send(200, view(cur));
    if (m[2] === 'session/start') {
      if (cur?.status === 'active') return send(200, view(cur));
      const s: LabSession = {
        id: randomInt(1e11, 1e12).toString(16).padStart(12, '0').slice(0, 12),
        user,
        status: 'active',
        flag: `YOJO_information_disclose_${randomInt(100000, 999999)}`,
      };
      sessions.set(key, s);
      return send(200, view(s));
    }
    const b = await body(req);
    if (!cur || cur.id !== b.session_id) return send(404, { detail: 'Session not found.' }); // another user's session looks missing
    if (m[2] === 'session/stop') {
      cur.status = 'stopped';
      return send(200, view(cur));
    }
    if (cur.status !== 'active') return send(409, { detail: 'Start the lab to submit a solution.' });
    const answer = String(b.answer ?? '').trim();
    if (!answer) return send(422, { detail: 'Enter the flag you found.' });
    return send(200, {
      accepted: answer === cur.flag,
      message: answer === cur.flag ? 'Correct! Flag accepted.' : 'That flag is not correct.',
    });
  });
  return { server, sessions, seen };
}

describe('Student Academy: lab environments through the lab service link', () => {
  let ctx: TestCtx;
  const stub = stubLabService();

  beforeAll(async () => {
    await new Promise<void>((r) => stub.server.listen(0, '127.0.0.1', () => r()));
    process.env.LAB_PROVIDER_URL = `http://127.0.0.1:${(stub.server.address() as AddressInfo).port}`;
    process.env.MISSION_SERVICE_SECRET = SECRET;
    ctx = await startApp();
  });
  afterAll(async () => {
    await ctx.app.close();
    process.env.LAB_PROVIDER_URL = '';
    process.env.MISSION_SERVICE_SECRET = '';
    await new Promise((r) => stub.server.close(r));
  });

  it('start, read the flag from my own lab, submit it: verified by the lab service, XP paid by the Academy once', async () => {
    const st = await makeStudent(ctx);
    expect((await st.client.get('/student/missions')).body.providerAvailable).toBe(true);
    expect((await st.client.get('/student/missions/INFO-01/lab')).body).toMatchObject({
      available: true,
      status: 'none',
    });
    expect((await st.client.post('/student/missions/INFO-01/lab/start')).body.code).toBe('NO_ACTIVE_ATTEMPT');
    await st.client.post('/student/missions/INFO-01/attempts');
    // a flag before the lab runs: refused without using a try
    expect(
      (await st.client.post('/student/missions/INFO-01/steps/2/answer', { answer: 'YOJO_information_disclose_1' })).body
        .code,
    ).toBe('LAB_NOT_RUNNING');
    const lab = await st.client.post('/student/missions/INFO-01/lab/start');
    expect(lab.body).toMatchObject({ available: true, status: 'active' });
    expect(lab.body.url).toMatch(/^http:\/\/info-01-/);
    // identity sent to the lab service is the Academy user id, signed
    expect(stub.seen.every((x) => x.user === st.id)).toBe(true);
    const mine = stub.sessions.get(`${st.id}:m4`)!;
    const wrong = await st.client.post('/student/missions/INFO-01/steps/2/answer', {
      answer: 'YOJO_information_disclose_000000',
    });
    expect(wrong.body.code).toBe('WRONG_ANSWER');
    await st.client.post('/student/missions/INFO-01/steps/1/read');
    const ok = await st.client.post('/student/missions/INFO-01/steps/2/answer', { answer: ` ${mine.flag} ` });
    expect(ok.body).toMatchObject({ stepDone: true, xp: 50, cleared: true });
    expect((await st.client.get('/student/dashboard')).body.xp.total).toBe(50);
    expect((await st.client.post('/student/missions/INFO-01/lab/stop')).body.status).toBe('stopped');
  });

  it("another student's flag is rejected (each lab has its own flag)", async () => {
    const a = await makeStudent(ctx);
    const b = await makeStudent(ctx);
    for (const s of [a, b]) {
      await s.client.post('/student/missions/INFO-01/attempts');
      await s.client.post('/student/missions/INFO-01/lab/start');
    }
    const flagA = stub.sessions.get(`${a.id}:m4`)!.flag;
    expect((await b.client.post('/student/missions/INFO-01/steps/2/answer', { answer: flagA })).body.code).toBe(
      'WRONG_ANSWER',
    );
  });

  it('the lab service refuses unsigned or tampered requests', async () => {
    const base = process.env.LAB_PROVIDER_URL!;
    expect((await fetch(`${base}/api/m4/session/current`)).status).toBe(401);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', SECRET)
      .update(`00000000-0000-0000-0000-000000000001|${ts}|GET|/api/m4/session/current`)
      .digest('hex');
    const forged = await fetch(`${base}/api/m4/session/current`, {
      headers: { 'X-Academy-User': '00000000-0000-0000-0000-000000000002', 'X-Academy-Ts': ts, 'X-Academy-Sig': sig },
    });
    expect(forged.status).toBe(401);
  });
});
