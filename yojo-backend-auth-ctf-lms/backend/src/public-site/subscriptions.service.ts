import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type PublicSubscriptionKind } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256 } from '../common/crypto/crypto.util';
import { AppError, Errors } from '../common/errors/app-error';
import { RateLimitService } from '../common/guards/rate-limit.service';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { CONSENT_VERSIONS } from '../identity/constants';
import { MAIL_PORT, type MailPort } from '../identity/mail/mail.port';
import type { RequestMeta } from '../identity/types';
import { PrismaService } from '../prisma/prisma.service';
import type { EventCreateDto, EventPatchDto } from './public-site.dto';
import type { Actor } from './submissions.service';

const eventPublic = {
  id: true,
  slug: true,
  name: true,
  summary: true,
  status: true,
  startsAt: true,
  endsAt: true,
  durationHours: true,
  format: true,
} satisfies Prisma.CtfEventSelect;

/**
 * Event listing for the website and event reminders (the newsletter was removed, OI-37). Each reminder carries its own
 * marketing-type consent (separate from contact-form consent) and an unsubscribe link whose token is stored only as a
 * hash.
 */
@Injectable()
export class SubscriptionsService {
  private readonly log = new Logger('Subscriptions');

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rate: RateLimitService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  /** Events the website may show: listed ones, plus any CTF open for registration or live. */
  async publicEvents() {
    const rows = await this.prisma.ctfEvent.findMany({
      where: { OR: [{ listed: true }, { status: { in: ['registration', 'live'] } }] },
      orderBy: [{ startsAt: 'asc' }, { name: 'asc' }],
      select: eventPublic,
    });
    const now = Date.now();
    return {
      items: rows.map((e) => ({
        ...e,
        // Reminders make sense only before the start (or while no date is set yet).
        remindable: e.status !== 'ended' && (!e.startsAt || e.startsAt.getTime() > now),
      })),
    };
  }

  async remind(slug: string, email: string, meta: RequestMeta) {
    const event = await this.prisma.ctfEvent.findUnique({ where: { slug }, select: { ...eventPublic, listed: true } });
    if (!event || (!event.listed && !['registration', 'live'].includes(event.status)))
      throw Errors.notFound('This event is not open for reminders.');
    if (event.status === 'ended' || (event.startsAt && event.startsAt.getTime() <= Date.now()))
      throw new AppError(409, 'EVENT_STARTED', 'This event has already started.');
    return this.subscribe('event_reminder', email, event.id, event.name, meta);
  }

  private async subscribe(
    kind: PublicSubscriptionKind,
    rawEmail: string,
    eventId: string | null,
    eventName: string | null,
    meta: RequestMeta,
  ) {
    await this.rate.hitClass('subscribe_ip', meta.ip ?? 'unknown');
    const email = rawEmail.trim().toLowerCase();
    await this.rate.hitClass('public_form_contact', sha256(email));
    const scope = eventId ?? '';
    const token = randomToken(32);
    const version = CONSENT_VERSIONS[kind];
    const existing = await this.prisma.publicSubscription.findUnique({
      where: { kind_email_scope: { kind, email, scope } },
      select: { id: true, status: true },
    });
    // Same answer whether or not the address was already on the list, so the form cannot be used to test addresses.
    const answer = { status: 'subscribed' as const, kind, event: eventName };
    if (existing?.status === 'active') return answer;
    const row = existing
      ? await this.prisma.publicSubscription.update({
          where: { id: existing.id },
          data: {
            status: 'active',
            unsubscribedAt: null,
            consentVersion: version,
            consentAt: new Date(),
            unsubscribeHash: sha256(token),
          },
        })
      : await this.prisma.publicSubscription.create({
          data: { kind, email, scope, eventId, consentVersion: version, unsubscribeHash: sha256(token) },
        });
    await this.audit.record({
      action: existing ? 'public.subscription.renewed' : 'public.subscription.created',
      actorRole: 'visitor',
      targetType: 'public_subscription',
      targetId: row.id,
      detail: { kind, eventId },
      ip: meta.ip,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });
    const link = `${this.cfg.PUBLIC_APP_URL}/index.html#unsubscribe=${token}`;
    await this.mail
      .send({
        to: email,
        template: 'subscription_confirmed',
        subject: `Reminder set: ${eventName}`,
        text: `We will email you before ${eventName} starts.\n\nDid not ask for this, or changed your mind? Unsubscribe: ${link}`,
      })
      .catch((e: unknown) =>
        this.log.warn(`confirmation email not queued: ${e instanceof Error ? e.message : 'error'}`),
      );
    return answer;
  }

