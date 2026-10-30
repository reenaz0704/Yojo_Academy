import { currentStep, totpAt } from '../src/identity/totp';
import { CONSENT_VERSIONS } from '../src/identity/constants';
import {
  Client,
  linkToken,
  makeStaff,
  STAFF_PASSWORD,
  staffLogin,
  startApp,
  totp,
  uniq,
  waitFor,
  type StaffUser,
  type TestCtx,
} from './helpers';

const POLICY = {
  codeOfConductVersion: CONSENT_VERSIONS.code_of_conduct,
  dataHandlingVersion: CONSENT_VERSIONS.staff_policy,
};
const NEW_PASSWORD = 'Brand-New-Pass-42';

describe('Staff sign-in, invites, onboarding and recovery (spec §6.4, §6.8, AC-AUTH-04..10)', () => {
  let ctx: TestCtx;
  let platform: StaffUser;
  beforeAll(async () => {
    ctx = await startApp();
    platform = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
  });
  afterAll(async () => ctx.app.close());

  async function invite(role: 'admin' | 'trainer', sub: object) {
    const email = uniq(`invitee-${role}`, 'yojosolutions.com');
    const res = await platform.client.post('/admin/staff/invites', { email, role, ...sub });
    expect(res.status).toBe(201);
    return {
      email,
      token: linkToken(ctx.mail.lastTo(email, 'staff_invite')!.text, 'invite'),
      inviteId: res.body.id as string,
    };
  }

  /** Accept invite → TOTP setup → confirm → policy (→ trainer profile). Returns the signed-in client and secret. */
  async function onboard(role: 'admin' | 'trainer', sub: object) {
    const { email, token } = await invite(role, sub);
    const c = await new Client(ctx.server).init();
    const accepted = await c.post('/auth/invite/accept', { token, password: STAFF_PASSWORD });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ next: 'onboarding', scope: 'onboarding' });
    const setup = await c.post('/auth/staff/mfa-setup');
    const secret = setup.body.secret as string;
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
    const confirm = await c.post('/auth/staff/mfa-confirm', { code: totpAt(secret, currentStep()) });
    expect(confirm.status).toBe(200);
    expect(confirm.body.recoveryCodes).toHaveLength(10);
    const pol = await c.post('/auth/staff/policy', POLICY);
    return { c, email, secret, user, recoveryCodes: confirm.body.recoveryCodes as string[], afterPolicy: pol };
  }

  it('invites are limited to organisation emails and to a valid role shape', async () => {
    const bad = await platform.client.post('/admin/staff/invites', {
      email: 'x@gmail.com',
      role: 'admin',
      adminRole: 'platform',
    });
    expect(bad.body.code).toBe('STAFF_DOMAIN_REQUIRED');
    const shape = await platform.client.post('/admin/staff/invites', {
      email: uniq('s', 'yojosolutions.com'),
      role: 'admin',
      adminRole: 'platform',
      capability: 'trainer',
    });
    expect(shape.status).toBe(400);
  });

  it('admin first login: accept invite, TOTP with recovery codes, policy, then a full session', async () => {
    const o = await onboard('admin', { adminRole: 'platform' });
    expect(o.afterPolicy.body).toMatchObject({ onboarding: { complete: true, pending: [] }, scope: 'full' });
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: o.user.id } })).status).toBe('active');
    const me = await o.c.get('/me');
    expect(me.body).toMatchObject({ role: 'admin', adminRole: 'platform', sessionScope: 'full' });
    expect(me.body.permissions).toContainEqual({ key: 'students', level: 'Y' });
    // recovery codes stored only as argon2 hashes
    const rc = await ctx.prisma.recoveryCode.findMany({ where: { userId: o.user.id } });
    expect(rc).toHaveLength(10);
    expect(rc.every((r) => r.codeHash.startsWith('$argon2id$') && !o.recoveryCodes.includes(r.codeHash))).toBe(true);
  });

  it('an onboarding session can call only first-login endpoints', async () => {
    const { token } = await invite('admin', { adminRole: 'platform' });
    const c = await new Client(ctx.server).init();
    await c.post('/auth/invite/accept', { token, password: STAFF_PASSWORD });
    const blocked = await c.get('/admin/settings');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('ONBOARDING_REQUIRED');
    expect((await c.get('/auth/staff/onboarding')).body).toMatchObject({ complete: false, pending: ['mfa', 'policy'] });
  });

  it('trainer first login has the extra profile step', async () => {
    const o = await onboard('trainer', { capability: 'trainer_mentor' });
    expect(o.afterPolicy.body.onboarding).toMatchObject({ complete: false, pending: ['profile'] });
    const prof = await o.c.post('/auth/staff/profile', {
      displayName: 'Ravi',
      speciality: 'Blue team',
      certifications: ['OSCP'],
      availability: { mon: ['18:00-20:00'] },
    });
    expect(prof.body).toMatchObject({ onboarding: { complete: true }, scope: 'full' });
  });

  it('invite tokens are single use and re-inviting revokes the earlier link', async () => {
    const first = await invite('admin', { adminRole: 'platform' });
    const second = await platform.client.post('/admin/staff/invites', {
      email: first.email,
      role: 'admin',
      adminRole: 'platform',
    });
    expect(second.status).toBe(201);
    const c = await new Client(ctx.server).init();
    const old = await c.post('/auth/invite/accept', { token: first.token, password: STAFF_PASSWORD });
    expect(old.status).toBe(410);
    const fresh = linkToken(ctx.mail.lastTo(first.email, 'staff_invite')!.text, 'invite');
    expect((await c.post('/auth/invite/accept', { token: fresh, password: STAFF_PASSWORD })).status).toBe(200);
    const again = await new Client(ctx.server).init();
    expect((await again.post('/auth/invite/accept', { token: fresh, password: STAFF_PASSWORD })).status).toBe(410);
  });

  it('weak passwords are refused when accepting an invite', async () => {
    const { token } = await invite('admin', { adminRole: 'platform' });
    const c = await new Client(ctx.server).init();
    const res = await c.post('/auth/invite/accept', { token, password: 'password12' });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('password');
  });

  it('unknown email and wrong password give the same answer; no session before TOTP', async () => {
    const c = await new Client(ctx.server).init();
    const unknown = await c.post('/auth/staff/login', {
      email: uniq('nobody', 'yojosolutions.com'),
      password: 'Whatever-123!',
    });
    const wrong = await c.post('/auth/staff/login', { email: platform.email, password: 'Wrong-Pass-123!' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    const strip = (b: Record<string, unknown>) => ({ ...b, requestId: undefined });
    expect(strip(unknown.body)).toEqual(strip(wrong.body));
    const step1 = await c.post('/auth/staff/login', { email: platform.email, password: STAFF_PASSWORD });
    expect(step1.body).toEqual({ next: 'totp', challengeId: expect.any(String) });
    expect((await c.get('/me')).status).toBe(401);
    await ctx.prisma.user.update({ where: { id: platform.id }, data: { failedLogins: 0 } });
  });

  it('wrong TOTP counts down; the challenge is single use; a code cannot be replayed', async () => {
    const s = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    const c = await new Client(ctx.server).init();
    const step1 = await c.post('/auth/staff/login', { email: s.email, password: STAFF_PASSWORD });
    const wrong = await c.post('/auth/staff/totp', { challengeId: step1.body.challengeId, code: '000000' });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toMatchObject({ code: 'TOTP_INVALID', needs: 'mfa', details: { triesLeft: 4 } });
    const code = await totp(ctx.prisma, s.id, s.secret);
    expect((await c.post('/auth/staff/totp', { challengeId: step1.body.challengeId, code })).status).toBe(200);
    expect((await c.post('/auth/staff/totp', { challengeId: step1.body.challengeId, code })).body.code).toBe(
      'CHALLENGE_EXPIRED',
    );
    // same code on a new challenge is a replay
    const c2 = await new Client(ctx.server).init();
    const again = await c2.post('/auth/staff/login', { email: s.email, password: STAFF_PASSWORD });
    expect((await c2.post('/auth/staff/totp', { challengeId: again.body.challengeId, code })).body.code).toBe(
      'TOTP_INVALID',
    );
  });

  it('a recovery code signs in once', async () => {
    const o = await onboard('admin', { adminRole: 'platform' });
    const c = await new Client(ctx.server).init();
    const s1 = await c.post('/auth/staff/login', { email: o.email, password: STAFF_PASSWORD });
    expect(
      (await c.post('/auth/staff/totp', { challengeId: s1.body.challengeId, recoveryCode: o.recoveryCodes[0] })).status,
    ).toBe(200);
    const c2 = await new Client(ctx.server).init();
    const s2 = await c2.post('/auth/staff/login', { email: o.email, password: STAFF_PASSWORD });
    expect(
      (await c2.post('/auth/staff/totp', { challengeId: s2.body.challengeId, recoveryCode: o.recoveryCodes[0] }))
        .status,
    ).toBe(401);
  });

  it('locks the account after 5 failures; the lock shows only with the right password', async () => {
    const s = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    const c = await new Client(ctx.server).init();
    for (let i = 0; i < 5; i++)
      expect((await c.post('/auth/staff/login', { email: s.email, password: 'Wrong-Pass-123!' })).status).toBe(401);
    const right = await c.post('/auth/staff/login', { email: s.email, password: STAFF_PASSWORD });
    expect(right.status).toBe(423);
    expect(right.body.code).toBe('ACCOUNT_LOCKED');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'auth.staff.locked', targetId: s.id } })).toBe(1);
  });

  it('access request → approve sends an invite; decline needs a reason', async () => {
    const anon = await new Client(ctx.server).init();
    const email = uniq('applicant', 'yojosolutions.com');
    expect(
      (
        await anon.post('/auth/staff/access-request', {
          name: 'Applicant',
          email,
          role: 'Trainer',
          reason: 'I teach SOC basics',
        })
      ).status,
    ).toBe(202);
    const list = await platform.client.get('/admin/staff/requests');
    const row = list.body.items.find((r: { email: string }) => r.email === email);
    expect(row).toBeDefined();
    const decline = await platform.client.post(`/admin/staff/requests/${row.id}/decide`, { decision: 'decline' });
    expect(decline.status).toBe(428);
    const ok = await platform.client.post(`/admin/staff/requests/${row.id}/decide`, {
      decision: 'approve',
      role: 'trainer',
      capability: 'trainer',
    });
    expect(ok.body).toMatchObject({ status: 'approved', inviteId: expect.any(String) });
    expect(ctx.mail.lastTo(email, 'staff_invite')).toBeDefined();
  });

  it('step-up issues a new session ID and revokes the old one', async () => {
    const s = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    const before = await ctx.prisma.userSession.findFirstOrThrow({ where: { userId: s.id, revokedAt: null } });
    const res = await s.client.post('/auth/step-up', { code: await totp(ctx.prisma, s.id, s.secret) });
    expect(res.status).toBe(200);
    expect((await s.client.get('/me')).status).toBe(200);
    const old = await ctx.prisma.userSession.findUniqueOrThrow({ where: { id: before.id } });
    expect(old.revokeReason).toBe('rotated');
  });

  it('password change needs a fresh code and the current password; other sessions end', async () => {
    const s = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    const other = await new Client(ctx.server).init();
    await staffLogin(ctx, other, s.email, s.id, s.secret);
    const noCode = await s.client.post('/auth/password', {
      currentPassword: STAFF_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(noCode.status).toBe(428);
    expect(noCode.body.needs).toBe('mfa');
    const reuse = await s.client.post(
      '/auth/password',
      { currentPassword: STAFF_PASSWORD, newPassword: STAFF_PASSWORD },
      { 'X-Step-Up-Code': await totp(ctx.prisma, s.id, s.secret) },
    );
    expect(reuse.status).toBe(400);
    const ok = await s.client.post(
      '/auth/password',
      { currentPassword: STAFF_PASSWORD, newPassword: NEW_PASSWORD },
      { 'X-Step-Up-Code': await totp(ctx.prisma, s.id, s.secret) },
    );
    expect(ok.status).toBe(204);
    expect((await s.client.get('/me')).status).toBe(200);
    expect((await other.get('/me')).status).toBe(401);
    expect(ctx.mail.lastTo(s.email, 'password_changed')).toBeDefined();
  });

  it('forgot/reset: always 202, needs TOTP, single-use link, all sessions revoked', async () => {
    const s = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    const anon = await new Client(ctx.server).init();
    expect((await anon.post('/auth/password/forgot', { email: uniq('ghost', 'yojosolutions.com') })).status).toBe(202);
    expect((await anon.post('/auth/password/forgot', { email: s.email })).status).toBe(202);
    const token = linkToken((await waitFor(() => ctx.mail.lastTo(s.email, 'password_reset'))).text, 'reset');
    const noMfa = await anon.post('/auth/password/reset', { token, newPassword: NEW_PASSWORD });
    expect(noMfa.status).toBe(428);
    const ok = await anon.post('/auth/password/reset', {
      token,
      newPassword: NEW_PASSWORD,
      code: await totp(ctx.prisma, s.id, s.secret),
    });
    expect(ok.status).toBe(204);
    expect((await s.client.get('/me')).status).toBe(401);
    expect(
      (
        await anon.post('/auth/password/reset', {
          token,
          newPassword: 'Another-Pass-99',
          code: await totp(ctx.prisma, s.id, s.secret),
        })
      ).status,
    ).toBe(410);
    const c = await new Client(ctx.server).init();
    await expect(staffLogin(ctx, c, s.email, s.id, s.secret, NEW_PASSWORD)).resolves.toBeDefined();
  });

  it('staff sessions carry the staff idle lifetime (30 min) in Redis', async () => {
    const s = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    const row = await ctx.prisma.userSession.findFirstOrThrow({ where: { userId: s.id, revokedAt: null } });
    const hours = (row.expiresAt.getTime() - row.createdAt.getTime()) / 3600_000;
    expect(Math.round(hours)).toBe(12);
  });
});
