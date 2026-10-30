import { clearResend, Client, makeStudent, otpFrom, startApp, uniq, type TestCtx } from './helpers';

describe('Student sign-in and sign-up (spec §6.3, AC-AUTH-01..03)', () => {
  let ctx: TestCtx;
  beforeAll(async () => (ctx = await startApp()));
  afterAll(async () => ctx.app.close());

  async function verifiedTicket(email: string) {
    const c = await new Client(ctx.server).init();
    const sent = await c.post('/auth/student/otp', { email, purpose: 'signup' });
    const v = await c.post('/auth/student/verify', { challengeId: sent.body.challengeId, code: otpFrom(ctx, email) });
    return { c, ticket: v.body.signupTicket as string, verify: v };
  }

  it('OTP send always answers 202 with the same shape and mails a 6-digit code', async () => {
    const c = await new Client(ctx.server).init();
    const email = uniq('new');
    const res = await c.post('/auth/student/otp', { email, purpose: 'login' });
    expect(res.status).toBe(202);
    expect(Object.keys(res.body).sort()).toEqual(['challengeId', 'expiresInSec', 'gate', 'resendAfterSec']);
    expect(res.body.expiresInSec).toBe(300);
    expect(res.body.resendAfterSec).toBe(30);
    expect(ctx.mail.lastTo(email, 'otp')!.text).toMatch(/\b\d{6}\b/);
  });

  it('refuses a resend inside 30 seconds', async () => {
    const c = await new Client(ctx.server).init();
    const email = uniq('resend');
    await c.post('/auth/student/otp', { email, purpose: 'login' });
    const again = await c.post('/auth/student/otp', { email, purpose: 'login' });
    expect(again.status).toBe(429);
    expect(again.headers['retry-after']).toBeDefined();
  });

  it('counts wrong codes down and burns the code after 3 tries', async () => {
    const c = await new Client(ctx.server).init();
    const email = uniq('burn');
    const sent = await c.post('/auth/student/otp', { email, purpose: 'login' });
    const real = otpFrom(ctx, email);
    const wrong = real === '000000' ? '111111' : '000000';
    const r1 = await c.post('/auth/student/verify', { challengeId: sent.body.challengeId, code: wrong });
    expect(r1.status).toBe(401);
    expect(r1.body).toMatchObject({ code: 'OTP_INVALID', details: { triesLeft: 2 } });
    await c.post('/auth/student/verify', { challengeId: sent.body.challengeId, code: wrong });
    const r3 = await c.post('/auth/student/verify', { challengeId: sent.body.challengeId, code: wrong });
    expect(r3.body.code).toBe('OTP_BURNED');
    const late = await c.post('/auth/student/verify', { challengeId: sent.body.challengeId, code: real });
    expect(late.status).toBe(401);
  });

  it('a verified unknown email gets a sign-up ticket, not a session', async () => {
    const email = uniq('ticket');
    const { verify, c } = await verifiedTicket(email);
    expect(verify.status).toBe(200);
    expect(verify.body).toMatchObject({ next: 'signup', email });
    expect(verify.body.signupTicket).toEqual(expect.any(String));
    expect((await c.get('/me')).status).toBe(401);
  });

  it('sign-up requires Terms, Privacy and AUP consent', async () => {
    const { c, ticket } = await verifiedTicket(uniq('consent'));
    const res = await c.post('/auth/signup', {
      signupTicket: ticket,
      name: 'Asha Rao',
      institutionName: 'ABC Institute',
      consents: { terms: true, privacy: true, aup: false },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONSENT_REQUIRED');
  });

  it('under 18 needs parental consent and guardian details', async () => {
    const { c, ticket } = await verifiedTicket(uniq('minor'));
    const year = new Date().getUTCFullYear() - 15;
    const noParent = await c.post('/auth/signup', {
      signupTicket: ticket,
      name: 'Asha Rao',
      institutionName: 'ABC Institute',
      dob: `${year}-03-01`,
      consents: { terms: true, privacy: true, aup: true },
    });
    expect(noParent.body.code).toBe('PARENTAL_CONSENT_REQUIRED');
    const ok = await c.post('/auth/signup', {
      signupTicket: ticket,
      name: 'Asha Rao',
      institutionName: 'ABC Institute',
      dob: `${year}-03-01`,
      consents: { terms: true, privacy: true, aup: true, parental: true },
      guardian: { name: 'Parent', relation: 'Mother', phone: '+91 98765 43210' },
    });
    expect(ok.status).toBe(201);
    const missing = await c.get('/me/missing-fields');
    expect(missing.body.minor).toBe(true);
    expect(missing.body.missing).not.toContain('guardian.name');
  });

  it('enforces the institution email domain', async () => {
    const domain = `inst-${Date.now().toString(36)}.demo`;
    const inst = await ctx.prisma.institution.create({ data: { name: 'ABC Institute', emailDomain: domain } });
    const { c, ticket } = await verifiedTicket(uniq('wrongdomain', 'gmail.demo'));
    const res = await c.post('/auth/signup', {
      signupTicket: ticket,
      name: 'Asha Rao',
      institutionId: inst.id,
      consents: { terms: true, privacy: true, aup: true },
    });
    expect(res.body.code).toBe('INSTITUTION_DOMAIN_MISMATCH');
    const good = await verifiedTicket(uniq('rightdomain', domain));
    const ok = await good.c.post('/auth/signup', {
      signupTicket: good.ticket,
      name: 'Asha Rao',
      institutionId: inst.id,
      consents: { terms: true, privacy: true, aup: true },
    });
    expect(ok.status).toBe(201);
  });

  it('stores versioned consents with IP and user agent, and audits the sign-up', async () => {
    const s = await makeStudent(ctx);
    const consents = await ctx.prisma.consent.findMany({ where: { userId: s.id } });
    expect(consents.map((c) => c.kind).sort()).toEqual(['aup', 'privacy', 'terms']);
    expect(consents.every((c) => c.version && c.ip)).toBe(true);
    const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'auth.student.signup', targetId: s.id } });
    expect(audit).not.toBeNull();
  });

  it('returning student signs in with OTP; /me returns the profile without secrets', async () => {
    const s = await makeStudent(ctx);
    await clearResend(ctx, s.email);
    const c = await new Client(ctx.server).init();
    const sent = await c.post('/auth/student/otp', { email: s.email, purpose: 'login' });
    const v = await c.post('/auth/student/verify', { challengeId: sent.body.challengeId, code: otpFrom(ctx, s.email) });
    expect(v.body).toMatchObject({ next: 'done', role: 'student', scope: 'full' });
    const me = await c.get('/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: s.email, role: 'student', permissions: [] });
    expect(me.body.code).toMatch(/^U-\d+$/);
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|password_hash|secret/i);
  });

  it('a staff-domain email is sent to the staff sign-in', async () => {
    const email = uniq('someone', 'yojosolutions.com');
    const { verify } = await verifiedTicket(email);
    expect(verify.status).toBe(403);
    expect(verify.body.code).toBe('USE_STAFF_LOGIN');
  });

  it('profile update refuses card numbers and CVV in free text', async () => {
    const s = await makeStudent(ctx);
    const res = await s.client.send('patch', '/me', { objective: 'my card is 4111 1111 1111 1111' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PAYMENT_DATA_NOT_ALLOWED');
    const ok = await s.client.send('patch', '/me', { city: 'Pune', skills: ['linux'] });
    expect(ok.status).toBe(200);
    expect(ok.body.studentProfile.city).toBe('Pune');
  });

  it('sign-up details are locked once filled; empty ones can still be completed (owner, 29 Oct)', async () => {
    const s = await makeStudent(ctx);
    expect((await s.client.send('patch', '/me', { city: 'Pune', skills: ['linux'] })).status).toBe(200);
    const change = await s.client.send('patch', '/me', { city: 'Chennai' });
    expect(change.status).toBe(409);
    expect(change.body).toMatchObject({ code: 'PROFILE_LOCKED' });
    expect((await s.client.send('patch', '/me', { name: 'Someone Else' })).body.code).toBe('PROFILE_LOCKED');
    expect((await s.client.send('patch', '/me', { city: 'Pune', skills: ['linux'] })).status).toBe(200); // same values
    expect((await s.client.send('patch', '/me', { cgpa: 8.2, certifications: ['Security+'] })).status).toBe(200);
    expect((await s.client.send('patch', '/me', { showOnBoard: false, displayName: 'Ace' })).status).toBe(200);
    expect((await s.client.send('patch', '/me', { cgpa: 9.9 })).body.code).toBe('PROFILE_LOCKED');
  });

  it('Google sign-in answers 503 until a client ID is configured', async () => {
    const c = await new Client(ctx.server).init();
    const res = await c.post('/auth/google', { idToken: 'x'.repeat(40), gate: 'yojo' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('GOOGLE_NOT_CONFIGURED');
  });

  it('logout ends the session; logout-all ends every device', async () => {
    const s = await makeStudent(ctx);
    await clearResend(ctx, s.email);
    const second = await new Client(ctx.server).init();
    const sent = await second.post('/auth/student/otp', { email: s.email, purpose: 'login' });
    await second.post('/auth/student/verify', { challengeId: sent.body.challengeId, code: otpFrom(ctx, s.email) });
    const list = await s.client.get('/auth/sessions');
    expect(list.body.items.length).toBe(2);
    expect(list.body.items.filter((i: { current: boolean }) => i.current)).toHaveLength(1);

    expect((await s.client.post('/auth/logout-all')).status).toBe(200);
    expect((await s.client.get('/me')).status).toBe(401);
    expect((await second.get('/me')).status).toBe(401);
  });

  it('a user can revoke one of their own devices but not someone else’s', async () => {
    const a = await makeStudent(ctx);
    const b = await makeStudent(ctx);
    const bSessions = await b.client.get('/auth/sessions');
    const res = await a.client.send('delete', `/auth/sessions/${bSessions.body.items[0].id}`);
    expect(res.status).toBe(404);
    expect((await b.client.get('/me')).status).toBe(200);
  });
});
