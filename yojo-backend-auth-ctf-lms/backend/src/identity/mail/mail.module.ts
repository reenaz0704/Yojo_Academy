import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/config.schema';
import { DevMailAdapter, DisabledMailAdapter } from './dev-mail.adapter';
import { MAIL_PORT } from './mail.port';

/** The mail port on its own, so the API and the worker (outbox notifications) share one provider. */
@Global()
@Module({
  providers: [
    {
      provide: MAIL_PORT,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) =>
        cfg.MAIL_DRIVER === 'dev' ? new DevMailAdapter(cfg.DEV_MAIL_DIR || null) : new DisabledMailAdapter(),
    },
  ],
  exports: [MAIL_PORT],
})
export class MailModule {}
