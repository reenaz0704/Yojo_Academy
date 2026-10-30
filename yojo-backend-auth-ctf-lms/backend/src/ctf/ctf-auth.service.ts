import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import Redis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256 } from '../common/crypto/crypto.util';
import { AppError, Errors } from '../common/errors/app-error';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { CONSENT_VERSIONS, PASSWORD_RESET_TTL_SEC } from '../identity/constants';
import { LoginService } from '../identity/login.service';
import { MAIL_PORT, type MailPort } from '../identity/mail/mail.port';
import { MfaService } from '../identity/mfa.service';
import { OtpService } from '../identity/otp.service';
import { PasswordService } from '../identity/password.service';
import { SessionService } from '../identity/session.service';
import { isStaffEmail, normEmail, type IssuedSession, type RequestMeta } from '../identity/types';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import type { CtfRegisterDto } from './ctf.dto';

const PURPOSE_REGISTER = 'ctf-register';
const PURPOSE_LOGIN = 'ctf-login';
const DEFAULT_EVENT = 'yojo-ctf';
const OTP_TICKET = (id: string) => `ctf:otp:${id}`;
const TOTP_TICKET = (t: string) => `ctf:totp:${sha256(t)}`;
const RESET = (t: string) => `ctf:reset:${sha256(t)}`;
const TOTP_TTL_SEC = 300;
const TOTP_TRIES = 5;

/** Post-login destinations a CTF sign-in may send the browser to. Anything else falls back to the first entry. */
export const CTF_REDIRECT_ALLOWLIST = [
  '/ctf/dashboard',
  '/ctf/challenges',
  '/ctf/scoreboard',
  '/ctf/profile',
  '/ctf-dashboard.html',
  '/ctf.html',
] as const;
export function safeCtfRedirect(next: string | undefined): string {
  return next && (CTF_REDIRECT_ALLOWLIST as readonly string[]).includes(next) ? next : CTF_REDIRECT_ALLOWLIST[0];
}

const INVALID = () => new AppError(401, 'INVALID_CREDENTIALS', 'Username or password is not right.');
export const maskEmail = (e: string) => {
  const [u, d] = e.split('@');
  return `${u.slice(0, 1)}${'*'.repeat(Math.max(1, Math.min(6, u.length - 1)))}@${d}`;
};

export type CtfResult = { next: 'done'; session: IssuedSession; redirect: string; username: string; linked?: boolean };

/**
 * CTF journey (separate from LMS sign-in). One canonical person: a CTF account is a users row with a
 * ctf_password identity (username + argon2id secret). Existing Yojo accounts are linked, never duplicated, and only
 * after an email OTP proves the person owns that email. CTF sessions carry aud 'ctf' and last at most 8 hours.
 */
