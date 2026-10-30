import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/config.schema';
import { cookieNames } from '../../identity/cookies';
import { safeEqual } from '../crypto/crypto.util';
import { SKIP_CSRF_KEY } from '../decorators/auth.decorators';
import { AppError } from '../errors/app-error';
import type { AppRequest } from '../http/request-context';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF (spec §22.4): unsafe methods must send X-CSRF-Token. With a session it must equal the token stored in the
 * session; before sign-in it must equal the pre-session cookie from GET /auth/csrf (double submit).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (SAFE.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [ctx.getHandler(), ctx.getClass()])) return true;
    const header = req.headers['x-csrf-token'];
    const sent = typeof header === 'string' ? header : '';
    const expected =
      req.session?.csrf ?? (req.cookies as Record<string, string> | undefined)?.[cookieNames(this.cfg).csrf] ?? '';
    if (!sent || !expected || !safeEqual(sent, expected))
      throw new AppError(403, 'CSRF_INVALID', 'Your page is out of date. Reload and try again.');
    return true;
  }
}
