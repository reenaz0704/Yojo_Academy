import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors/app-error';
import { EntitlementService, liveEntitlement, PAID_KEY } from '../entitlements/entitlement.service';
import { SessionService } from '../identity/session.service';
import { normEmail, type RequestMeta } from '../identity/types';
import { PrismaService } from '../prisma/prisma.service';
import type { ProvisionStudentDto, UserListQuery, UserSort, UserView } from './lms.dto';

export type AdminActor = RequestMeta & { userId: string };

/** Students whose paid access is in force right now (server records only). */
const paidWhere = (now: Date): Prisma.UserWhereInput => ({
  OR: [
    { entitlements: { some: { key: PAID_KEY, ...liveEntitlement(now) } } },
    { subscriptions: { some: { status: 'active', plan: { grants: { array_contains: [PAID_KEY] } } } } },
  ],
});

/** Field minimisation: the list never carries secrets, hashes, phone, date of birth or guardian data. */
const LIST_SELECT = {
  id: true,
  code: true,
  email: true,
  displayName: true,
  role: true,
  adminRole: true,
  capability: true,
  status: true,
  origin: true,
  createdAt: true,
  lastLoginAt: true,
  lockedUntil: true,
  studentProfile: { select: { name: true, studentNumber: true, institutionName: true } },
  identities: { select: { provider: true } },
} satisfies Prisma.UserSelect;

