import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestMeta } from '../identity/types';

type Tx = Prisma.TransactionClient;

/** The entitlement key that unlocks paid content. Payment integration will grant it with source 'payment'. */
export const PAID_KEY = 'plan:paid';
export const FREE_PLAN_CODE = 'free';

/** A where-clause for entitlement rows that are in force right now. */
export const liveEntitlement = (now = new Date()): Prisma.EntitlementWhereInput => ({
  revokedAt: null,
  startsAt: { lte: now },
  OR: [{ endsAt: null }, { endsAt: { gt: now } }],
});

/**
 * Paid access comes only from server-side records: a live entitlement row, or an active subscription whose plan
 * grants the key. Nothing the client sends (plan name, flags, local storage) is trusted.
 */
@Injectable()
export class EntitlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async has(userId: string, key: string): Promise<boolean> {
    const now = new Date();
    if (await this.prisma.entitlement.count({ where: { studentId: userId, key, ...liveEntitlement(now) } }))
      return true;
    const subs = await this.prisma.subscription.findMany({
      where: {
        studentId: userId,
        status: 'active',
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: { plan: { select: { grants: true, active: true } } },
    });
    return subs.some((s) => Array.isArray(s.plan.grants) && (s.plan.grants as unknown[]).includes(key));
  }

  async listKeys(userId: string): Promise<{ plan: string | null; keys: string[] }> {
    const now = new Date();
    const rows = await this.prisma.entitlement.findMany({
      where: { studentId: userId, ...liveEntitlement(now) },
      select: { key: true },
    });
    const sub = await this.prisma.subscription.findFirst({
      where: { studentId: userId, status: 'active' },
      select: { plan: { select: { code: true, grants: true } } },
    });
    const grants = Array.isArray(sub?.plan.grants)
      ? (sub!.plan.grants as unknown[]).filter((g): g is string => typeof g === 'string')
      : [];
    return { plan: sub?.plan.code ?? null, keys: [...new Set([...rows.map((r) => r.key), ...grants])].sort() };
  }

  /** Puts a new student on the default free plan (inside the sign-up transaction). */
  async startFreePlan(tx: Tx, studentId: string): Promise<void> {
    const plan = await tx.plan.findUnique({ where: { code: FREE_PLAN_CODE }, select: { id: true } });
    if (!plan) throw new AppError(500, 'FREE_PLAN_MISSING', 'Sign-up is not available right now. Try again later.');
    await tx.subscription.create({ data: { studentId, planId: plan.id } });
  }

  async grant(
    studentId: string,
    dto: { key: string; reason: string; endsAt?: string },
    actor: RequestMeta & { userId: string },
  ) {
    const student = await this.prisma.user.findUnique({ where: { id: studentId }, select: { role: true } });
    if (!student || student.role !== 'student') throw Errors.notFound();
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (endsAt && endsAt.getTime() <= Date.now())
      throw Errors.validation('The end date must be in the future.', 'endsAt');
    return this.prisma.$transaction(async (tx) => {
      if (await tx.entitlement.count({ where: { studentId, key: dto.key, revokedAt: null } }))
        throw Errors.conflict(
          'ENTITLEMENT_EXISTS',
          'This student already has this access. Revoke it first to change it.',
        );
      const row = await tx.entitlement.create({
        data: { studentId, key: dto.key, source: 'manual', grantedById: actor.userId, reason: dto.reason, endsAt },
      });
      await this.audit.record(
        {
          action: 'entitlement.granted',
          actorId: actor.userId,
          actorRole: 'admin',
          adminRole: 'platform',
          targetType: 'user',
          targetId: studentId,
          reason: dto.reason,
          detail: { entitlementId: row.id, key: dto.key, endsAt: endsAt?.toISOString() ?? null, source: 'manual' },
          ip: actor.ip,
          requestId: actor.requestId,
        },
        tx,
      );
      return { id: row.id, key: row.key, source: row.source, startsAt: row.startsAt, endsAt: row.endsAt };
    });
  }

  async revoke(studentId: string, entitlementId: string, reason: string, actor: RequestMeta & { userId: string }) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.entitlement.findFirst({ where: { id: entitlementId, studentId } });
      if (!row) throw Errors.notFound();
      if (row.revokedAt) throw Errors.conflict('ALREADY_REVOKED', 'This access was already revoked.');
      await tx.entitlement.update({
        where: { id: row.id },
        data: { revokedAt: new Date(), revokedById: actor.userId, revokeReason: reason },
      });
      await this.audit.record(
        {
          action: 'entitlement.revoked',
          actorId: actor.userId,
          actorRole: 'admin',
          adminRole: 'platform',
          targetType: 'user',
          targetId: studentId,
          reason,
          detail: { entitlementId: row.id, key: row.key },
          ip: actor.ip,
          requestId: actor.requestId,
        },
        tx,
      );
      return { id: row.id, revoked: true };
    });
  }
}
