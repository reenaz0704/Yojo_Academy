import { Module } from '@nestjs/common';
import { PublicSiteNotifier } from './public-site.notifier';

/** Outbox handlers for website emails; imported by the API module and by the worker that relays the outbox. */
@Module({ providers: [PublicSiteNotifier] })
export class PublicSiteNotifyModule {}
