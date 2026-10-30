import { Inject, Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import Redis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { BatchesService } from '../lms/batches.service';
import { randomToken, sha256 } from '../common/crypto/crypto.util';
import { AppError, Errors } from '../common/errors/app-error';
import { containsPaymentSecret } from '../common/text/sensitive';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import { RateLimitService } from '../common/guards/rate-limit.service';
import {
  CONSENT_VERSIONS,
  PASSWORD_RESET_TTL_SEC,
  STAFF_CHALLENGE_MAX_TRIES,
  STAFF_CHALLENGE_TTL_SEC,
} from './constants';
import type { AccessRequestDto, PolicyDto, TrainerProfileDto } from './dto/auth.dto';
import { LoginService } from './login.service';
import { MAIL_PORT, type MailPort } from './mail/mail.port';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { normEmail, type IssuedSession, type RequestMeta } from './types';

const CHALLENGE = (id: string) => `schal:${sha256(id)}`;
const RESET = (t: string) => `pwreset:${sha256(t)}`;
export const REENROL = (t: string) => `mfareenrol:${sha256(t)}`;

const INVALID = () => new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is not right.');
const isStaffRole = (u: Pick<User, 'role'> | null): u is User => !!u && (u.role === 'admin' || u.role === 'trainer');

export type OnboardingStep = 'mfa' | 'policy' | 'profile';
export interface OnboardingState {
  complete: boolean;
  pending: OnboardingStep[];
  /** Versions the policy step must echo back, so the page never hard-codes them. */
  policyVersions: { codeOfConductVersion: string; dataHandlingVersion: string };
}

type Current = { hash: string; userId: string };

/** Staff sign-in, first-login onboarding, password reset and access requests (spec §6.4, §6.8). */
@Injectable()
export class StaffAuthService {
  private readonly log = new Logger('StaffAuth');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    private readonly passwords: PasswordService,
    private readonly mfa: MfaService,
    private readonly sessions: SessionService,
    private readonly login: LoginService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly rate: RateLimitService,
  ) {}

  // ── Sign-in ─────────────────────────────────────────────────────────────

  /**
   * Password step. Unknown email, non-staff email and wrong password give the same 401 and run argon2 either way.
   * Lock and suspension are only revealed after a correct password.
   */
  async passwordStep(
    rawEmail: string,
    password: string,
    meta: RequestMeta,
  ): Promise<{ next: 'totp'; challengeId: string } | { next: 'onboarding'; session: IssuedSession }> {
    const email = normEmail(rawEmail);
    const found = await this.prisma.user.findUnique({ where: { email } });
    const user = isStaffRole(found) ? found : null;
    const ok = await this.passwords.verify(user?.passwordHash, password);
    const now = Date.now();
    const locked = !!user?.lockedUntil && user.lockedUntil.getTime() > now;

    if (!user || !ok) {
      if (user && !locked) await this.countFailure(user, meta);
      await this.audit.record({
        action: 'auth.staff.login',
        actorId: user?.id ?? null,
        targetType: 'user',
        targetId: user?.id,
        outcome: 'denied',
        detail: { reason: 'invalid_credentials' },
        ip: meta.ip,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      });
      throw INVALID();
    }
    if (locked) {
      const retryAfterSec = Math.ceil((user.lockedUntil!.getTime() - now) / 1000);
      throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed sign-ins. Try again later or reset your password.', {
        details: { retryAfterSec },
      });
    }
    this.login.assertCanSignIn(user);

    if (!(await this.mfa.hasConfirmedTotp(user.id))) {
      if (user.status === 'invited') {
        // First login was interrupted before the authenticator was set up: resume onboarding.
        return {
          next: 'onboarding',
          session: await this.login.start(user, 'onboarding', meta, 'auth.staff.login', { detail: { resume: true } }),
        };
      }
      throw new AppError(
        403,
        'MFA_REENROLMENT_REQUIRED',
        'Your authenticator was reset. Use the link in your email to set it up again.',
      );
    }

    const challengeId = randomToken(24);
    await this.redis.set(
      CHALLENGE(challengeId),
      JSON.stringify({ userId: user.id, tries: STAFF_CHALLENGE_MAX_TRIES }),
      'EX',
      STAFF_CHALLENGE_TTL_SEC,
    );
    return { next: 'totp', challengeId };
  }

  async totpStep(
    challengeId: string,
    code: string | undefined,
    recoveryCode: string | undefined,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    if (!code && !recoveryCode) throw Errors.validation('Enter your authenticator code or a recovery code.', 'code');
    const key = CHALLENGE(challengeId);
    const raw = await this.redis.get(key);
    if (!raw)
      throw new AppError(401, 'CHALLENGE_EXPIRED', 'Your sign-in expired. Enter your password again.', {
        needs: 'login',
      });
    const ch = JSON.parse(raw) as { userId: string; tries: number };
    await this.rate.hitClass('verify_account', ch.userId);

    const ok = code
      ? await this.mfa.verifyTotp(ch.userId, code)
      : await this.mfa.useRecoveryCode(ch.userId, recoveryCode!);
    if (!ok) {
      ch.tries -= 1;
      if (ch.tries <= 0) {
        await this.redis.del(key);
        throw new AppError(401, 'CHALLENGE_BURNED', 'Too many wrong codes. Enter your password again.', {
          needs: 'login',
        });
      }
      await this.redis.set(key, JSON.stringify(ch), 'KEEPTTL');
      throw new AppError(401, 'TOTP_INVALID', 'That code is not right.', {
        needs: 'mfa',
        details: { triesLeft: ch.tries },
      });
    }
    // Single use: a second request with the same challenge fails.
    if ((await this.redis.del(key)) === 0)
      throw new AppError(401, 'CHALLENGE_EXPIRED', 'Your sign-in expired. Enter your password again.', {
        needs: 'login',
      });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: ch.userId } });
    this.login.assertCanSignIn(user);
    const scope = user.status === 'active' ? 'full' : 'onboarding';
    return this.login.start(user, scope, meta, 'auth.staff.login', {
      stepUp: true,
      detail: { method: code ? 'totp' : 'recovery_code' },
    });
  }

  private async countFailure(user: User, meta: RequestMeta): Promise<void> {
    const { value } = await this.settings.get('auth');
    const failures = user.failedLogins + 1;
    if (failures >= value.staffLockAfterFailures) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: new Date(Date.now() + value.staffLockMinutes * 60_000) },
      });
      await this.audit.record({
        action: 'auth.staff.locked',
        targetType: 'user',
        targetId: user.id,
        detail: { failures, minutes: value.staffLockMinutes },
        ip: meta.ip,
        requestId: meta.requestId,
      });
    } else {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: failures } });
    }
  }

  // ── Invites and onboarding ──────────────────────────────────────────────

  async acceptInvite(
    token: string,
    password: string,
    meta: RequestMeta,
  ): Promise<{ session: IssuedSession; onboarding: OnboardingState }> {
    const invite = await this.prisma.staffInvite.findUnique({ where: { tokenHash: sha256(token) } });
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt.getTime() < Date.now())
      throw new AppError(
        410,
        'INVITE_INVALID',
        'This invite link is no longer valid. Ask a Platform Admin for a new one.',
      );
    await this.passwords.assertAcceptable(password, [], invite.email);
    const passwordHash = await this.passwords.hash(password);

    const user = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.staffInvite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new AppError(410, 'INVITE_INVALID', 'This invite link is no longer valid.');
      const existing = await tx.user.findUnique({ where: { email: invite.email } });
      if (existing && existing.status !== 'invited')
        throw Errors.conflict('ACCOUNT_EXISTS', 'An account with this email already exists.');
      const data = {
        role: invite.role,
        adminRole: invite.adminRole,
        capability: invite.capability,
        status: 'invited' as const,
        origin: 'staff' as const,
        passwordHash,
        passwordHistory: [],
        passwordChangedAt: new Date(),
      };
      const u = existing
        ? await tx.user.update({ where: { id: existing.id }, data })
        : await tx.user.create({ data: { email: invite.email, ...data } });
      await tx.staffProfile.upsert({ where: { userId: u.id }, create: { userId: u.id }, update: {} });
      if (u.role === 'trainer' && invite.batchIds.length)
        await BatchesService.applyInviteScope(tx, u.id, invite.batchIds);
      await this.audit.record(
        {
          action: 'staff.invite.accepted',
          actorId: u.id,
          actorRole: u.role,
          adminRole: u.adminRole,
          targetType: 'staff_invite',
          targetId: invite.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          requestId: meta.requestId,
        },
        tx,
      );
      return u;
    });
    const session = await this.login.start(user, 'onboarding', meta, 'auth.staff.login', { detail: { via: 'invite' } });
    return { session, onboarding: await this.onboardingState(user.id) };
  }

  /** After a confirmed MFA reset (dual control) the person proves the password and gets an onboarding session. */
  async mfaReenrol(
    token: string,
    password: string,
    meta: RequestMeta,
  ): Promise<{ session: IssuedSession; onboarding: OnboardingState }> {
    const key = REENROL(token);
    const userId = await this.redis.get(key);
    if (!userId)
      throw new AppError(410, 'REENROL_LINK_INVALID', 'This link is no longer valid. Ask a Platform Admin for help.');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!isStaffRole(user) || !(await this.passwords.verify(user.passwordHash, password))) throw INVALID();
    this.login.assertCanSignIn(user);
    await this.redis.del(key);
    const session = await this.login.start(user, 'onboarding', meta, 'auth.staff.login', {
      detail: { via: 'mfa_reenrol' },
    });
    return { session, onboarding: await this.onboardingState(user.id) };
  }

  async onboardingState(userId: string): Promise<OnboardingState> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { staffProfile: true } });
    const pending: OnboardingStep[] = [];
    if (!(await this.mfa.hasConfirmedTotp(userId))) pending.push('mfa');
    const accepted = await this.prisma.consent.findMany({
      where: {
        userId,
        accepted: true,
        OR: [
          { kind: 'code_of_conduct', version: CONSENT_VERSIONS.code_of_conduct },
          { kind: 'staff_policy', version: CONSENT_VERSIONS.staff_policy },
        ],
      },
      select: { kind: true },
    });
    if (new Set(accepted.map((c) => c.kind)).size < 2) pending.push('policy');
    if (user.role === 'trainer' && !(user.staffProfile?.displayName && user.staffProfile.speciality))
      pending.push('profile');
    return {
      complete: pending.length === 0,
      pending,
      policyVersions: {
        codeOfConductVersion: CONSENT_VERSIONS.code_of_conduct,
        dataHandlingVersion: CONSENT_VERSIONS.staff_policy,
      },
    };
  }

  async mfaSetup(userId: string): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.mfa.beginEnrolment(userId, user.email);
  }

  async mfaConfirm(current: Current, code: string, meta: RequestMeta) {
    const recoveryCodes = await this.mfa.confirmEnrolment(current.userId, code);
    await this.audit.record({
      action: 'staff.mfa.enrolled',
      actorId: current.userId,
      targetType: 'user',
      targetId: current.userId,
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return { recoveryCodes, ...(await this.maybeComplete(current, meta)) };
  }

  async acceptPolicy(current: Current, dto: PolicyDto, meta: RequestMeta) {
    if (
      dto.codeOfConductVersion !== CONSENT_VERSIONS.code_of_conduct ||
      dto.dataHandlingVersion !== CONSENT_VERSIONS.staff_policy
    )
      throw new AppError(
        409,
        'POLICY_VERSION_STALE',
        'The policy was updated. Reload the page and read the current version.',
        {
          details: {
            codeOfConductVersion: CONSENT_VERSIONS.code_of_conduct,
            dataHandlingVersion: CONSENT_VERSIONS.staff_policy,
          },
        },
      );
    await this.prisma.consent.createMany({
      data: (['code_of_conduct', 'staff_policy'] as const).map((kind) => ({
        userId: current.userId,
        kind,
        version: CONSENT_VERSIONS[kind],
        accepted: true,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300),
      })),
    });
    return this.maybeComplete(current, meta);
  }

  async trainerProfile(current: Current, role: string, dto: TrainerProfileDto, meta: RequestMeta) {
    if (role !== 'trainer') throw Errors.forbidden('Only trainers complete this step.');
    const text = [dto.displayName, dto.speciality, ...(dto.certifications ?? [])].join(' ');
    if (containsPaymentSecret(text))
      throw new AppError(400, 'PAYMENT_DATA_NOT_ALLOWED', 'Remove card, CVV or UPI PIN details.');
    await this.prisma.staffProfile.upsert({
      where: { userId: current.userId },
      create: { userId: current.userId, ...profileData(dto) },
      update: profileData(dto),
    });
    return this.maybeComplete(current, meta);
  }

  /** When every step is done: status active and a new full-scope session ID (spec §6.4.2). */
  private async maybeComplete(
    current: Current,
    meta: RequestMeta,
  ): Promise<{ onboarding: OnboardingState; session?: IssuedSession }> {
    const onboarding = await this.onboardingState(current.userId);
    if (!onboarding.complete) return { onboarding };
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: current.userId } });
    if (user.status === 'invited') {
      await this.prisma.user.update({ where: { id: user.id }, data: { status: 'active' } });
      await this.audit.record({
        action: 'staff.onboarding.completed',
        actorId: user.id,
        actorRole: user.role,
        adminRole: user.adminRole,
        targetType: 'user',
        targetId: user.id,
        ip: meta.ip,
        requestId: meta.requestId,
      });
    }
    const session = await this.login.rotate(current, user, 'full', meta, true);
    return { onboarding, session };
  }

  // ── Access requests ─────────────────────────────────────────────────────

  async accessRequest(dto: AccessRequestDto, meta: RequestMeta): Promise<void> {
    const email = normEmail(dto.email);
    if (containsPaymentSecret(`${dto.name} ${dto.role} ${dto.reason}`))
      throw new AppError(400, 'PAYMENT_DATA_NOT_ALLOWED', 'Remove card, CVV or UPI PIN details.');
    const open = await this.prisma.staffAccessRequest.findFirst({ where: { email, status: 'pending' } });
    if (open) return; // same 202; no duplicate queue rows
    const row = await this.prisma.staffAccessRequest.create({
      data: { name: dto.name, email, role: dto.role, reason: dto.reason },
    });
    await this.audit.record({
      action: 'staff.access_request.created',
      targetType: 'staff_access_request',
      targetId: row.id,
      ip: meta.ip,
      requestId: meta.requestId,
    });
  }

  // ── Passwords ───────────────────────────────────────────────────────────

  async changePassword(
    current: Current,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: current.userId } });
    if (!(await this.passwords.verify(user.passwordHash, currentPassword)))
      throw new AppError(400, 'CURRENT_PASSWORD_WRONG', 'Your current password is not right.', {
        field: 'currentPassword',
      });
    await this.setPassword(user, newPassword);
    const revoked = await this.sessions.revokeAll(user.id, 'password_changed', current.hash);
    await this.notifyPasswordChanged(user.email);
    await this.audit.record({
      action: 'auth.password.changed',
      actorId: user.id,
      actorRole: user.role,
      adminRole: user.adminRole,
      targetType: 'user',
      targetId: user.id,
      detail: { otherSessionsRevoked: revoked },
      ip: meta.ip,
      requestId: meta.requestId,
    });
  }

  /**
   * Always succeeds from the caller's view. The lookup and the email run after the response is sent, so existing
   * and unknown accounts answer with the same content and timing (AC-AUTH-09). Staff only in M1; CTF in M5.
   */
  forgotPassword(rawEmail: string, meta: RequestMeta): Promise<void> {
    const work = this.sendResetLink(normEmail(rawEmail), meta).catch((err: unknown) =>
      this.log.error(`password reset mail failed: ${err instanceof Error ? err.message : String(err)}`),
    );
    return work;
  }

  private async sendResetLink(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!isStaffRole(user) || !user.passwordHash || user.status === 'deleted' || user.status === 'suspended') return;
    const token = randomToken(32);
    await this.redis.set(RESET(token), user.id, 'EX', PASSWORD_RESET_TTL_SEC);
    await this.mail.send({
      to: user.email,
      template: 'password_reset',
      subject: 'Reset your Yojo password',
      text: `Reset your password within 30 minutes: ${this.cfg.PUBLIC_APP_URL}/login.html#reset=${token}\nIf you did not ask for this, ignore this email.`,
    });
    await this.audit.record({
      action: 'auth.password.reset_requested',
      targetType: 'user',
      targetId: user.id,
      ip: meta.ip,
      requestId: meta.requestId,
    });
  }

  async resetPassword(
    token: string,
    newPassword: string,
    code: string | undefined,
    recoveryCode: string | undefined,
    meta: RequestMeta,
  ): Promise<void> {
    const key = RESET(token);
    const userId = await this.redis.get(key);
    if (!userId) throw new AppError(410, 'RESET_LINK_INVALID', 'This reset link has expired. Ask for a new one.');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (await this.mfa.hasConfirmedTotp(user.id)) {
      const ok = code
        ? await this.mfa.verifyTotp(user.id, code)
        : recoveryCode
          ? await this.mfa.useRecoveryCode(user.id, recoveryCode)
          : null;
      if (ok === null)
        throw new AppError(428, 'MFA_CODE_REQUIRED', 'Enter your authenticator code or a recovery code.', {
          needs: 'mfa',
        });
      if (!ok) throw new AppError(401, 'TOTP_INVALID', 'That code is not right.', { needs: 'mfa' });
    }
    await this.setPassword(user, newPassword);
    await this.redis.del(key);
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    const revoked = await this.sessions.revokeAll(user.id, 'password_reset');
    await this.notifyPasswordChanged(user.email);
    await this.audit.record({
      action: 'auth.password.reset',
      actorId: user.id,
      targetType: 'user',
      targetId: user.id,
      detail: { sessionsRevoked: revoked },
      ip: meta.ip,
      requestId: meta.requestId,
    });
  }

  private async setPassword(user: User, plain: string): Promise<void> {
    const history = [user.passwordHash, ...user.passwordHistory].filter((h): h is string => !!h).slice(0, 5);
    await this.passwords.assertAcceptable(plain, history, user.email);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await this.passwords.hash(plain),
        passwordHistory: history.slice(0, 4),
        passwordChangedAt: new Date(),
      },
    });
  }

  private notifyPasswordChanged(to: string): Promise<void> {
    return this.mail.send({
      to,
      template: 'password_changed',
      subject: 'Your Yojo password was changed',
      text: 'Your password was changed. If this was not you, contact a Platform Admin now.',
    });
  }
}

function profileData(dto: TrainerProfileDto) {
  return {
    displayName: dto.displayName,
    speciality: dto.speciality,
    certifications: dto.certifications ?? [],
    availability: (dto.availability ?? undefined) as object | undefined,
  };
}
