import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ENTITLEMENT_KEY } from '../common/decorators/auth.decorators';
import { AppError, Errors } from '../common/errors/app-error';
import type { AppRequest } from '../common/http/request-context';
import { EntitlementService } from './entitlement.service';

/** Runs after the session guard. Routes marked @RequireEntitlement(key) need that key from server records. */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string | undefined>(ENTITLEMENT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!key) return true;
    const s = ctx.switchToHttp().getRequest<AppRequest>().session;
    if (!s) throw Errors.unauthenticated();
    if (s.role !== 'student' || !(await this.entitlements.has(s.userId, key)))
      throw new AppError(403, 'ENTITLEMENT_REQUIRED', 'This content is part of a paid plan.', {
        details: { entitlement: key },
      });
    return true;
  }
}
