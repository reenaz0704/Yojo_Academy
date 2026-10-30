import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Errors } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { GamificationService } from './gamification.service';
import { TrainingGridService } from './training-grid.service';
import { performanceIndex } from './performance-index';

const DAY = 86_400_000;
/** A student with no lab, lesson, blog or quiz activity and no sign-in for this many days is flagged Inactive. */
export const INACTIVE_DAYS = 7;
/** A quiz average under this is flagged Falling behind. */
export const QUIZ_FLAG_PCT = 40;

/**
 * Admin and Trainer LMS read models (slice i). Every number comes from recorded rows: attendance marks, graded
 * attempts, completed missions, the XP ledger and activity. The performance index is the plain average of the parts
 * that exist for the student (attendance %, quiz average %, labs cleared % of published missions); a part with no data
 * is left out rather than counted as zero, and the response says which parts were used.
 */
@Injectable()
export class LmsInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly grid: TrainingGridService,
    private readonly game: GamificationService,
  ) {}

  private trainerScope(trainerId: string): Prisma.BatchWhereInput {
    return { OR: [{ trainerId }, { coTrainerIds: { has: trainerId } }] };
  }

  async batchOverview(batchId: string, trainerId?: string) {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, ...(trainerId ? this.trainerScope(trainerId) : {}) },
      select: { id: true, code: true, name: true, courseId: true },
    });
    if (!batch) throw Errors.notFound('No batch of yours with that ID.');
    const enrolments = await this.prisma.enrolment.findMany({
      where: { batchId, status: 'active' },
      select: {
        student: {
          select: {
            id: true,
            code: true,
            displayName: true,
            lastLoginAt: true,
            studentProfile: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const ids = enrolments.map((e) => e.student.id);
    const policy = (await this.settings.get('policy')).value;
    const [labsTotal, solved, attempts, lastActs] = await Promise.all([
      this.prisma.mission.count({ where: { status: 'published' } }),
      this.prisma.missionAttempt.findMany({
        where: { userId: { in: ids }, status: 'completed' },
        distinct: ['userId', 'missionCode'],
        select: { userId: true },
      }),
      this.prisma.attempt.findMany({
        where: {
          studentId: { in: ids },
          status: 'graded',
          score: { not: null },
          assessment: { OR: [{ batchId }, ...(batch.courseId ? [{ batchId: null, courseId: batch.courseId }] : [])] },
        },
        select: { studentId: true, score: true, assessment: { select: { maxMarks: true } } },
      }),
      this.prisma.studentActivity.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _max: { at: true } }),
    ]);
    const labs = new Map<string, number>();
    for (const s of solved) labs.set(s.userId, (labs.get(s.userId) ?? 0) + 1);
    const quiz = new Map<string, number[]>();
    for (const a of attempts)
      if (a.assessment.maxMarks > 0)
        quiz.set(a.studentId, [...(quiz.get(a.studentId) ?? []), (100 * (a.score ?? 0)) / a.assessment.maxMarks]);
    const acted = new Map(lastActs.map((a) => [a.userId, a._max.at]));

    const rows = [];
    for (const e of enrolments) {
      const s = e.student;
      const att = await this.grid.attendance(s.id);
      const q = quiz.get(s.id);
      const quizAvg = q?.length ? Math.round(q.reduce((x, y) => x + y, 0) / q.length) : null;
      const labsDone = labs.get(s.id) ?? 0;
      const labsPct = labsTotal ? Math.round((100 * labsDone) / labsTotal) : null;
      const parts = { attendance: att.pct, quiz: quizAvg, labs: labsDone ? labsPct : null };
      const last = [acted.get(s.id), s.lastLoginAt].filter((d): d is Date => !!d).sort((a, b) => +b - +a)[0] ?? null;
      const flags: string[] = [];
      // Each flag carries the actual figure behind it, so a trainer sees why (informational; nothing is automatic).
      const flagReasons: string[] = [];
      if (att.pct !== null && att.pct < policy.attendanceMinPct) {
        flags.push('Low attendance');
        flagReasons.push(`Attendance ${att.pct}% (needs ${policy.attendanceMinPct}%)`);
      }
      if (!last || Date.now() - last.getTime() > INACTIVE_DAYS * DAY) {
        flags.push('Inactive');
        flagReasons.push(
          last ? `No activity for ${Math.floor((Date.now() - last.getTime()) / DAY)} days` : 'No activity recorded yet',
        );
      }
      if (quizAvg !== null && quizAvg < QUIZ_FLAG_PCT) {
        flags.push('Falling behind');
        flagReasons.push(`Quiz average ${quizAvg}% (under ${QUIZ_FLAG_PCT}%)`);
      }
      rows.push({
        studentId: s.id,
        code: s.code,
        name: s.studentProfile?.name ?? s.displayName,
        attendance: { pct: att.pct, counts: att.counts },
        quizAvg,
        quizzesGraded: q?.length ?? 0,
        labsCleared: labsDone,
        labsTotal,
        xp: await this.game.totalXp(s.id),
        lastActive: last,
        performanceIndex: performanceIndex(parts, policy.piWeights),
        performanceParts: Object.keys(parts).filter((k) => parts[k as keyof typeof parts] !== null),
        flags,
        flagReasons,
      });
    }
    const avg = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x !== null);
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
    };
    return {
      batch: { id: batch.id, code: batch.code, name: batch.name },
      requiredAttendancePct: policy.attendanceMinPct,
      summary: {
        students: rows.length,
        attendanceAvg: avg(rows.map((r) => r.attendance.pct)),
        performanceAvg: avg(rows.map((r) => r.performanceIndex)),
        flagged: rows.filter((r) => r.flags.length).length,
      },
      students: rows,
      rules: {
        performanceIndex: `Weighted: attendance ${policy.piWeights.attendance} %, quiz average ${policy.piWeights.quiz} %, labs cleared ${policy.piWeights.labs} %. Parts without data are left out and the other weights scaled up.`,
        weights: policy.piWeights,
        inactiveDays: INACTIVE_DAYS,
        quizFlagPct: QUIZ_FLAG_PCT,
      },
    };
  }

  /** What needs the trainer today: counts only, each linking to its own list endpoint. */
  async trainerDashboard(trainerId: string) {
    const batches = await this.prisma.batch.findMany({
      where: this.trainerScope(trainerId),
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        _count: { select: { enrolments: { where: { status: 'active' } } } },
      },
      orderBy: { code: 'asc' },
    });
    const bIds = batches.map((b) => b.id);
    const studentIds = (
      await this.prisma.enrolment.findMany({
        where: { batchId: { in: bIds }, status: 'active' },
        select: { studentId: true },
      })
    ).map((e) => e.studentId);
    const now = new Date();
    const [leave, bookings, toGrade, unread, resumes, projects, milestones, today, outcomes, requests] =
      await Promise.all([
        this.prisma.leaveRequest.count({ where: { studentId: { in: studentIds }, status: 'pending' } }),
        this.prisma.sessionRequest.count({ where: { trainerId, status: 'pending' } }),
        this.prisma.attempt.count({
          where: { status: 'submitted', studentId: { in: studentIds }, assessment: { createdById: trainerId } },
        }),
        this.prisma.message.count({
          where: { readAt: null, senderId: { not: trainerId }, conversation: { staffId: trainerId } },
        }),
        this.prisma.resume.count({ where: { status: 'submitted', userId: { in: studentIds } } }),
        this.prisma.portfolioProject.count({ where: { status: 'submitted', userId: { in: studentIds } } }),
        this.prisma.studentMilestone.count({ where: { status: 'submitted', userId: { in: studentIds } } }),
        this.prisma.classSession.findMany({
          where: {
            batchId: { in: bIds },
            status: 'scheduled',
            startsAt: { gte: new Date(now.getTime() - 3 * 3600_000), lt: new Date(now.getTime() + DAY) },
          },
          orderBy: { startsAt: 'asc' },
          select: { id: true, title: true, type: true, startsAt: true, endsAt: true, batchId: true },
        }),
        // mentoring sessions that took place and still have no recorded outcome
        this.prisma.sessionRequest.count({
          where: {
            trainerId,
            purpose: { not: 'mock_interview' },
            status: { in: ['approved', 'completed'] },
            outcome: null,
            startsAt: { lt: now },
          },
        }),
        // requests this trainer raised that the admin has not resolved yet
        this.prisma.studentStaffRequest.count({ where: { raisedById: trainerId, status: 'open' } }),
      ]);
    return {
      batches: batches.map((b) => ({
        id: b.id,
        code: b.code,
        name: b.name,
        status: b.status,
        students: b._count.enrolments,
      })),
      pending: {
        leave,
        bookings,
        toGrade,
        unreadMessages: unread,
        placementReviews: resumes + projects + milestones,
        mentoringOutcomes: outcomes,
        openRequests: requests,
      },
      upcoming: today,
    };
  }

  /** Admin LMS dashboard tiles. */
  async adminDashboard() {
    const [students, batches, leave, toGrade, blogs, reports, placement] = await Promise.all([
      this.prisma.user.count({ where: { role: 'student', status: 'active' } }),
      this.prisma.batch.count({ where: { status: 'active' } }),
      this.prisma.leaveRequest.count({ where: { status: 'pending' } }),
      this.prisma.attempt.count({ where: { status: 'submitted' } }),
      this.prisma.blog.count({ where: { status: 'in_review' } }),
      this.prisma.contentReport.count({ where: { status: 'open' } }),
      Promise.all([
        this.prisma.resume.count({ where: { status: 'submitted' } }),
        this.prisma.portfolioProject.count({ where: { status: 'submitted' } }),
      ]).then(([a, b]) => a + b),
    ]);
    return {
      students,
      activeBatches: batches,
      pending: { leave, toGrade, blogsInReview: blogs, contentReports: reports, placementReviews: placement },
    };
  }
}
