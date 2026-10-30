import { Injectable } from '@nestjs/common';
import { Prisma, type Course } from '@prisma/client';
import { AppError, Errors } from '../common/errors/app-error';
import { EntitlementService, PAID_KEY } from '../entitlements/entitlement.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { GamificationService } from './gamification.service';

export type AccessState = 'enrolled' | 'free' | 'locked';
export type PendingReason = 'payment' | 'batch_assignment' | 'approval' | 'prerequisite' | null;
export const COURSE_FILTERS = [
  'all',
  'featured',
  'trending',
  'beginner',
  'hands_on',
  'free',
  'paid',
  'recent',
] as const;
export type CourseFilter = (typeof COURSE_FILTERS)[number];
const RECENT_DAYS = 30;

const publicLessonSelect = {
  id: true,
  title: true,
  type: true,
  preview: true,
  required: true,
  durationMin: true,
  sortOrder: true,
  completion: true,
} satisfies Prisma.LessonSelect;

const courseInclude = {
  modules: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      title: true,
      sortOrder: true,
      lessons: { where: { status: 'published' }, orderBy: { sortOrder: 'asc' }, select: publicLessonSelect },
    },
  },
  faqs: { where: { published: true }, orderBy: { sortOrder: 'asc' }, select: { question: true, answer: true } },
  batches: {
    where: { status: { in: ['planned', 'active'] } },
    select: { trainer: { select: { displayName: true } } },
    take: 1,
  },
} satisfies Prisma.CourseInclude;
type CourseFull = Prisma.CourseGetPayload<{ include: typeof courseInclude }>;

/**
 * Cyber Arsenal: catalog, access, lessons, progress and certificates (docs/ACADEMY-INVENTORY.md, slice b).
 * Access rule (same as the prototype): a free course is open to every signed-in student; a paid course opens only
 * with an active enrolment in a batch that runs it plus paid access (entitlement plan:paid or course:<code>).
 * A paid plan alone never opens every course.
 */
