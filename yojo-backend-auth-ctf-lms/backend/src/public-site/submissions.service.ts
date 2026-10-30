import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type SubmissionStatus, type SubmissionType } from '@prisma/client';
import type Redis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { sha256 } from '../common/crypto/crypto.util';
import { AppError, Errors } from '../common/errors/app-error';
import { RateLimitService } from '../common/guards/rate-limit.service';
import { CONSENT_VERSIONS } from '../identity/constants';
import type { RequestMeta } from '../identity/types';
import { OutboxService } from '../jobs/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import type {
  AssignDto,
  ContactAttemptDto,
  CreateSubmissionDto,
  MetricsQuery,
  StatusDto,
  SubmissionListQuery,
} from './public-site.dto';
import {
  canMove,
  dedupeKey,
  DUPLICATE_WINDOW_MS,
  FINAL_STATUSES,
  needsReason,
  normalisePhone,
  OPEN_STATUSES,
  RESPONSE_TARGET_MS,
  SUBMISSION_RULES,
  type SubmissionField,
} from './submission-rules';

export interface Visitor {
  userId?: string;
  role?: string;
}
export interface Actor extends RequestMeta {
  userId: string;
}

const IDEMPOTENCY_TTL_SEC = 24 * 3600;
const encodeCursor = (offset: number) => Buffer.from(`o:${offset}`).toString('base64url');
function decodeCursor(c?: string): number {
  if (!c) return 0;
  const m = /^o:(\d{1,7})$/.exec(Buffer.from(c, 'base64url').toString());
  if (!m) throw Errors.validation('The page cursor is not valid.', 'cursor');
  return Number(m[1]);
}

const listSelect = {
  id: true,
  reference: true,
  type: true,
  topic: true,
  name: true,
  email: true,
  phone: true,
  message: true,
  status: true,
  sourcePage: true,
  createdAt: true,
  updatedAt: true,
  firstResponseAt: true,
  resolvedAt: true,
  userId: true,
  assignee: { select: { id: true, displayName: true, email: true } },
  _count: { select: { notes: true } },
} satisfies Prisma.PublicSubmissionSelect;

/**
 * Public website submissions (docs/PUBLIC-INVENTORY.md): validated per form type, stored once, reference number
 * returned, delivered to the Admin LMS inbox. Never creates or changes a user account.
 */
