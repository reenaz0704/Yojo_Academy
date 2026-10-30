import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { APP_CONFIG } from './config/config.module';
import type { AppConfig } from './config/config.schema';
import { allowedOrigin } from './common/http/cors';
import { appValidationPipe } from './common/http/validation';
import { stripControlChars } from './common/text/sensitive';
import { buildOpenApi } from './openapi';

/** Builds the HTTP app with every cross-cutting setting; main.ts and the e2e tests share it. */
export async function createApp(opts: { logger?: boolean } = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    logger: opts.logger === false ? false : undefined,
  });
  const cfg = app.get<AppConfig>(APP_CONFIG);
  if (opts.logger !== false) app.useLogger(app.get(Logger));

  app.set('trust proxy', cfg.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '256kb' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Security headers for API responses (spec §22.4); the CSP for pages lives in NGINX.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (cfg.SESSION_COOKIE_SECURE)
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    next();
  });
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.body && typeof req.body === 'object') req.body = stripControlChars(req.body);
    next();
  });
  if (!cfg.CORS_DISABLED)
    app.enableCors({ origin: (origin, cb) => cb(null, allowedOrigin(cfg, origin)), credentials: true });
  app.useGlobalPipes(appValidationPipe());
  app.enableShutdownHooks();

  if (cfg.SWAGGER_ENABLED)
    SwaggerModule.setup('api/docs', app, buildOpenApi(app), { jsonDocumentUrl: 'api/docs/openapi.json' });
  return app;
}
