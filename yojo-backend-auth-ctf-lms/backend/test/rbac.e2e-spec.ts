import { matrixRows } from '../src/access/permissions';
import { Client, makeStaff, makeStudent, startApp, totp, type StaffUser, type TestCtx } from './helpers';

describe('RBAC: route groups, admin matrix, no self-elevation, dual control (spec §6.6, §6.8, AC-AUTH-07..10)', () => {
  let ctx: TestCtx;
  const admins: Record<'platform', StaffUser> = {} as never;
  let platform2: StaffUser;
  let trainer: StaffUser;
  let student: Awaited<ReturnType<typeof makeStudent>>;

  beforeAll(async () => {
    ctx = await startApp();
    admins.platform = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    platform2 = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    trainer = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    student = await makeStudent(ctx);
  });
  afterAll(async () => ctx.app.close());

  it('role_permissions in the database equals the matrix constant', async () => {
    const rows = await ctx.prisma.rolePermission.findMany();
    const db = new Set(rows.map((r) => `${r.adminRole}:${r.permission}:${r.level}`));
    const expected = new Set(matrixRows().map((r) => `${r.adminRole}:${r.permission}:${r.level}`));
    expect(db).toEqual(expected);
  });

  it('no session → 401 with needs: login', async () => {
    const anon = await new Client(ctx.server).init();
    const res = await anon.get('/me');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED', needs: 'login' });
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('students and trainers cannot reach admin routes', async () => {
    for (const c of [student.client, trainer.client]) {
      expect((await c.get('/admin/staff')).status).toBe(403);
      expect((await c.get('/admin/settings')).status).toBe(403);
      expect((await c.get('/admin/audit')).status).toBe(403);
    }
    expect((await student.client.get('/trainer/audit')).status).toBe(403);
    expect((await trainer.client.get('/trainer/audit')).status).toBe(200);
  });

  it('admin staff have a single role: the database rejects any admin_role other than platform', async () => {
    expect((await admins.platform.client.get('/admin/staff')).status).toBe(200);
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: platform2.id } });
    await expect(ctx.prisma.user.update({ where: { id: u.id }, data: { adminRole: 'support' } })).rejects.toThrow();
    const bad = await admins.platform.client.post('/admin/staff/invites', {
      email: 'x0@yojosolutions.com',
      role: 'admin',
      adminRole: 'support',
    });
    expect(bad.status).toBe(400);
  });

  it('settings: Platform Admin sees every section', async () => {
    const p = await admins.platform.client.get('/admin/settings');
    expect(Object.keys(p.body.sections).sort()).toEqual([
      'ai',
      'auth',
      'gamification',
      'maintenance',
      'placement',
      'plans',
      'policy',
      'promos',
      'xp',
    ]);
  });

  it('audit list: Platform Admin sees all and can verify the chain', async () => {
    const all = await admins.platform.client.get('/admin/audit?limit=100');
    expect(new Set(all.body.items.map((i: { actorId: string }) => i.actorId)).size).toBeGreaterThan(1);
    expect((await admins.platform.client.get('/admin/audit/verify')).body.ok).toBe(true);
  });

  it('a trainer cannot invite staff (no path to create a more powerful account)', async () => {
    const res = await trainer.client.post('/admin/staff/invites', {
      email: 'x1@yojosolutions.com',
      role: 'admin',
      adminRole: 'platform',
    });
    expect(res.status).toBe(403);
  });

  it('nobody can change their own role or status', async () => {
    const p = admins.platform;
    const role = await p.client.send(
      'patch',
      `/admin/staff/${p.id}/role`,
      { adminRole: 'platform', reason: 'testing self change' },
      { 'X-Step-Up-Code': await totp(ctx.prisma, p.id, p.secret) },
    );
    expect(role.status).toBe(403);
    expect(role.body.code).toBe('SELF_ACTION_FORBIDDEN');
    const status = await p.client.send('patch', `/admin/staff/${p.id}/status`, {
      status: 'suspended',
      reason: 'testing self change',
    });
    expect(status.body.code).toBe('SELF_ACTION_FORBIDDEN');
  });

  it('role change needs reason (428), then a fresh code (428), then ends the target’s sessions', async () => {
    const target = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    const p = admins.platform;
    const noReason = await p.client.send('patch', `/admin/staff/${target.id}/role`, { capability: 'trainer_mentor' });
    expect(noReason.status).toBe(428);
    expect(noReason.body.needs).toBe('reason');
    const noCode = await p.client.send('patch', `/admin/staff/${target.id}/role`, {
      capability: 'trainer_mentor',
      reason: 'promoted to mentor',
    });
    expect(noCode.status).toBe(428);
    expect(noCode.body.needs).toBe('mfa');
    const badCode = await p.client.send(
      'patch',
      `/admin/staff/${target.id}/role`,
      { capability: 'trainer_mentor', reason: 'promoted to mentor' },
      { 'X-Step-Up-Code': '000000' },
    );
    expect(badCode.status).toBe(401);
    const ok = await p.client.send(
      'patch',
      `/admin/staff/${target.id}/role`,
      { capability: 'trainer_mentor', reason: 'promoted to mentor' },
      { 'X-Step-Up-Code': await totp(ctx.prisma, p.id, p.secret) },
    );
    expect(ok.status).toBe(200);
    expect((await target.client.get('/me')).status).toBe(401);
    const row = await ctx.prisma.auditLog.findFirst({ where: { action: 'staff.role.changed', targetId: target.id } });
    expect(row).toMatchObject({ actorId: p.id, reason: 'promoted to mentor' });
  });

  it('suspension ends sessions and blocks sign-in', async () => {
    const target = await makeStaff(ctx, 'trainer', { capability: 'trainer' });
    const res = await admins.platform.client.send('patch', `/admin/staff/${target.id}/status`, {
      status: 'suspended',
      reason: 'contract ended',
    });
    expect(res.status).toBe(200);
    expect((await target.client.get('/me')).status).toBe(401);
    const c = await new Client(ctx.server).init();
    const login = await c.post('/auth/staff/login', { email: target.email, password: 'Str0ng-Staff-Pass!' });
    expect(login.body.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('MFA reset needs a second, different Platform Admin (dual control)', async () => {
    const target = await makeStaff(ctx, 'admin', { adminRole: 'platform' });
    const p1 = admins.platform;
    const start = await p1.client.post(
      `/admin/staff/${target.id}/mfa-reset`,
      { reason: 'lost phone, verified by call' },
      { 'X-Step-Up-Code': await totp(ctx.prisma, p1.id, p1.secret) },
    );
    expect(start.status).toBe(201);
    expect(start.body).toMatchObject({ status: 'awaiting_second_admin', code: expect.stringMatching(/^DC-\d+$/) });
    // nothing changed yet
    expect((await target.client.get('/me')).status).toBe(200);

    const self = await p1.client.post(
      `/admin/dual-control/${start.body.id}/decide`,
      { decision: 'confirm' },
      { 'X-Step-Up-Code': await totp(ctx.prisma, p1.id, p1.secret) },
    );
    expect(self.body.code).toBe('SECOND_ADMIN_REQUIRED');
    const notAllowed = await trainer.client.post(`/admin/dual-control/${start.body.id}/decide`, {
      decision: 'confirm',
    });
    expect(notAllowed.status).toBe(403);

    const ok = await platform2.client.post(
      `/admin/dual-control/${start.body.id}/decide`,
      { decision: 'confirm', note: 'confirmed by phone' },
      { 'X-Step-Up-Code': await totp(ctx.prisma, platform2.id, platform2.secret) },
    );
    expect(ok.body.status).toBe('confirmed');
    expect((await target.client.get('/me')).status).toBe(401);
    expect(await ctx.prisma.mfaFactor.count({ where: { userId: target.id } })).toBe(0);

    // the person must re-enrol with the emailed link plus their password
    const c = await new Client(ctx.server).init();
    expect((await c.post('/auth/staff/login', { email: target.email, password: 'Str0ng-Staff-Pass!' })).body.code).toBe(
      'MFA_REENROLMENT_REQUIRED',
    );
    const token = /#mfa-reenrol=([\w-]+)/.exec(ctx.mail.lastTo(target.email, 'mfa_reset')!.text)![1];
    const re = await c.post('/auth/staff/mfa-reenrol', { token, password: 'Str0ng-Staff-Pass!' });
    expect(re.body).toMatchObject({ scope: 'onboarding', onboarding: { pending: ['mfa'] } });
  });

  it('trainer audit route shows only the trainer’s own actions', async () => {
    const res = await trainer.client.get('/trainer/audit');
    expect(res.body.items.every((i: { actorId: string }) => i.actorId === trainer.id)).toBe(true);
  });
});
