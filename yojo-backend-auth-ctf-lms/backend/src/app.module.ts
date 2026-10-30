import { StorageModule } from './storage/storage.module';
import { DevDemoModule } from './dev/demo-directory';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CtfModule } from './ctf/ctf.module';
import { EntitlementGuard } from './entitlements/entitlement.guard';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { LmsModule } from './lms/lms.module';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { AccessModule } from './access/access.module';
import { AuditModule } from './audit/audit.module';
import { ProblemFilter } from './common/errors/problem.filter';
import { CsrfGuard } from './common/guards/csrf.guard';
import { MaintenanceGuard } from './common/guards/maintenance.guard';
import { PolicyGuard } from './common/guards/policy.guard';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { SessionGuard } from './common/guards/session.guard';
import { ConfigModule } from './config/config.module';
import { loadConfig } from './config/config.schema';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { JobsModule } from './jobs/jobs.module';
import { PrismaModule } from './prisma/prisma.module';
import { PublicSiteModule } from './public-site/public-site.module';
import { AcademyModule } from './academy/academy.module';
import { RedisModule } from './redis/redis.module';
import { SettingsModule } from './settings/settings.module';

const REQUEST_ID = /^[\w-]{8,64}$/;

/** Structured JSON logs with request IDs; credentials, cookies and secrets are redacted (spec §23.3). */
export const loggerModule = LoggerModule.forRootAsync({
  useFactory: () => {
    const cfg = loadConfig();
    return {
      pinoHttp: {
        level: cfg.LOG_LEVEL,
        genReqId: (req: IncomingMessage, res) => {
          const incoming = req.headers['x-request-id'];
          const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
          res.setHeader('X-Request-Id', id);
          return id;
        },
        // W3C trace context: log the trace ID from `traceparent` (set by NGINX / OpenTelemetry), else the request ID.
        customProps: (req: IncomingMessage) => {
          const tp = req.headers.traceparent;
          const m = typeof tp === 'string' ? /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/.exec(tp) : null;
          return { traceId: m ? m[1] : (req as IncomingMessage & { id?: string }).id };
        },
        redact: {
          paths: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.headers["x-csrf-token"]',
            'req.headers["x-step-up-code"]',
            'res.headers["set-cookie"]',
            '*.password',
            '*.newPassword',
            '*.currentPassword',
            '*.code',
            '*.token',
            '*.recoveryCode',
            '*.idToken',
            '*.secret',
          ],
          censor: '[REDACTED]',
        },
        // The query string can carry tokens in later milestones; log the path only.
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({
            id: req.id,
            method: req.method,
            path: req.url.split('?')[0],
          }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
        autoLogging: { ignore: (req: IncomingMessage) => (req.url ?? '').startsWith('/api/v1/health') },
      },
    };
  },
});

@Module({
  imports: [
    ConfigModule,
    loggerModule,
    PrismaModule,
    StorageModule,
    RedisModule,
    AccessModule,
    AuditModule,
    SettingsModule,
    IdentityModule,
    EntitlementsModule,
    CtfModule,
    LmsModule,
    PublicSiteModule,
    AcademyModule,
    JobsModule,
    HealthModule,
    DevDemoModule, // local development only: the sign-in page demo panel (404 elsewhere)
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemFilter },
    // Guard order matters: session, rate limit, maintenance, CSRF, then permission / reason / step-up.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: MaintenanceGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PolicyGuard },
    { provide: APP_GUARD, useClass: EntitlementGuard },
  ],
})
export class AppModule {}
