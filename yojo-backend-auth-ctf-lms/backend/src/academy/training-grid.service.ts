import { Injectable } from '@nestjs/common';
import { Prisma, type AttendanceMark, type ClassSession, type SessionType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors/app-error';
import { RateLimitService } from '../common/guards/rate-limit.service';
import type { RequestMeta } from '../identity/types';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { addDays, dateCol, dayOf, istDay, istDayStart, istWeekStart } from './ist';
import { NotificationsService } from './notifications.service';

type Actor = RequestMeta & { userId: string };
const JOIN_OPENS_MS = 30 * 60_000;
const TRAINER_EDIT_DAYS = 7;
const MAX_RANGE_DAYS = 62;
const OPEN_REQUEST = ['pending', 'approved', 'proposed'] as const;
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Training Grid (docs/ACADEMY-INVENTORY.md, slice c): sessions, attendance, calendar, week schedule, trainer card,
 * 1-to-1 bookings, leave requests and messages. Students see only their own batches and records; trainers only
 * the batches they lead or co-lead; admins everything (with audit). Attendance rule (documented):
 *   eligible = sessions that count for attendance, not cancelled, already ended, in the student's batches;
 *   pct = (present + late) / (present + late + absent); excused and not-yet-marked sessions are left out.
 * An approved leave request does not change marks by itself; the trainer marks excused (prompt rule).
 */
@Injectable()
export class TrainingGridService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly rate: RateLimitService,
    private readonly notes: NotificationsService,
  ) {}

  // ───────────── shared ─────────────

  async studentBatches(userId: string) {
    const rows = await this.prisma.enrolment.findMany({
      where: { studentId: userId, status: 'active' },
      select: {
        batch: {
          select: {
            id: true,
            name: true,
            code: true,
            trainerId: true,
            coTrainerIds: true,
            courseId: true,
            course: { select: { title: true } },
          },
        },
      },
    });
    return rows.map((r) => r.batch);
  }

  private trainerBatchWhere(trainerId: string): Prisma.BatchWhereInput {
    return { OR: [{ trainerId }, { coTrainerIds: { has: trainerId } }] };
  }

  private async assertTrainerBatch(trainerId: string, batchId: string) {
    const ok = await this.prisma.batch.count({ where: { id: batchId, ...this.trainerBatchWhere(trainerId) } });
    if (!ok) throw Errors.notFound('No batch of yours with that ID.');
  }

  private range(from?: string, to?: string, defDays = 31, maxDays = MAX_RANGE_DAYS) {
    const start = from ?? istDay();
    const end = to ?? addDays(start, defDays);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start)
      throw Errors.validation('Give from and to as YYYY-MM-DD, from before to.', 'from');
    if ((dateCol(end).getTime() - dateCol(start).getTime()) / 86_400_000 > maxDays)
      throw Errors.validation(`Ask for at most ${maxDays} days at a time.`, 'to');
    return { start, end, gte: istDayStart(start), lt: istDayStart(addDays(end, 1)) };
  }

  private state(s: Pick<ClassSession, 'startsAt' | 'endsAt' | 'status'>, now = Date.now()) {
    if (s.status === 'cancelled') return 'cancelled';
    if (s.endsAt.getTime() <= now) return 'completed';
    if (s.startsAt.getTime() <= now) return 'live';
    return 'upcoming';
  }

  private async names(ids: (string | null | undefined)[]) {
    const u = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = u.length
      ? await this.prisma.user.findMany({
          where: { id: { in: u } },
          select: { id: true, displayName: true, staffProfile: { select: { displayName: true } } },
        })
      : [];
    return new Map(rows.map((r) => [r.id, r.staffProfile?.displayName ?? r.displayName ?? 'Trainer']));
  }

  // ───────────── student: attendance, calendar, schedule ─────────────

  async attendance(userId: string, from?: string, to?: string) {
    const batches = await this.studentBatches(userId);
    const r = this.range(from ?? addDays(istDay(), -90), to ?? istDay(), 0, 366); // attendance reports cover up to a year
    const now = new Date();
    const sessions = await this.prisma.classSession.findMany({
      where: {
        batchId: { in: batches.map((b) => b.id) },
        countsForAttendance: true,
        status: 'scheduled',
        endsAt: { lte: now },
        startsAt: { gte: r.gte, lt: r.lt },
      },
      orderBy: { startsAt: 'asc' },
      include: { attendance: { where: { studentId: userId } } },
    });
    const policy = (await this.settings.get('policy')).value;
    const count = { present: 0, late: 0, absent: 0, excused: 0, unmarked: 0 };
    const weeks = new Map<string, { attended: number; counted: number }>();
    const courses = new Map<string, { attended: number; counted: number }>();
    const bname = new Map(batches.map((b) => [b.id, b.course?.title ?? b.name]));
    const list = sessions.map((s) => {
      const m = s.attendance[0]?.mark ?? null;
      if (!m) count.unmarked++;
      else count[m]++;
      if (m && m !== 'excused') {
        const att = m === 'present' || m === 'late' ? 1 : 0;
        const w = istWeekStart(s.startsAt);
        const wk = weeks.get(w) ?? { attended: 0, counted: 0 };
        weeks.set(w, { attended: wk.attended + att, counted: wk.counted + 1 });
        const c = bname.get(s.batchId) ?? '';
        const ck = courses.get(c) ?? { attended: 0, counted: 0 };
        courses.set(c, { attended: ck.attended + att, counted: ck.counted + 1 });
      }
      return {
        id: s.id,
        type: s.type,
        title: s.title,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        course: bname.get(s.batchId),
        mark: m,
      };
    });
    const counted = count.present + count.late + count.absent;
    const pct = (a: number, c: number) => (c ? Math.round((100 * a) / c) : null);
    return {
      from: r.start,
      to: r.end,
      requiredPct: policy.attendanceMinPct,
      pct: pct(count.present + count.late, counted),
      counts: count,
      byWeek: [...weeks].map(([week, v]) => ({ week, pct: pct(v.attended, v.counted) })),
      byCourse: [...courses].map(([course, v]) => ({ course, pct: pct(v.attended, v.counted), sessions: v.counted })),
      sessions: list,
      rule: 'Attended (present or late) ÷ marked sessions that count. Excused and not-yet-marked sessions are left out.',
    };
  }

  /** Normalised events for the Ops Calendar; layout stays in the page. */
  async calendar(userId: string, from?: string, to?: string) {
    const r = this.range(from, to);
    const batches = await this.studentBatches(userId);
    const [sessions, bookings, holidays, leaves] = await Promise.all([
      this.prisma.classSession.findMany({
        where: { batchId: { in: batches.map((b) => b.id) }, startsAt: { gte: r.gte, lt: r.lt } },
        orderBy: { startsAt: 'asc' },
        include: { attendance: { where: { studentId: userId }, select: { mark: true } } },
      }),
      this.prisma.sessionRequest.findMany({
        where: {
          studentId: userId,
          startsAt: { gte: r.gte, lt: r.lt },
          status: { in: [...OPEN_REQUEST, 'completed'] },
        },
      }),
      this.prisma.holiday.findMany({ where: { day: { gte: dateCol(r.start), lte: dateCol(r.end) } } }),
      this.prisma.leaveRequest.findMany({
        where: {
          studentId: userId,
          status: 'approved',
          fromDay: { lte: dateCol(r.end) },
          toDay: { gte: dateCol(r.start) },
        },
      }),
    ]);
    const who = await this.names([...sessions.map((s) => s.trainerId), ...bookings.map((b) => b.trainerId)]);
    const bname = new Map(batches.map((b) => [b.id, b.course?.title ?? b.name]));
    // Deadlines of published assessments for the courses and batches the student is in.
    const dues = await this.prisma.assessment.findMany({
      where: {
        status: 'published',
        dueAt: { gte: r.gte, lt: r.lt },
        courseId: { in: batches.map((b) => b.courseId).filter((x): x is string => !!x) },
        OR: [{ batchId: null }, { batchId: { in: batches.map((b) => b.id) } }],
      },
      select: { id: true, title: true, kind: true, dueAt: true },
    });
    const now = Date.now();
    return {
      from: r.start,
      to: r.end,
      timezone: 'Asia/Kolkata',
      events: [
        ...sessions.map((s) => ({
          kind: 'session' as const,
          id: s.id,
          type: s.type,
          title: s.title,
          course: bname.get(s.batchId),
          trainer: s.trainerId ? who.get(s.trainerId) : null,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          status: this.state(s, now),
          attendance: s.attendance[0]?.mark ?? null,
        })),
        ...dues.map((a) => ({
          kind: 'assessment' as const,
          id: a.id,
          type: a.kind,
          title: `Due: ${a.title}`,
          startsAt: a.dueAt!,
          endsAt: a.dueAt!,
          status: 'due',
        })),
        ...bookings.map((b) => ({
          kind: 'booking' as const,
          id: b.id,
          type: 'mentor' as SessionType,
          title: `1-to-1 with ${who.get(b.trainerId) ?? 'trainer'}`,
          startsAt: b.startsAt,
          endsAt: b.endsAt,
          status: b.status,
        })),
      ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
      holidays: holidays.map((h) => ({ day: dayOf(h.day), name: h.name })),
      leave: leaves.map((l) => ({ from: dayOf(l.fromDay), to: dayOf(l.toDay) })),
    };
  }

  /** This Week: sessions of the IST week with join links for enrolled students (from 30 minutes before the start). */
  async schedule(userId: string, week?: string) {
    const start = istWeekStart(week ? istDayStart(week) : new Date());
    const cal = await this.calendar(userId, start, addDays(start, 6));
    const now = Date.now();
    const ids = cal.events.filter((e) => e.kind === 'session').map((e) => e.id);
    const links = new Map(
      (
        await this.prisma.classSession.findMany({
          where: { id: { in: ids } },
          select: { id: true, joinUrl: true, room: true, startsAt: true, endsAt: true, status: true },
        })
      ).map((s) => [
        s.id,
        {
          joinUrl:
            s.status === 'scheduled' &&
            s.joinUrl &&
            now >= s.startsAt.getTime() - JOIN_OPENS_MS &&
            now < s.endsAt.getTime()
              ? s.joinUrl
              : null,
          room: s.room,
        },
      ]),
    );
    const next = await this.prisma.classSession.findFirst({
      where: {
        batchId: { in: (await this.studentBatches(userId)).map((b) => b.id) },
        status: 'scheduled',
        endsAt: { gt: new Date() },
      },
      orderBy: { startsAt: 'asc' },
      select: { id: true, title: true, type: true, startsAt: true, endsAt: true },
    });
    return {
      weekStart: start,
      events: cal.events.map((e) => (e.kind === 'session' ? { ...e, ...links.get(e.id) } : e)),
      holidays: cal.holidays,
      next,
      joinRule: 'Join links appear 30 minutes before a session and only for students enrolled in its batch.',
    };
  }

  // ───────────── student: trainer, bookings, leave ─────────────

  async myTrainers(userId: string) {
    const batches = await this.studentBatches(userId);
    const ids = [...new Set(batches.flatMap((b) => [b.trainerId, ...b.coTrainerIds]).filter((x): x is string => !!x))];
    const staff = await this.prisma.user.findMany({
      where: { id: { in: ids }, status: 'active', role: 'trainer' },
      select: { id: true, capability: true, displayName: true, staffProfile: true },
    });
    const slots = await this.prisma.trainerSlot.findMany({
      where: {
        trainerId: { in: ids },
        startsAt: { gt: new Date(Date.now() + 3600_000), lt: new Date(Date.now() + 14 * 86_400_000) },
        requests: { none: { status: { in: [...OPEN_REQUEST] } } },
      },
      orderBy: { startsAt: 'asc' },
      select: { id: true, trainerId: true, startsAt: true, endsAt: true, kind: true },
    });
    const [requests, leave, conversations] = await Promise.all([
      this.prisma.sessionRequest.findMany({ where: { studentId: userId }, orderBy: { startsAt: 'desc' }, take: 20 }),
      this.prisma.leaveRequest.findMany({ where: { studentId: userId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.conversations(userId, 'student'),
    ]);
    return {
      batches: batches.map((b) => ({ id: b.id, name: b.name, course: b.course?.title ?? null })),
      trainers: staff.map((t) => ({
        id: t.id,
        name: t.staffProfile?.displayName ?? t.displayName ?? 'Trainer',
        role: t.capability === 'trainer_mentor' ? 'Trainer and mentor' : 'Trainer',
        title: t.staffProfile?.title ?? null,
        speciality: t.staffProfile?.speciality ?? null,
        experience: t.staffProfile?.experience ?? null,
        languages: t.staffProfile?.languages ?? [],
        certifications: t.staffProfile?.certifications ?? [],
        certificationsVerified: !!t.staffProfile?.credentialsVerifiedAt,
        batches: batches.filter((b) => b.trainerId === t.id || b.coTrainerIds.includes(t.id)).map((b) => b.name),
        openSlots: slots.filter((s) => s.trainerId === t.id).map(({ trainerId: _t, ...s }) => s),
      })),
      requests,
      leave: leave.map((l) => ({ ...l, fromDay: dayOf(l.fromDay), toDay: dayOf(l.toDay) })),
      conversations,
    };
  }

  async book(userId: string, slotId: string, purpose: string, note: string | undefined, meta: RequestMeta) {
    const slot = await this.prisma.trainerSlot.findUnique({ where: { id: slotId } });
    if (!slot) throw Errors.notFound('That slot is not available.');
    const mine = (await this.studentBatches(userId)).some(
      (b) => b.trainerId === slot.trainerId || b.coTrainerIds.includes(slot.trainerId),
    );
    if (!mine) throw Errors.notFound('That slot is not available.');
    if (slot.startsAt.getTime() < Date.now() + 3600_000)
      throw new AppError(409, 'TOO_LATE', 'Book at least one hour ahead.');
    const clash = await this.prisma.sessionRequest.count({
      where: {
        studentId: userId,
        status: { in: ['pending', 'approved'] },
        startsAt: { lt: slot.endsAt },
        endsAt: { gt: slot.startsAt },
      },
    });
    if (clash) throw new AppError(409, 'TIME_CLASH', 'You already have a session at that time.');
    try {
      const r = await this.prisma.sessionRequest.create({
        data: {
          studentId: userId,
          trainerId: slot.trainerId,
          slotId,
          purpose,
          note,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
        },
      });
      await this.log('academy.booking.requested', 'session_request', r.id, { userId, ...meta }, { slotId });
      return r;
    } catch (e) {
      if (isUnique(e)) throw new AppError(409, 'SLOT_TAKEN', 'Someone just booked that slot. Pick another.');
      throw e;
    }
  }

  async cancelRequest(userId: string, id: string) {
    const r = await this.prisma.sessionRequest.updateMany({
      where: { id, studentId: userId, status: { in: [...OPEN_REQUEST] }, startsAt: { gt: new Date() } },
      data: { status: 'cancelled' },
    });
    if (!r.count) throw Errors.notFound('No open request of yours with that ID.');
    return { id, status: 'cancelled' };
  }

  /** The student's answer to a trainer's proposed new time. */
  async respondProposal(userId: string, id: string, accept: boolean) {
    const r = await this.prisma.sessionRequest.findFirst({ where: { id, studentId: userId, status: 'proposed' } });
    if (!r || !r.proposedStart) throw Errors.notFound('No proposed time to answer.');
    const len = r.endsAt.getTime() - r.startsAt.getTime();
    const upd = await this.prisma.sessionRequest.updateMany({
      where: { id, status: 'proposed' },
      data: accept
        ? {
            status: 'approved',
            startsAt: r.proposedStart,
            endsAt: new Date(r.proposedStart.getTime() + len),
            slotId: null,
          }
        : { status: 'cancelled' },
    });
    if (!upd.count) throw Errors.conflict('REQUEST_CHANGED', 'This request changed. Reload it.');
    return { id, status: accept ? 'approved' : 'cancelled' };
  }

  async requestLeave(userId: string, from: string, to: string, reason: string, meta: RequestMeta) {
    if (!(await this.studentBatches(userId)).length)
      throw new AppError(409, 'NO_BATCH', 'Leave requests are for students in a batch.');
    if (from < istDay()) throw Errors.validation('Leave cannot start in the past.', 'from');
    if (to < from) throw Errors.validation('The end date is before the start date.', 'to');
    const overlap = await this.prisma.leaveRequest.count({
      where: {
        studentId: userId,
        status: { in: ['pending', 'approved'] },
        fromDay: { lte: dateCol(to) },
        toDay: { gte: dateCol(from) },
      },
    });
    if (overlap) throw new AppError(409, 'LEAVE_OVERLAP', 'You already asked for leave on some of these days.');
    const l = await this.prisma.leaveRequest.create({
      data: { studentId: userId, fromDay: dateCol(from), toDay: dateCol(to), reason },
    });
    await this.log('academy.leave.requested', 'leave_request', l.id, { userId, ...meta }, { from, to });
    return { ...l, fromDay: from, toDay: to };
  }

  async withdrawLeave(userId: string, id: string) {
    const r = await this.prisma.leaveRequest.updateMany({
      where: { id, studentId: userId, status: 'pending' },
      data: { status: 'withdrawn' },
    });
    if (!r.count) throw Errors.notFound('No pending leave request of yours with that ID.');
    return { id, status: 'withdrawn' };
  }

  // ───────────── messages (student ↔ staff) ─────────────

  async conversations(userId: string, as: 'student' | 'staff') {
    const rows = await this.prisma.conversation.findMany({
      where: as === 'student' ? { studentId: userId } : { staffId: userId },
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, senderId: true, createdAt: true } },
      },
    });
    const unread = await this.prisma.message.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: rows.map((r) => r.id) }, readAt: null, senderId: { not: userId } },
      _count: { _all: true },
    });
    const un = new Map(unread.map((u) => [u.conversationId, u._count._all]));
    const who = await this.names(rows.map((r) => (as === 'student' ? r.staffId : r.studentId)));
    return rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      with: who.get(as === 'student' ? r.staffId : r.studentId) ?? null,
      lastMessageAt: r.lastMessageAt,
      preview: r.messages[0]?.body.slice(0, 120) ?? '',
      unread: un.get(r.id) ?? 0,
    }));
  }

  async thread(userId: string, id: string) {
    const c = await this.prisma.conversation.findUnique({ where: { id } });
    if (!c || (c.studentId !== userId && c.staffId !== userId)) throw Errors.notFound('No conversation with that ID.');
    await this.prisma.message.updateMany({
      where: { conversationId: id, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });
    const messages = await this.prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return {
      id,
      subject: c.subject,
      messages: messages.map((m) => ({
        id: m.id,
        mine: m.senderId === userId,
        body: m.body,
        at: m.createdAt,
        read: !!m.readAt,
      })),
    };
  }

  /** A student may write only to a trainer of one of their batches. */
  async startConversation(userId: string, staffId: string, subject: string, body: string) {
    const ok = (await this.studentBatches(userId)).some(
      (b) => b.trainerId === staffId || b.coTrainerIds.includes(staffId),
    );
    if (!ok) throw Errors.forbidden('You can message only the trainers of your batches.');
    await this.rate.hitClass('message_user', userId);
    const c = await this.prisma.conversation.create({
      data: { studentId: userId, staffId, subject, messages: { create: { senderId: userId, body } } },
    });
    await this.notes.notify(staffId, {
      kind: 'message',
      title: `New message: ${subject}`,
      link: `#/messages/${c.id}`,
      dedupeKey: `conversation:${c.id}`,
    });
    return { id: c.id };
  }

  async send(userId: string, id: string, body: string) {
    const c = await this.prisma.conversation.findUnique({ where: { id } });
    if (!c || (c.studentId !== userId && c.staffId !== userId)) throw Errors.notFound('No conversation with that ID.');
    await this.rate.hitClass('message_user', userId);
    const now = new Date();
    const [m] = await this.prisma.$transaction([
      this.prisma.message.create({ data: { conversationId: id, senderId: userId, body, createdAt: now } }),
      this.prisma.conversation.update({ where: { id }, data: { lastMessageAt: now } }),
    ]);
    await this.notes.notify(c.studentId === userId ? c.staffId : c.studentId, {
      kind: 'message',
      title: `New reply: ${c.subject}`,
      link: c.studentId === userId ? `#/messages/${id}` : '#/lms/trainer', // staff console route vs Academy route
      dedupeKey: `message:${m.id}`,
    });
    return { id: m.id, at: m.createdAt };
  }

  // ───────────── trainer ─────────────

  async trainerSessions(trainerId: string, from?: string, to?: string) {
    const r = this.range(from, to);
    const rows = await this.prisma.classSession.findMany({
      where: { batch: this.trainerBatchWhere(trainerId), startsAt: { gte: r.gte, lt: r.lt } },
      orderBy: { startsAt: 'asc' },
      include: { batch: { select: { code: true, name: true } }, _count: { select: { attendance: true } } },
    });
    const now = Date.now();
    return rows.map(({ _count, ...s }) => ({ ...s, state: this.state(s, now), marked: _count.attendance }));
  }

  async createSession(
    actor: Actor,
    dto: {
      batchId: string;
      type: SessionType;
      title: string;
      startsAt: string;
      endsAt: string;
      joinUrl?: string;
      room?: string;
      countsForAttendance?: boolean;
    },
    asAdmin = false,
  ) {
    if (!asAdmin) await this.assertTrainerBatch(actor.userId, dto.batchId);
    const batch = await this.prisma.batch.findUnique({
      where: { id: dto.batchId },
      select: { courseId: true, trainerId: true },
    });
    if (!batch) throw Errors.notFound('No batch with that ID.');
    const s = new Date(dto.startsAt),
      e = new Date(dto.endsAt);
    if (e <= s) throw Errors.validation('The end must be after the start.', 'endsAt');
    const clash = await this.prisma.classSession.count({
      where: { batchId: dto.batchId, status: 'scheduled', startsAt: { lt: e }, endsAt: { gt: s } },
    });
    if (clash) throw new AppError(409, 'TIME_CLASH', 'This batch already has a session at that time.');
    const row = await this.prisma.classSession.create({
      data: {
        batchId: dto.batchId,
        courseId: batch.courseId,
        type: dto.type,
        title: dto.title,
        startsAt: s,
        endsAt: e,
        trainerId: asAdmin ? batch.trainerId : actor.userId,
        joinUrl: dto.joinUrl,
        room: dto.room,
        countsForAttendance: dto.countsForAttendance ?? dto.type !== 'mentor',
        createdById: actor.userId,
      },
    });
    await this.log('academy.session.created', 'class_session', row.id, actor, { batchId: dto.batchId, type: dto.type });
    return row;
  }

  async updateSession(
    actor: Actor,
    id: string,
    dto: { title?: string; startsAt?: string; endsAt?: string; joinUrl?: string; room?: string; cancelReason?: string },
    asAdmin = false,
  ) {
    const s = await this.prisma.classSession.findUnique({ where: { id } });
    if (!s) throw Errors.notFound('No session with that ID.');
    if (!asAdmin) await this.assertTrainerBatch(actor.userId, s.batchId);
    if (s.endsAt.getTime() <= Date.now()) throw new AppError(409, 'SESSION_ENDED', 'A past session cannot be changed.');
    const data: Prisma.ClassSessionUpdateInput = {};
    if (dto.title) data.title = dto.title;
    if (dto.joinUrl !== undefined) data.joinUrl = dto.joinUrl || null;
    if (dto.room !== undefined) data.room = dto.room || null;
    if (dto.startsAt || dto.endsAt) {
      const st = new Date(dto.startsAt ?? s.startsAt),
        en = new Date(dto.endsAt ?? s.endsAt);
      if (en <= st) throw Errors.validation('The end must be after the start.', 'endsAt');
      data.startsAt = st;
      data.endsAt = en;
    }
    if (dto.cancelReason) {
      data.status = 'cancelled';
      data.cancelReason = dto.cancelReason;
    }
    const row = await this.prisma.classSession.update({ where: { id }, data });
    await this.log(
      dto.cancelReason ? 'academy.session.cancelled' : 'academy.session.updated',
      'class_session',
      id,
      actor,
      { fields: Object.keys(dto) },
      dto.cancelReason,
    );
    return row;
  }

  async roster(actor: Actor, sessionId: string, asAdmin = false) {
    const s = await this.prisma.classSession.findUnique({ where: { id: sessionId }, include: { attendance: true } });
    if (!s) throw Errors.notFound('No session with that ID.');
    if (!asAdmin) await this.assertTrainerBatch(actor.userId, s.batchId);
    const students = await this.prisma.enrolment.findMany({
      where: { batchId: s.batchId, status: 'active' },
      select: {
        student: { select: { id: true, code: true, displayName: true, studentProfile: { select: { name: true } } } },
      },
    });
    const marks = new Map(s.attendance.map((a) => [a.studentId, a]));
    const leave = await this.prisma.leaveRequest.findMany({
      where: {
        studentId: { in: students.map((x) => x.student.id) },
        status: 'approved',
        fromDay: { lte: dateCol(istDay(s.startsAt)) },
        toDay: { gte: dateCol(istDay(s.startsAt)) },
      },
      select: { studentId: true },
    });
    const onLeave = new Set(leave.map((l) => l.studentId));
    return {
      session: { id: s.id, title: s.title, type: s.type, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status },
      students: students.map(({ student: x }) => ({
        id: x.id,
        code: x.code,
        name: x.studentProfile?.name ?? x.displayName,
        mark: marks.get(x.id)?.mark ?? null,
        note: marks.get(x.id)?.note ?? null,
        approvedLeave: onLeave.has(x.id),
      })),
    };
  }

  /**
   * Marks attendance for students enrolled in the session's batch. Trainers may change marks for 7 days after the
   * session; admins any time. Every write lands in attendance_history; a change of an existing mark needs a reason.
   */
  async mark(
    actor: Actor,
    sessionId: string,
    marks: { studentId: string; mark: AttendanceMark; note?: string }[],
    reason: string | undefined,
    asAdmin = false,
  ) {
    const s = await this.prisma.classSession.findUnique({ where: { id: sessionId } });
    if (!s) throw Errors.notFound('No session with that ID.');
    if (!asAdmin) await this.assertTrainerBatch(actor.userId, s.batchId);
    if (s.status === 'cancelled')
      throw new AppError(409, 'SESSION_CANCELLED', 'A cancelled session has no attendance.');
    if (s.startsAt.getTime() > Date.now())
      throw new AppError(409, 'NOT_STARTED', 'Attendance opens when the session starts.');
    if (!asAdmin && Date.now() - s.endsAt.getTime() > TRAINER_EDIT_DAYS * 86_400_000)
      throw new AppError(
        403,
        'CORRECTION_WINDOW_CLOSED',
        `After ${TRAINER_EDIT_DAYS} days only an admin can change attendance.`,
      );
    const enrolled = new Set(
      (
        await this.prisma.enrolment.findMany({
          where: { batchId: s.batchId, status: 'active' },
          select: { studentId: true },
        })
      ).map((e) => e.studentId),
    );
    const bad = marks.find((m) => !enrolled.has(m.studentId));
    if (bad) throw Errors.validation('Every student must be enrolled in this batch.', 'marks');
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const existing = new Map(
        (await tx.attendance.findMany({ where: { sessionId } })).map((a) => [a.studentId, a.mark]),
      );
      const changes = marks.filter((m) => existing.has(m.studentId) && existing.get(m.studentId) !== m.mark);
      if (changes.length && (!reason || reason.trim().length < 5)) throw Errors.reasonRequired();
      let written = 0;
      for (const m of marks) {
        const from = existing.get(m.studentId) ?? null;
        if (from === m.mark) continue;
        await tx.attendance.upsert({
          where: { sessionId_studentId: { sessionId, studentId: m.studentId } },
          create: {
            sessionId,
            studentId: m.studentId,
            mark: m.mark,
            note: m.note,
            markedById: actor.userId,
            markedAt: now,
          },
          update: { mark: m.mark, note: m.note, markedById: actor.userId, markedAt: now },
        });
        await tx.attendanceHistory.create({
          data: {
            sessionId,
            studentId: m.studentId,
            fromMark: from,
            toMark: m.mark,
            reason: from ? reason : null,
            actorId: actor.userId,
          },
        });
        written++;
      }
      await this.audit.record(
        {
          action: changes.length ? 'academy.attendance.corrected' : 'academy.attendance.marked',
          actorId: actor.userId,
          actorRole: asAdmin ? 'admin' : 'trainer',
          targetType: 'class_session',
          targetId: sessionId,
          detail: { written, corrections: changes.length },
          reason,
          ip: actor.ip,
          requestId: actor.requestId,
        },
        tx,
      );
      return { sessionId, written, corrections: changes.length };
    });
  }

  async slots(trainerId: string) {
    return this.prisma.trainerSlot.findMany({
      where: { trainerId, endsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
      include: {
        requests: { where: { status: { in: [...OPEN_REQUEST] } }, select: { id: true, status: true, studentId: true } },
      },
    });
  }

  async addSlot(trainerId: string, startsAt: string, endsAt: string, kind: string) {
    const s = new Date(startsAt),
      e = new Date(endsAt);
    if (s.getTime() < Date.now() + 3600_000)
      throw Errors.validation('Offer slots at least one hour ahead.', 'startsAt');
    if (e <= s) throw Errors.validation('The end must be after the start.', 'endsAt');
    if (await this.prisma.trainerSlot.count({ where: { trainerId, startsAt: { lt: e }, endsAt: { gt: s } } }))
      throw new AppError(409, 'TIME_CLASH', 'You already offer a slot at that time.');
    return this.prisma.trainerSlot.create({ data: { trainerId, startsAt: s, endsAt: e, kind } });
  }

  async removeSlot(trainerId: string, id: string) {
    const s = await this.prisma.trainerSlot.findFirst({
      where: { id, trainerId },
      include: { requests: { where: { status: { in: [...OPEN_REQUEST] } } } },
    });
    if (!s) throw Errors.notFound('No slot of yours with that ID.');
    if (s.requests.length)
      throw new AppError(409, 'SLOT_BOOKED', 'A student booked this slot. Decide the request first.');
    await this.prisma.trainerSlot.delete({ where: { id } });
  }

  async trainerRequests(trainerId: string) {
    const rows = await this.prisma.sessionRequest.findMany({
      where: { trainerId },
      orderBy: [{ status: 'asc' }, { startsAt: 'asc' }],
      take: 100,
    });
    const who = await this.studentNames(rows.map((r) => r.studentId));
    return rows.map((r) => ({ ...r, student: who.get(r.studentId) ?? null }));
  }

  async decideRequest(
    actor: Actor,
    id: string,
    decision: 'approve' | 'reject' | 'propose',
    note?: string,
    proposedStart?: string,
  ) {
    const r = await this.prisma.sessionRequest.findFirst({ where: { id, trainerId: actor.userId } });
    if (!r) throw Errors.notFound('No request of yours with that ID.');
    if (r.status !== 'pending') throw Errors.conflict('REQUEST_CHANGED', `This request is ${r.status}.`);
    let data: Prisma.SessionRequestUpdateManyMutationInput;
    if (decision === 'propose') {
      if (!proposedStart || new Date(proposedStart).getTime() < Date.now() + 3600_000)
        throw Errors.validation('Propose a time at least one hour ahead.', 'proposedStart');
      data = { status: 'proposed', proposedStart: new Date(proposedStart), decisionNote: note, decidedAt: new Date() };
    } else
      data = { status: decision === 'approve' ? 'approved' : 'rejected', decisionNote: note, decidedAt: new Date() };
    const upd = await this.prisma.sessionRequest.updateMany({ where: { id, status: 'pending' }, data });
    if (!upd.count) throw Errors.conflict('REQUEST_CHANGED', 'This request changed. Reload it.');
    await this.log(`academy.booking.${decision}`, 'session_request', id, actor, {});
    const word = { approve: 'approved', reject: 'declined', propose: 'given a new time' }[decision];
    await this.notes.notify(r.studentId, {
      kind: 'booking',
      title: `Your session request was ${word}`,
      body: note ?? '',
      link: '#/lms/trainer',
      important: decision !== 'reject',
      dedupeKey: `booking:${id}:${decision}`,
    });
    return { id, status: data.status };
  }

  async trainerLeave(trainerId: string) {
    const students = await this.prisma.enrolment.findMany({
      where: { status: 'active', batch: this.trainerBatchWhere(trainerId) },
      select: { studentId: true },
    });
    const rows = await this.prisma.leaveRequest.findMany({
      where: { studentId: { in: students.map((s) => s.studentId) } },
      orderBy: [{ status: 'asc' }, { fromDay: 'asc' }],
      take: 200,
    });
    const who = await this.studentNames(rows.map((r) => r.studentId));
    return rows.map((r) => ({
      ...r,
      fromDay: dayOf(r.fromDay),
      toDay: dayOf(r.toDay),
      student: who.get(r.studentId) ?? null,
    }));
  }

  async decideLeave(actor: Actor, id: string, approve: boolean, note: string | undefined, asAdmin = false) {
    const l = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!l) throw Errors.notFound('No leave request with that ID.');
    if (!asAdmin) {
      const mine = await this.prisma.enrolment.count({
        where: { studentId: l.studentId, status: 'active', batch: this.trainerBatchWhere(actor.userId) },
      });
      if (!mine) throw Errors.notFound('No leave request with that ID.');
    }
    const upd = await this.prisma.leaveRequest.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: approve ? 'approved' : 'rejected',
        reviewerId: actor.userId,
        decisionNote: note,
        decidedAt: new Date(),
      },
    });
    if (!upd.count) throw Errors.conflict('REQUEST_CHANGED', 'This leave request was already decided.');
    await this.log(`academy.leave.${approve ? 'approved' : 'rejected'}`, 'leave_request', id, actor, {}, note);
    await this.notes.notify(l.studentId, {
      kind: 'leave',
      title: `Your leave request was ${approve ? 'approved' : 'declined'}`,
      body: note ?? '',
      link: '#/lms/attendance',
      dedupeKey: `leave:${id}`,
    });
    return { id, status: approve ? 'approved' : 'rejected' };
  }

  // ───────────── admin ─────────────

  /** Per-student attendance for a batch (same rule as the student view). */
  async batchReport(batchId: string, from?: string, to?: string) {
    const students = await this.prisma.enrolment.findMany({
      where: { batchId, status: 'active' },
      select: { studentId: true },
    });
    const out = [];
    for (const s of students) {
      const a = await this.attendance(s.studentId, from, to);
      out.push({ studentId: s.studentId, pct: a.pct, counts: a.counts });
    }
    const names = await this.studentNames(students.map((s) => s.studentId));
    return {
      batchId,
      requiredPct: (await this.settings.get('policy')).value.attendanceMinPct,
      students: out.map((o) => ({ ...o, name: names.get(o.studentId) ?? null })),
    };
  }

  holidays() {
    return this.prisma.holiday
      .findMany({ orderBy: { day: 'asc' } })
      .then((r) => r.map((h) => ({ day: dayOf(h.day), name: h.name })));
  }

  async addHoliday(actor: Actor, day: string, name: string) {
    try {
      await this.prisma.holiday.create({ data: { day: dateCol(day), name, addedBy: actor.userId } });
    } catch (e) {
      if (isUnique(e)) throw Errors.conflict('HOLIDAY_EXISTS', 'That day is already a holiday.');
      throw e;
    }
    await this.log('academy.holiday.added', 'holiday', day, actor, { name });
    return { day, name };
  }

  async removeHoliday(actor: Actor, day: string) {
    const r = await this.prisma.holiday.deleteMany({ where: { day: dateCol(day) } });
    if (!r.count) throw Errors.notFound('No holiday on that day.');
    await this.log('academy.holiday.removed', 'holiday', day, actor, {});
  }

  async verifyCredentials(actor: Actor, trainerId: string, verified: boolean) {
    const r = await this.prisma.staffProfile.updateMany({
      where: { userId: trainerId, user: { role: 'trainer' } },
      data: { credentialsVerifiedAt: verified ? new Date() : null },
    });
    if (!r.count) throw Errors.notFound('No trainer profile with that ID.');
    await this.log(
      verified ? 'admin.trainer.credentials_verified' : 'admin.trainer.credentials_unverified',
      'user',
      trainerId,
      actor,
      {},
    );
    return { trainerId, verified };
  }

  private async studentNames(ids: string[]) {
    const rows = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, displayName: true, studentProfile: { select: { name: true } } },
    });
    return new Map(rows.map((r) => [r.id, r.studentProfile?.name ?? r.displayName ?? null]));
  }

  private log(
    action: string,
    type: string,
    id: string,
    actor: Actor,
    detail: Record<string, unknown>,
    reason?: string,
  ) {
    return this.audit.record({
      action,
      actorId: actor.userId,
      targetType: type,
      targetId: id,
      detail,
      reason,
      ip: actor.ip,
      requestId: actor.requestId,
    });
  }
}
