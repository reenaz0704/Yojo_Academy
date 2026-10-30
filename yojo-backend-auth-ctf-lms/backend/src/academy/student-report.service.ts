import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors/app-error';
import type { RequestMeta } from '../identity/types';
import { PrismaService } from '../prisma/prisma.service';
import { AssessmentsService } from './assessments.service';
import { CareerPathService } from './career-path.service';
import { CoursesService } from './courses.service';
import { GamificationService } from './gamification.service';
import { PlacementService } from './placement.service';
import { TrainingGridService } from './training-grid.service';

type Actor = RequestMeta & { userId: string };

/**
 * Admin LMS → Student reports. Everything is read from records; nothing here changes a student (the streak is read
 * from streak_state, not through the student endpoint that opens a pending break). Opening a full report is audited.
 */
@Injectable()
export class StudentReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly career: CareerPathService,
    private readonly game: GamificationService,
    private readonly grid: TrainingGridService,
    private readonly assessments: AssessmentsService,
    private readonly courses: CoursesService,
    private readonly placement: PlacementService,
  ) {}

  /** Student list with the career-path quiz as a filter and column. Offset cursor, 50 per page. */
  async list(q: { q?: string; path?: string; quiz?: 'taken' | 'skipped' | 'none'; batchId?: string; cursor?: string }) {
    const skip = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString()) || 0 : 0;
    const where: Prisma.UserWhereInput = {
      role: 'student',
      status: { not: 'deleted' },
      ...(q.q
        ? {
            OR: [
              { email: { contains: q.q, mode: 'insensitive' } },
              { code: { contains: q.q, mode: 'insensitive' } },
              { studentProfile: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(q.batchId ? { enrolments: { some: { batchId: q.batchId, status: 'active' } } } : {}),
    };
    // Quiz and path filters work on the latest career row per student.
    if (q.quiz || q.path) {
      const rows = await this.prisma.$queryRaw<{ user_id: string; skipped: boolean; chosen_path: string | null }[]>`
        SELECT DISTINCT ON (user_id) user_id, skipped, chosen_path FROM career_path_results ORDER BY user_id, created_at DESC`;
      const ids = new Set(
        rows
          .filter((r) => (q.quiz === 'taken' ? !r.skipped : q.quiz === 'skipped' ? r.skipped : true))
          .filter((r) => !q.path || r.chosen_path === q.path)
          .map((r) => r.user_id),
      );
      where.id = q.quiz === 'none' ? { notIn: rows.map((r) => r.user_id) } : { in: [...ids] };
      if (q.quiz === 'none' && q.path) where.id = { in: [] }; // no quiz row → no chosen path either
    }
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: 51,
        select: {
          id: true,
          code: true,
          email: true,
          origin: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
          studentProfile: { select: { name: true, institutionName: true } },
          enrolments: { where: { status: 'active' }, select: { batch: { select: { code: true } } } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    const page = users.slice(0, 50);
    const ids = page.map((u) => u.id);
    const [careers, xp, streaks] = await Promise.all([
      this.prisma.careerPathResult.findMany({ where: { userId: { in: ids } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.xpLedger.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _sum: { delta: true } }),
      this.prisma.streakState.findMany({ where: { userId: { in: ids } }, select: { userId: true, current: true } }),
    ]);
    const latest = new Map<string, (typeof careers)[number]>();
    for (const c of careers) if (!latest.has(c.userId)) latest.set(c.userId, c);
    const xpOf = new Map(xp.map((x) => [x.userId, Math.max(0, x._sum.delta ?? 0)]));
    const stOf = new Map(streaks.map((x) => [x.userId, x.current]));
    return {
      total,
      items: await Promise.all(
        page.map(async (u) => {
          const c = latest.get(u.id);
          return {
            id: u.id,
            code: u.code,
            name: u.studentProfile?.name ?? null,
            email: u.email,
            origin: u.origin,
            status: u.status,
            institution: u.studentProfile?.institutionName ?? null,
            batches: u.enrolments.map((e) => e.batch.code),
            path: await this.career.pathOf(u.id),
            quiz: c
              ? {
                  status: c.skipped ? 'skipped' : 'taken',
                  suggested: c.suggested,
                  percentages: c.skipped
                    ? null
                    : { Offensive: c.offensivePct, Defensive: c.defensivePct, GRC: c.grcPct },
                  chosenPath: c.chosenPath,
                  at: c.createdAt,
                }
              : { status: 'none' },
            xp: xpOf.get(u.id) ?? 0,
            streak: stOf.get(u.id) ?? 0,
            lastActive: u.lastLoginAt,
            joinedAt: u.createdAt,
          };
        }),
      ),
      nextCursor: users.length > 50 ? Buffer.from(String(skip + 50)).toString('base64url') : null,
    };
  }

  async report(actor: Actor, id: string) {
    const u = await this.prisma.user.findFirst({
      where: { id, role: 'student' },
      select: {
        id: true,
        code: true,
        email: true,
        phone: true,
        origin: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        studentProfile: {
          select: { name: true, institutionName: true, city: true, eduLevel: true, stream: true, gradYear: true },
        },
        enrolments: {
          select: {
            status: true,
            createdAt: true,
            batch: { select: { id: true, code: true, name: true, course: { select: { title: true } } } },
          },
        },
      },
    });
    if (!u) throw Errors.notFound('No student with that ID.');
    const [
      careerRows,
      onboarding,
      path,
      xp,
      week,
      streak,
      attendance,
      results,
      courses,
      certificates,
      placement,
      labs,
      rank,
      remarks,
      requests,
    ] = await Promise.all([
      this.prisma.careerPathResult.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.onboardingResult.findFirst({ where: { userId: id }, orderBy: { createdAt: 'desc' } }),
      this.career.pathOf(id),
      this.game.totalXp(id),
      this.game.weekXp(id),
      this.prisma.streakState.findUnique({ where: { userId: id } }),
      this.grid.attendance(id),
      this.assessments.results(id),
      this.courses.forStudent(id, 'mine'),
      this.courses.certificates(id),
      this.placement.overview(id),
      this.prisma.studentActivity.findMany({
        where: { userId: id, kind: 'lab_completed' },
        distinct: ['refId'],
        orderBy: { at: 'desc' },
        select: { refId: true, at: true },
      }),
      this.game.totalXp(id).then((t) => this.game.rankOf(t)),
      // trainer desk: every remark and private note (admins see both), and trainers' requests about this student
      this.prisma.studentRemark.findMany({
        where: { studentId: id },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          kind: true,
          text: true,
          createdAt: true,
          updatedAt: true,
          history: true,
          author: { select: { displayName: true, email: true } },
        },
      }),
      this.prisma.studentStaffRequest.findMany({
        where: { studentId: id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          code: true,
          kind: true,
          reason: true,
          status: true,
          resolution: true,
          createdAt: true,
          resolvedAt: true,
          raisedBy: { select: { displayName: true, email: true } },
        },
      }),
    ]);
    await this.audit.record({
      action: 'admin.student.report_viewed',
      actorId: actor.userId,
      actorRole: 'admin',
      targetType: 'user',
      targetId: id,
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return {
      profile: {
        id: u.id,
        code: u.code,
        name: u.studentProfile?.name ?? null,
        email: u.email,
        phone: u.phone,
        origin: u.origin,
        status: u.status,
        institution: u.studentProfile?.institutionName ?? null,
        city: u.studentProfile?.city ?? null,
        education:
          [u.studentProfile?.eduLevel, u.studentProfile?.stream, u.studentProfile?.gradYear]
            .filter(Boolean)
            .join(' · ') || null,
        joinedAt: u.createdAt,
        lastLogin: u.lastLoginAt,
      },
      careerPath: {
        path,
        latest: careerRows[0] ?? null,
        history: careerRows.map((c) => ({
          at: c.createdAt,
          skipped: c.skipped,
          percentages: c.skipped ? null : { Offensive: c.offensivePct, Defensive: c.defensivePct, GRC: c.grcPct },
          suggested: c.suggested,
          tiedWith: c.tiedWith,
          chosenPath: c.chosenPath,
          chosenAt: c.chosenAt,
          version: c.quizVersion,
        })),
        olderQuestionnaire: onboarding
          ? {
              primary: onboarding.primary,
              scores: { Offensive: onboarding.offensive, Defensive: onboarding.defensive, GRC: onboarding.grc },
              at: onboarding.createdAt,
            }
          : null,
      },
      enrolments: u.enrolments.map((e) => ({
        batch: e.batch.code,
        name: e.batch.name,
        course: e.batch.course?.title ?? null,
        status: e.status,
        since: e.createdAt,
      })),
      courses: courses.items.map((c) => ({ title: c.title, state: c.state, progress: c.progress })),
      certificates,
      attendance: {
        pct: attendance.pct,
        requiredPct: attendance.requiredPct,
        counts: attendance.counts,
        byCourse: attendance.byCourse,
      },
      assessments: results,
      gamification: {
        xp,
        weekXp: week,
        rank,
        streak: {
          current: streak?.current ?? 0,
          longest: streak?.longest ?? 0,
          lastQualifiedDay: streak?.lastQualifiedDay ?? null,
        },
      },
      labs: { cleared: labs.length, recent: labs.slice(0, 10).map((l) => ({ code: l.refId, at: l.at })) },
      placement,
      remarks: remarks.map(({ author, ...r }) => ({ ...r, author: author.displayName ?? author.email })),
      requests: requests.map(({ raisedBy, ...r }) => ({ ...r, raisedBy: raisedBy.displayName ?? raisedBy.email })),
    };
  }
}
