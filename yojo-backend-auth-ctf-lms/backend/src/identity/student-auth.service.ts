import { Inject, Injectable } from '@nestjs/common';
import type { ConsentKind, Prisma, User } from '@prisma/client';
import Redis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { EntitlementService } from '../entitlements/entitlement.service';
import { randomToken, sha256 } from '../common/crypto/crypto.util';
import { AppError, Errors } from '../common/errors/app-error';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { CONSENT_VERSIONS, SIGNUP_TICKET_TTL_SEC } from './constants';
import type { SignupDto } from './dto/auth.dto';
import { GoogleVerifier } from './google.verifier';
import { LoginService } from './login.service';
import { MAIL_PORT, type MailPort } from './mail/mail.port';
import { OtpService } from './otp.service';
import { ageOn, isStaffEmail, normEmail, type IssuedSession, type RequestMeta } from './types';

const TICKET = (t: string) => `signup:${sha256(t)}`;
const OTP_PURPOSE = 'student';
const OTP_PURPOSE_YOJO = 'student-yojo';

export type StudentSignInResult =
  | { next: 'done'; session: IssuedSession }
  | { next: 'signup'; signupTicket: string; email: string; upgrade?: 'ctf' };

/** A sign-up ticket. upgradeUserId: a CTF participant whose email was just verified joins the Academy (OI-14). */
type Ticket = { email: string; upgradeUserId?: string };

