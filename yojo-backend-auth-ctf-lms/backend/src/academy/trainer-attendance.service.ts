import { Injectable } from '@nestjs/common';
import type { TrainerAttendanceStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors/app-error';
import type { RequestMeta } from '../identity/types';
import { PrismaService } from '../prisma/prisma.service';

type Actor = RequestMeta & { userId: string };
const DAY_MS = 86_400_000;
/** Days are Indian calendar days (IST, UTC+05:30), like the class schedule. */
const startOf = (day: string) => new Date(`${day}T00:00:00+05:30`);
const dayOf = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const today = () => dayOf(new Date());

/**
 * Admin → Attendance → Trainers (owner, 30 Oct). An admin marks a trainer present, absent, on leave or half day for a
 * date; a day without a mark shows "present (from classes)" when the trainer took attendance in a class that day.
 * Every mark is audited; changing an existing mark needs a reason.
 */
@Injectable()
export class TrainerAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private trainers() {
    return this.prisma.user.findMany({
      where: { role: 'trainer', status: { in: ['active', 'suspended'] } },
      orderBy: { displayName: 'asc' },
      select: {
        id: true,
        code: true,
        displayName: true,
        email: true,
        capability: true,
        batchesLed: { where: { status: { not: 'completed' } }, select: { code: true } },
      },
    });
  }

  /** Sessions per trainer per day in [from, to), and the ones where the trainer took attendance. */
  private async classDays(ids: string[], from: Date, to: Date) {
    const sessions = await this.prisma.classSession.findMany({
      where: {
        startsAt: { gte: from, lt: to },
        status: { not: 'cancelled' },
        OR: [{ trainerId: { in: ids } }, { trainerId: null, batch: { trainerId: { in: ids } } }],
      },
      select: { id: true, startsAt: true, trainerId: true, batch: { select: { trainerId: true } } },
    });
    const marked = await this.prisma.attendance.findMany({
      where: { sessionId: { in: sessions.map((s) => s.id) }, markedById: { in: ids } },
      select: { sessionId: true, markedById: true },
      distinct: ['sessionId', 'markedById'],
    });
    const out = new Map<string, { sessions: number; marked: number }>(); // key trainerId|day
    for (const s of sessions) {
      const t = s.trainerId ?? s.batch.trainerId!;
      const k = `${t}|${dayOf(s.startsAt)}`;
      const v = out.get(k) ?? { sessions: 0, marked: 0 };
      v.sessions++;
      if (marked.some((m) => m.sessionId === s.id && m.markedById === t)) v.marked++;
      out.set(k, v);
    }
    return out;
  }

  async day(day = today()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Errors.validation('Use a date like 2026-10-30.', 'day');
    const from = startOf(day);
    const [ts, rows, holiday] = await Promise.all([
      this.trainers(),
      this.prisma.trainerAttendance.findMany({ where: { day: new Date(`${day}T00:00:00Z`) } }),
      this.prisma.holiday.findUnique({ where: { day: new Date(`${day}T00:00:00Z`) } }),
    ]);
    const cls = await this.classDays(
      ts.map((t) => t.id),
      from,
      new Date(from.getTime() + DAY_MS),
    );
    const markers = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.markedById) } },
      select: { id: true, displayName: true },
    });
    const past = day < today();
    const list = ts.map((t) => {
      const r = rows.find((x) => x.trainerId === t.id);
      const c = cls.get(`${t.id}|${day}`) ?? { sessions: 0, marked: 0 };
      const auto = c.marked > 0 ? 'present' : null;
      return {
        id: t.id,
        code: t.code,
        name: t.displayName ?? t.email,
        email: t.email,
        capability: t.capability,
        batches: t.batchesLed.map((b) => b.code),
        sessions: c.sessions,
        sessionsMarked: c.marked,
        status: (r?.status ?? auto) as TrainerAttendanceStatus | null,
        source: r ? 'admin' : auto ? 'classes' : c.sessions ? (past ? 'not_marked' : 'scheduled') : 'no_classes',
        note: r?.note ?? null,
        markedBy: r ? (markers.find((m) => m.id === r.markedById)?.displayName ?? 'Admin') : null,
        markedAt: r?.updatedAt ?? null,
      };
    });
    const count = (s: string) => list.filter((x) => x.status === s).length;
    return {
      day,
      holiday: holiday?.name ?? null,
      trainers: list,
      summary: {
        present: count('present'),
        absent: count('absent'),
        leave: count('leave'),
        halfDay: count('half_day'),
        notMarked: list.filter((x) => !x.status && x.source === 'not_marked').length,
      },
    };
  }

  async mark(actor: Actor, dto: { trainerId: string; day: string; status: TrainerAttendanceStatus; note?: string }) {
    if (dto.day > today()) throw Errors.validation('Attendance cannot be marked for a future date.', 'day');
    const t = await this.prisma.user.findFirst({ where: { id: dto.trainerId, role: 'trainer' }, select: { id: true } });
    if (!t) throw Errors.notFound('No trainer with that ID.');
    const day = new Date(`${dto.day}T00:00:00Z`);
    const cur = await this.prisma.trainerAttendance.findUnique({
      where: { trainerId_day: { trainerId: t.id, day } },
    });
    const note = dto.note?.trim() || null;
    if (cur && cur.status !== dto.status && (!note || note.length < 3))
      throw Errors.validation('Changing an existing mark needs a reason.', 'note');
    const row = await this.prisma.trainerAttendance.upsert({
      where: { trainerId_day: { trainerId: t.id, day } },
      create: { trainerId: t.id, day, status: dto.status, note, markedById: actor.userId },
      update: { status: dto.status, note, markedById: actor.userId },
    });
    await this.audit.record({
      action: cur ? 'admin.trainer_attendance.changed' : 'admin.trainer_attendance.marked',
      actorId: actor.userId,
      actorRole: 'admin',
      adminRole: 'platform',
      targetType: 'user',
      targetId: t.id,
      reason: note ?? undefined,
      detail: { day: dto.day, status: dto.status, from: cur?.status ?? null },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return { trainerId: t.id, day: dto.day, status: row.status };
  }

  /** Last N days per trainer: admin marks, plus days present from class records where there is no mark. */
  async summary(days = 30) {
    const n = Math.min(Math.max(days, 1), 180);
    const to = startOf(today());
    const end = new Date(to.getTime() + DAY_MS);
    const from = new Date(to.getTime() - (n - 1) * DAY_MS);
    const ts = await this.trainers();
    const ids = ts.map((t) => t.id);
    const [rows, cls] = await Promise.all([
      this.prisma.trainerAttendance.findMany({
        where: { trainerId: { in: ids }, day: { gte: new Date(`${dayOf(from)}T00:00:00Z`) } },
      }),
      this.classDays(ids, from, end),
    ]);
    return {
      days: n,
      trainers: ts.map((t) => {
        const mine = rows.filter((r) => r.trainerId === t.id);
        const markedDays = new Set(mine.map((r) => r.day.toISOString().slice(0, 10)));
        let fromClasses = 0,
          notMarked = 0;
        for (const [k, v] of cls) {
          const [tid, d] = k.split('|');
          if (tid !== t.id || markedDays.has(d)) continue;
          if (v.marked > 0) fromClasses++;
          else if (d < today()) notMarked++;
        }
        const c = (s: string) => mine.filter((r) => r.status === s).length;
        return {
          id: t.id,
          code: t.code,
          name: t.displayName ?? t.email,
          present: c('present') + fromClasses,
          presentFromClasses: fromClasses,
          absent: c('absent'),
          leave: c('leave'),
          halfDay: c('half_day'),
          classDaysNotMarked: notMarked,
        };
      }),
    };
  }
}
