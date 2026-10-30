import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxService } from './outbox.service';

/** Housekeeping jobs (spec §21). Plain methods so tests can call them without a queue. */
@Injectable()
export class MaintenanceJobs {
  private readonly log = new Logger('MaintenanceJobs');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Daily: recompute the audit hash chain; a break is logged at error level and written to the audit log. */
  async verifyAuditChain() {
    const r = await this.audit.verify();
    if (!r.ok) {
      this.log.error(`audit chain broken at seq ${r.brokenAtSeq}`);
      await this.audit.record({
        action: 'audit.chain.broken',
        outcome: 'failed',
        detail: { brokenAtSeq: r.brokenAtSeq },
      });
    }
    return r;
  }

  /** Hourly: marks device-list rows whose absolute expiry has passed (Redis already dropped the session). */
  async expireSessions(): Promise<number> {
    const r = await this.prisma.userSession.updateMany({
      where: { revokedAt: null, expiresAt: { lt: new Date() } },
      data: { revokedAt: new Date(), revokeReason: 'expired' },
    });
    return r.count;
  }

  /** Hourly: open dual-control requests past 48 hours become expired. */
  async expireDualControl(): Promise<number> {
    const r = await this.prisma.dualControlAction.updateMany({
      where: { status: 'awaiting_second_admin', expiresAt: { lt: new Date() } },
      data: { status: 'expired' },
    });
    return r.count;
  }

  /** Daily: drop idempotency records past their expiry. */
  async purgeIdempotencyKeys(): Promise<number> {
    const r = await this.prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return r.count;
  }

  relayOutbox(): Promise<number> {
    return this.outbox.relay();
  }
}