  async unsubscribe(token: string, meta: RequestMeta) {
    await this.rate.hitClass('unsubscribe_ip', meta.ip ?? 'unknown');
    const row = await this.prisma.publicSubscription.findUnique({
      where: { unsubscribeHash: sha256(token) },
      select: { id: true, kind: true, status: true, event: { select: { name: true } } },
    });
    if (!row) throw new AppError(404, 'UNSUBSCRIBE_LINK_INVALID', 'This unsubscribe link is not valid any more.');
    if (row.status === 'active') {
      await this.prisma.publicSubscription.update({
        where: { id: row.id },
        data: { status: 'unsubscribed', unsubscribedAt: new Date() },
      });
      await this.audit.record({
        action: 'public.subscription.unsubscribed',
        actorRole: 'visitor',
        targetType: 'public_subscription',
        targetId: row.id,
        detail: { kind: row.kind },
        ip: meta.ip,
        requestId: meta.requestId,
      });
    }
    return { status: 'unsubscribed' as const, kind: row.kind, event: row.event?.name ?? null };
  }

  // ── admin ──

  async adminEvents() {
    const rows = await this.prisma.ctfEvent.findMany({
      orderBy: [{ startsAt: 'asc' }, { name: 'asc' }],
      select: {
        ...eventPublic,
        listed: true,
        _count: { select: { registrations: true, reminders: { where: { status: 'active' } } } },
      },
    });
    return {
      items: rows.map(({ _count, ...e }) => ({
        ...e,
        registrations: _count.registrations,
        activeReminders: _count.reminders,
      })),
    };
  }

  async createEvent(dto: EventCreateDto, actor: Actor) {
    try {
      const e = await this.prisma.ctfEvent.create({
        data: this.eventData(dto, { slug: dto.slug, name: dto.name }),
        select: eventPublic,
      });
      await this.audit.record({
        action: 'admin.event.created',
        actorId: actor.userId,
        actorRole: 'admin',
        targetType: 'ctf_event',
        targetId: e.id,
        detail: { slug: e.slug },
        ip: actor.ip,
        requestId: actor.requestId,
      });
      return e;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw Errors.conflict('SLUG_TAKEN', 'An event with this address already exists.');
      throw err;
    }
  }

  async patchEvent(id: string, dto: EventPatchDto, actor: Actor) {
    const exists = await this.prisma.ctfEvent.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw Errors.notFound('No event with that ID.');
    const e = await this.prisma.ctfEvent.update({ where: { id }, data: this.eventData(dto, {}), select: eventPublic });
    await this.audit.record({
      action: 'admin.event.updated',
      actorId: actor.userId,
      actorRole: 'admin',
      targetType: 'ctf_event',
      targetId: id,
      detail: { fields: Object.keys(dto) },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return e;
  }

  /** Reminder list for one event (emails only, for the team that sends the reminder). Audited. */
  async eventReminders(id: string, actor: Actor) {
    const rows = await this.prisma.publicSubscription.findMany({
      where: { eventId: id, kind: 'event_reminder', status: 'active' },
      orderBy: { createdAt: 'asc' },
      select: { email: true, createdAt: true },
      take: 10000,
    });
    await this.audit.record({
      action: 'admin.event.reminders_viewed',
      actorId: actor.userId,
      actorRole: 'admin',
      targetType: 'ctf_event',
      targetId: id,
      detail: { count: rows.length },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return { items: rows };
  }

  private eventData(dto: EventPatchDto, base: { slug?: string; name?: string }) {
    if (dto.startsAt && dto.endsAt && new Date(dto.endsAt) <= new Date(dto.startsAt))
      throw Errors.validation('The end must be after the start.', 'endsAt');
    return {
      ...base,
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.listed !== undefined ? { listed: dto.listed } : {}),
      ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
      ...(dto.startsAt !== undefined ? { startsAt: new Date(dto.startsAt) } : {}),
      ...(dto.endsAt !== undefined ? { endsAt: new Date(dto.endsAt) } : {}),
      ...(dto.durationHours !== undefined ? { durationHours: dto.durationHours } : {}),
      ...(dto.format !== undefined ? { format: dto.format } : {}),
    } as Prisma.CtfEventCreateInput;
  }
}