@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
    private readonly game: GamificationService,
    private readonly storage: StorageService,
  ) {}

  // ───────────── catalog (public) ─────────────

  async catalog(q: { category?: string; filter?: CourseFilter; q?: string; limit?: number; cursor?: string }) {
    const where: Prisma.CourseWhereInput = { status: 'published' };
    const and: Prisma.CourseWhereInput[] = [];
    if (q.category) and.push({ category: q.category });
    if (q.q)
      and.push({
        OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { summary: { contains: q.q, mode: 'insensitive' } }],
      });
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
    switch (q.filter) {
      case 'featured':
        and.push({ featured: true });
        break;
      case 'beginner':
        and.push({ level: { equals: 'Beginner', mode: 'insensitive' } });
        break;
      case 'hands_on':
        and.push({ OR: [{ labs: { isEmpty: false } }, { lessons: { some: { status: 'published', type: 'lab' } } }] });
        break;
      case 'free':
        and.push({ access: 'free' });
        break;
      case 'paid':
        and.push({ access: 'paid' });
        break;
      case 'recent':
        and.push({ publishedAt: { gte: since } });
        break;
    }
    if (and.length) where.AND = and;
    let rows = await this.prisma.course.findMany({
      where,
      include: courseInclude,
      orderBy: [{ featured: 'desc' }, { title: 'asc' }],
      take: 200,
    });
    // Trending = courses with new enrolments in the last 30 days, most first (no invented popularity).
    const counts = await this.newEnrolments(since);
    if (q.filter === 'trending')
      rows = rows
        .filter((c) => (counts.get(c.id) ?? 0) > 0)
        .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
    const offset = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString()) || 0 : 0;
    const limit = Math.min(q.limit ?? 24, 50);
    const page = rows.slice(offset, offset + limit);
    return {
      total: rows.length,
      items: page.map((c) => this.publicCard(c)),
      nextCursor: offset + limit < rows.length ? Buffer.from(String(offset + limit)).toString('base64url') : null,
      definitions: {
        trending: `new enrolments in the last ${RECENT_DAYS} days`,
        recent: `published in the last ${RECENT_DAYS} days`,
      },
    };
  }

  async categories() {
    const rows = await this.prisma.course.groupBy({
      by: ['category'],
      where: { status: 'published' },
      _count: { _all: true },
      orderBy: { category: 'asc' },
    });
    return rows.map((r) => ({ category: r.category, courses: r._count._all }));
  }

  async publicDetail(slug: string) {
    const c = await this.prisma.course.findFirst({ where: { slug, status: 'published' }, include: courseInclude });
    if (!c) throw Errors.notFound('This course is not available.');
    return this.publicDetailOf(c);
  }

  private async newEnrolments(since: Date) {
    const rows = await this.prisma.$queryRaw<{ course_id: string; n: number }[]>`
      SELECT b.course_id, COUNT(*)::int AS n FROM enrolments e JOIN batches b ON b.id = e.batch_id
      WHERE b.course_id IS NOT NULL AND e.created_at >= ${since} GROUP BY b.course_id`;
    return new Map(rows.map((r) => [r.course_id, r.n]));
  }

  private publicCard(c: CourseFull) {
    const lessons = c.modules.flatMap((m) => m.lessons);
    return {
      id: c.id,
      code: c.code,
      slug: c.slug,
      title: c.title,
      summary: c.summary,
      category: c.category,
      level: c.level,
      duration: c.duration,
      format: c.format,
      access: c.access,
      featured: c.featured,
      imageUrl: c.imageUrl,
      pricePaise: c.access === 'paid' ? c.pricePaise : 0,
      certificate: c.certificate,
      hasLabs: c.labs.length > 0 || lessons.some((l) => l.type === 'lab'),
      moduleCount: c.modules.length,
      lessonCount: lessons.length,
      trainer: c.batches[0]?.trainer?.displayName ?? null,
      publishedAt: c.publishedAt,
    };
  }

  private publicDetailOf(c: CourseFull) {
    return {
      ...this.publicCard(c),
      overview: c.overview || c.summary,
      outcomes: c.outcomes,
      prerequisites: c.prerequisites,
      audience: c.audience,
      labs: c.labs.length
        ? c.labs
        : c.modules
            .flatMap((m) => m.lessons)
            .filter((l) => l.type === 'lab')
            .map((l) => l.title),
      modules: c.modules.map((m) => ({
        id: m.id,
        title: m.title,
        lessons: m.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          type: l.type,
          preview: l.preview,
          durationMin: l.durationMin,
        })),
      })),
      faqs: c.faqs,
    };
  }

  // ───────────── access ─────────────

  /** Access state and, for locked courses, the one reason that blocks it (in the order a student would fix them). */
  async accessFor(userId: string, course: Pick<Course, 'id' | 'code' | 'title' | 'access' | 'prerequisiteCourseId'>) {
    const [enrolled, paid, coursePass] = await Promise.all([
      this.prisma.enrolment.count({
        where: {
          studentId: userId,
          status: 'active',
          batch: { courseId: course.id, status: { in: ['planned', 'active'] } },
        },
      }),
      this.entitlements.has(userId, PAID_KEY),
      this.entitlements.has(userId, `course:${course.code}`),
    ]);
    const paidAccess = paid || coursePass;
    if (course.access === 'free')
      return {
        state: (enrolled ? 'enrolled' : 'free') as AccessState,
        pendingReason: null as PendingReason,
        paidAccess,
      };
    if (enrolled && paidAccess)
      return { state: 'enrolled' as AccessState, pendingReason: null as PendingReason, paidAccess };
    let reason: PendingReason;
    if (course.prerequisiteCourseId && !(await this.isComplete(userId, course.prerequisiteCourseId)))
      reason = 'prerequisite';
    else if (!paidAccess) reason = 'payment';
    else if (
      await this.prisma.publicSubmission.count({
        where: {
          userId,
          type: 'course_enrolment',
          topic: course.title,
          status: { in: ['new', 'reviewing', 'assigned', 'in_progress', 'waiting_for_user'] },
        },
      })
    )
      reason = 'approval';
    else reason = 'batch_assignment';
    return { state: 'locked' as AccessState, pendingReason: reason, paidAccess };
  }

  // ───────────── student ─────────────

  /** Every published course with the student's state and progress. view: mine (open and started), pending, all. */
  async forStudent(userId: string, view: 'all' | 'mine' | 'pending' = 'all') {
    const courses = await this.prisma.course.findMany({
      where: { status: 'published' },
      include: courseInclude,
      orderBy: [{ featured: 'desc' }, { title: 'asc' }],
    });
    const done = await this.completedLessons(userId);
    const out = [];
    for (const c of courses) {
      const a = await this.accessFor(userId, c);
      const p = this.progressOf(c, done);
      const item = { ...this.publicCard(c), state: a.state, pendingReason: a.pendingReason, progress: p };
      if (view === 'mine' && !(a.state === 'enrolled' || (a.state === 'free' && p.done > 0))) continue;
      if (view === 'pending' && a.state !== 'locked') continue;
      out.push(item);
    }
    return { plan: (await this.entitlements.has(userId, PAID_KEY)) ? 'paid' : 'free', items: out };
  }

  async studentDetail(userId: string, slug: string) {
    const c = await this.prisma.course.findFirst({ where: { slug, status: 'published' }, include: courseInclude });
    if (!c) throw Errors.notFound('This course is not available.');
    const a = await this.accessFor(userId, c);
    const done = await this.completedLessons(userId);
    const open = a.state !== 'locked';
    const cert = await this.prisma.certificate.findFirst({
      where: { userId, courseId: c.id, revokedAt: null },
      select: { code: true, issuedAt: true },
    });
    const p = this.progressOf(c, done);
    return {
      ...this.publicDetailOf(c),
      state: a.state,
      pendingReason: a.pendingReason,
      progress: p,
      modules: c.modules.map((m) => ({
        id: m.id,
        title: m.title,
        done: m.lessons.length > 0 && m.lessons.every((l) => done.has(l.id)),
        lessons: m.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          type: l.type,
          preview: l.preview,
          durationMin: l.durationMin,
          open: open || l.preview,
          done: done.has(l.id),
          completion: l.completion,
        })),
      })),
      certificate: c.certificate
        ? {
            name: c.certificate,
            eligible: p.complete,
            issued: cert ? { code: cert.code, issuedAt: cert.issuedAt } : null,
          }
        : null,
    };
  }

  /** The only call that returns lesson content. Records that the student opened it (needed before manual completion). */
  async openLesson(userId: string, lessonId: string) {
    const l = await this.lessonWithCourse(lessonId);
    const a = await this.accessFor(userId, l.course);
    if (a.state === 'locked' && !l.preview)
      throw new AppError(
        403,
        'COURSE_LOCKED',
        l.course.access === 'paid' ? 'This lesson opens after you enrol in this course.' : 'Not available.',
        {
          details: { pendingReason: a.pendingReason },
        },
      );
    if (l.releaseAt && l.releaseAt > new Date())
      throw new AppError(403, 'NOT_RELEASED', `This lesson opens on ${l.releaseAt.toISOString().slice(0, 10)}.`);
    const now = new Date();
    await this.prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      // Times come from the app clock (not the database default) so started/completed always compare correctly.
      create: { userId, lessonId, courseId: l.courseId, startedAt: now, lastAccessAt: now },
      update: { lastAccessAt: now },
    });
    return {
      id: l.id,
      courseId: l.courseId,
      title: l.title,
      type: l.type,
      contentUrl: l.contentUrl,
      body: l.body,
      durationMin: l.durationMin,
      completion: l.completion,
      // An uploaded file goes out only through GET /files/:id (checked again there); with no storage driver the
      // lesson says so instead of showing a dead link (OI-45).
      file: l.fileName
        ? {
            name: l.fileName,
            sizeMb: l.fileSizeMb ? Number(l.fileSizeMb) : null,
            downloadable: l.downloadable,
            available: !!l.fileKey && this.storage.available,
            url: l.fileKey && this.storage.available ? `/files/${l.fileKey}` : null,
            reason: l.fileKey && this.storage.available ? null : 'STORAGE_NOT_CONFIGURED',
          }
        : null,
    };
  }

  /**
   * Marks a lesson complete under its completion rule: manual lessons must have been opened; quiz and lab lessons
   * need the verified result (student_activity quiz_passed / lab_completed for the lesson's ref code).
   */
  async completeLesson(userId: string, lessonId: string) {
    const l = await this.lessonWithCourse(lessonId);
    const a = await this.accessFor(userId, l.course);
    if (a.state === 'locked')
      throw new AppError(403, 'COURSE_LOCKED', 'Enrol in this course to record progress.', {
        details: { pendingReason: a.pendingReason },
      });
    const prog = await this.prisma.lessonProgress.findUnique({ where: { userId_lessonId: { userId, lessonId } } });
    if (prog?.completedAt)
      return { lessonId, completed: true, alreadyDone: true, course: await this.courseProgress(userId, l.courseId) };
    if (l.completion === 'manual' && !prog)
      throw new AppError(409, 'OPEN_FIRST', 'Open the lesson before marking it complete.');
    if (l.completion !== 'manual') {
      const kind = l.completion === 'quiz_pass' ? 'quiz_passed' : 'lab_completed';
      const ok = await this.prisma.studentActivity.count({ where: { userId, kind, refId: l.refCode! } });
      if (!ok)
        throw new AppError(
          409,
          'NEEDS_VERIFIED_RESULT',
          l.completion === 'quiz_pass'
            ? 'Pass the quiz to complete this lesson.'
            : 'Clear the lab to complete this lesson.',
        );
    }
    const now = new Date();
    await this.prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: { userId, lessonId, courseId: l.courseId, startedAt: now, lastAccessAt: now, completedAt: now },
      update: { completedAt: now, lastAccessAt: now },
    });
    await this.game.recordActivity(userId, 'lesson_completed', lessonId, { category: l.course.category });
    await this.game.afterChange(userId);
    return { lessonId, completed: true, alreadyDone: false, course: await this.courseProgress(userId, l.courseId) };
  }

  async courseProgress(userId: string, courseId: string) {
    const c = await this.prisma.course.findUnique({ where: { id: courseId }, include: courseInclude });
    if (!c || c.status !== 'published') throw Errors.notFound('This course is not available.');
    const a = await this.accessFor(userId, c);
    if (a.state === 'locked') throw new AppError(403, 'COURSE_LOCKED', 'Enrol in this course to see progress.');
    const last = await this.prisma.lessonProgress.findFirst({
      where: { userId, courseId },
      orderBy: { lastAccessAt: 'desc' },
      select: { lessonId: true, lastAccessAt: true },
    });
    return { courseId, ...this.progressOf(c, await this.completedLessons(userId)), lastLesson: last };
  }

  /** Completed paid courses: the "Campaigns won" tile. */
  async campaignsWon(userId: string) {
    const courses = await this.prisma.course.findMany({
      where: { status: 'published', access: 'paid' },
      include: courseInclude,
    });
    const done = await this.completedLessons(userId);
    return courses.filter((c) => this.progressOf(c, done).complete).length;
  }

  async certificates(userId: string) {
    return this.prisma.certificate.findMany({
      where: { userId },
      orderBy: { issuedAt: 'desc' },
      select: { code: true, issuedAt: true, revokedAt: true, course: { select: { title: true, slug: true } } },
    });
  }

  /** Public certificate check: holder's display name, course, date and whether it is still valid. */
  async verifyCertificate(code: string) {
    const c = await this.prisma.certificate.findUnique({
      where: { code },
      select: { code: true, issuedAt: true, revokedAt: true, userId: true, course: { select: { title: true } } },
    });
    if (!c) throw Errors.notFound('No certificate with that code.');
    const u = await this.prisma.user.findUnique({
      where: { id: c.userId },
      select: { displayName: true, studentProfile: { select: { name: true } } },
    });
    return {
      code: c.code,
      course: c.course.title,
      holder: u?.studentProfile?.name ?? u?.displayName ?? 'Yojo learner',
      issuedAt: c.issuedAt,
      valid: !c.revokedAt,
      revokedAt: c.revokedAt,
    };
  }

  /** Eligibility for a certificate: the course offers one and every required published lesson is complete. */
  async eligibility(userId: string, courseId: string) {
    const c = await this.prisma.course.findUnique({ where: { id: courseId }, include: courseInclude });
    if (!c) throw Errors.notFound('No course with that ID.');
    const p = this.progressOf(c, await this.completedLessons(userId));
    return { offers: !!c.certificate, complete: p.complete, eligible: !!c.certificate && p.complete, progress: p };
  }

  // ───────────── helpers ─────────────

  /** A student may fetch an uploaded file only through a published lesson of a published course they can open. */
  async canOpenFile(userId: string, fileId: string) {
    const lessons = await this.prisma.lesson.findMany({
      where: { fileKey: fileId, status: 'published', course: { status: 'published' } },
      include: { course: true },
    });
    for (const l of lessons) {
      if (l.releaseAt && l.releaseAt > new Date()) continue;
      if (l.preview || (await this.accessFor(userId, l.course)).state !== 'locked') return true;
    }
    return false;
  }

  private async lessonWithCourse(lessonId: string) {
    const l = await this.prisma.lesson.findUnique({ where: { id: lessonId }, include: { course: true } });
    if (!l || l.status !== 'published' || l.course.status !== 'published') throw Errors.notFound('Lesson not found.');
    return l;
  }

  async completedLessons(userId: string) {
    const rows = await this.prisma.lessonProgress.findMany({
      where: { userId, completedAt: { not: null } },
      select: { lessonId: true },
    });
    return new Set(rows.map((r) => r.lessonId));
  }

  async isComplete(userId: string, courseId: string) {
    const c = await this.prisma.course.findUnique({ where: { id: courseId }, include: courseInclude });
    return !!c && this.progressOf(c, await this.completedLessons(userId)).complete;
  }

  private progressOf(c: CourseFull, done: Set<string>) {
    const lessons = c.modules.flatMap((m) => m.lessons);
    const required = lessons.filter((l) => l.required);
    const doneCount = lessons.filter((l) => done.has(l.id)).length;
    const reqDone = required.filter((l) => done.has(l.id)).length;
    const mods = c.modules.map((m) => ({
      title: m.title,
      done: m.lessons.length > 0 && m.lessons.every((l) => done.has(l.id)),
    }));
    const next = lessons.find((l) => !done.has(l.id));
    return {
      done: doneCount,
      total: lessons.length,
      pct: lessons.length ? Math.round((100 * doneCount) / lessons.length) : 0,
      requiredDone: reqDone,
      requiredTotal: required.length,
      complete: required.length > 0 && reqDone === required.length,
      completedModules: mods.filter((m) => m.done).map((m) => m.title),
      pendingModules: mods.filter((m) => !m.done).map((m) => m.title),
      nextLesson: next ? { id: next.id, title: next.title } : null,
    };
  }
}
