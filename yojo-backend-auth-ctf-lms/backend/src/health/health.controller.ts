import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import Redis from 'ioredis';
import { Public, SkipCsrf } from '../common/decorators/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

/** Liveness and readiness (spec §23). NGINX exposes these to the internal network only. */
@ApiTags('health')
@Controller('health')
@Public()
@SkipCsrf()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('live')
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, 'up' | 'down'> = { database: 'down', redis: 'down', migrations: 'down' };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'up';
      const pending = await this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM (
          -- latest attempt per migration: a rolled-back attempt that was later re-applied is history, not pending
          SELECT DISTINCT ON (migration_name) finished_at, rolled_back_at
          FROM _prisma_migrations ORDER BY migration_name, started_at DESC
        ) m WHERE m.finished_at IS NULL OR m.rolled_back_at IS NOT NULL`;
      checks.migrations = Number(pending[0]?.n ?? 1) === 0 ? 'up' : 'down';
    } catch {
      /* reported as down */
    }
    try {
      checks.redis = (await this.redis.ping()) === 'PONG' ? 'up' : 'down';
    } catch {
      /* reported as down */
    }
    const ok = Object.values(checks).every((v) => v === 'up');
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', checks };
  }
}