/** Student sign-in and sign-up (spec §6.3). */
@Injectable()
export class StudentAuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    private readonly otp: OtpService,
    private readonly googleVerifier: GoogleVerifier,
    private readonly login: LoginService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementService,
  ) {}

  /**
   * Always answers the same shape, whether or not an account exists (no enumeration).
   * gate 'open' (NO path): code goes to the typed email; verification signs in or starts sign-up.
   * gate 'yojo' (YES path): the person types a Yojo email or student ID; the code goes to the email on file.
   * When nothing matches safely, a challenge is still created but no email is sent, so the answer looks the same;
   * verification then ends in the generic YOJO_ACCOUNT_NOT_FOUND that points to recovery or support.
   */
  async sendOtp(dto: {
    email?: string;
    identifier?: string;
    gate?: 'yojo' | 'open';
  }): Promise<{ challengeId: string; expiresInSec: number; resendAfterSec: number; gate: 'yojo' | 'open' }> {
    const gate = dto.gate ?? 'open';
    let email: string | null;
    if (gate === 'open') {
      const typed = (dto.email ?? dto.identifier ?? '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(typed)) throw Errors.validation('Enter a valid email address.', 'email');
      email = normEmail(typed);
    } else {
      email = await this.yojoEmailFor((dto.identifier ?? dto.email ?? '').trim());
    }
    const key = email ?? `nomatch:${(dto.identifier ?? dto.email ?? '').trim().toLowerCase()}`;
    const { challengeId, code, ttlSec, resendSec } = await this.otp.issue(
      key,
      gate === 'yojo' ? OTP_PURPOSE_YOJO : OTP_PURPOSE,
    );
    if (email)
      await this.mail.send({
        to: email,
        template: 'otp',
        subject: 'Your Yojo sign-in code',
        text: `Your Yojo code is ${code}. It expires in ${Math.round(ttlSec / 60)} minutes. If you did not ask for it, ignore this email.`,
      });
    return { challengeId, expiresInSec: ttlSec, resendAfterSec: resendSec, gate };
  }

  /** YES path lookup: a Yojo email or student ID that belongs to an existing student account, else null. */
  private async yojoEmailFor(identifier: string): Promise<string | null> {
    if (!identifier) return null;
    const user = identifier.includes('@')
      ? await this.prisma.user.findUnique({ where: { email: normEmail(identifier) } })
      : (
          await this.prisma.studentProfile.findUnique({
            where: { studentNumber: identifier },
            select: { user: true },
          })
        )?.user;
    if (!user || user.role !== 'student' || user.status === 'deleted') return null;
    return user.email;
  }

  async verifyOtp(
    challengeId: string,
    code: string,
    meta: RequestMeta,
    gate: 'yojo' | 'open' = 'open',
  ): Promise<StudentSignInResult> {
    const email = await this.otp.verify(challengeId, code, gate === 'yojo' ? OTP_PURPOSE_YOJO : OTP_PURPOSE);
    const user = email.startsWith('nomatch:') ? null : await this.prisma.user.findUnique({ where: { email } });
    if (gate === 'yojo' && (!user || user.role !== 'student'))
      throw new AppError(
        403,
        'YOJO_ACCOUNT_NOT_FOUND',
        'We could not sign you in with these details. Use account recovery, or contact Yojo support. If you are new, choose "No" to sign up.',
        { details: { recovery: '/login.html#recover', support: 'support@yojo.academy' } },
      );
    this.assertStudentPath(email, user);
    if (!user) return { next: 'signup', signupTicket: await this.newTicket(email), email };
    this.login.assertCanSignIn(user);
    if (user.role === 'participant') return this.upgradeTicket(user);
    if (user.status === 'pending_verification')
      await this.prisma.user.update({ where: { id: user.id }, data: { status: 'active' } });
    return {
      next: 'done',
      session: await this.login.start(user, 'full', meta, 'auth.student.login', { detail: { method: 'otp', gate } }),
    };
  }

  async google(idToken: string, gate: 'yojo' | 'open', meta: RequestMeta): Promise<StudentSignInResult> {
    const g = await this.googleVerifier.verify(idToken);
    const email = normEmail(g.email);
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: 'google', subject: g.sub } },
      include: { user: true },
    });
    const user = identity?.user ?? (await this.prisma.user.findUnique({ where: { email } }));
    this.assertStudentPath(email, user);
    if (gate === 'yojo' && (!user || user.origin !== 'yojo'))
      throw new AppError(
        403,
        'NOT_A_YOJO_ACCOUNT',
        'This Google account is not a Yojo student account. Choose "No" to sign up.',
      );
    if (!user) return { next: 'signup', signupTicket: await this.newTicket(email), email };
    this.login.assertCanSignIn(user);
    if (user.role === 'participant') return this.upgradeTicket(user);
    if (!identity)
      await this.prisma.authIdentity.create({ data: { userId: user.id, provider: 'google', subject: g.sub } });
    return {
      next: 'done',
      session: await this.login.start(user, 'full', meta, 'auth.student.login', { detail: { method: 'google', gate } }),
    };
  }

  async signup(dto: SignupDto, meta: RequestMeta): Promise<IssuedSession> {
    const raw = await this.redis.get(TICKET(dto.signupTicket));
    if (!raw)
      throw new AppError(401, 'SIGNUP_TICKET_INVALID', 'Your sign-up session expired. Verify your email again.');
    const { email, upgradeUserId } = JSON.parse(raw) as Ticket;

    const c = dto.consents;
    if (!c.terms || !c.privacy || !c.aup)
      throw new AppError(
        400,
        'CONSENT_REQUIRED',
        'Accept the Terms, Privacy Policy and Acceptable Use Policy to continue.',
        {
          field: 'consents',
        },
      );

    let minor = false;
    let dob: Date | undefined;
    if (dto.dob) {
      dob = new Date(`${dto.dob.slice(0, 10)}T00:00:00Z`);
      const age = ageOn(dob);
      if (Number.isNaN(age) || age < 0 || age > 120) throw Errors.validation('Enter a valid date of birth.', 'dob');
      minor = age < 18;
    }
    if (minor && (!c.parental || !dto.guardian))
      throw new AppError(
        400,
        'PARENTAL_CONSENT_REQUIRED',
        'Students under 18 need parental consent and guardian details.',
        {
          field: c.parental ? 'guardian' : 'consents.parental',
        },
      );

    let institution: { id: string; name: string; emailDomain: string | null } | null = null;
    if (dto.institutionId) {
      institution = await this.prisma.institution.findUnique({
        where: { id: dto.institutionId },
        select: { id: true, name: true, emailDomain: true },
      });
      if (!institution) throw Errors.validation('Choose an institution from the list.', 'institutionId');
      if (institution.emailDomain && !email.endsWith(`@${institution.emailDomain.toLowerCase()}`))
        throw new AppError(
          400,
          'INSTITUTION_DOMAIN_MISMATCH',
          `Use your @${institution.emailDomain} email for this institution.`,
          {
            field: 'institutionId',
          },
        );
    }

    const consentRows = (userId: string): Prisma.ConsentCreateManyInput[] => {
      const kinds: [ConsentKind, boolean][] = [
        ['terms', true],
        ['privacy', true],
        ['aup', true],
      ];
      if (c.marketing !== undefined) kinds.push(['marketing', c.marketing]);
      if (minor) kinds.push(['parental', true]);
      return kinds.map(([kind, accepted]) => ({
        userId,
        kind,
        accepted,
        version: CONSENT_VERSIONS[kind as keyof typeof CONSENT_VERSIONS],
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300),
      }));
    };

    const user = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email }, select: { id: true, role: true } });
      // OI-14: a CTF participant becomes a student on the same account; CTF identity and registrations stay.
      const upgrade = !!upgradeUserId && existing?.id === upgradeUserId && existing.role === 'participant';
      if (existing && !upgrade)
        throw Errors.conflict('ACCOUNT_EXISTS', 'An account with this email already exists. Sign in instead.');
      const u = upgrade
        ? await tx.user.update({ where: { id: upgradeUserId }, data: { role: 'student' } })
        : await tx.user.create({
            data: { email, role: 'student', status: 'active', origin: 'signup', displayName: dto.name },
          });
      await tx.studentProfile.create({
        data: {
          userId: u.id,
          name: dto.name,
          dob,
          city: dto.city,
          institutionId: institution?.id,
          institutionName: institution?.name ?? dto.institutionName,
          guardian: dto.guardian ? { create: dto.guardian } : undefined,
        },
      });
      await tx.consent.createMany({ data: consentRows(u.id) });
      await this.entitlements.startFreePlan(tx, u.id);
      await this.audit.record(
        {
          action: upgrade ? 'auth.student.joined_from_ctf' : 'auth.student.signup',
          actorId: u.id,
          actorRole: 'student',
          targetType: 'user',
          targetId: u.id,
          detail: { institutionId: institution?.id ?? null, minor, marketing: c.marketing ?? null, fromCtf: upgrade },
          ip: meta.ip,
          userAgent: meta.userAgent,
          requestId: meta.requestId,
        },
        tx,
      );
      return u;
    });
    await this.redis.del(TICKET(dto.signupTicket));
    return this.login.start(user, 'full', meta, 'auth.student.login', { detail: { method: 'signup' } });
  }

  /** Staff use password + authenticator. CTF participants may join as students (OI-14); any other role is refused. */
  private assertStudentPath(email: string, user: User | null): void {
    if (isStaffEmail(this.cfg, email) || (user && (user.role === 'admin' || user.role === 'trainer')))
      throw new AppError(
        403,
        'USE_STAFF_LOGIN',
        'Staff accounts sign in with password and authenticator on the staff page.',
      );
    if (user && user.role !== 'student' && user.role !== 'participant')
      throw new AppError(403, 'NOT_A_STUDENT_ACCOUNT', 'This email belongs to a different kind of account.');
  }

  /** The email was verified just now, so the participant only completes the student details (no second account). */
  private async upgradeTicket(user: User): Promise<StudentSignInResult> {
    return {
      next: 'signup',
      signupTicket: await this.newTicket(user.email, user.id),
      email: user.email,
      upgrade: 'ctf',
    };
  }

  private async newTicket(email: string, upgradeUserId?: string): Promise<string> {
    const ticket = randomToken(32);
    const t: Ticket = upgradeUserId ? { email, upgradeUserId } : { email };
    await this.redis.set(TICKET(ticket), JSON.stringify(t), 'EX', SIGNUP_TICKET_TTL_SEC);
    return ticket;
  }
}