@Injectable()
export class CtfAuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    private readonly otp: OtpService,
    private readonly passwords: PasswordService,
    private readonly mfa: MfaService,
    private readonly login: LoginService,
    private readonly sessions: SessionService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Same answer for every address. Staff addresses get no code (staff never use the CTF login). */
  async sendRegisterOtp(raw: string) {
    const email = normEmail(raw);
    const { challengeId, code, ttlSec, resendSec } = await this.otp.issue(email, PURPOSE_REGISTER);
    if (!isStaffEmail(this.cfg, email))
      await this.mail.send({
        to: email,
        template: 'otp',
        subject: 'Your Yojo CTF verification code',
        text: `Your Yojo CTF code is ${code}. It expires in ${Math.round(ttlSec / 60)} minutes.`,
      });
    return { challengeId, expiresInSec: ttlSec, resendAfterSec: resendSec };
  }

  async register(dto: CtfRegisterDto, meta: RequestMeta): Promise<CtfResult> {
    const email = await this.otp.verify(dto.challengeId, dto.code, PURPOSE_REGISTER);
    if (isStaffEmail(this.cfg, email))
      throw new AppError(403, 'USE_STAFF_LOGIN', 'Staff accounts cannot register for the CTF with this email.');
    await this.passwords.assertAcceptable(dto.password, [], email);
    const secretHash = await this.passwords.hash(dto.password);
    const event = await this.prisma.ctfEvent.findUnique({ where: { slug: dto.event ?? DEFAULT_EVENT } });
    if (!event) throw Errors.validation('Choose a CTF event that is open.', 'event');
    if (event.status !== 'registration' && event.status !== 'live')
      throw new AppError(409, 'REGISTRATION_CLOSED', 'Registration for this CTF is closed.');
    const subject = dto.username.toLowerCase();

    let linked = false;
    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        if (await tx.authIdentity.findUnique({ where: { provider_subject: { provider: 'ctf_password', subject } } }))
          throw Errors.conflict('USERNAME_TAKEN', 'This username is taken. Choose another.');
        const existing = await tx.user.findUnique({
          where: { email },
          include: { identities: { where: { provider: 'ctf_password' } } },
        });
        let u: User;
        if (existing) {
          if (existing.role === 'admin' || existing.role === 'trainer')
            throw new AppError(403, 'USE_STAFF_LOGIN', 'Staff accounts cannot register for the CTF with this email.');
          if (existing.identities.length)
            throw Errors.conflict('CTF_ACCOUNT_EXISTS', 'You already have a CTF account. Sign in instead.');
          if (existing.status === 'suspended' || existing.status === 'deleted')
            throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account cannot register. Contact Yojo support.');
          u = existing;
          linked = true;
        } else {
          u = await tx.user.create({
            data: { email, role: 'participant', status: 'active', origin: 'ctf', displayName: dto.username },
          });
        }
        await tx.authIdentity.create({ data: { userId: u.id, provider: 'ctf_password', subject, secretHash } });
        await tx.consent.createMany({
          data: (
            [
              ['ctf_rules', true],
              ['ctf_contact', dto.consents.ctf_contact],
            ] as const
          ).map(([kind, accepted]) => ({
            userId: u.id,
            kind,
            accepted,
            version: CONSENT_VERSIONS[kind],
            ip: meta.ip,
            userAgent: meta.userAgent?.slice(0, 300),
          })),
        });
        const reg = await tx.ctfRegistration.create({
          data: {
            eventId: event.id,
            userId: u.id,
            username: dto.username,
            phone: dto.phone,
            institution: dto.institution,
            city: dto.city,
            level: dto.level,
          },
        });
        await this.audit.record(
          {
            action: linked ? 'ctf.identity.linked' : 'ctf.registered',
            actorId: u.id,
            actorRole: u.role,
            targetType: 'user',
            targetId: u.id,
            detail: { registration: reg.code, event: event.slug, linked, verifiedBy: 'email_otp' },
            ip: meta.ip,
            userAgent: meta.userAgent,
            requestId: meta.requestId,
          },
          tx,
        );
        return u;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw Errors.conflict('USERNAME_TAKEN', 'This username is taken. Choose another.');
      throw e;
    }
    this.login.assertCanSignIn(user);
    const session = await this.login.start(user, 'full', meta, 'auth.ctf.login', {
      aud: 'ctf',
      detail: { method: 'register' },
    });
    return { next: 'done', session, redirect: CTF_REDIRECT_ALLOWLIST[0], username: dto.username, linked };
  }

  /** Step 1: username + password. The same error and similar timing for unknown usernames and wrong passwords. */
  async passwordStep(username: string, password: string, next: string | undefined, meta: RequestMeta) {
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: 'ctf_password', subject: username.trim().toLowerCase() } },
      include: { user: true },
    });
    const user = identity?.user ?? null;
    const ok = await this.passwords.verify(identity?.secretHash, password);
    const now = Date.now();
    const locked = !!user?.lockedUntil && user.lockedUntil.getTime() > now;
    if (!user || !ok) {
      if (user && !locked) await this.countFailure(user, meta);
      await this.audit.record({
        action: 'auth.ctf.login',
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
    if (locked)
      throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed sign-ins. Try again later or reset your password.', {
        details: { retryAfterSec: Math.ceil((user.lockedUntil!.getTime() - now) / 1000) },
      });
    this.login.assertCanSignIn(user);
    if (user.failedLogins) await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0 } });

    const { challengeId, code, ttlSec, resendSec } = await this.otp.issue(user.email, PURPOSE_LOGIN);
    await this.redis.set(
      OTP_TICKET(challengeId),
      JSON.stringify({ userId: user.id, next: safeCtfRedirect(next) }),
      'EX',
      ttlSec,
    );
    await this.mail.send({
      to: user.email,
      template: 'otp',
      subject: 'Your Yojo CTF sign-in code',
      text: `Your Yojo CTF sign-in code is ${code}. It expires in ${Math.round(ttlSec / 60)} minutes.`,
    });
    return {
      next: 'otp' as const,
      challengeId,
      emailHint: maskEmail(user.email),
      expiresInSec: ttlSec,
      resendAfterSec: resendSec,
    };
  }

  /** Step 2: email code. Then TOTP if the person enrolled an authenticator, otherwise a CTF session. */
  async otpStep(
    challengeId: string,
    code: string,
    meta: RequestMeta,
  ): Promise<CtfResult | { next: 'totp'; ticket: string }> {
    const raw = await this.redis.get(OTP_TICKET(challengeId));
    if (!raw) throw new AppError(401, 'OTP_EXPIRED', 'This code has expired. Sign in again.');
    const t = JSON.parse(raw) as { userId: string; next: string };
    const email = await this.otp.verify(challengeId, code, PURPOSE_LOGIN);
    await this.redis.del(OTP_TICKET(challengeId));
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: t.userId } });
    if (user.email !== email) throw new AppError(401, 'OTP_EXPIRED', 'This code has expired. Sign in again.');
    this.login.assertCanSignIn(user);
    if (await this.mfa.hasConfirmedTotp(user.id)) {
      const ticket = randomToken(24);
      await this.redis.set(
        TOTP_TICKET(ticket),
        JSON.stringify({ userId: user.id, next: t.next, tries: TOTP_TRIES }),
        'EX',
        TOTP_TTL_SEC,
      );
      return { next: 'totp', ticket };
    }
    return this.finish(user, t.next, meta, 'otp');
  }

  async totpStep(ticket: string, code: string | undefined, recoveryCode: string | undefined, meta: RequestMeta) {
    const key = TOTP_TICKET(ticket);
    const raw = await this.redis.get(key);
    if (!raw) throw new AppError(401, 'CHALLENGE_EXPIRED', 'This sign-in expired. Start again.');
    const t = JSON.parse(raw) as { userId: string; next: string; tries: number };
    const ok = code
      ? await this.mfa.verifyTotp(t.userId, code)
      : recoveryCode
        ? await this.mfa.useRecoveryCode(t.userId, recoveryCode)
        : false;
    if (!ok) {
      t.tries -= 1;
      if (t.tries <= 0) await this.redis.del(key);
      else await this.redis.set(key, JSON.stringify(t), 'KEEPTTL');
      throw new AppError(401, 'TOTP_INVALID', 'That authenticator code is not right.', {
        details: { triesLeft: Math.max(0, t.tries) },
      });
    }
    await this.redis.del(key);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: t.userId } });
    this.login.assertCanSignIn(user);
    return this.finish(user, t.next, meta, code ? 'totp' : 'recovery_code');
  }

  private async finish(user: User, next: string, meta: RequestMeta, method: string): Promise<CtfResult> {
    const identity = await this.prisma.authIdentity.findFirst({
      where: { userId: user.id, provider: 'ctf_password' },
      select: { subject: true },
    });
    const session = await this.login.start(user, 'full', meta, 'auth.ctf.login', { aud: 'ctf', detail: { method } });
    return { next: 'done', session, redirect: safeCtfRedirect(next), username: identity?.subject ?? '' };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        code: true,
        email: true,
        role: true,
        displayName: true,
        identities: { where: { provider: 'ctf_password' }, select: { subject: true } },
        ctfRegistrations: {
          select: {
            code: true,
            username: true,
            status: true,
            mode: true,
            teamName: true,
            event: { select: { name: true, slug: true, status: true, startsAt: true, endsAt: true } },
          },
        },
      },
    });
    return {
      code: user.code,
      username: user.ctfRegistrations[0]?.username ?? user.identities[0]?.subject ?? null,
      email: maskEmail(user.email),
      displayName: user.displayName,
      lmsAccount: user.role === 'student',
      mfaEnrolled: await this.mfa.hasConfirmedTotp(userId),
      registrations: user.ctfRegistrations,
    };
  }

  async mfaSetup(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    if (await this.mfa.hasConfirmedTotp(userId))
      throw Errors.conflict('MFA_ALREADY_ENROLLED', 'An authenticator is already set up.');
    return this.mfa.beginEnrolment(userId, u.email);
  }

  async mfaConfirm(userId: string, code: string, meta: RequestMeta) {
    const recoveryCodes = await this.mfa.confirmEnrolment(userId, code);
    await this.audit.record({
      action: 'ctf.mfa.enrolled',
      actorId: userId,
      targetType: 'user',
      targetId: userId,
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return { recoveryCodes };
  }

  /** Always 202 to the caller; runs in the background so timing does not reveal accounts. */
  async forgotPassword(usernameOrEmail: string, meta: RequestMeta): Promise<void> {
    try {
      const v = usernameOrEmail.trim().toLowerCase();
      const identity = v.includes('@')
        ? await this.prisma.authIdentity.findFirst({ where: { provider: 'ctf_password', user: { email: v } } })
        : await this.prisma.authIdentity.findUnique({
            where: { provider_subject: { provider: 'ctf_password', subject: v } },
          });
      if (!identity) return;
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: identity.userId } });
      if (user.status === 'suspended' || user.status === 'deleted') return;
      const token = randomToken(32);
      await this.redis.set(RESET(token), user.id, 'EX', PASSWORD_RESET_TTL_SEC);
      await this.mail.send({
        to: user.email,
        template: 'ctf_password_reset',
        subject: 'Reset your Yojo CTF password',
        text: `Reset your CTF password within 30 minutes: ${this.cfg.PUBLIC_APP_URL}/ctf-login.html#ctf-reset=${token}`,
      });
      await this.audit.record({
        action: 'ctf.password.reset_requested',
        targetType: 'user',
        targetId: user.id,
        ip: meta.ip,
        requestId: meta.requestId,
      });
    } catch {
      // Swallowed on purpose: the caller already got 202.
    }
  }

  async resetPassword(token: string, newPassword: string, code: string | undefined, meta: RequestMeta) {
    const userId = await this.redis.get(RESET(token));
    if (!userId)
      throw new AppError(410, 'RESET_LINK_INVALID', 'This reset link is no longer valid. Ask for a new one.');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (await this.mfa.hasConfirmedTotp(userId)) {
      if (!code) throw Errors.stepUpRequired();
      if (!(await this.mfa.verifyTotp(userId, code))) throw Errors.stepUpInvalid();
    }
    await this.passwords.assertAcceptable(newPassword, [], user.email);
    const secretHash = await this.passwords.hash(newPassword);
    await this.prisma.authIdentity.updateMany({ where: { userId, provider: 'ctf_password' }, data: { secretHash } });
    await this.prisma.user.update({ where: { id: userId }, data: { failedLogins: 0, lockedUntil: null } });
    await this.redis.del(RESET(token));
    await this.sessions.revokeAll(userId, 'password_reset');
    await this.audit.record({
      action: 'ctf.password.reset',
      actorId: userId,
      targetType: 'user',
      targetId: userId,
      ip: meta.ip,
      requestId: meta.requestId,
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
        action: 'auth.ctf.locked',
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
}
