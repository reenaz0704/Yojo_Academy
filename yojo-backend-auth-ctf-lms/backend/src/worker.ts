import 'reflect-metadata';
import { loadLocalEnv } from './config/load-env';
loadLocalEnv();
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import { AuditModule } from './audit/audit.module';
import { APP_CONFIG, ConfigModule } from './config/config.module';
import type { AppConfig } from './config/config.schema';
import { JobsModule } from './jobs/jobs.module';
import { MaintenanceJobs } from './jobs/maintenance.jobs';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './identity/mail/mail.module';
import { PublicSiteNotifyModule } from './public-site/public-site-notify.module';
import { AcademyNotifyModule } from './academy/academy-notify.module';
import { GamificationService } from './academy/gamification.service';
import { addDays } from './academy/ist';
import { istWeekStart } from './academy/ist';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuditModule,
    JobsModule,
    MailModule,
    PublicSiteNotifyModule,
    AcademyNotifyModule,
    SettingsModule,
  ],
  providers: [GamificationService],
})
class WorkerModule {}

const QUEUE = 'maintenance';
/** Repeatable jobs (spec §21.3). Times are Asia/Kolkata. */
const SCHEDULE: { name: string; pattern: string }[] = [
  { name: 'audit.verify', pattern: '0 2 * * *' },
  { name: 'sessions.expire', pattern: '15 * * * *' },
  { name: 'dual_control.expire', pattern: '20 * * * *' },
  { name: 'idempotency.purge', pattern: '30 3 * * *' },
  { name: 'outbox.relay', pattern: '* * * * *' },
  { name: 'league.close', pattern: '5 0 * * 1' }, // Monday 00:05 IST: close last week's league
];

async function main(): Promise<void> {
  const ctx = await NestFactory.createApplicationContext(WorkerModule);
  const cfg = ctx.get<AppConfig>(APP_CONFIG);
  const jobs = ctx.get(MaintenanceJobs);
  const url = new URL(cfg.REDIS_QUEUE_URL ?? cfg.REDIS_URL);
  const connection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1) || 0),
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };

  const queue = new Queue(QUEUE, { connection });
  for (const s of SCHEDULE)
    await queue.upsertJobScheduler(
      s.name,
      { pattern: s.pattern, tz: 'Asia/Kolkata' },
      { name: s.name, opts: { removeOnComplete: 100, removeOnFail: 500 } },
    );

  const handlers: Record<string, () => Promise<unknown>> = {
    'audit.verify': () => jobs.verifyAuditChain(),
    'sessions.expire': () => jobs.expireSessions(),
    'dual_control.expire': () => jobs.expireDualControl(),
    'idempotency.purge': () => jobs.purgeIdempotencyKeys(),
    'outbox.relay': () => jobs.relayOutbox(),
    'league.close': () => ctx.get(GamificationService).closeWeek(addDays(istWeekStart(), -7)),
  };
  const worker = new Worker(QUEUE, async (job) => handlers[job.name]?.(), { connection, concurrency: 1 });
  worker.on('failed', (job, err) => process.stderr.write(`job ${job?.name} failed: ${err.message}\n`));

  const stop = async () => {
    await worker.close();
    await queue.close();
    await ctx.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
