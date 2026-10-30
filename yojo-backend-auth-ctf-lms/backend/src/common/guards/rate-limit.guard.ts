import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RATE_KEY } from '../decorators/auth.decorators';
import type { AppRequest } from '../http/request-context';
import { RateLimitService } from './rate-limit.service';

/** Named per-IP classes on sensitive public routes, plus a general per-user budget for signed-in calls. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rate: RateLimitService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const cls = this.reflector.getAllAndOverride<string | undefined>(RATE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (cls) await this.rate.hitClass(cls, req.ip ?? 'unknown');
    if (req.session) await this.rate.hitClass('general_user', req.session.userId);
    return true;
  }
}