const ORDER: Record<UserSort, Prisma.UserOrderByWithRelationInput[]> = {
  created_desc: [{ createdAt: 'desc' }, { id: 'asc' }],
  created_asc: [{ createdAt: 'asc' }, { id: 'asc' }],
  name_asc: [{ displayName: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
  last_login_desc: [{ lastLoginAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
};

const encodeCursor = (offset: number) => Buffer.from(`o:${offset}`).toString('base64url');
function decodeCursor(c?: string): number {
  if (!c) return 0;
  const m = /^o:(\d{1,7})$/.exec(Buffer.from(c, 'base64url').toString());
  if (!m) throw Errors.validation('The page cursor is not valid.', 'cursor');
  return Number(m[1]);
}

/** Admin LMS user management. One users row per person, so every count here is a count of distinct people. */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly entitlements: EntitlementService,
  ) {}

  viewWhere(view: UserView, now = new Date()): Prisma.UserWhereInput {
    const notDeleted: Prisma.UserWhereInput = { status: { not: 'deleted' } };
    switch (view) {
      case 'students':
        return { ...notDeleted, role: 'student' };
      case 'paid':
        return { ...notDeleted, role: 'student', ...paidWhere(now) };
      case 'free':
        return { ...notDeleted, role: 'student', NOT: paidWhere(now) };
      case 'ctf':
        return { ...notDeleted, identities: { some: { provider: 'ctf_password' } } };
      case 'trainers':
        return { ...notDeleted, role: 'trainer' };
      case 'admins':
        return { ...notDeleted, role: 'admin' };
      case 'pending_verification':
        return { status: 'pending_verification' };
      case 'pending_onboarding':
        return { status: 'invited', role: { in: ['trainer', 'admin'] } };
      case 'suspended':
        return { OR: [{ status: { in: ['suspended', 'locked'] } }, { lockedUntil: { gt: now } }] };
      default:
        return notDeleted;
    }
  }

  async list(q: UserListQuery) {
    const view = q.view ?? 'all';
    const limit = q.limit ?? 25;
    const offset = decodeCursor(q.cursor);
    if (view === 'invited') return this.listInvites(q.q, limit, offset);
    const where: Prisma.UserWhereInput = { AND: [this.viewWhere(view), this.searchWhere(q.q)] };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: LIST_SELECT,
        orderBy: ORDER[q.sort ?? 'created_desc'],
        skip: offset,
        take: limit + 1,
      }),
      this.prisma.user.count({ where }),
    ]);
    const page = rows.slice(0, limit);
    const paid = await this.paidSet(page.filter((r) => r.role === 'student').map((r) => r.id));
    return {
      view,
      total,
      items: page.map((u) => ({
        kind: 'user' as const,
        id: u.id,
        code: u.code,
        name: u.displayName ?? u.studentProfile?.name ?? null,
        email: u.email,
        role: u.role,
        adminRole: u.adminRole,
        capability: u.capability,
        status: u.lockedUntil && u.lockedUntil > new Date() && u.status === 'active' ? 'locked' : u.status,
        origin: u.origin,
        plan: u.role === 'student' ? (paid.has(u.id) ? 'paid' : 'free') : null,
        ctf: u.identities.some((i) => i.provider === 'ctf_password'),
        studentNumber: u.studentProfile?.studentNumber ?? null,
        institution: u.studentProfile?.institutionName ?? null,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
      })),
      nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
    };
  }

  private searchWhere(q?: string): Prisma.UserWhereInput {
    const t = q?.trim();
    if (!t) return {};
    return {
      OR: [
        { email: { contains: t, mode: 'insensitive' } },
        { displayName: { contains: t, mode: 'insensitive' } },
        { code: { equals: t.toUpperCase() } },
        { studentProfile: { is: { studentNumber: { equals: t } } } },
        { studentProfile: { is: { name: { contains: t, mode: 'insensitive' } } } },
      ],
    };
  }

  private async listInvites(q: string | undefined, limit: number, offset: number) {
    const where: Prisma.StaffInviteWhereInput = {
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      ...(q?.trim() ? { email: { contains: q.trim(), mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.staffInvite.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: offset,
        take: limit + 1,
        select: {
          id: true,
          email: true,
          role: true,
          adminRole: true,
          capability: true,
          batchIds: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
      this.prisma.staffInvite.count({ where }),
    ]);
    return {
      view: 'invited' as const,
      total,
      items: rows.slice(0, limit).map((r) => ({ kind: 'invite' as const, ...r })),
      nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
    };
  }

  private async paidSet(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids }, ...paidWhere(new Date()) },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /** Total Users: distinct people. A student who also has a CTF account is one person and is counted once. */
  async totals() {
    const now = new Date();
    const c = (w: Prisma.UserWhereInput) => this.prisma.user.count({ where: w });
    const [
      total,
      students,
      paid,
      free,
      ctf,
      ctfOnly,
      ctfLinkedStudents,
      trainers,
      admins,
      pendingVerification,
      pendingOnboarding,
      suspended,
      invited,
    ] = await Promise.all([
      c(this.viewWhere('all', now)),
      c(this.viewWhere('students', now)),
      c(this.viewWhere('paid', now)),
      c(this.viewWhere('free', now)),
      c(this.viewWhere('ctf', now)),
      c({ status: { not: 'deleted' }, role: 'participant' }),
      c({ status: { not: 'deleted' }, role: 'student', identities: { some: { provider: 'ctf_password' } } }),
      c(this.viewWhere('trainers', now)),
      c(this.viewWhere('admins', now)),
      c(this.viewWhere('pending_verification', now)),
      c(this.viewWhere('pending_onboarding', now)),
      c(this.viewWhere('suspended', now)),
      this.prisma.staffInvite.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } }),
    ]);
    return {
      totalUsers: total,
      breakdown: {
        students,
        paid,
        free,
        ctf,
        ctfOnly,
        ctfLinkedStudents,
        trainers,
        admins,
        pendingVerification,
        pendingOnboarding,
        suspended,
      },
      invitedStaff: invited,
      asOf: now.toISOString(),
      note: 'Counts are distinct people (one users row each); linked CTF accounts are not counted twice.',
    };
  }

  async detail(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...LIST_SELECT,
        phone: false,
        failedLogins: true,
        studentProfile: {
          select: {
            name: true,
            studentNumber: true,
            institutionName: true,
            city: true,
            eduLevel: true,
            gradYear: true,
            dob: true,
          },
        },
        staffProfile: { select: { displayName: true, title: true, speciality: true } },
        identities: { select: { provider: true, subject: true, createdAt: true } },
        consents: {
          orderBy: { acceptedAt: 'desc' },
          select: { kind: true, version: true, accepted: true, acceptedAt: true },
          take: 30,
        },
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            code: true,
            status: true,
            startsAt: true,
            endsAt: true,
            plan: { select: { code: true, name: true } },
          },
        },
        entitlements: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, key: true, source: true, startsAt: true, endsAt: true, revokedAt: true, reason: true },
        },
        enrolments: { select: { status: true, batch: { select: { id: true, code: true, name: true } } } },
        ctfRegistrations: {
          select: { code: true, username: true, status: true, event: { select: { slug: true, name: true } } },
        },
        batchesLed: { select: { id: true, code: true, name: true, status: true } },
      },
    });
    if (!u) throw Errors.notFound();
    const sp = u.studentProfile;
    const minor = sp?.dob ? Date.now() - sp.dob.getTime() < 18 * 365.25 * 86400_000 : null;
    const activeSessions = await this.prisma.userSession.count({
      where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    // Latest decision per consent kind only.
    const consents = [...new Map(u.consents.map((c) => [c.kind, c])).values()];
    return {
      id: u.id,
      code: u.code,
      name: u.displayName ?? sp?.name ?? null,
      email: u.email,
      role: u.role,
      adminRole: u.adminRole,
      capability: u.capability,
      status: u.status,
      origin: u.origin,
      lockedUntil: u.lockedUntil,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      student: sp
        ? {
            studentNumber: sp.studentNumber,
            institution: sp.institutionName,
            city: sp.city,
            eduLevel: sp.eduLevel,
            gradYear: sp.gradYear,
            minor,
          }
        : null,
      staff: u.staffProfile,
      identities: u.identities.map((i) => ({
        provider: i.provider,
        // Only the CTF username is shown; Google subjects are opaque ids with no value to an admin.
        username: i.provider === 'ctf_password' ? i.subject : undefined,
        linkedAt: i.createdAt,
      })),
      plan: u.role === 'student' ? ((await this.entitlements.has(u.id, PAID_KEY)) ? 'paid' : 'free') : null,
      consents,
      subscriptions: u.subscriptions,
      entitlements: u.entitlements,
      enrolments: u.enrolments,
      ctfRegistrations: u.ctfRegistrations,
      batchesLed: u.batchesLed,
      activeSessions,
    };
  }

  /** Creates a Yojo-origin student so the "Yojo student: YES" path can find them. Activates on first OTP. */
  async provisionStudent(dto: ProvisionStudentDto, actor: AdminActor) {
    const email = normEmail(dto.email);
    let institutionName = dto.institutionName;
    if (dto.institutionId) {
      const inst = await this.prisma.institution.findUnique({ where: { id: dto.institutionId } });
      if (!inst) throw Errors.validation('Choose an institution from the list.', 'institutionId');
      institutionName = inst.name;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (await tx.user.findUnique({ where: { email }, select: { id: true } }))
          throw Errors.conflict('ACCOUNT_EXISTS', 'An account with this email already exists.');
        const u = await tx.user.create({
          data: { email, role: 'student', status: 'pending_verification', origin: 'yojo', displayName: dto.name },
        });
        await tx.studentProfile.create({
          data: {
            userId: u.id,
            name: dto.name,
            studentNumber: dto.studentNumber,
            institutionId: dto.institutionId,
            institutionName,
          },
        });
        await this.entitlements.startFreePlan(tx, u.id);
        await this.audit.record(
          {
            action: 'student.provisioned',
            actorId: actor.userId,
            actorRole: 'admin',
            adminRole: 'platform',
            targetType: 'user',
            targetId: u.id,
            reason: dto.reason,
            detail: { origin: 'yojo', studentNumber: dto.studentNumber ?? null },
            ip: actor.ip,
            requestId: actor.requestId,
          },
          tx,
        );
        return { id: u.id, code: u.code, email, status: u.status, origin: u.origin };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw Errors.conflict('STUDENT_NUMBER_TAKEN', 'This student ID is already in use.');
      throw e;
    }
  }

  /** Suspend or reactivate a student or CTF participant. Staff use /admin/staff/:id/status. */
  async setStatus(id: string, status: 'active' | 'suspended', reason: string, actor: AdminActor) {
    if (id === actor.userId) throw new AppError(403, 'SELF_ACTION_FORBIDDEN', 'You cannot change your own account.');
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u || u.status === 'deleted') throw Errors.notFound();
    if (u.role === 'admin' || u.role === 'trainer')
      throw new AppError(400, 'USE_STAFF_ENDPOINT', 'Change staff accounts from Staff management.');
    await this.prisma.user.update({
      where: { id },
      data: { status, ...(status === 'active' ? { failedLogins: 0, lockedUntil: null } : {}) },
    });
    const revoked = status === 'suspended' ? await this.sessions.revokeAll(id, 'suspended') : 0;
    await this.audit.record({
      action: 'user.status.changed',
      actorId: actor.userId,
      actorRole: 'admin',
      adminRole: 'platform',
      targetType: 'user',
      targetId: id,
      reason,
      detail: { from: u.status, to: status, sessionsRevoked: revoked },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return { id, status, sessionsRevoked: revoked };
  }

  async revokeSessions(id: string, reason: string, actor: AdminActor) {
    if (!(await this.prisma.user.findUnique({ where: { id }, select: { id: true } }))) throw Errors.notFound();
    const revoked = await this.sessions.revokeAll(id, 'admin_revoked');
    await this.audit.record({
      action: 'user.sessions.revoked',
      actorId: actor.userId,
      actorRole: 'admin',
      adminRole: 'platform',
      targetType: 'user',
      targetId: id,
      reason,
      detail: { revoked },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return { revoked };
  }
}
