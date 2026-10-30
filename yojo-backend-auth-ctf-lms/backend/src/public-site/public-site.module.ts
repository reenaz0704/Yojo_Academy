import { Module } from '@nestjs/common';
import { ContentService } from './content.service';
import {
  AdminContentController,
  AdminEventsController,
  AdminSubmissionsController,
  PublicSiteController,
} from './public-site.controllers';
import { PublicSiteNotifyModule } from './public-site-notify.module';
import { SubmissionsService } from './submissions.service';
import { SubscriptionsService } from './subscriptions.service';

/** Public website backend: forms → Admin LMS Enquiries, event reminders, managed content. */
@Module({
  imports: [PublicSiteNotifyModule],
  providers: [SubmissionsService, SubscriptionsService, ContentService],
  controllers: [PublicSiteController, AdminSubmissionsController, AdminContentController, AdminEventsController],
})
export class PublicSiteModule {}
