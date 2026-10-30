import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '../../access/permissions';
import { PolicyService } from '../../access/policy.service';
import { AuditService } from '../../audit/audit.service';
import { MfaService } from '../../identity/mfa.service';
import { SettingsService } from '../../settings/settings.service';
import { PERMISSION_KEY, REASON_KEY, STEP_UP_KEY } from '../decorators/auth.decorators';
import { Errors } from '../errors/app-error';
import type { AppRequest } from '../http/request-context';

/**
 * The one place admin permissions, reasons and step-up are evaluated (spec §6.6.1). Services do no ad-hoc checks.
 * Order: permission, then reason, then step-up, so a code is never spent on a request that fails anyway.
 */
@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policy: PolicyService,
    private readonly settings: SettingsService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    const s = req.session;

    const perm = this.reflector.getAllAndOverride<{ permission: Permission; min: 'Y' | 'R' } | undefined>(
      PERMISSION_KEY,
      targets,
    );
    if (perm) {
      const level = s?.role === 'admin' && s.adminRole ? await this.policy.level(s.adminRole, perm.permission) : null;
      if (!level || (perm.min === 'Y' && level !== 'Y')) {
        await this.audit.record({
          action: 'access.denied',
          actorId: s?.userId ?? null,
          actorRole: s?.role ?? null,
          adminRole: s?.adminRole ?? null,
          outcome: 'denied',
          detail: {
            permission: perm.permission,
            need: perm.min,
            had: level,
            method: req.method,
            path: req.route?.path as string | undefined,
          },
          ip: req.ip,
          requestId: String(req.id),
        });
        throw Errors.forbidden();
      }
      req.permissionLevel = level;
    }

    if (this.reflector.getAllAndOverride<boolean>(REASON_KEY, targets)) {
      const reason = (req.body as { reason?: unknown } | undefined)?.reason;
      if (typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 500) throw Errors.reasonRequired();
    }

    const stepUp = this.reflector.getAllAndOverride<'window' | 'fresh' | undefined>(STEP_UP_KEY, targets);
    if (stepUp && s) {
      const header = req.headers['x-step-up-code'];
      const code = typeof header === 'string' ? header : undefined;
      if (stepUp === 'fresh' || code) {
        await this.mfa.requireFreshCode(s.userId, code);
      } else {
        const { value } = await this.settings.get('auth');
        if (!s.stepUpAt || Date.now() - s.stepUpAt > value.stepUpWindowSec * 1000) throw Errors.stepUpRequired();
      }
    }
    return true;
  }
}
