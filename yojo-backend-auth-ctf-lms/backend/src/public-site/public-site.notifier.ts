import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { MAIL_PORT, type MailPort } from '../identity/mail/mail.port';
import { OutboxService } from '../jobs/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { SUBMISSION_RULES } from './submission-rules';

/**
 * Emails for website submissions, delivered by the worker through the transactional outbox (retries are counted in
 * outbox_events.attempts; publishedAt marks delivery to the mail port). Staff alerts carry only the reference and
 * form name, never the visitor's details. Real delivery needs a mail provider (OI-01): with MAIL_DRIVER=dev the
 * messages are written to .dev-mail, which is not proof of delivery.
 */
@Injectable()
export class PublicSiteNotifier implements OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  onModuleInit() {
    this.outbox.handlers.set('public.submission.created', (p) => this.created(p));
    this.outbox.handlers.set('public.submission.assigned', (p) => this.assigned(p));
  }

  private async created(payload: Prisma.JsonValue) {
    const { submissionId } = payload as { submissionId: string };
    const s = await this.prisma.publicSubmission.findUnique({
      where: { id: submissionId },
      select: { reference: true, type: true, email: true, name: true },
    });
    if (!s) return;
    const label = SUBMISSION_RULES[s.type].label;
    if (s.email)
      await this.mail.send({
        to: s.email,
        template: 'submission_received',
        subject: `We received your request (${s.reference})`,
        text:
          `Hello ${s.name.split(' ')[0]},\n\nThank you for contacting Yojo Cyber Academy (${label}). ` +
          `Your reference is ${s.reference}. Our team replies within one working day.\n\n` +
          'If you did not send this request, you can ignore this email.',
      });
    if (this.cfg.ENQUIRY_NOTIFY_EMAIL)
      await this.mail.send({
        to: this.cfg.ENQUIRY_NOTIFY_EMAIL,
        template: 'submission_staff_alert',
        subject: `New ${label} enquiry ${s.reference}`,
        text: `A new ${label} enquiry arrived: ${s.reference}.\nOpen it in the Admin LMS: ${this.cfg.PUBLIC_APP_URL}/admin.html#/admin/enquiries`,
      });
  }

  private async assigned(payload: Prisma.JsonValue) {
    const { submissionId, assigneeId } = payload as { submissionId: string; assigneeId: string };
    const [s, u] = await Promise.all([
      this.prisma.publicSubmission.findUnique({ where: { id: submissionId }, select: { reference: true, type: true } }),
      this.prisma.user.findUnique({ where: { id: assigneeId }, select: { email: true, status: true } }),
    ]);
    if (!s || !u || u.status !== 'active') return;
    await this.mail.send({
      to: u.email,
      template: 'submission_assigned',
      subject: `Enquiry ${s.reference} is assigned to you`,
      text: `${SUBMISSION_RULES[s.type].label} enquiry ${s.reference} is now yours.\nOpen it: ${this.cfg.PUBLIC_APP_URL}/admin.html#/admin/enquiries`,
    });
  }
}
