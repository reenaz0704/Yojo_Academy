import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors/app-error';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { MAIL_PORT, type MailPort } from '../identity/mail/mail.port';
import type { RequestMeta } from '../identity/types';
import { OutboxService } from '../jobs/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export interface NotifyInput {
  kind:
    | 'booking'
    | 'leave'
    | 'message'
    | 'grade'
    | 'blog'
    | 'certificate'
    | 'broadcast'
    | 'system'
    | 'staff_request'
    | 'nudge'
    | 'course'
    | 'announcement'
    | 'admin_message';
  title: string;
  body?: string;
  /** Academy route the bell opens, e.g. #/lms/assessments. */
  link?: string;
  important?: boolean;
  /** One notification per person per source event. */
  dedupeKey: string;
}

/**
 * In-app notifications (docs/ACADEMY-INVENTORY.md, slice h). Producers call notify() from verified server events;
 * nothing is created from a client request except an admin broadcast. Important notifications are also queued for
 * email through the outbox (title and link only, never grades or feedback); real delivery needs a mail provider.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async notify(userIds: string | string[], n: NotifyInput) {
    const ids = [...new Set(Array.isArray(userIds) ? userIds : [userIds])];
    if (!ids.length) return 0;
    const r = await this.prisma.notification.createMany({
      data: ids.map((userId) => ({
        userId,
        kind: n.kind,
        title: n.title.slice(0, 150),
        body: (n.body ?? '').slice(0, 2000),
        link: n.link,
        important: !!n.important,
        dedupeKey: n.dedupeKey,
      })),
      skipDuplicates: true,
    });
    if (n.important && r.count) {
      const rows = await this.prisma.notification.findMany({
        where: { userId: { in: ids }, dedupeKey: n.dedupeKey },
        select: { id: true, userId: true },
      });
      for (const row of rows)
        await this.prisma.$transaction((tx) =>
          this.outbox.add(tx, {
            aggregate: 'notification',
            aggregateId: row.id,
            type: 'academy.notification.email',
            payload: { notificationId: row.id },
          }),
        );
    }
    return r.count;
  }

  async list(userId: string, q: { unread?: boolean; limit?: number; before?: string }) {
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(q.unread ? { readAt: null } : {}),
      ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
    };
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: Math.min(q.limit ?? 30, 100),
        select: {
          id: true,
          kind: true,
          title: true,
          body: true,
          link: true,
          important: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { unread, items };
  }

  async read(userId: string, id: string) {
    const r = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (!r.count && !(await this.prisma.notification.count({ where: { id, userId } })))
      throw Errors.notFound('No notification with that ID.');
    return { id, read: true };
  }

  async readAll(userId: string) {
    const r = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: r.count };
  }

  async preferences(userId: string, emailImportant?: boolean) {
    if (emailImportant === undefined)
      return (
        (await this.prisma.notificationPreference.findUnique({ where: { userId } })) ?? { userId, emailImportant: true }
      );
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, emailImportant },
      update: { emailImportant },
    });
  }

  /**
   * Admin broadcast to one batch or every active student. Above settings.policy.broadcastSecondAdminThreshold
   * recipients it needs a second admin, which is not built for broadcasts yet, so it is refused with that reason.
   */
  async broadcast(
    actor: RequestMeta & { userId: string },
    dto: { batchId?: string; allStudents?: boolean; title: string; body: string; important?: boolean },
  ) {
    if (!dto.batchId === !dto.allStudents) throw Errors.validation('Choose one batch or all students.', 'batchId');
    const ids = dto.batchId
      ? (
          await this.prisma.enrolment.findMany({
            where: { batchId: dto.batchId, status: 'active' },
            select: { studentId: true },
          })
        ).map((e) => e.studentId)
      : (await this.prisma.user.findMany({ where: { role: 'student', status: 'active' }, select: { id: true } })).map(
          (u) => u.id,
        );
    if (!ids.length) throw Errors.validation('No students to notify.', 'batchId');
    const limit = (await this.settings.get('policy')).value.broadcastSecondAdminThreshold;
    if (ids.length > limit)
      throw new AppError(
        409,
        'NEEDS_SECOND_ADMIN',
        `This reaches ${ids.length} students (more than ${limit}). A second-admin approval is required and not available for broadcasts yet.`,
      );
    const key = `broadcast:${randomUUID()}`;
    const sent = await this.notify(ids, {
      kind: 'broadcast',
      title: dto.title,
      body: dto.body,
      important: dto.important,
      dedupeKey: key,
    });
    await this.audit.record({
      action: 'admin.notification.broadcast',
      actorId: actor.userId,
      actorRole: 'admin',
      targetType: dto.batchId ? 'batch' : 'students',
      targetId: dto.batchId,
      detail: { recipients: sent, important: !!dto.important },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return { recipients: sent };
  }

  /**
   * Admin message to one student (owner, 30 Oct), e.g. a fee-dues reminder. In-app (bell); important ones are also
   * emailed through the outbox once the mail provider is connected (OI-01). Audited with the category.
   */
  async direct(
    actor: RequestMeta & { userId: string },
    dto: { studentId: string; category: string; title: string; body: string; important?: boolean },
  ) {
    const st = await this.prisma.user.findFirst({
      where: { id: dto.studentId, role: 'student' },
      select: { id: true, code: true, status: true },
    });
    if (!st) throw Errors.notFound('No student with that ID.');
    if (st.status !== 'active') throw Errors.conflict('STUDENT_NOT_ACTIVE', 'This student account is not active.');
    const sent = await this.notify(st.id, {
      kind: 'admin_message',
      title: dto.title,
      body: dto.body,
      important: dto.important,
      dedupeKey: `admin_message:${randomUUID()}`,
    });
    await this.audit.record({
      action: 'admin.notification.direct',
      actorId: actor.userId,
      actorRole: 'admin',
      targetType: 'user',
      targetId: st.id,
      detail: {
        category: dto.category,
        title: dto.title,
        body: dto.body,
        important: !!dto.important,
        student: st.code, // not "…Code": the audit log redacts it
      },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return { recipients: sent, student: st.code };
  }

  /** Messages admins sent to individual students, newest first. */
  async directHistory() {
    const rows = await this.prisma.auditLog.findMany({
      where: { action: 'admin.notification.direct' },
      orderBy: { seq: 'desc' },
      take: 50,
      select: { at: true, actorId: true, detail: true },
    });
    const people = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))] } },
      select: { id: true, displayName: true },
    });
    return rows.map((r) => {
      const d = (r.detail ?? {}) as { category?: string; title?: string; student?: string; important?: boolean };
      return {
        at: r.at,
        by: people.find((p) => p.id === r.actorId)?.displayName ?? 'Admin',
        student: d.student ?? '',
        category: d.category ?? 'general',
        title: d.title ?? '',
        important: !!d.important,
      };
    });
  }

  /**
   * Trainer announcement to one batch they lead or co-lead ("Post to batch", restored 29 Oct). Students see it in the
   * bell and under "Trainer announcements" in My Handler; the trainer's history comes from the audit log.
   */
  async announce(actor: RequestMeta & { userId: string }, batchId: string, dto: { title: string; body: string }) {
    const b = await this.prisma.batch.findFirst({
      where: { id: batchId, OR: [{ trainerId: actor.userId }, { coTrainerIds: { has: actor.userId } }] },
      select: { id: true, code: true },
    });
    if (!b) throw Errors.notFound('No batch of yours with that ID.');
    const ids = (
      await this.prisma.enrolment.findMany({ where: { batchId, status: 'active' }, select: { studentId: true } })
    ).map((e) => e.studentId);
    if (!ids.length) throw Errors.validation('This batch has no active students yet.', 'batchId');
    const sent = await this.notify(ids, {
      kind: 'announcement',
      title: dto.title,
      body: dto.body,
      link: '#/lms/trainer',
      important: false,
      dedupeKey: `announcement:${randomUUID()}`,
    });
    await this.audit.record({
      action: 'trainer.announcement.posted',
      actorId: actor.userId,
      actorRole: 'trainer',
      targetType: 'batch',
      targetId: batchId,
      detail: { batch: b.code, title: dto.title, body: dto.body, recipients: sent },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return { recipients: sent, batch: b.code };
  }

  /** The trainer's own announcements, newest first. */
  async announcements(trainerId: string) {
    const rows = await this.prisma.auditLog.findMany({
      where: { actorId: trainerId, action: 'trainer.announcement.posted' },
      orderBy: { seq: 'desc' },
      take: 50,
      select: { at: true, detail: true },
    });
    return rows.map((r) => {
      const d = (r.detail ?? {}) as { batch?: string; title?: string; body?: string; recipients?: number };
      return {
        at: r.at,
        batch: d.batch ?? '',
        title: d.title ?? '',
        body: d.body ?? '',
        recipients: d.recipients ?? 0,
      };
    });
  }

  /** A student's trainer announcements, newest first. */
  async studentAnnouncements(userId: string) {
    const rows = await this.prisma.notification.findMany({
      where: { userId, kind: 'announcement' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { title: true, body: true, createdAt: true },
    });
    return rows.map((n) => ({ title: n.title, body: n.body, at: n.createdAt }));
  }
}

/** Sends the email for an important notification (worker, via the outbox). Title and link only. */
@Injectable()
export class AcademyNotifier implements OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  onModuleInit() {
    this.outbox.handlers.set('academy.notification.email', async (p) => {
      const { notificationId } = p as { notificationId: string };
      const n = await this.prisma.notification.findUnique({ where: { id: notificationId } });
      if (!n || n.readAt) return;
      const pref = await this.prisma.notificationPreference.findUnique({ where: { userId: n.userId } });
      if (pref && !pref.emailImportant) return;
      const u = await this.prisma.user.findUnique({ where: { id: n.userId }, select: { email: true, status: true } });
      if (!u || u.status !== 'active') return;
      await this.mail.send({
        to: u.email,
        template: 'academy_notification',
        subject: `Yojo Academy: ${n.title}`,
        text: `${n.title}\n\nOpen your Academy to read it: ${this.cfg.PUBLIC_APP_URL}/academy.html${n.link ?? ''}`,
      });
    });
  }
}
