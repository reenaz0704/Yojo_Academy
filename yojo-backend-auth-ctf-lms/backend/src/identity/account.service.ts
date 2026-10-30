import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors/app-error';
import { containsPaymentSecret } from '../common/text/sensitive';
import { RateLimitService } from '../common/guards/rate-limit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateMeDto } from './dto/auth.dto';
import { LoginService } from './login.service';
import { MfaService } from './mfa.service';
import { SessionService, type SessionData } from './session.service';
import { ageOn, type IssuedSession, type RequestMeta } from './types';

type Current = SessionData & { hash: string };

const STUDENT_FIELDS = [
  'name',
  'dob',
  'phone',
  'city',
  'eduLevel',
  'stream',
  'institution',
  'gradYear',
  'cgpa',
  'skills',
  'objective',
  'certifications',
] as const;
const GUARDIAN_FIELDS = ['guardian.name', 'guardian.relation', 'guardian.phone'] as const;
const STAFF_TEXT_KEYS = ['title', 'speciality', 'bio', 'displayName'] as const;

/** The signed-in person's own account: sessions, step-up, profile (spec §6.5, §8.1). */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly login: LoginService,
    private readonly mfa: MfaService,
    private readonly policy: PolicyService,
    private readonly rate: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  async logout(s: Current, meta: RequestMeta): Promise<void> {
    await this.sessions.revokeHash(s.hash, s.userId, 'logout');
    await this.audit.record({
      action: 'auth.logout',
      actorId: s.userId,
      actorRole: s.role,
      targetType: 'session',
      targetId: s.sid,
      ip: meta.ip,
      requestId: meta.requestId,
    });
  }

  async logoutAll(s: Current, meta: RequestMeta): Promise<number> {
    const n = await this.sessions.revokeAll(s.userId, 'logout_all');
    await this.audit.record({
      action: 'auth.logout_all',
      actorId: s.userId,
      actorRole: s.role,
      targetType: 'user',
      targetId: s.userId,
      detail: { revoked: n },
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return n;
  }

  async listSessions(s: Current) {
    const rows = await this.prisma.userSession.findMany({
      where: { userId: s.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
    });
    return rows.map((r) => ({ ...r, current: r.id === s.sid }));
  }

  async revokeSession(s: Current, id: string, meta: RequestMeta): Promise<void> {
    const row = await this.prisma.userSession.findFirst({ where: { id, userId: s.userId, revokedAt: null } });
    if (!row) throw Errors.notFound('Session not found.');
    await this.sessions.revokeHash(row.sessionHash, s.userId, 'revoked_by_user');
    await this.audit.record({
      action: 'auth.session.revoked',
      actorId: s.userId,
      actorRole: s.role,
      targetType: 'session',
      targetId: id,
      ip: meta.ip,
      requestId: meta.requestId,
    });
  }

  /** Verifies a TOTP code and issues a new session ID carrying the step-up time (spec §6.4.4, §6.5). */
  async stepUp(s: Current, code: string, meta: RequestMeta): Promise<IssuedSession> {
    if (s.role !== 'admin' && s.role !== 'trainer') throw Errors.forbidden('Step-up is for staff accounts.');
    await this.rate.hitClass('step_up_user', s.userId);
    const ok = await this.mfa.verifyTotp(s.userId, code);
    await this.audit.record({
      action: 'auth.step_up',
      actorId: s.userId,
      actorRole: s.role,
      adminRole: s.adminRole,
      outcome: ok ? 'success' : 'denied',
      ip: meta.ip,
      requestId: meta.requestId,
    });
    if (!ok) throw Errors.stepUpInvalid();
    return this.login.rotate(
      s,
      { id: s.userId, role: s.role, adminRole: s.adminRole, capability: s.capability },
      s.scope,
      meta,
      true,
    );
  }

  async me(s: Current) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: s.userId },
      include: {
        studentProfile: { include: { guardian: true, institution: { select: { id: true, name: true } } } },
        staffProfile: true,
      },
    });
    const permissions =
      user.role === 'admin' && user.adminRole
        ? Object.entries(await this.policy.permissionsFor(user.adminRole)).map(([key, level]) => ({ key, level }))
        : [];
    return {
      id: user.id,
      code: user.code,
      email: user.email,
      phone: user.phone,
      role: user.role,
      adminRole: user.adminRole,
      capability: user.capability,
      status: user.status,
      origin: user.origin,
      displayName: user.displayName,
      sessionScope: s.scope,
      permissions,
      // Plans and entitlements arrive with Milestone 3 (payments); the fields exist so clients can rely on the shape.
      plan: null,
      entitlements: [] as string[],
      studentProfile: user.studentProfile,
      staffProfile: user.staffProfile,
    };
  }

  async updateMe(s: Current, dto: UpdateMeDto, meta: RequestMeta) {
    const texts = Object.values(dto).flatMap((v) =>
      typeof v === 'string'
        ? [v]
        : Array.isArray(v)
          ? v.map(String)
          : v && typeof v === 'object'
            ? Object.values(v).map(String)
            : [],
    );
    if (texts.some(containsPaymentSecret))
      throw new AppError(400, 'PAYMENT_DATA_NOT_ALLOWED', 'Remove card, CVV or UPI PIN details from your profile.');

    const staff = s.role === 'admin' || s.role === 'trainer';
    const changed = Object.keys(dto);
    if (s.role === 'student') await this.assertUnlocked(s.userId, dto);
    await this.prisma.$transaction(async (tx) => {
      const userData: Prisma.UserUpdateInput = {};
      if (dto.phone !== undefined) userData.phone = dto.phone;
      if (dto.displayName !== undefined) userData.displayName = dto.displayName;
      if (Object.keys(userData).length) await tx.user.update({ where: { id: s.userId }, data: userData });

      if (staff) {
        const p: Prisma.StaffProfileUpdateInput = {};
        for (const k of STAFF_TEXT_KEYS) if (dto[k] !== undefined) p[k] = dto[k];
        if (dto.linkedinUrl !== undefined) p.linkedinUrl = dto.linkedinUrl;
        if (dto.certifications !== undefined) p.certifications = dto.certifications;
        if (Object.keys(p).length)
          await tx.staffProfile.upsert({
            where: { userId: s.userId },
            create: { userId: s.userId, ...(p as object) },
            update: p,
          });
        return;
      }
      if (s.role !== 'student') return;
      const p: Prisma.StudentProfileUncheckedUpdateInput = {};
      for (const k of [
        'name',
        'city',
        'eduLevel',
        'stream',
        'gradYear',
        'skills',
        'objective',
        'certifications',
        'showOnBoard',
        'displayName',
      ] as const)
        if (dto[k] !== undefined) (p as Record<string, unknown>)[k] = dto[k];
      if (dto.cgpa !== undefined) p.cgpa = dto.cgpa;
      if (dto.dob !== undefined) p.dob = new Date(`${dto.dob.slice(0, 10)}T00:00:00Z`);
      await tx.studentProfile.upsert({
        where: { userId: s.userId },
        create: { userId: s.userId, ...(p as object) },
        update: p,
      });
      if (dto.guardian)
        await tx.guardian.upsert({
          where: { studentId: s.userId },
          create: { studentId: s.userId, ...dto.guardian },
          update: dto.guardian,
        });
    });
    await this.audit.record({
      action: 'account.profile.updated',
      actorId: s.userId,
      actorRole: s.role,
      targetType: 'user',
      targetId: s.userId,
      detail: { fields: changed },
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return this.me(s);
  }

  /**
   * Owner, 29 Oct: a student's sign-up details are locked once filled. Empty fields can still be completed (for
   * example CGPA or certifications later) and display name / leaderboard visibility stay free; changing a filled
   * detail goes through Yojo (admin), so the resume built from these details stays trustworthy.
   */
  private async assertUnlocked(userId: string, dto: UpdateMeDto) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { phone: true, studentProfile: { include: { guardian: true } } },
    });
    const p = u.studentProfile;
    const dobOf = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
    const current: Record<string, unknown> = {
      name: p?.name,
      phone: u.phone,
      dob: dobOf(p?.dob),
      city: p?.city,
      eduLevel: p?.eduLevel,
      stream: p?.stream,
      gradYear: p?.gradYear,
      cgpa: p?.cgpa === null || p?.cgpa === undefined ? null : Number(p.cgpa),
      skills: p?.skills?.length ? p.skills : null,
      objective: p?.objective,
      certifications: p?.certifications?.length ? p.certifications : null,
      guardian: p?.guardian ? { name: p.guardian.name, relation: p.guardian.relation, phone: p.guardian.phone } : null,
    };
    const next = (k: string, v: unknown) => (k === 'dob' && typeof v === 'string' ? v.slice(0, 10) : v);
    const locked = Object.keys(current).filter((k) => {
      const v = (dto as Record<string, unknown>)[k];
      if (v === undefined) return false;
      const cur = current[k];
      if (cur === null || cur === undefined || cur === '') return false; // completing an empty detail is fine
      return JSON.stringify(next(k, v)) !== JSON.stringify(cur);
    });
    if (locked.length)
      throw new AppError(
        409,
        'PROFILE_LOCKED',
        'Your sign-up details are locked. To change them, ask Yojo support or your Platform Admin.',
        { details: { fields: locked } },
      );
  }

  /** Resume and guardian fields still empty (spec §6.3 step 5). Which of these block other routes is [PROVISIONAL]. */
  async missingFields(s: Current): Promise<{ missing: string[]; minor: boolean }> {
    if (s.role !== 'student') throw Errors.forbidden('Only students have resume fields.');
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: s.userId },
      include: { studentProfile: { include: { guardian: true } } },
    });
    const p = user.studentProfile;
    const value: Record<(typeof STUDENT_FIELDS)[number], unknown> = {
      name: p?.name,
      dob: p?.dob,
      phone: user.phone,
      city: p?.city,
      eduLevel: p?.eduLevel,
      stream: p?.stream,
      // Either an institution from the list or the free-text name given at sign-up.
      institution: p?.institutionId ?? p?.institutionName,
      gradYear: p?.gradYear,
      cgpa: p?.cgpa,
      skills: p?.skills?.length ? p.skills : null,
      objective: p?.objective,
      certifications: p?.certifications?.length ? p.certifications : null,
    };
    const missing: string[] = STUDENT_FIELDS.filter(
      (f) => value[f] === null || value[f] === undefined || value[f] === '',
    );
    const minor = !!p?.dob && ageOn(p.dob) < 18;
    if (minor && !p?.guardian) missing.push(...GUARDIAN_FIELDS);
    return { missing, minor };
  }
}