@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rate: RateLimitService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // ───────────────────────────── public ─────────────────────────────

  async create(dto: CreateSubmissionDto, visitor: Visitor, meta: RequestMeta, idempotencyKey?: string) {
    // Spam trap first, with a plain refusal (no record, no hint about which field gave it away).
    if (dto.website && dto.website.trim())
      throw new AppError(400, 'SUBMISSION_REJECTED', 'This form could not be sent. Reload the page and try again.');

    const idemKey = idempotencyKey ? `idem:sub:${sha256(`${meta.ip ?? ''}|${idempotencyKey}`)}` : null;
    if (idemKey) {
      const prior = await this.redis.get(idemKey);
      if (prior) return JSON.parse(prior) as SubmissionReceipt;
    }

    const rule = SUBMISSION_RULES[dto.type];
    const given = (Object.keys(dto) as (keyof CreateSubmissionDto)[]).filter(
      (k) => dto[k] !== undefined && !['type', 'sourcePage', 'website'].includes(k),
    ) as SubmissionField[];
    const extra = given.find((k) => !rule.allowed.includes(k));
    if (extra) throw Errors.validation(`This form does not take "${extra}".`, extra);
    for (const k of rule.required)
      if (dto[k] === undefined || dto[k] === '' || (k === 'consent' && dto.consent !== true))
        throw Errors.validation(REQUIRED_MESSAGE[k], k);
    if (rule.topics && dto.topic && !rule.topics.includes(dto.topic))
      throw Errors.validation('Choose one of the listed options.', 'topic');

    let name = dto.name?.trim() ?? '';
    let email = dto.email?.trim().toLowerCase() ?? null;
    let phone: string | null = null;
    if (dto.phone !== undefined && dto.phone !== '') {
      phone = normalisePhone(dto.phone);
      if (!phone) throw Errors.validation('Enter a valid phone number.', 'phone');
    }
    let preferredAt: string | undefined;
    if (dto.preferredAt) {
      const t = new Date(dto.preferredAt);
      if (t.getTime() < Date.now() - 3600_000 || t.getTime() > Date.now() + 180 * 86400_000)
        throw Errors.validation('Choose a date within the next six months.', 'preferredAt');
      preferredAt = t.toISOString();
    }

    let userId: string | null = null;
    if (rule.signedInStudent) {
      if (!visitor.userId) throw Errors.unauthenticated();
      if (visitor.role !== 'student') throw Errors.forbidden('Only students can request a course enrolment.');
      const u = await this.prisma.user.findUniqueOrThrow({
        where: { id: visitor.userId },
        select: { email: true, phone: true, displayName: true, studentProfile: { select: { name: true } } },
      });
      // Taken from the account, never from the request body.
      name = u.studentProfile?.name ?? u.displayName ?? u.email;
      email = u.email;
      phone = u.phone;
      userId = visitor.userId;
    } else if (visitor.userId && (visitor.role === 'student' || visitor.role === 'participant')) {
      userId = visitor.userId; // linked for context only; the visitor's typed details are kept as sent
    }

    // Per-IP limit for all forms, plus a per-email/phone limit so one address cannot flood the inbox.
    await this.rate.hitClass('public_form_ip', meta.ip ?? 'unknown');
    const subject = email ?? phone;
    if (subject) await this.rate.hitClass('public_form_contact', sha256(subject));

    const key = dedupeKey(dto.type, email, phone, dto.topic);
    const recent = await this.prisma.publicSubmission.findFirst({
      where: {
        dedupeKey: key,
        ...(rule.signedInStudent
          ? { userId, status: { in: OPEN_STATUSES } }
          : { createdAt: { gt: new Date(Date.now() - DUPLICATE_WINDOW_MS) } }),
      },
      orderBy: { createdAt: 'desc' },
      select: { reference: true, status: true, createdAt: true },
    });
    if (recent) {
      const receipt: SubmissionReceipt = {
        reference: recent.reference,
        status: recent.status,
        receivedAt: recent.createdAt.toISOString(),
        duplicate: true,
      };
      if (idemKey) await this.redis.set(idemKey, JSON.stringify(receipt), 'EX', IDEMPOTENCY_TTL_SEC);
      return receipt;
    }

    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const s = await tx.publicSubmission.create({
        data: {
          type: dto.type,
          topic: dto.topic?.trim() ?? null,
          name,
          email,
          phone,
          message: dto.message?.trim() || null,
          answers: preferredAt ? { preferredAt } : {},
          sourcePage: dto.sourcePage ?? null,
          userId,
          consentKind: rule.consentKind,
          consentVersion: rule.consentKind ? CONSENT_VERSIONS.contact : null,
          consentAt: rule.consentKind ? now : null,
          dedupeKey: key,
          events: { create: { kind: 'created', toStatus: 'new', actorId: userId } },
        },
        select: { id: true, reference: true, status: true, createdAt: true, type: true },
      });
      await this.outbox.add(tx, {
        aggregate: 'public_submission',
        aggregateId: s.id,
        type: 'public.submission.created',
        payload: { submissionId: s.id },
      });
      await this.audit.record(
        {
          action: 'public.submission.created',
          actorId: userId,
          actorRole: visitor.role ?? 'visitor',
          targetType: 'public_submission',
          targetId: s.id,
          detail: { reference: s.reference, type: s.type },
          ip: meta.ip,
          userAgent: meta.userAgent,
          requestId: meta.requestId,
        },
        tx,
      );
      return s;
    });
    const receipt: SubmissionReceipt = {
      reference: row.reference,
      status: row.status,
      receivedAt: row.createdAt.toISOString(),
      duplicate: false,
    };
    if (idemKey) await this.redis.set(idemKey, JSON.stringify(receipt), 'EX', IDEMPOTENCY_TTL_SEC);
    return receipt;
  }

  // ───────────────────────────── admin ─────────────────────────────

  async list(q: SubmissionListQuery, me: string) {
    const limit = q.limit ?? 25;
    const offset = decodeCursor(q.cursor);
    const where = this.where(q, me);
    const orderBy: Prisma.PublicSubmissionOrderByWithRelationInput =
      q.sort === 'created_asc'
        ? { createdAt: 'asc' }
        : q.sort === 'updated_desc'
          ? { updatedAt: 'desc' }
          : { createdAt: 'desc' };
    const [rows, total] = await Promise.all([
      this.prisma.publicSubmission.findMany({ where, orderBy, skip: offset, take: limit + 1, select: listSelect }),
      this.prisma.publicSubmission.count({ where }),
    ]);
    return {
      total,
      items: rows.slice(0, limit).map((r) => this.row(r)),
      nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
    };
  }

  /** CSV of the current filter (max 5000 rows). Every export is audited. */
  async exportCsv(q: SubmissionListQuery, actor: Actor): Promise<string> {
    const rows = await this.prisma.publicSubmission.findMany({
      where: this.where(q, actor.userId),
      orderBy: { createdAt: 'desc' },
      take: 5000,
      select: listSelect,
    });
    await this.audit.record({
      action: 'admin.submissions.exported',
      actorId: actor.userId,
      actorRole: 'admin',
      targetType: 'public_submission',
      detail: { count: rows.length, filter: { ...q, cursor: undefined } },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    const cell = (v: unknown) => {
      let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // no formulas when opened in a spreadsheet
      return `"${s.replace(/"/g, '""')}"`;
    };
    const head = ['Reference', 'Form', 'Topic', 'Name', 'Email', 'Phone', 'Status', 'Assignee', 'Received', 'Resolved'];
    return [
      head,
      ...rows.map((r) => [
        r.reference,
        SUBMISSION_RULES[r.type].label,
        r.topic,
        r.name,
        r.email,
        r.phone,
        r.status,
        r.assignee?.email ?? '',
        r.createdAt,
        r.resolvedAt,
      ]),
    ]
      .map((line) => line.map(cell).join(','))
      .join('\r\n');
  }

  async detail(id: string, actor: Actor) {
    const s = await this.prisma.publicSubmission.findUnique({
      where: { id },
      select: {
        ...listSelect,
        answers: true,
        consentKind: true,
        consentVersion: true,
        consentAt: true,
        notes: { orderBy: { createdAt: 'asc' }, select: { id: true, body: true, authorId: true, createdAt: true } },
        events: { orderBy: { at: 'asc' } },
      },
    });
    if (!s) throw Errors.notFound('No enquiry with that ID.');
    const people = await this.people([
      ...s.notes.map((n) => n.authorId),
      ...s.events.flatMap((e) => [e.actorId, e.assigneeId]),
    ]);
    // Opening a record shows personal data: logged like a student record view.
    await this.audit.record({
      action: 'admin.submission.viewed',
      actorId: actor.userId,
      actorRole: 'admin',
      targetType: 'public_submission',
      targetId: s.id,
      detail: { reference: s.reference },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return {
      ...this.row(s),
      answers: s.answers,
      consent: s.consentKind ? { kind: s.consentKind, version: s.consentVersion, at: s.consentAt } : null,
      allowedNext: s.status === 'rejected' ? [] : SUBMISSION_TRANSITIONS_FOR(s.status),
      notes: s.notes.map((n) => ({ id: n.id, body: n.body, at: n.createdAt, author: people.get(n.authorId) ?? null })),
      history: s.events.map((e) => ({
        id: e.id,
        kind: e.kind,
        from: e.fromStatus,
        to: e.toStatus,
        assignee: e.assigneeId ? (people.get(e.assigneeId) ?? null) : null,
        actor: e.actorId ? (people.get(e.actorId) ?? null) : null,
        detail: e.detail,
        at: e.at,
      })),
    };
  }

  async assign(id: string, dto: AssignDto, actor: Actor) {
    const assigneeId = dto.assigneeId ?? null;
    if (assigneeId) {
      const u = await this.prisma.user.findUnique({ where: { id: assigneeId }, select: { role: true, status: true } });
      if (!u || u.role !== 'admin' || u.status !== 'active')
        throw Errors.validation('Assign to an active admin account.', 'assigneeId');
    }
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.publicSubmission.findUnique({ where: { id }, select: { status: true, assigneeId: true } });
      if (!s) throw Errors.notFound('No enquiry with that ID.');
      if (FINAL_STATUSES.includes(s.status))
        throw Errors.conflict('SUBMISSION_CLOSED', 'Reopen this enquiry before assigning it.');
      if (s.assigneeId === assigneeId) return { id, assigneeId, status: s.status, changed: false };
      const status: SubmissionStatus = assigneeId && ['new', 'reviewing'].includes(s.status) ? 'assigned' : s.status;
      const r = await tx.publicSubmission.updateMany({
        where: { id, status: s.status, assigneeId: s.assigneeId },
        data: { assigneeId, status },
      });
      if (!r.count) throw Errors.conflict('SUBMISSION_CHANGED', 'Someone else changed this enquiry. Reload it.');
      await tx.submissionEvent.create({
        data: {
          submissionId: id,
          actorId: actor.userId,
          kind: assigneeId ? 'assigned' : 'unassigned',
          assigneeId,
          fromStatus: s.status,
          toStatus: status,
        },
      });
      if (assigneeId)
        await this.outbox.add(tx, {
          aggregate: 'public_submission',
          aggregateId: id,
          type: 'public.submission.assigned',
          payload: { submissionId: id, assigneeId },
        });
      await this.audit.record(
        {
          action: 'admin.submission.assigned',
          actorId: actor.userId,
          actorRole: 'admin',
          targetType: 'public_submission',
          targetId: id,
          detail: { assigneeId, from: s.status, to: status },
          ip: actor.ip,
          requestId: actor.requestId,
        },
        tx,
      );
      return { id, assigneeId, status, changed: true };
    });
  }

  async setStatus(id: string, dto: StatusDto, actor: Actor) {
    const from = dto.from as SubmissionStatus;
    const to = dto.status as SubmissionStatus;
    if (!canMove(from, to))
      throw new AppError(409, 'TRANSITION_NOT_ALLOWED', `An enquiry cannot move from ${from} to ${to}.`, {
        details: { allowed: SUBMISSION_TRANSITIONS_FOR(from) },
      });
    if (needsReason(from, to) && !dto.reason) throw Errors.reasonRequired();
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.publicSubmission.findUnique({
        where: { id },
        select: { status: true, firstResponseAt: true },
      });
      if (!s) throw Errors.notFound('No enquiry with that ID.');
      const data: Prisma.PublicSubmissionUpdateManyMutationInput = { status: to };
      if (FINAL_STATUSES.includes(to)) data.resolvedAt = now;
      else data.resolvedAt = null;
      if (!s.firstResponseAt && to !== 'new') data.firstResponseAt = now;
      // Compare-and-set on the status the admin saw: a concurrent change makes this a 409, never a silent overwrite.
      const r = await tx.publicSubmission.updateMany({ where: { id, status: from }, data });
      if (!r.count) throw Errors.conflict('SUBMISSION_CHANGED', 'Someone else changed this enquiry. Reload it.');
      await tx.submissionEvent.create({
        data: {
          submissionId: id,
          actorId: actor.userId,
          kind: 'status',
          fromStatus: from,
          toStatus: to,
          detail: dto.reason ? { reason: dto.reason } : {},
        },
      });
      await this.audit.record(
        {
          action: 'admin.submission.status',
          actorId: actor.userId,
          actorRole: 'admin',
          targetType: 'public_submission',
          targetId: id,
          detail: { from, to },
          reason: dto.reason,
          ip: actor.ip,
          requestId: actor.requestId,
        },
        tx,
      );
      return { id, status: to, resolvedAt: data.resolvedAt ?? null };
    });
  }

  async addNote(id: string, body: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.publicSubmission.findUnique({ where: { id }, select: { id: true } });
      if (!s) throw Errors.notFound('No enquiry with that ID.');
      const n = await tx.submissionNote.create({
        data: { submissionId: id, authorId: actor.userId, body: body.trim() },
      });
      await tx.submissionEvent.create({ data: { submissionId: id, actorId: actor.userId, kind: 'note' } });
      await tx.publicSubmission.update({ where: { id }, data: { updatedAt: new Date() } });
      await this.audit.record(
        {
          action: 'admin.submission.note',
          actorId: actor.userId,
          actorRole: 'admin',
          targetType: 'public_submission',
          targetId: id,
          ip: actor.ip,
          requestId: actor.requestId,
        },
        tx,
      );
      return { id: n.id, at: n.createdAt };
    });
  }

  async contactAttempt(id: string, dto: ContactAttemptDto, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.publicSubmission.findUnique({ where: { id }, select: { firstResponseAt: true } });
      if (!s) throw Errors.notFound('No enquiry with that ID.');
      const e = await tx.submissionEvent.create({
        data: {
          submissionId: id,
          actorId: actor.userId,
          kind: 'contact_attempt',
          detail: { channel: dto.channel, outcome: dto.outcome, ...(dto.note ? { note: dto.note } : {}) },
        },
      });
      await tx.publicSubmission.update({
        where: { id },
        data: { updatedAt: new Date(), ...(s.firstResponseAt ? {} : { firstResponseAt: new Date() }) },
      });
      await this.audit.record(
        {
          action: 'admin.submission.contact_attempt',
          actorId: actor.userId,
          actorRole: 'admin',
          targetType: 'public_submission',
          targetId: id,
          detail: { channel: dto.channel, outcome: dto.outcome },
          ip: actor.ip,
          requestId: actor.requestId,
        },
        tx,
      );
      return { id: e.id, at: e.at };
    });
  }

  /**
   * Dashboard figures, all counted from public_submissions in one pass of grouped queries.
   * Definitions: open = new/reviewing/assigned/in_progress/waiting_for_user; overdue = open with no first response
   * after 24 h; average resolution = mean of (resolved_at - created_at) for records resolved, closed or rejected in
   * the period. Period filters on created_at, except the resolution average which filters on resolved_at.
   */
  async metrics(q: MetricsQuery) {
    const range: Prisma.DateTimeFilter = {};
    if (q.from) range.gte = new Date(q.from);
    if (q.to) range.lt = new Date(q.to);
    const inRange = q.from || q.to ? { createdAt: range } : {};
    const [byStatus, byType, unassigned, overdue, resolution] = await Promise.all([
      this.prisma.publicSubmission.groupBy({ by: ['status'], where: inRange, _count: { _all: true } }),
      this.prisma.publicSubmission.groupBy({ by: ['type'], where: inRange, _count: { _all: true } }),
      this.prisma.publicSubmission.count({ where: { ...inRange, assigneeId: null, status: { in: OPEN_STATUSES } } }),
      this.prisma.publicSubmission.count({
        where: {
          ...inRange,
          status: { in: OPEN_STATUSES },
          firstResponseAt: null,
          createdAt: { ...range, lt: minDate(range.lt as Date | undefined, new Date(Date.now() - RESPONSE_TARGET_MS)) },
        },
      }),
      this.prisma.$queryRaw<{ avg_hours: number | null; n: bigint }[]>`
        SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)::float AS avg_hours, COUNT(*) AS n
        FROM public_submissions
        WHERE resolved_at IS NOT NULL
          AND (${q.from ?? null}::timestamptz IS NULL OR resolved_at >= ${q.from ?? null}::timestamptz)
          AND (${q.to ?? null}::timestamptz IS NULL OR resolved_at < ${q.to ?? null}::timestamptz)`,
    ]);
    const statusCounts = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])) as Record<string, number>;
    const total = byStatus.reduce((a, r) => a + r._count._all, 0);
    return {
      period: { from: q.from ?? null, to: q.to ?? null },
      total,
      byStatus: statusCounts,
      byType: Object.fromEntries(byType.map((r) => [r.type, r._count._all])),
      open: OPEN_STATUSES.reduce((a, s) => a + (statusCounts[s] ?? 0), 0),
      unassigned,
      overdue,
      averageResolutionHours: resolution[0]?.avg_hours == null ? null : Math.round(resolution[0].avg_hours * 10) / 10,
      resolvedCount: Number(resolution[0]?.n ?? 0),
      definitions: {
        open: OPEN_STATUSES,
        overdue: 'open, no first response after 24 hours',
        averageResolutionHours: 'mean hours from received to resolved/closed/rejected, by resolution date',
      },
    };
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private where(q: SubmissionListQuery, me: string): Prisma.PublicSubmissionWhereInput {
    const and: Prisma.PublicSubmissionWhereInput[] = [];
    if (q.type) and.push({ type: q.type });
    if (q.status === 'open') and.push({ status: { in: OPEN_STATUSES } });
    else if (q.status) and.push({ status: q.status });
    if (q.assignee === 'me') and.push({ assigneeId: me });
    else if (q.assignee === 'none') and.push({ assigneeId: null });
    else if (q.assignee) and.push({ assigneeId: q.assignee });
    if (q.from || q.to)
      and.push({
        createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) },
      });
    const t = q.q?.trim();
    if (t) {
      if (/^enq-\d+$/i.test(t)) and.push({ reference: t.toUpperCase() });
      else
        and.push({
          OR: [
            { name: { contains: t, mode: 'insensitive' } },
            { email: { contains: t, mode: 'insensitive' } },
            { phone: { contains: t.replace(/[^\d+]/g, '') || t } },
            { topic: { contains: t, mode: 'insensitive' } },
          ],
        });
    }
    return and.length ? { AND: and } : {};
  }

  private row(r: Prisma.PublicSubmissionGetPayload<{ select: typeof listSelect }>) {
    const open = OPEN_STATUSES.includes(r.status);
    return {
      id: r.id,
      reference: r.reference,
      type: r.type,
      typeLabel: SUBMISSION_RULES[r.type].label,
      topic: r.topic,
      name: r.name,
      email: r.email,
      phone: r.phone,
      message: r.message,
      status: r.status,
      sourcePage: r.sourcePage,
      linkedUser: !!r.userId,
      assignee: r.assignee ? { id: r.assignee.id, name: r.assignee.displayName ?? r.assignee.email } : null,
      notes: r._count.notes,
      overdue: open && !r.firstResponseAt && Date.now() - r.createdAt.getTime() > RESPONSE_TARGET_MS,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      resolvedAt: r.resolvedAt,
    };
  }

  private async people(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = unique.length
      ? await this.prisma.user.findMany({
          where: { id: { in: unique } },
          select: { id: true, displayName: true, email: true },
        })
      : [];
    return new Map(rows.map((u) => [u.id, { id: u.id, name: u.displayName ?? u.email }]));
  }
}

export interface SubmissionReceipt {
  reference: string;
  status: SubmissionStatus;
  receivedAt: string;
  duplicate: boolean;
}

const REQUIRED_MESSAGE: Record<SubmissionField, string> = {
  name: 'Enter your full name.',
  email: 'Enter a valid email address.',
  phone: 'Enter a valid phone number.',
  topic: 'Choose an option.',
  message: 'Write a short message.',
  preferredAt: 'Choose a date and time.',
  consent: 'Tick the box so we may contact you about this request.',
};

function SUBMISSION_TRANSITIONS_FOR(from: SubmissionStatus): SubmissionStatus[] {
  return (
    ['reviewing', 'in_progress', 'waiting_for_user', 'resolved', 'closed', 'rejected'] as SubmissionStatus[]
  ).filter((to) => canMove(from, to));
}

function minDate(a: Date | undefined, b: Date): Date {
  return a && a < b ? a : b;
}

export type { SubmissionType };
