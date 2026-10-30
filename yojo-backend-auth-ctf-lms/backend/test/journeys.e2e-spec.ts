import { currentStep, totpAt } from '../src/identity/totp';
import {
  clearResend,
  Client,
  makeStaff,
  makeStudent,
  otpFrom,
  startApp,
  totp,
  uniq,
  type StaffUser,
  type TestCtx,
} from './helpers';

const CTF_PASSWORD = 'Ctf-Pl4yer-Pass!';

/** Registers a CTF account through the real API and returns the signed-in client. */
async function registerCtf(ctx: TestCtx, opts: { email?: string; username?: string; client?: Client } = {}) {
  const email = opts.email ?? uniq('ctf');
  const username = opts.username ?? `p_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const c = opts.client ?? (await new Client(ctx.server).init());
  await clearResend(ctx, email);
  const sent = await c.post('/ctf/register/otp', { email });
  expect(sent.status).toBe(202);
  const res = await c.post('/ctf/register', {
    challengeId: sent.body.challengeId,
    code: otpFrom(ctx, email),
    username,
    password: CTF_PASSWORD,
    consents: { ctf_rules: true, ctf_contact: false },
    institution: 'ABC Institute',
  });
  return { c, email, username, res };
}

async function ctfLogin(ctx: TestCtx, c: Client, username: string, email: string, next?: string) {
  await clearResend(ctx, email);
  const step1 = await c.post('/ctf/login', { username, password: CTF_PASSWORD, next });
  expect(step1.status).toBe(200);
  expect(step1.body).toMatchObject({ next: 'otp', challengeId: expect.any(String) });
  return c.post('/ctf/login/otp', { challengeId: step1.body.challengeId, code: otpFrom(ctx, email) });
}

describe('Login, sign-up and Admin LMS journeys (brief §9)', () => {
  let ctx: TestCtx;
  let admin: StaffUser;
  let trainerA: StaffUser;
  let trainerB: StaffUser;
  const fresh = async (u: StaffUser) => ({ 'X-Step-Up-Code': await totp(ctx.prisma, u.id, u.secret) });

  beforeAll(async () => {
    ctx = await startApp();
    admin = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    trainerA = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    trainerB = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
  });
  afterAll(async () => ctx.app.close());

  describe('A. Students', () => {
    it('§9.1 NO path: sign-up needs name and institution, verifies email first, lands on the free plan', async () => {
      const email = uniq('newbie');
      const c = await new Client(ctx.server).init();
      const sent = await c.post('/auth/student/otp', { email, gate: 'open' });
      // no account exists before the code is verified
      expect(await ctx.prisma.user.count({ where: { email } })).toBe(0);
      const v = await c.post('/auth/student/verify', { challengeId: sent.body.challengeId, code: otpFrom(ctx, email) });
      expect(v.body.next).toBe('signup');
      const noName = await c.post('/auth/signup', {
        signupTicket: v.body.signupTicket,
        consents: { terms: true, privacy: true, aup: true },
        institutionName: 'ABC',
      });
      expect(noName.status).toBe(400);
      const ok = await c.post('/auth/signup', {
        signupTicket: v.body.signupTicket,
        name: 'Asha Rao',
        institutionName: 'ABC Institute',
        city: 'Pune',
        consents: { terms: true, privacy: true, aup: true },
      });
      expect(ok.status).toBe(201);
      const me = await c.get('/me');
      expect(me.body.role).toBe('student');
      const ent = await c.get('/me/entitlements');
      expect(ent.body).toEqual({ plan: 'free', keys: [] });
      expect((await c.get('/me/missing-fields')).status).toBe(200);
    });

    it('§9.2 YES path: Yojo student ID or email signs in to the existing account, never a duplicate', async () => {
      const email = uniq('yojo');
      const studentNumber = `YS-${Date.now().toString(36).toUpperCase()}`;
      const prov = await admin.client.post('/admin/students', {
        email,
        name: 'Ravi Kumar',
        studentNumber,
        institutionName: 'Yojo Pune',
        reason: 'enrolled at Pune centre',
      });
      expect(prov.status).toBe(201);
      expect(prov.body).toMatchObject({ origin: 'yojo', status: 'pending_verification' });

      const c = await new Client(ctx.server).init();
      const sent = await c.post('/auth/student/otp', { identifier: studentNumber, gate: 'yojo' });
      expect(sent.status).toBe(202);
      const v = await c.post('/auth/student/verify', {
        challengeId: sent.body.challengeId,
        code: otpFrom(ctx, email),
        gate: 'yojo',
      });
      expect(v.body.next).toBe('done');
      expect(await ctx.prisma.user.count({ where: { email } })).toBe(1);
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).status).toBe('active');
    });

    it('§9.2 YES path with no safe match: same 202 shape, no email sent, generic answer that points to support', async () => {
      const c = await new Client(ctx.server).init();
      const known = await makeStudent(ctx);
      await clearResend(ctx, known.email);
      const a = await c.post('/auth/student/otp', { identifier: known.email, gate: 'yojo' });
      const b = await c.post('/auth/student/otp', { identifier: 'YS-DOES-NOT-EXIST', gate: 'yojo' });
      expect(a.status).toBe(202);
      expect(b.status).toBe(202);
      expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
      const unknownMail = uniq('nobody');
      const before = ctx.mail.lastTo(unknownMail, 'otp');
      const u = await c.post('/auth/student/otp', { identifier: unknownMail, gate: 'yojo' });
      expect(u.status).toBe(202);
      expect(ctx.mail.lastTo(unknownMail, 'otp')).toBe(before);
      const v = await c.post('/auth/student/verify', { challengeId: u.body.challengeId, code: '000000', gate: 'yojo' });
      expect(v.status).toBe(401);
      expect(await ctx.prisma.user.count({ where: { email: unknownMail } })).toBe(0);
    });

    it('§9.3 OTP: a code from one gate does not verify on the other, and a used code cannot be replayed', async () => {
      const email = uniq('replay');
      const c = await new Client(ctx.server).init();
      const sent = await c.post('/auth/student/otp', { email });
      const code = otpFrom(ctx, email);
      const wrongGate = await c.post('/auth/student/verify', {
        challengeId: sent.body.challengeId,
        code,
        gate: 'yojo',
      });
      expect(wrongGate.body.code).toBe('OTP_EXPIRED');
      await clearResend(ctx, email);
      const again = await c.post('/auth/student/otp', { email });
      const code2 = otpFrom(ctx, email);
      expect((await c.post('/auth/student/verify', { challengeId: again.body.challengeId, code: code2 })).status).toBe(
        200,
      );
      const replay = await c.post('/auth/student/verify', { challengeId: again.body.challengeId, code: code2 });
      expect(replay.body.code).toBe('OTP_EXPIRED');
    });

    it('§9.10 paid access comes only from server entitlements; client values change nothing', async () => {
      const s = await makeStudent(ctx);
      expect((await s.client.get('/learn/paid/access')).status).toBe(403);
      const tamper = await s.client.get('/learn/paid/access', { 'X-Plan': 'paid', Cookie: 'plan=paid' });
      expect(tamper.status).toBe(403);
      expect((await s.client.send('patch', '/me', { plan: 'paid' })).status).toBe(400);

      const noCode = await admin.client.post(`/admin/students/${s.id}/entitlements`, {
        key: 'plan:paid',
        reason: 'paid offline at centre',
      });
      expect(noCode.status).toBe(428);
      const grant = await admin.client.post(
        `/admin/students/${s.id}/entitlements`,
        { key: 'plan:paid', reason: 'paid offline at centre' },
        await fresh(admin),
      );
      expect(grant.status).toBe(201);
      expect((await s.client.get('/learn/paid/access')).status).toBe(200);
      const revoke = await admin.client.post(
        `/admin/students/${s.id}/entitlements/${grant.body.id}/revoke`,
        { reason: 'refund issued' },
        await fresh(admin),
      );
      expect(revoke.status).toBe(201);
      expect((await s.client.get('/learn/paid/access')).status).toBe(403);
      const rows = await ctx.prisma.auditLog.findMany({
        where: { targetId: s.id, action: { in: ['entitlement.granted', 'entitlement.revoked'] } },
      });
      expect(rows.map((r) => r.action).sort()).toEqual(['entitlement.granted', 'entitlement.revoked']);
    });
  });

  describe('B. CTF', () => {
    it('§9.5 registration creates one users row (origin ctf, role participant), the identity and the registration', async () => {
      const { c, email, username, res } = await registerCtf(ctx);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ next: 'done', redirect: '/ctf/dashboard', linked: false });
      const u = await ctx.prisma.user.findUniqueOrThrow({
        where: { email },
        include: { identities: true, ctfRegistrations: true, consents: true },
      });
      expect(u).toMatchObject({ role: 'participant', origin: 'ctf', status: 'active', passwordHash: null });
      expect(u.identities).toEqual([
        expect.objectContaining({ provider: 'ctf_password', subject: username.toLowerCase() }),
      ]);
      expect(u.identities[0].secretHash).toMatch(/^\$argon2id\$/);
      expect(u.ctfRegistrations).toHaveLength(1);
      expect(u.ctfRegistrations[0].code).toMatch(/^CR-\d+$/);
      expect(u.consents.map((x) => x.kind).sort()).toEqual(['ctf_contact', 'ctf_rules']);
      const me = await c.get('/ctf/me');
      expect(me.status).toBe(200);
      expect(me.body.username).toBe(username);
      expect(JSON.stringify(me.body)).not.toMatch(/argon2|secret/i);
    });

    it('§9.5 usernames are unique (case-insensitive), CTF rules consent is required', async () => {
      const first = await registerCtf(ctx);
      const dup = await registerCtf(ctx, { username: first.username.toUpperCase() });
      expect(dup.res.status).toBe(409);
      expect(dup.res.body.code).toBe('USERNAME_TAKEN');
      const email = uniq('norules');
      const c = await new Client(ctx.server).init();
      const sent = await c.post('/ctf/register/otp', { email });
      const res = await c.post('/ctf/register', {
        challengeId: sent.body.challengeId,
        code: otpFrom(ctx, email),
        username: `nr_${Date.now().toString(36)}`,
        password: CTF_PASSWORD,
        consents: { ctf_rules: false, ctf_contact: true },
      });
      expect(res.status).toBe(400);
    });

    it('§9.16 concurrent registrations for the same username: exactly one wins', async () => {
      const username = `race_${Date.now().toString(36)}`;
      const results = await Promise.all([registerCtf(ctx, { username }), registerCtf(ctx, { username })]);
      const statuses = results.map((r) => r.res.status).sort();
      expect(statuses).toEqual([201, 409]);
      expect(
        await ctx.prisma.authIdentity.count({ where: { provider: 'ctf_password', subject: username.toLowerCase() } }),
      ).toBe(1);
    });

    it('§9.6 login is password → email OTP → TOTP when enrolled; session is CTF-only with an 8 h cap', async () => {
      const { c: reg, email, username } = await registerCtf(ctx);
      const setup = await reg.post('/ctf/mfa/setup');
      expect(setup.status).toBe(200);
      const conf = await reg.post('/ctf/mfa/confirm', { code: totpAt(setup.body.secret, currentStep()) });
      expect(conf.body.recoveryCodes).toHaveLength(10);

      const c = await new Client(ctx.server).init();
      const bad = await c.post('/ctf/login', { username, password: 'Wrong-Pass-123!' });
      const unknown = await c.post('/ctf/login', { username: 'nobody_here_x', password: 'Wrong-Pass-123!' });
      expect(bad.status).toBe(401);
      expect({ ...bad.body, requestId: 0 }).toEqual({ ...unknown.body, requestId: 0 });

      const otp = await ctfLogin(ctx, c, username, email, 'https://evil.example/steal');
      expect(otp.body).toMatchObject({ next: 'totp', ticket: expect.any(String) });
      expect((await c.get('/ctf/me')).status).toBe(401);
      const wrong = await c.post('/ctf/login/totp', { ticket: otp.body.ticket, code: '000000' });
      expect(wrong.status).toBe(401);
      const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
      await ctx.prisma.mfaFactor.updateMany({ where: { userId: u.id }, data: { lastUsedStep: null } });
      const done = await c.post('/ctf/login/totp', {
        ticket: otp.body.ticket,
        code: totpAt(setup.body.secret, currentStep()),
      });
      expect(done.status).toBe(200);
      // open redirect refused: falls back to the allow-listed default
      expect(done.body.redirect).toBe('/ctf/dashboard');
      expect((await c.get('/ctf/me')).status).toBe(200);
      // a CTF session cannot reach LMS routes
      expect((await c.get('/me')).status).toBe(403);
      const row = await ctx.prisma.userSession.findFirstOrThrow({
        where: { userId: u.id, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(8 * 3600_000 + 5000);
    });

    it('§9.6 without TOTP the OTP step signs in; allow-listed next is honoured; LMS sessions cannot open /ctf/me', async () => {
      const { email, username } = await registerCtf(ctx);
      const c = await new Client(ctx.server).init();
      const done = await ctfLogin(ctx, c, username, email, '/ctf/scoreboard');
      expect(done.body).toMatchObject({ next: 'done', redirect: '/ctf/scoreboard' });
      const s = await makeStudent(ctx);
      expect((await s.client.get('/ctf/me')).status).toBe(403);
    });

    it('§9.7 an existing student links a CTF account only after proving the email; one person, not two', async () => {
      const s = await makeStudent(ctx);
      const before = (await admin.client.get('/admin/total-users')).body.totalUsers;
      const { res } = await registerCtf(ctx, { email: s.email });
      expect(res.status).toBe(201);
      expect(res.body.linked).toBe(true);
      expect(await ctx.prisma.user.count({ where: { email: s.email } })).toBe(1);
      const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email: s.email }, include: { identities: true } });
      expect(u.role).toBe('student');
      expect(u.identities.map((i) => i.provider)).toContain('ctf_password');
      const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'ctf.identity.linked', targetId: u.id } });
      expect(audit?.detail).toMatchObject({ verifiedBy: 'email_otp' });
      // §9.12 total users unchanged: the linked account is the same person
      expect((await admin.client.get('/admin/total-users')).body.totalUsers).toBe(before);
      // a second CTF registration for the same person is refused
      const again = await registerCtf(ctx, { email: s.email });
      expect(again.res.body.code).toBe('CTF_ACCOUNT_EXISTS');
    });

    it('§9.7 linking needs the email code: a wrong code links nothing', async () => {
      const s = await makeStudent(ctx);
      const c = await new Client(ctx.server).init();
      await clearResend(ctx, s.email);
      const sent = await c.post('/ctf/register/otp', { email: s.email });
      const res = await c.post('/ctf/register', {
        challengeId: sent.body.challengeId,
        code: '000000',
        username: `steal_${Date.now().toString(36)}`,
        password: CTF_PASSWORD,
        consents: { ctf_rules: true, ctf_contact: false },
      });
      expect(res.status).toBe(401);
      expect(await ctx.prisma.authIdentity.count({ where: { userId: s.id, provider: 'ctf_password' } })).toBe(0);
    });

    it('OI-14 a CTF participant joins the Academy on the same account after proving the email; sessions stay apart', async () => {
      const { c: ctf, email, username } = await registerCtf(ctx);
      const p = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
      const lms = await new Client(ctx.server).init();
      await clearResend(ctx, email);
      const sent = await lms.post('/auth/student/otp', { email, purpose: 'login' });
      const v = await lms.post('/auth/student/verify', {
        challengeId: sent.body.challengeId,
        code: otpFrom(ctx, email),
      });
      expect(v.body).toMatchObject({ next: 'signup', upgrade: 'ctf', email, signupTicket: expect.any(String) });
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).role).toBe('participant'); // nothing yet
      const su = await lms.post('/auth/signup', {
        signupTicket: v.body.signupTicket,
        name: 'Ctf Player',
        institutionName: 'Test Institute',
        dob: '2000-01-15',
        consents: { terms: true, privacy: true, aup: true },
      });
      expect(su.status).toBe(201);
      const u = await ctx.prisma.user.findUniqueOrThrow({
        where: { email },
        include: { identities: true, studentProfile: true, ctfRegistrations: true },
      });
      expect(u).toMatchObject({ id: p.id, role: 'student', origin: 'ctf' });
      expect(u.studentProfile?.name).toBe('Ctf Player');
      expect(u.identities.map((i) => i.provider)).toContain('ctf_password');
      expect(u.ctfRegistrations).toHaveLength(1);
      expect(await ctx.prisma.user.count({ where: { email } })).toBe(1);
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'auth.student.joined_from_ctf', targetId: u.id } }),
      ).toBe(1);
      expect((await lms.get('/student/dashboard')).status).toBe(200);
      expect((await lms.get('/ctf/me')).status).toBe(403); // the LMS session does not open the CTF
      const me = await ctf.get('/ctf/me');
      expect(me.body).toMatchObject({ username, lmsAccount: true }); // the CTF session keeps working
      const reuse = await lms.post('/auth/signup', {
        signupTicket: v.body.signupTicket,
        name: 'Again',
        institutionName: 'Test Institute',
        consents: { terms: true, privacy: true, aup: true },
      });
      expect(reuse.body.code).toBe('SIGNUP_TICKET_INVALID'); // the ticket is single-use
    });

    it('§9.8 staff emails cannot register for the CTF or use the student sign-up', async () => {
      const c = await new Client(ctx.server).init();
      const sent = await c.post('/ctf/register/otp', { email: admin.email });
      expect(sent.status).toBe(202);
      expect(ctx.mail.lastTo(admin.email, 'otp')).toBeUndefined();
      const st = await c.post('/auth/student/otp', { email: trainerA.email });
      const v = await c.post('/auth/student/verify', {
        challengeId: st.body.challengeId,
        code: otpFrom(ctx, trainerA.email),
      });
      expect(v.body.code).toBe('USE_STAFF_LOGIN');
    });

    it('CTF password reset: always 202, single-use link, sessions revoked', async () => {
      const { c, email, username } = await registerCtf(ctx);
      const anon = await new Client(ctx.server).init();
      expect((await anon.post('/ctf/password/forgot', { usernameOrEmail: 'ghost_user_1' })).status).toBe(202);
      expect((await anon.post('/ctf/password/forgot', { usernameOrEmail: username })).status).toBe(202);
      const deadline = Date.now() + 3000;
      while (!ctx.mail.lastTo(email, 'ctf_password_reset') && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 50));
      const token = /#ctf-reset=([\w-]+)/.exec(ctx.mail.lastTo(email, 'ctf_password_reset')!.text)![1];
      expect((await anon.post('/ctf/password/reset', { token, newPassword: 'New-Ctf-Pass-77!' })).status).toBe(204);
      expect((await c.get('/ctf/me')).status).toBe(401);
      expect((await anon.post('/ctf/password/reset', { token, newPassword: 'New-Ctf-Pass-78!' })).status).toBe(410);
    });
  });

  describe('C. Trainers and batch scope', () => {
    it('§9.9 a trainer sees only their own batches; other batches answer 404; students see no email', async () => {
      const code = `B-${Date.now().toString(36)}`;
      const mine = await admin.client.post('/admin/batches', {
        code: `${code}-A`,
        name: 'Batch A',
        trainerId: trainerA.id,
      });
      const theirs = await admin.client.post('/admin/batches', {
        code: `${code}-B`,
        name: 'Batch B',
        trainerId: trainerB.id,
      });
      expect(mine.status).toBe(201);
      const s = await makeStudent(ctx);
      expect((await admin.client.post(`/admin/students/${s.id}/enrolments`, { batchId: mine.body.id })).status).toBe(
        201,
      );

      const list = await trainerA.client.get('/trainer/batches');
      expect(list.body.items.map((b: { id: string }) => b.id)).toContain(mine.body.id);
      expect(list.body.items.map((b: { id: string }) => b.id)).not.toContain(theirs.body.id);
      expect((await trainerA.client.get(`/trainer/batches/${theirs.body.id}`)).status).toBe(404);
      expect((await trainerA.client.get(`/trainer/batches/${theirs.body.id}/students`)).status).toBe(404);
      const students = await trainerA.client.get(`/trainer/batches/${mine.body.id}/students`);
      expect(students.body.items).toEqual([
        expect.objectContaining({ id: s.id, name: 'Test Student', batch: `${code}-A` }),
      ]);
      expect(JSON.stringify(students.body)).not.toContain(s.email);

      expect((await trainerA.client.get('/admin/users')).status).toBe(403);
      expect((await s.client.get('/trainer/batches')).status).toBe(403);
    });

    it('§9.8 trainer invites carry batch scope that applies when the invite is accepted', async () => {
      const b = await admin.client.post('/admin/batches', {
        code: `INV-${Date.now().toString(36)}`,
        name: 'Invite batch',
      });
      const email = uniq('newtrainer', 'yojosolutions.com');
      const inv = await admin.client.post('/admin/staff/invites', {
        email,
        role: 'trainer',
        capability: 'trainer',
        batchIds: [b.body.id],
      });
      expect(inv.status).toBe(201);
      const token = /#invite=([\w-]+)/.exec(ctx.mail.lastTo(email, 'staff_invite')!.text)![1];
      const c = await new Client(ctx.server).init();
      const acc = await c.post('/auth/invite/accept', { token, password: 'Str0ng-Staff-Pass!' });
      expect(acc.body.scope).toBe('onboarding');
      const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
      expect((await ctx.prisma.batch.findUniqueOrThrow({ where: { id: b.body.id } })).trainerId).toBe(u.id);
      // still in onboarding: batch routes need MFA and the remaining steps first
      expect((await c.get('/trainer/batches')).body.code).toBe('ONBOARDING_REQUIRED');
    });
  });

  describe('D. Admin LMS user management', () => {
    it('§9.11 views filter correctly, results are paged, and the list carries no secrets', async () => {
      const paid = await makeStudent(ctx);
      await admin.client.post(
        `/admin/students/${paid.id}/entitlements`,
        { key: 'plan:paid', reason: 'paid online' },
        await fresh(admin),
      );
      const free = await makeStudent(ctx);
      const paidView = await admin.client.get(`/admin/users?view=paid&q=${encodeURIComponent(paid.email)}`);
      expect(paidView.body.items.map((i: { id: string }) => i.id)).toEqual([paid.id]);
      expect(paidView.body.items[0].plan).toBe('paid');
      const freeView = await admin.client.get(`/admin/users?view=free&q=${encodeURIComponent(free.email)}`);
      expect(freeView.body.items.map((i: { id: string }) => i.id)).toEqual([free.id]);
      expect((await admin.client.get(`/admin/users?view=free&q=${encodeURIComponent(paid.email)}`)).body.items).toEqual(
        [],
      );

      for (const view of [
        'trainers',
        'admins',
        'ctf',
        'students',
        'pending_verification',
        'pending_onboarding',
        'invited',
        'suspended',
      ]) {
        const r = await admin.client.get(`/admin/users?view=${view}&limit=5`);
        expect(r.status).toBe(200);
        expect(r.body.items.length).toBeLessThanOrEqual(5);
      }
      const trainers = await admin.client.get('/admin/users?view=trainers&limit=100');
      expect(trainers.body.items.every((i: { role: string }) => i.role === 'trainer')).toBe(true);

      const p1 = await admin.client.get('/admin/users?view=students&limit=2&sort=created_asc');
      expect(p1.body.items).toHaveLength(2);
      const p2 = await admin.client.get(
        `/admin/users?view=students&limit=2&sort=created_asc&cursor=${p1.body.nextCursor}`,
      );
      expect(p2.body.items[0].id).not.toBe(p1.body.items[0].id);
      expect((await admin.client.get('/admin/users?view=everyone')).status).toBe(400);
      expect((await admin.client.get('/admin/users?cursor=bad!')).status).toBe(400);

      const all = JSON.stringify((await admin.client.get('/admin/users?limit=100')).body);
      expect(all).not.toMatch(/passwordHash|secretHash|argon2|recovery|secretEnc|dob|guardian|phone/);
      const detail = await admin.client.get(`/admin/users/${paid.id}`);
      expect(detail.body).toMatchObject({ id: paid.id, plan: 'paid', role: 'student' });
      expect(JSON.stringify(detail.body)).not.toMatch(/passwordHash|secretHash|argon2|secretEnc/);
    });

    it('§9.11 unauthorised roles are refused the Admin LMS', async () => {
      const s = await makeStudent(ctx);
      for (const c of [s.client, trainerA.client]) {
        expect((await c.get('/admin/users')).status).toBe(403);
        expect((await c.get('/admin/total-users')).status).toBe(403);
      }
      const anon = await new Client(ctx.server).init();
      expect((await anon.get('/admin/users')).status).toBe(401);
    });

    it('§9.12 Total Users equals the number of distinct non-deleted people', async () => {
      const t = await admin.client.get('/admin/total-users');
      expect(t.body.totalUsers).toBe(await ctx.prisma.user.count({ where: { status: { not: 'deleted' } } }));
      expect(t.body.breakdown.students).toBe(t.body.breakdown.paid + t.body.breakdown.free);
    });

    it('§9.13 suspension and logout-all revoke sessions; §9.14 both are audited', async () => {
      const s = await makeStudent(ctx);
      const second = await new Client(ctx.server).init();
      await clearResend(ctx, s.email);
      const sent = await second.post('/auth/student/otp', { email: s.email });
      await second.post('/auth/student/verify', { challengeId: sent.body.challengeId, code: otpFrom(ctx, s.email) });
      expect((await second.get('/me')).status).toBe(200);

      const out = await s.client.post('/auth/logout-all');
      expect(out.body.revoked).toBeGreaterThanOrEqual(2);
      expect((await second.get('/me')).status).toBe(401);

      const { c: ctf, email } = await registerCtf(ctx);
      const target = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
      const noReason = await admin.client.send('patch', `/admin/users/${target.id}/status`, { status: 'suspended' });
      expect(noReason.status).toBe(428);
      const sus = await admin.client.send(
        'patch',
        `/admin/users/${target.id}/status`,
        { status: 'suspended', reason: 'cheating report confirmed' },
        await fresh(admin),
      );
      expect(sus.status).toBe(200);
      expect((await ctf.get('/ctf/me')).status).toBe(401);
      const row = await ctx.prisma.auditLog.findFirst({
        where: { action: 'user.status.changed', targetId: target.id },
      });
      expect(row).toMatchObject({ actorId: admin.id, reason: 'cheating report confirmed' });
      const view = await admin.client.get(`/admin/users?view=suspended&q=${encodeURIComponent(email)}`);
      expect(view.body.items.map((i: { id: string }) => i.id)).toEqual([target.id]);
      // staff accounts are not changed through this endpoint
      const staff = await admin.client.send(
        'patch',
        `/admin/users/${trainerB.id}/status`,
        { status: 'suspended', reason: 'wrong endpoint test' },
        await fresh(admin),
      );
      expect(staff.body.code).toBe('USE_STAFF_ENDPOINT');
    });

    it('§9.14 sign-in, CTF and admin events are audited without codes or passwords', async () => {
      const actions = (await ctx.prisma.auditLog.findMany({ select: { action: true }, distinct: ['action'] })).map(
        (a) => a.action,
      );
      for (const a of [
        'auth.student.signup',
        'auth.student.login',
        'ctf.registered',
        'auth.ctf.login',
        'student.provisioned',
        'batch.created',
      ])
        expect(actions).toContain(a);
      const rows = await ctx.prisma.auditLog.findMany({
        take: 500,
        orderBy: { seq: 'desc' },
        select: { detail: true, reason: true },
      });
      const blob = JSON.stringify(rows);
      expect(blob).not.toContain(CTF_PASSWORD);
      expect(blob).not.toMatch(/"code":"\d{6}"/);
      expect((await admin.client.get('/admin/audit/verify')).body.ok).toBe(true);
    });
  });

  describe('§9.16 schema constraints', () => {
    it('one active subscription per student, one live entitlement per key, unique student IDs', async () => {
      const s = await makeStudent(ctx);
      const free = await ctx.prisma.plan.findUniqueOrThrow({ where: { code: 'free' } });
      await expect(ctx.prisma.subscription.create({ data: { studentId: s.id, planId: free.id } })).rejects.toThrow();
      await ctx.prisma.entitlement.create({ data: { studentId: s.id, key: 'x:test', source: 'manual' } });
      await expect(
        ctx.prisma.entitlement.create({ data: { studentId: s.id, key: 'x:test', source: 'manual' } }),
      ).rejects.toThrow();
      const sn = `YS-U-${Date.now().toString(36)}`;
      const one = await admin.client.post('/admin/students', {
        email: uniq('sn1'),
        name: 'A One',
        studentNumber: sn,
        reason: 'bulk import 1',
      });
      const two = await admin.client.post('/admin/students', {
        email: uniq('sn2'),
        name: 'B Two',
        studentNumber: sn,
        reason: 'bulk import 2',
      });
      expect(one.status).toBe(201);
      expect(two.body.code).toBe('STUDENT_NUMBER_TAKEN');
    });
  });
});
