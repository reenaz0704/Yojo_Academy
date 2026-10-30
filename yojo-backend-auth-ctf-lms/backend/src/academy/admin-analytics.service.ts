import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PAID_KEY } from '../entitlements/entitlement.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { LmsInsightsService } from './lms-insights.service';
import { MissionsService } from './missions.service';

const DAY = 86_400_000;
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : null);

/**
 * Admin LMS → Analytics, Insight Engine (rule-based) and the certificate register. Every figure is a count or an
 * average over stored records, returned with its definition; nothing is estimated or predicted. Insights are fixed
 * rules over the same records (not AI), each with its threshold and the records that triggered it.
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly insights: LmsInsightsService,
    private readonly missions: MissionsService,
  ) {}

  private async paidStudentIds() {
    const now = new Date();
    const [ents, subs] = await Promise.all([
      this.prisma.entitlement.findMany({
        where: {
          key: PAID_KEY,
          revokedAt: null,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
        select: { studentId: true },
      }),
      this.prisma.subscription.findMany({
        where: { status: 'active', startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        select: { studentId: true },
      }),
    ]);
    return new Set([...ents, ...subs].map((x) => x.studentId));
  }

  /** Latest chosen career path per student (else the older questionnaire's primary track). */
  private async pathCounts(studentIds: string[]) {
    const [career, older] = await Promise.all([
      this.prisma.$queryRaw<{ user_id: string; chosen_path: string | null; skipped: boolean }[]>`
        SELECT DISTINCT ON (user_id) user_id, chosen_path, skipped FROM career_path_results ORDER BY user_id, created_at DESC`,
      this.prisma.$queryRaw<{ user_id: string; primary: string }[]>`
        SELECT DISTINCT ON (user_id) user_id, "primary" FROM onboarding_results ORDER BY user_id, created_at DESC`,
    ]);
    const chosen = new Map(career.filter((c) => c.chosen_path).map((c) => [c.user_id, c.chosen_path!]));
    const legacy = new Map(older.map((o) => [o.user_id, o.primary]));
    const ids = new Set(studentIds);
    const counts: Record<string, number> = { Offensive: 0, Defensive: 0, GRC: 0, 'Not chosen': 0 };
    for (const id of ids) {
      const p = chosen.get(id) ?? legacy.get(id);
      counts[p && p in counts ? p : 'Not chosen']++;
    }
    const latest = career.filter((c) => ids.has(c.user_id));
    return {
      counts,
      quiz: {
        taken: latest.filter((c) => !c.skipped).length,
        skipped: latest.filter((c) => c.skipped).length,
        none: ids.size - latest.length,
      },
    };
  }

  async analytics() {
    const now = Date.now();
    const since7 = new Date(now - 7 * DAY);
    const since30 = new Date(now - 30 * DAY);
    const students = await this.prisma.user.findMany({
      where: { role: 'student', status: 'active' },
      select: { id: true, origin: true, createdAt: true },
    });
    const ids = students.map((s) => s.id);
    const [
      paid,
      paths,
      active7,
      xp7,
      streaks,
      coursesPublished,
      lessons30,
      certs,
      enrolments,
      attempts,
      labClears,
      batches,
      quizAvg,
    ] = await Promise.all([
      this.paidStudentIds(),
      this.pathCounts(ids),
      this.prisma.studentActivity.findMany({
        where: { at: { gte: since7 } },
        distinct: ['userId'],
        select: { userId: true },
      }),
      this.prisma.xpLedger.aggregate({
        where: { createdAt: { gte: since7 }, delta: { gt: 0 } },
        _sum: { delta: true },
      }),
      this.prisma.streakState.count({ where: { current: { gt: 0 } } }),
      this.prisma.course.count({ where: { status: 'published' } }),
      this.prisma.lessonProgress.count({ where: { completedAt: { gte: since30 } } }),
      this.prisma.certificate.count({ where: { revokedAt: null } }),
      this.prisma.enrolment.count({ where: { status: 'active' } }),
      this.prisma.assessment.findMany({
        where: { status: { in: ['published', 'closed'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          title: true,
          passMarks: true,
          attempts: { where: { status: { not: 'in_progress' } }, select: { status: true, score: true } },
        },
      }),
      this.prisma.missionAttempt.groupBy({
        by: ['missionCode'],
        where: { status: 'completed' },
        _count: { _all: true },
      }),
      this.prisma.batch.findMany({
        where: { status: 'active' },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.prisma.careerPathResult.aggregate({
        where: { skipped: false },
        _avg: { offensivePct: true, defensivePct: true, grcPct: true },
      }),
    ]);
    const cohorts = [];
    for (const b of batches) {
      const o = await this.insights.batchOverview(b.id);
      cohorts.push({ batch: o.batch.code, name: o.batch.name, ...o.summary });
    }
    const byOrigin: Record<string, number> = {};
    for (const s of students) byOrigin[s.origin] = (byOrigin[s.origin] ?? 0) + 1;
    return {
      generatedAt: new Date(),
      students: {
        total: students.length,
        paid: ids.filter((i) => paid.has(i)).length,
        free: ids.filter((i) => !paid.has(i)).length,
        newLast30Days: students.filter((s) => s.createdAt >= since30).length,
        byOrigin,
      },
      paths: paths.counts,
      careerQuiz: {
        ...paths.quiz,
        averagePercentages: {
          Offensive: quizAvg._avg.offensivePct === null ? null : Math.round(quizAvg._avg.offensivePct),
          Defensive: quizAvg._avg.defensivePct === null ? null : Math.round(quizAvg._avg.defensivePct),
          GRC: quizAvg._avg.grcPct === null ? null : Math.round(quizAvg._avg.grcPct),
        },
      },
      engagement: {
        activeLast7Days: active7.length,
        xpAwardedLast7Days: xp7._sum.delta ?? 0,
        studentsWithStreak: streaks,
      },
      learning: {
        coursesPublished,
        activeEnrolments: enrolments,
        lessonsCompletedLast30Days: lessons30,
        certificatesValid: certs,
      },
      assessments: attempts.map((a) => {
        const graded = a.attempts.filter((x) => x.status === 'graded' && x.score !== null);
        return {
          id: a.id,
          title: a.title,
          submissions: a.attempts.length,
          graded: graded.length,
          passRate: pct(graded.filter((x) => (x.score ?? 0) >= a.passMarks).length, graded.length),
        };
      }),
      labs: labClears.map((l) => ({ code: l.missionCode, clears: l._count._all })).sort((a, b) => b.clears - a.clears),
      cohorts,
      definitions: {
        students: 'Active student accounts. Paid = a live plan:paid entitlement or an active subscription.',
        paths: 'Latest chosen career path; older accounts use the 18-question questionnaire result.',
        careerQuiz: 'Latest career-path record per student: taken, skipped (picked a path without the quiz) or none.',
        activeLast7Days:
          'Students with a recorded learning activity (lesson, lab, blog read, quiz pass) in the last 7 days.',
        xpAwardedLast7Days: 'Sum of positive XP ledger entries in the last 7 days (penalties not subtracted).',
        assessments:
          'Last 10 published or closed assessments. Pass rate = graded attempts at or above pass marks ÷ graded attempts.',
        labs: 'Completed mission attempts per mission (verified by the server).',
        cohorts: 'The 30 most recent active batches: attendance and performance as in the batch overview.',
      },
    };
  }

  /** Fixed rules over stored records. Each insight says what triggered it; none is a prediction. */
  async insightRules() {
    const now = Date.now();
    const policy = (await this.settings.get('policy')).value;
    // The 30 most recent active batches (each overview reads every student's attendance).
    const batches = await this.prisma.batch.findMany({
      where: { status: 'active' },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    const flagged: { rule: string; studentId: string; name: string | null; batch: string; detail: string }[] = [];
    for (const b of batches) {
      const o = await this.insights.batchOverview(b.id);
      for (const s of o.students)
        for (const f of s.flags)
          flagged.push({
            rule: f,
            studentId: s.studentId,
            name: s.name,
            batch: o.batch.code,
            detail:
              f === 'Low attendance'
                ? `${s.attendance.pct}% attendance`
                : f === 'Falling behind'
                  ? `quiz average ${s.quizAvg}%`
                  : `last active ${s.lastActive ? new Date(s.lastActive).toISOString().slice(0, 10) : 'never'}`,
          });
    }
    const [backlog, assessments, stalled, blogs, reports, leave, offline] = await Promise.all([
      this.prisma.attempt.findMany({
        where: { status: 'submitted', submittedAt: { lt: new Date(now - 3 * DAY) } },
        select: { id: true, submittedAt: true, assessment: { select: { id: true, title: true } } },
        take: 200,
      }),
      this.prisma.assessment.findMany({
        where: { status: { in: ['published', 'closed'] } },
        select: {
          id: true,
          title: true,
          passMarks: true,
          attempts: { where: { status: 'graded' }, select: { score: true } },
        },
      }),
      this.prisma.$queryRaw<{ student_id: string; code: string; title: string; since: Date }[]>`
        SELECT e.student_id, b.code, c.title, e.created_at AS since
        FROM enrolments e JOIN batches b ON b.id = e.batch_id JOIN courses c ON c.id = b.course_id
        WHERE e.status = 'active' AND b.status = 'active' AND e.created_at < now() - interval '14 days'
          AND NOT EXISTS (SELECT 1 FROM lesson_progress p WHERE p.user_id = e.student_id AND p.course_id = c.id AND p.completed_at IS NOT NULL)
        LIMIT 200`,
      this.prisma.blog.findMany({
        where: { status: 'in_review', submittedAt: { lt: new Date(now - 2 * DAY) } },
        select: { id: true, title: true, submittedAt: true },
      }),
      this.prisma.contentReport.count({ where: { status: 'open' } }),
      this.prisma.leaveRequest.count({ where: { status: 'pending', createdAt: { lt: new Date(now - 2 * DAY) } } }),
      this.missions
        .providerAvailable()
        .then(
          async (ok) =>
            !ok &&
            (await this.prisma.mission.count({ where: { status: 'published', provider: { not: 'native' } } })) > 0,
        ),
    ]);
    const names = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: stalled.map((s) => s.student_id) } },
          select: { id: true, studentProfile: { select: { name: true } } },
        })
      ).map((u) => [u.id, u.studentProfile?.name ?? null]),
    );
    const byAssessment = new Map<string, { title: string; n: number }>();
    for (const a of backlog) {
      const x = byAssessment.get(a.assessment.id) ?? { title: a.assessment.title, n: 0 };
      byAssessment.set(a.assessment.id, { ...x, n: x.n + 1 });
    }
    const lowPass = assessments
      .filter((a) => a.attempts.length >= 5)
      .map((a) => ({
        id: a.id,
        title: a.title,
        graded: a.attempts.length,
        rate: pct(a.attempts.filter((x) => (x.score ?? 0) >= a.passMarks).length, a.attempts.length)!,
      }))
      .filter((a) => a.rate < 50);
    const rule = (
      id: string,
      label: string,
      definition: string,
      severity: 'High' | 'Medium' | 'Low',
      items: { label: string; detail: string; link?: string }[],
    ) => ({ id, label, definition, severity, count: items.length, items: items.slice(0, 25) });
    const of = (r: string) =>
      flagged
        .filter((f) => f.rule === r)
        .map((f) => ({
          label: `${f.name ?? 'Student'} · ${f.batch}`,
          detail: f.detail,
          link: `#/admin/reports/${f.studentId}`,
        }));
    const list = [
      rule(
        'low_attendance',
        'Students below the attendance requirement',
        `Attendance under ${policy.attendanceMinPct}% (present or late ÷ marked sessions that count), in the 30 most recent active batches.`,
        'High',
        of('Low attendance'),
      ),
      rule(
        'grading_backlog',
        'Submissions waiting more than 3 days for a grade',
        'Attempts in status submitted for over 3 days.',
        'High',
        [...byAssessment].map(([id, x]) => ({
          label: x.title,
          detail: `${x.n} waiting`,
          link: `#/admin/assessments/${id}`,
        })),
      ),
      rule(
        'inactive',
        'Students inactive for 7 days',
        'No learning activity and no sign-in in the last 7 days (students in active batches).',
        'Medium',
        of('Inactive'),
      ),
      rule(
        'falling_behind',
        'Students with a low quiz average',
        'Quiz average under 40% across graded attempts.',
        'Medium',
        of('Falling behind'),
      ),
      rule(
        'stalled_course',
        'Enrolled 14+ days with no lesson completed',
        'Active enrolment in a batch with a course, older than 14 days, and no completed lesson in that course.',
        'Medium',
        stalled.map((s) => ({
          label: `${names.get(s.student_id) ?? 'Student'} · ${s.code}`,
          detail: s.title,
          link: `#/admin/reports/${s.student_id}`,
        })),
      ),
      rule(
        'low_pass_rate',
        'Assessments with a pass rate under 50%',
        'At least 5 graded attempts and fewer than half at or above pass marks.',
        'Low',
        lowPass.map((a) => ({
          label: a.title,
          detail: `${a.rate}% of ${a.graded} graded`,
          link: `#/admin/assessments/${a.id}`,
        })),
      ),
      rule(
        'review_queue',
        'Blogs waiting more than 2 days for review',
        'Blogs in review, sent over 2 days ago.',
        'Low',
        blogs.map((b) => ({ label: b.title, detail: `sent ${b.submittedAt?.toISOString().slice(0, 10)}` })),
      ),
      rule(
        'open_reports',
        'Open content reports',
        'Reports from students on blogs or comments not yet resolved.',
        'Low',
        reports ? [{ label: `${reports} open`, detail: 'Admin LMS → blog moderation' }] : [],
      ),
      rule(
        'pending_leave',
        'Leave requests pending more than 2 days',
        'Leave requests not yet decided by the trainer, older than 2 days.',
        'Low',
        leave ? [{ label: `${leave} pending`, detail: 'Trainers decide leave in their console' }] : [],
      ),
      rule(
        'mission_service',
        'Mission service offline',
        'Published missions run in the separate mission service, which is not linked to the Academy server (OPEN-ITEMS OI-43).',
        'Medium',
        offline
          ? [{ label: 'Missions cannot be started from the Academy', detail: 'Students see "Mission service offline"' }]
          : [],
      ),
    ];
    return {
      generatedAt: new Date(),
      kind: 'rule-based',
      note: 'Fixed rules over stored records. Not AI and not a prediction.',
      insights: list,
    };
  }

  async certificates(q: { q?: string; status?: 'valid' | 'revoked'; courseId?: string }) {
    let userIds: string[] | undefined;
    if (q.q && !/^[A-Z0-9-]{6,}$/i.test(q.q)) {
      userIds = (
        await this.prisma.user.findMany({
          where: {
            role: 'student',
            OR: [
              { email: { contains: q.q, mode: 'insensitive' } },
              { studentProfile: { name: { contains: q.q, mode: 'insensitive' } } },
            ],
          },
          select: { id: true },
          take: 200,
        })
      ).map((u) => u.id);
    }
    const where: Prisma.CertificateWhereInput = {
      ...(q.status === 'valid' ? { revokedAt: null } : q.status === 'revoked' ? { revokedAt: { not: null } } : {}),
      ...(q.courseId ? { courseId: q.courseId } : {}),
      ...(userIds ? { userId: { in: userIds } } : q.q ? { code: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const rows = await this.prisma.certificate.findMany({
      where,
      orderBy: { issuedAt: 'desc' },
      take: 200,
      include: { course: { select: { title: true } } },
    });
    const people = new Map(
      (
        await this.prisma.user.findMany({
          where: {
            id: {
              in: [
                ...new Set(
                  rows.flatMap((r) => [r.userId, r.issuedById, r.revokedById].filter((x): x is string => !!x)),
                ),
              ],
            },
          },
          select: {
            id: true,
            email: true,
            displayName: true,
            studentProfile: { select: { name: true } },
            staffProfile: { select: { displayName: true } },
          },
        })
      ).map((u) => [
        u.id,
        { name: u.studentProfile?.name ?? u.staffProfile?.displayName ?? u.displayName ?? null, email: u.email },
      ]),
    );
    return rows.map((r) => ({
      code: r.code,
      course: r.course.title,
      courseId: r.courseId,
      student: { id: r.userId, ...(people.get(r.userId) ?? { name: null, email: null }) },
      issuedAt: r.issuedAt,
      issuedBy: people.get(r.issuedById)?.name ?? people.get(r.issuedById)?.email ?? null,
      revokedAt: r.revokedAt,
      revokedBy: r.revokedById ? (people.get(r.revokedById)?.name ?? people.get(r.revokedById)?.email ?? null) : null,
      revokeReason: r.revokeReason,
    }));
  }
}
