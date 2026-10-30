import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { sha256 as issuedHash } from '../common/crypto/crypto.util';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from './session.service';
import type { IssuedSession, RequestMeta, SessionUser } from './types';

/** Shared final step of every sign-in: account state check, new session ID, audit row. */
@Injectable()
export class LoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Refuses accounts that may not sign in. Messages do not reveal more than the person already proved. */
  assertCanSignIn(user: Pick<User, 'status'>): void {
    if (user.status === 'suspended')
      throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact Yojo support.');
    if (user.status === 'deleted')
      throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account is no longer available.');
  }

  async start(
    user: SessionUser,
    scope: 'full' | 'onboarding',
    meta: RequestMeta,
    action: string,
    opts: { stepUp?: boolean; detail?: Record<string, unknown>; aud?: 'lms' | 'ctf' } = {},
  ): Promise<IssuedSession> {
    const issued = await this.sessions.create(user, scope, meta, opts.aud ?? 'lms');
    if (opts.stepUp) {
      issued.data.stepUpAt = Date.now();
      await this.sessions.update(issuedHash(issued.token), issued.data);
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null },
    });
    await this.audit.record({
      action,
      actorId: user.id,
      actorRole: user.role,
      adminRole: user.adminRole,
      targetType: 'user',
      targetId: user.id,
      detail: { scope, aud: opts.aud ?? 'lms', sessionId: issued.data.sid, ...opts.detail },
      ip: meta.ip,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });
    return issued;
  }

  /** Ends the current session and issues a new ID with the same user (after onboarding or step-up). */
  async rotate(
    current: { hash: string; userId: string },
    user: SessionUser,
    scope: 'full' | 'onboarding',
    meta: RequestMeta,
    stepUp: boolean,
  ): Promise<IssuedSession> {
    await this.sessions.revokeHash(current.hash, current.userId, 'rotated');
    const issued = await this.sessions.create(user, scope, meta);
    if (stepUp) {
      issued.data.stepUpAt = Date.now();
      await this.sessions.update(issuedHash(issued.token), issued.data);
    }
    return issued;
  }
}
