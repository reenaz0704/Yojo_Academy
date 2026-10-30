import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Transactional outbox (spec §21.2): domain events are written in the same transaction as the change and relayed
 * by the worker. M1 has no consumers yet; later milestones register handlers in OutboxService.handlers.
 */
@Injectable()
export class OutboxService {
  readonly handlers = new Map<string, (payload: Prisma.JsonValue) => Promise<void>>();

  constructor(private readonly prisma: PrismaService) {}

  add(
    tx: Prisma.TransactionClient,
    e: { aggregate: string; aggregateId: string; type: string; payload: Prisma.InputJsonValue },
  ) {
    return tx.outboxEvent.create({ data: e });
  }

  /** Publishes up to `batch` unpublished events in order. Events without a handler are marked published. */
  async relay(batch = 100): Promise<number> {
    const rows = await this.prisma.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { occurredAt: 'asc' },
      take: batch,
    });
    let done = 0;
    for (const r of rows) {
      try {
        await this.handlers.get(r.type)?.(r.payload);
        await this.prisma.outboxEvent.update({
          where: { id: r.id },
          data: { publishedAt: new Date(), attempts: { increment: 1 } },
        });
        done++;
      } catch {
        await this.prisma.outboxEvent.update({ where: { id: r.id }, data: { attempts: { increment: 1 } } });
      }
    }
    return done;
  }
}
