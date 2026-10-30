import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/config.schema';
import { cookieNames } from '../../identity/cookies';
import { SessionService } from '../../identity/session.service';
import { AUDIENCE_KEY, ONBOARDING_KEY, PUBLIC_KEY, ROLES_KEY } from '../decorators/auth.decorators';
import { AppError, Errors } from '../errors/app-error';
import type { AppRequest } from '../http/request-context';

/**
 * First global guard. Loads the session from the cookie, then enforces deny-by-default: every route needs a
 * session unless marked @Public, @Roles limits the route group, and an onboarding-scope session may only call
 * routes marked @AllowOnboarding (spec §6.4.2, §6.6).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    const token = (req.cookies as Record<string, string> | undefined)?.[cookieNames(this.cfg).session];
    if (token) {
      const loaded = await this.sessions.load(token);
      if (loaded) req.session = { ...loaded, token };
    }
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const s = req.session;
    if (!s) throw Errors.unauthenticated();
    const want = this.reflector.getAllAndOverride<'lms' | 'ctf' | 'any' | undefined>(AUDIENCE_KEY, targets) ?? 'lms';
    const aud = s.aud ?? 'lms';
    if (want !== 'any' && want !== aud)
      throw new AppError(
        403,
        'WRONG_SESSION_TYPE',
        aud === 'ctf' ? 'Sign in to Yojo Academy to open this page.' : 'Sign in to Yojo CTF to open this page.',
        { needs: 'login' },
      );
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, targets);
    if (roles && !roles.includes(s.role)) throw Errors.forbidden();
    if (s.scope === 'onboarding' && !this.reflector.getAllAndOverride<boolean>(ONBOARDING_KEY, targets))
      throw new AppError(403, 'ONBOARDING_REQUIRED', 'Finish setting up your account first.');
    return true;
  }
}
