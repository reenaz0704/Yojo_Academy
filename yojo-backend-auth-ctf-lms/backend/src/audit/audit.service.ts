import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditOutcome, Prisma } from '@prisma/client';
import { canonicalJson, sha256 } from '../common/crypto/crypto.util';
import { redact } from '../common/text/sensitive';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  actorRole?: string | null;
  adminRole?: string | null;
  targetType?: string;
  targetId?: string;
  detail?: Record<string, unknown>;
  reason?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  outcome?: AuditOutcome;
}

type Tx = Prisma.TransactionClient;
const GENESIS = '0'.repeat(64);
const CHAIN_LOCK = 7_301_001; // advisory lock id that serialises appends to the hash chain

/** The fields covered by row_hash. */
function hashInput(r: {
  id: string;
  at: Date;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
  reason: string | null;
  outcome: string;
}): string {
  return canonicalJson({
    id: r.id,
    at: r.at.toISOString(),
    actorId: r.actorId,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    detail: r.detail,
    reason: r.reason,
    outcome: r.outcome,
  });
}

/**
 * Append-only, hash-chained audit log (spec §6.9). Each row stores the previous row's hash; verify() recomputes
 * the chain so an edited or deleted row is detected. The database also refuses UPDATE/DELETE with a trigger.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Writes inside the caller's transaction when given, so the audit row commits with the change it describes. */
  async record(entry: AuditEntry, tx?: Tx): Promise<void> {
    const run = async (t: Tx) => {
      await t.$executeRaw`SELECT pg_advisory_xact_lock(${CHAIN_LOCK})`;
      const last = await t.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { rowHash: true } });
      const prevHash = last?.rowHash ?? GENESIS;
      const id = randomUUID();
      const at = new Date();
      const detail = redact(entry.detail ?? {}) as Prisma.InputJsonObject;
      const base = {
        id,
        at,
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        detail,
        reason: entry.reason ?? null,
        outcome: entry.outcome ?? 'success',
      };
      const rowHash = sha256(prevHash + hashInput(base));
      await t.auditLog.create({
        data: {
          ...base,
          actorRole: entry.actorRole ?? null,
          adminRole: entry.adminRole ?? null,
          ip: entry.ip,
          userAgent: entry.userAgent?.slice(0, 300),
          requestId: entry.requestId,
          prevHash,
          rowHash,
        },
      });
    };
    if (tx) return run(tx);
    await this.prisma.$transaction(run);
  }

  /** Recomputes the whole chain. Returns the first broken sequence number, if any. */
  async verify(): Promise<{ ok: boolean; checked: number; brokenAtSeq?: string }> {
    let prev = GENESIS;
    let checked = 0;
    let cursor: bigint | undefined;
    for (;;) {
      const rows = await this.prisma.auditLog.findMany({
        orderBy: { seq: 'asc' },
        take: 1000,
        ...(cursor !== undefined ? { where: { seq: { gt: cursor } } } : {}),
      });
      if (!rows.length) return { ok: true, checked };
      for (const r of rows) {
        const expect = sha256(prev + hashInput(r));
        if (r.prevHash !== prev || r.rowHash !== expect) return { ok: false, checked, brokenAtSeq: r.seq.toString() };
        prev = r.rowHash;
        checked++;
      }
      cursor = rows[rows.length - 1].seq;
    }
  }

  async list(filter: { actorId?: string; action?: string; limit: number; cursor?: string }) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(filter.actorId ? { actorId: filter.actorId } : {}),
        ...(filter.action ? { action: filter.action } : {}),
        ...(filter.cursor ? { seq: { lt: BigInt(filter.cursor) } } : {}),
      },
      orderBy: { seq: 'desc' },
      take: filter.limit + 1,
    });
    const more = rows.length > filter.limit;
    const items = rows.slice(0, filter.limit).map((r) => ({
      id: r.id,
      at: r.at,
      actorId: r.actorId,
      actorRole: r.actorRole,
      adminRole: r.adminRole,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      detail: r.detail,
      reason: r.reason,
      outcome: r.outcome,
      requestId: r.requestId,
    }));
    return { items, nextCursor: more ? rows[filter.limit - 1].seq.toString() : null };
  }
}
