import { Injectable } from '@nestjs/common';
import { Prisma, type CourseStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors/app-error';
import type { RequestMeta } from '../identity/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  CHANGE_REASON_LABELS,
  type ChangeReasonCode,
  type CourseDto,
  type CoursePatchDto,
  type FaqDto,
  type LessonDto,
  type LessonPatchDto,
  type ModuleDto,
} from './courses.dto';
import { CoursesService } from './courses.service';
import { NotificationsService } from './notifications.service';

/** `role: 'trainer'` marks an edit made from the trainer console (scope checked by TrainerCoursesService). */
export type Actor = RequestMeta & { userId: string; role?: 'admin' | 'trainer' };
/** The reason a trainer gave for an edit or delete (OI-48); stored in the audit row. */
export type ChangeWhy = { reasonCode: ChangeReasonCode; reasonNote?: string };
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Admin LMS → courses (permission `courses`): drafts, publication, modules, lessons, FAQs and certificates.
 * Students only ever see published courses and published lessons; every change is audited.
 */
@Injectable()
export class CoursesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly courses: CoursesService,
    private readonly notes: NotificationsService,
  ) {}

  list(status?: CourseStatus) {
    return this.prisma.course.findMany({
      where: status ? { status } : {},
      orderBy: [{ status: 'asc' }, { title: 'asc' }],
      select: {
        id: true,
        code: true,
        slug: true,
        title: true,
        category: true,
        access: true,
        status: true,
        version: true,
        featured: true,
        updatedAt: true,
        _count: { select: { lessons: true, batches: true, certificates: true } },
      },
    });
  }

  async get(id: string) {
    const c = await this.prisma.course.findUnique({
      where: { id },
      include: {
        modules: { orderBy: { sortOrder: 'asc' }, include: { lessons: { orderBy: { sortOrder: 'asc' } } } },
        faqs: { orderBy: { sortOrder: 'asc' } },
        batches: { select: { id: true, code: true, name: true, status: true } },
      },
    });
    if (!c) throw Errors.notFound('No course with that ID.');
    return c;
  }

  async create(dto: CourseDto, actor: Actor) {
    try {
      const c = await this.prisma.course.create({
        data: {
          ...this.fields(dto),
          code: dto.code,
          slug: dto.slug,
          title: dto.title,
          category: dto.category,
          ownerId: actor.userId,
        },
      });
      await this.log('admin.course.created', 'course', c.id, actor, { code: c.code });
      return c;
    } catch (e) {
      if (isUnique(e)) throw Errors.conflict('COURSE_EXISTS', 'A course with this code or address already exists.');
      throw e;
    }
  }

  async patch(id: string, dto: CoursePatchDto, actor: Actor) {
    await this.get(id);
    if (dto.prerequisiteCourseId === id)
      throw Errors.validation('A course cannot be its own prerequisite.', 'prerequisiteCourseId');
    try {
      const c = await this.prisma.course.update({
        where: { id },
        data: {
          ...this.fields(dto),
          ...(dto.slug ? { slug: dto.slug } : {}),
          ...(dto.title ? { title: dto.title } : {}),
          ...(dto.category ? { category: dto.category } : {}),
          version: { increment: 1 },
        },
      });
      await this.log('admin.course.updated', 'course', id, actor, { fields: Object.keys(dto) });
      return c;
    } catch (e) {
      if (isUnique(e)) throw Errors.conflict('COURSE_EXISTS', 'Another course already uses this address.');
      throw e;
    }
  }

  async setStatus(id: string, status: CourseStatus, actor: Actor) {
    const c = await this.get(id);
    if (
      status === 'published' &&
      !c.modules.some((m) => m.lessons.some((l) => l.status === 'published')) &&
      !c.labs.length &&
      !c.summary
    )
      throw new AppError(409, 'NOT_PUBLISHABLE', 'Add a summary or at least one published lesson before publishing.');
    const u = await this.prisma.course.update({
      where: { id },
      data: {
        status,
        ...(status === 'published' && !c.publishedAt ? { publishedAt: new Date() } : {}),
        version: { increment: 1 },
      },
    });
    await this.log(`admin.course.${status}`, 'course', id, actor, { from: c.status });
    return u;
  }

  async addModule(courseId: string, dto: ModuleDto, actor: Actor) {
    await this.get(courseId);
    const m = await this.prisma.courseModule.create({
      data: { courseId, title: dto.title, sortOrder: dto.sortOrder ?? 0 },
    });
    await this.log('admin.course.module_added', 'course', courseId, actor, { moduleId: m.id });
    return m;
  }

  async patchModule(id: string, dto: Partial<ModuleDto>, actor: Actor, why?: ChangeWhy) {
    const m = await this.prisma.courseModule
      .update({
        where: { id },
        data: {
          ...(dto.title ? { title: dto.title } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
      })
      .catch(() => {
        throw Errors.notFound('No module with that ID.');
      });
    await this.log('admin.course.module_updated', 'course', m.courseId, actor, { moduleId: id }, why);
    return m;
  }

  /** A module can be removed only while no student has progress in it (history is never deleted silently). */
  async deleteModule(id: string, actor: Actor, why?: ChangeWhy) {
    const m = await this.prisma.courseModule.findUnique({
      where: { id },
      select: { courseId: true, lessons: { select: { id: true } } },
    });
    if (!m) throw Errors.notFound('No module with that ID.');
    if (await this.prisma.lessonProgress.count({ where: { lessonId: { in: m.lessons.map((l) => l.id) } } }))
      throw new AppError(409, 'HAS_PROGRESS', 'Students have progress in this module. Unpublish its lessons instead.');
    await this.prisma.courseModule.delete({ where: { id } });
    await this.log('admin.course.module_deleted', 'course', m.courseId, actor, { moduleId: id }, why);
  }

  async addLesson(moduleId: string, dto: LessonDto, actor: Actor) {
    const m = await this.prisma.courseModule.findUnique({ where: { id: moduleId }, select: { courseId: true } });
    if (!m) throw Errors.notFound('No module with that ID.');
    this.checkLesson(dto);
    const l = await this.prisma.lesson.create({
      data: {
        ...this.lessonFields(dto),
        ...(await this.fileFields(m.courseId, dto.fileId)),
        title: dto.title,
        type: dto.type,
        status: dto.status ?? 'draft',
        moduleId,
        courseId: m.courseId,
      },
    });
    await this.log('admin.course.lesson_added', 'course', m.courseId, actor, { lessonId: l.id });
    return l;
  }

  async patchLesson(id: string, dto: LessonPatchDto, actor: Actor, why?: ChangeWhy) {
    const cur = await this.prisma.lesson.findUnique({ where: { id } });
    if (!cur) throw Errors.notFound('No lesson with that ID.');
    this.checkLesson({ ...cur, ...dto, refCode: dto.refCode ?? cur.refCode } as LessonDto);
    const l = await this.prisma.lesson.update({
      where: { id },
      data: {
        ...this.lessonFields(dto),
        ...(await this.fileFields(cur.courseId, dto.fileId)),
        ...(dto.title ? { title: dto.title } : {}),
        ...(dto.type ? { type: dto.type } : {}),
        ...(dto.status ? { status: dto.status } : {}),
      },
    });
    await this.log(
      'admin.course.lesson_updated',
      'course',
      cur.courseId,
      actor,
      { lessonId: id, fields: Object.keys(dto) },
      why,
    );
    return l;
  }

  async deleteLesson(id: string, actor: Actor, why?: ChangeWhy) {
    const l = await this.prisma.lesson.findUnique({ where: { id }, select: { courseId: true } });
    if (!l) throw Errors.notFound('No lesson with that ID.');
    if (await this.prisma.lessonProgress.count({ where: { lessonId: id } }))
      throw new AppError(409, 'HAS_PROGRESS', 'Students have progress in this lesson. Unpublish it instead.');
    await this.prisma.lesson.delete({ where: { id } });
    await this.log('admin.course.lesson_deleted', 'course', l.courseId, actor, { lessonId: id }, why);
  }

  async addFaq(courseId: string, dto: FaqDto, actor: Actor) {
    await this.get(courseId);
    const f = await this.prisma.courseFaq.create({
      data: {
        courseId,
        question: dto.question,
        answer: dto.answer,
        sortOrder: dto.sortOrder ?? 0,
        published: dto.published ?? false,
      },
    });
    await this.log('admin.course.faq_added', 'course', courseId, actor, { faqId: f.id });
    return f;
  }

  async patchFaq(id: string, dto: Partial<FaqDto>, actor: Actor, why?: ChangeWhy) {
    const f = await this.prisma.courseFaq.update({ where: { id }, data: dto }).catch(() => {
      throw Errors.notFound('No FAQ with that ID.');
    });
    await this.log('admin.course.faq_updated', 'course', f.courseId, actor, { faqId: id }, why);
    return f;
  }

  async deleteFaq(id: string, actor: Actor, why?: ChangeWhy) {
    const f = await this.prisma.courseFaq.delete({ where: { id } }).catch(() => {
      throw Errors.notFound('No FAQ with that ID.');
    });
    await this.log('admin.course.faq_deleted', 'course', f.courseId, actor, { faqId: id }, why);
  }

  /** Issues a certificate only when the student is eligible (all required lessons complete). */
  async issueCertificate(userId: string, courseId: string, actor: Actor) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!u || u.role !== 'student') throw Errors.validation('Choose a student.', 'userId');
    const e = await this.courses.eligibility(userId, courseId);
    if (!e.offers) throw new AppError(409, 'NO_CERTIFICATE', 'This course does not offer a certificate.');
    if (!e.complete)
      throw new AppError(409, 'NOT_ELIGIBLE', 'The student has not completed every required lesson.', {
        details: { progress: e.progress },
      });
    try {
      const c = await this.prisma.certificate.create({ data: { userId, courseId, issuedById: actor.userId } });
      await this.log('admin.certificate.issued', 'certificate', c.id, actor, { code: c.code, userId, courseId });
      await this.notes.notify(userId, {
        kind: 'certificate',
        title: 'Your certificate is ready',
        link: '#/courses',
        important: true,
        dedupeKey: `certificate:${c.id}`,
      });
      return c;
    } catch (err) {
      if (isUnique(err))
        throw Errors.conflict('ALREADY_ISSUED', 'This student already has a valid certificate for this course.');
      throw err;
    }
  }

  async revokeCertificate(code: string, reason: string, actor: Actor) {
    const r = await this.prisma.certificate.updateMany({
      where: { code, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: actor.userId, revokeReason: reason },
    });
    if (!r.count) throw Errors.notFound('No valid certificate with that code.');
    await this.log('admin.certificate.revoked', 'certificate', code, actor, {}, undefined, reason);
    return { code, revoked: true };
  }

  private checkLesson(dto: Pick<LessonDto, 'completion' | 'refCode' | 'contentUrl'>) {
    if (dto.completion && dto.completion !== 'manual' && !dto.refCode)
      throw Errors.validation('Quiz and lab completion need the quiz or lab code.', 'refCode');
  }

  private fields(dto: CoursePatchDto) {
    const keys = [
      'summary',
      'overview',
      'level',
      'duration',
      'format',
      'access',
      'featured',
      'outcomes',
      'prerequisites',
      'prerequisiteCourseId',
      'audience',
      'labs',
      'certificate',
      'imageUrl',
      'pricePaise',
    ] as const;
    return Object.fromEntries(
      keys.filter((k) => dto[k] !== undefined).map((k) => [k, dto[k]]),
    ) as Partial<Prisma.CourseUncheckedCreateInput>;
  }

  /** Attaches an active uploaded file of the same course to a lesson (or detaches it with null). */
  private async fileFields(courseId: string, fileId: string | null | undefined) {
    if (fileId === undefined) return {};
    if (fileId === null) return { fileKey: null, fileName: null, fileSizeMb: null };
    const f = await this.prisma.courseFile.findFirst({ where: { id: fileId, courseId, status: 'active' } });
    if (!f) throw Errors.validation('Choose a file uploaded to this course.', 'fileId');
    return { fileKey: f.id, fileName: f.relPath, fileSizeMb: Math.max(0.01, Math.round(f.sizeBytes / 10485.76) / 100) };
  }

  private lessonFields(dto: LessonPatchDto) {
    const keys = [
      'sortOrder',
      'preview',
      'required',
      'completion',
      'refCode',
      'contentUrl',
      'body',
      'fileName',
      'fileSizeMb',
      'downloadable',
      'durationMin',
    ] as const;
    const out: Record<string, unknown> = Object.fromEntries(
      keys.filter((k) => dto[k] !== undefined).map((k) => [k, dto[k]]),
    );
    if (dto.releaseAt !== undefined) out.releaseAt = dto.releaseAt ? new Date(dto.releaseAt) : null;
    return out as Partial<Prisma.LessonUncheckedCreateInput>;
  }

  /** Content changes of a course, newest first, with who made them and why (admin view, OI-48). */
  async changes(courseId: string) {
    await this.get(courseId);
    const rows = await this.prisma.auditLog.findMany({
      where: { targetType: 'course', targetId: courseId, action: { startsWith: 'trainer.course.' } },
      orderBy: { seq: 'desc' },
      take: 200,
      select: { at: true, action: true, actorId: true, detail: true, reason: true },
    });
    const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const people = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true, email: true },
    });
    const name = new Map(people.map((p) => [p.id, p.displayName ?? p.email]));
    return {
      items: rows.map((r) => {
        const d = (r.detail ?? {}) as Record<string, unknown>;
        const code = d.reasonKind as ChangeReasonCode | undefined;
        return {
          at: r.at,
          action: r.action.replace(/^trainer\.course\./, ''),
          by: r.actorId ? (name.get(r.actorId) ?? null) : null,
          reasonCode: code ?? null,
          reasonLabel: code ? CHANGE_REASON_LABELS[code] : null,
          reasonNote: (d.reasonNote as string | undefined) ?? null,
          target: d.moduleId ? 'module' : d.lessonId ? 'lesson' : d.faqId ? 'faq' : null,
          targetId: (d.moduleId ?? d.lessonId ?? d.faqId ?? null) as string | null,
        };
      }),
    };
  }

  private log(
    action: string,
    type: string,
    id: string,
    actor: Actor,
    detail: Record<string, unknown>,
    why?: ChangeWhy,
    reason?: string,
  ) {
    const trainer = actor.role === 'trainer';
    if (why) detail = { ...detail, reasonKind: why.reasonCode, reasonNote: why.reasonNote ?? null }; // not "…Code": audit redacts it
    return this.audit.record({
      action: trainer ? action.replace(/^admin\./, 'trainer.') : action,
      actorId: actor.userId,
      actorRole: trainer ? 'trainer' : 'admin',
      targetType: type,
      targetId: id,
      detail,
      reason:
        reason ??
        (why ? `${CHANGE_REASON_LABELS[why.reasonCode]}${why.reasonNote ? `: ${why.reasonNote}` : ''}` : undefined),
      ip: actor.ip,
      requestId: actor.requestId,
    });
  }
}
