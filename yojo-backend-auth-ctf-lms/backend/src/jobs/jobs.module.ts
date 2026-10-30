import { Global, Module } from '@nestjs/common';
import { MaintenanceJobs } from './maintenance.jobs';
import { OutboxService } from './outbox.service';

@Global()
@Module({ providers: [OutboxService, MaintenanceJobs], exports: [OutboxService, MaintenanceJobs] })
export class JobsModule {}
