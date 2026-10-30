import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminRole } from '@prisma/client';
import { ADMIN_ROLES, matrixLevel, matrixRows, PERMISSIONS, type Permission } from '../../access/permissions';
import type { PolicyService } from '../../access/policy.service';
import type { AuditService } from '../../audit/audit.service';
import type { MfaService } from '../../identity/mfa.service';
import type { SettingsService } from '../../settings/settings.service';
import { PERMISSION_KEY, REASON_KEY, STEP_UP_KEY } from '../decorators/auth.decorators';
import { PolicyGuard } from './policy.guard';

/**
 * AC-AUTH-03 at guard level: for every row of the access matrix and every sub-role, a route that requires the
 * permission at R or at Y answers exactly as the matrix says. (Endpoint-level tests follow as each module lands.)
 */
const rows = new Map(matrixRows().map((r) => [`${r.adminRole}:${r.permission}`, r.level]));
const policy = {
  level: async (role: AdminRole, perm: Permission) => rows.get(`${role}:${perm}`) ?? null,
} as unknown as PolicyService;
const audit = { record: jest.fn(async () => undefined) } as unknown as AuditService;
const settings = { get: async () => ({ value: { stepUpWindowSec: 300 }, version: 1 }) } as unknown as SettingsService;
const mfa = {
  requireFreshCode: jest.fn(async (_u: string, code?: string) => {
    if (!code) throw Object.assign(new Error('step'), { status: 428 });
  }),
} as unknown as MfaService;

function ctxFor(
  meta: Record<string, unknown>,
  session: object | undefined,
  body: object = {},
  headers: Record<string, string> = {},
) {
  const handler = () => undefined;
  for (const [k, v] of Object.entries(meta)) Reflect.defineMetadata(k, v, handler);
  const req = { session, body, headers, method: 'GET', ip: '127.0.0.1', id: 'r1', route: { path: '/x' } } as Record<
    string,
    unknown
  >;
  const ctx = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

const guard = new PolicyGuard(new Reflector(), policy, settings, mfa, audit);
const admin = (adminRole: AdminRole, extra: object = {}) => ({
  userId: 'u',
  role: 'admin',
  adminRole,
  stepUpAt: null,
  ...extra,
});

describe('PolicyGuard × access matrix', () => {
  const legacy = ['payment', 'content', 'support'] as AdminRole[];
  const cases = PERMISSIONS.flatMap((p) => [...ADMIN_ROLES, ...legacy].map((r) => [p, r, matrixLevel(r, p)] as const));

  it.each(cases)('%s / %s (matrix %s)', async (perm, role, level) => {
    const readRoute = ctxFor({ [PERMISSION_KEY]: { permission: perm, min: 'R' } }, admin(role));
    const fullRoute = ctxFor({ [PERMISSION_KEY]: { permission: perm, min: 'Y' } }, admin(role));
    if (level === '-') await expect(guard.canActivate(readRoute.ctx)).rejects.toMatchObject({ status: 403 });
    else {
      await expect(guard.canActivate(readRoute.ctx)).resolves.toBe(true);
      expect(readRoute.req.permissionLevel).toBe(level);
    }
    if (level === 'Y') await expect(guard.canActivate(fullRoute.ctx)).resolves.toBe(true);
    else await expect(guard.canActivate(fullRoute.ctx)).rejects.toMatchObject({ status: 403 });
  });

  it('refuses non-admin sessions on permission routes', async () => {
    const { ctx } = ctxFor(
      { [PERMISSION_KEY]: { permission: 'dashboard', min: 'R' } },
      { userId: 'u', role: 'trainer', adminRole: null },
    );
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 403 });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'access.denied', outcome: 'denied' }));
  });

  it('checks the reason before step-up so a code is not spent on a failing request', async () => {
    (mfa.requireFreshCode as jest.Mock).mockClear();
    const { ctx } = ctxFor(
      { [REASON_KEY]: true, [STEP_UP_KEY]: 'fresh' },
      admin('platform'),
      { reason: 'no' },
      { 'x-step-up-code': '123456' },
    );
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 428, opts: { needs: 'reason' } });
    expect(mfa.requireFreshCode).not.toHaveBeenCalled();
  });

  it('window step-up accepts a step-up younger than the window and refuses an older one', async () => {
    const fresh = ctxFor({ [STEP_UP_KEY]: 'window' }, admin('platform', { stepUpAt: Date.now() - 60_000 }));
    await expect(guard.canActivate(fresh.ctx)).resolves.toBe(true);
    const old = ctxFor({ [STEP_UP_KEY]: 'window' }, admin('platform', { stepUpAt: Date.now() - 600_000 }));
    await expect(guard.canActivate(old.ctx)).rejects.toMatchObject({ status: 428, opts: { needs: 'mfa' } });
  });
});
