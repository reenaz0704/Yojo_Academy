import { Module } from '@nestjs/common';
import { AcademyNotifier } from './notifications.service';

/** Outbox handler for Academy notification emails; imported by the Academy module and by the worker. */
@Module({ providers: [AcademyNotifier] })
export class AcademyNotifyModule {}
