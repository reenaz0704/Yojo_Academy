import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type CourseStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { CoursesAdminService, type Actor, type ChangeWhy } from './courses-admin.service';
import {
  TRACKS,
  type ChangeReasonDto,
  type FaqDto,
  type LessonDto,
  type LessonPatchDto,
  type ModuleDto,
  type OptionalReasonDto,
  type Track,
  type TrainerCourseCreateDto,
  type TrainerCoursePatchDto,
} from './courses.dto';
import { NotificationsService } from './notifications.service';

/** owner: created it · co_editor: added by the owner · batch: a batch the trainer leads or co-leads runs it */
export type CourseRole = 'owner' | 'co_editor' | 'batch';
/** What a change to a published course returns: it waits for a Platform Admin (HTTP 202). */
export type Pending = { pending: true; requestId: string; code: string; message: string };

const TRACK_OF = Object.fromEntries(Object.entries(TRACKS).map(([k, v]) => [v, k])) as Record<string, Track>;
const ENROLLED: Prisma.EnrolmentWhereInput = { status: { in: ['active', 'paused', 'completed'] } };
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Trainer console → Content.
 * - 24 Oct: trainers edit modules, lessons and FAQs of the courses their batches run.
 * - 29 Oct (owner): trainers also create courses (they own them), add co-editors, edit the course details, assign
 *   their own batches and publish their own courses. Once a course is published, every edit or delete by a trainer
 *   becomes a change request (CourseChangeRequest) with a reason (OI-48): the live course stays as it is until a
 *   Platform Admin approves (applied, version + 1) or rejects it with a note. Drafts and unpublished courses are
 *   edited directly. Price and free/paid access stay admin-only (no trainer field for them).
 * Out-of-scope IDs answer 404; course-level actions by a trainer who only runs the course answer 403.
 */
@Injectable()
export class TrainerCoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: CoursesAdminService,
    private readonly audit: AuditService,
    private readonly notes: NotificationsService,
  ) {}

  private mine(trainerId: string): Prisma.CourseWhereInput {
    return {
      OR: [
        { ownerId: trainerId },
        { coEditorIds: { has: trainerId } },
        { batches: { some: { OR: [{ trainerId }, { coTrainerIds: { has: trainerId } }] } } },
      ],
    };
  }

  /** The course and the trainer's role in it, or 404 when it is not theirs. */
  async access(trainerId: string, courseId: string | null | undefined) {
    const c = courseId
      ? await this.prisma.course.findFirst({
          where: { id: courseId, ...this.mine(trainerId) },
          select: { id: true, title: true, status: true, ownerId: true, coEditorIds: true },
        })
      : null;
    if (!c) throw Errors.notFound('No course of yours with that ID.');
    const role: CourseRole =
      c.ownerId === trainerId ? 'owner' : c.coEditorIds.includes(trainerId) ? 'co_editor' : 'batch';
    return { ...c, role };
  }

  async editor(trainerId: string, courseId: string) {
    const c = await this.access(trainerId, courseId);
    if (c.role === 'batch')
      throw new AppError(403, 'NOT_COURSE_EDITOR', 'Only the course owner and its co-editors can do this.');
    return c;
  }

  private as(actor: Actor): Actor {
    return { ...actor, role: 'trainer' };
  }

  /** Splits the reason fields off a request body, so only content fields reach the update. */
  private split<T extends OptionalReasonDto>(dto: T): [Omit<T, 'reasonCode' | 'reasonNote'>, ChangeWhy | undefined] {
    const { reasonCode, reasonNote, ...rest } = dto;
    return [rest, reasonCode ? { reasonCode, reasonNote: reasonNote?.trim() || undefined } : undefined];
  }

  /**
   * Applies a change now, or (published course) records it as a change request for a Platform Admin.
   * `payload` is what the admin applies on approval; it holds only fields the trainer may change.
   */
  async gate<T>(
    actor: Actor,
    course: { id: string; title: string; status: CourseStatus },
    kind: string,
    targetId: string | null,
    payload: object,
    why: ChangeWhy | undefined,
    apply: () => Promise<T>,
  ): Promise<T | Pending> {
    if (course.status !== 'published') return apply();
    if (!why) throw Errors.validation('This course is published: choose a reason for the change.', 'reasonCode');
    const r = await this.prisma.courseChangeRequest.create({
      data: {
        courseId: course.id,
        requestedById: actor.userId,
        kind,
        targetId,
        payload: payload as Prisma.InputJsonValue,
        reasonCode: why.reasonCode,
        reasonNote: why.reasonNote ?? null,
      },
    });
    await this.log('trainer.course.change_requested', course.id, actor, { requestId: r.id, code: r.code, kind }, why);
    const admins = await this.prisma.user.findMany({
      where: { role: 'admin', status: 'active' },
      select: { id: true },
    });
    await this.notes.notify(
      admins.map((a) => a.id),
      {
        kind: 'course',
        title: `${r.code}: a trainer changed the published course "${course.title}"`,
        body: 'The live course is unchanged until you approve. Open Courses → Change requests.',
        link: '#/admin/courses',
        // in-app only: an email per admin would need the mail provider (OI-01)
        important: false,
        dedupeKey: `course_change:${r.id}`,
      },
    );
    return {
      pending: true,
      requestId: r.id,
      code: r.code,
      message: 'Sent for approval. The published course stays as it is until a Platform Admin approves.',
    };
  }

  private log(action: string, courseId: string, actor: Actor, detail: Record<string, unknown>, why?: ChangeWhy) {
    if (why) detail = { ...detail, reasonKind: why.reasonCode, reasonNote: why.reasonNote ?? null };
    return this.audit.record({
      action,
      actorId: actor.userId,
      actorRole: 'trainer',
      targetType: 'course',
      targetId: courseId,
      detail,
      ip: actor.ip,
      requestId: actor.requestId,
    });
  }

  /* ---------------- courses ---------------- */

  async list(trainerId: string) {
    const rows = await this.prisma.course.findMany({
      where: { ...this.mine(trainerId), status: { not: 'archived' } },
      orderBy: [{ updatedAt: 'desc' }],
      select: {
        id: true,
        code: true,
        slug: true,
        title: true,
        category: true,
        level: true,
        duration: true,
        access: true,
        status: true,
        version: true,
        imageUrl: true,
        coverFileId: true,
        ownerId: true,
        coEditorIds: true,
        updatedAt: true,
        _count: { select: { modules: true, lessons: true, faqs: true } },
        batches: { select: { id: true, code: true, trainerId: true, coTrainerIds: true } },
      },
    });
    const ids = rows.map((c) => c.id);
    const [enrolled, pending, owners] = await Promise.all([
      this.prisma.enrolment.findMany({
        where: { ...ENROLLED, batch: { courseId: { in: ids } } },
        select: { batch: { select: { courseId: true } } },
      }),
      this.prisma.courseChangeRequest.groupBy({
        by: ['courseId'],
        where: { courseId: { in: ids }, status: 'pending' },
        _count: true,
      }),
      this.prisma.user.findMany({
        where: { id: { in: rows.map((c) => c.ownerId).filter((x): x is string => !!x) } },
        select: { id: true, displayName: true, role: true },
      }),
    ]);
    const nEnrolled = new Map<string, number>();
    for (const e of enrolled) nEnrolled.set(e.batch.courseId!, (nEnrolled.get(e.batch.courseId!) ?? 0) + 1);
    const items = rows.map(({ batches, coEditorIds, ownerId, ...c }) => {
      const role: CourseRole =
        ownerId === trainerId ? 'owner' : coEditorIds.includes(trainerId) ? 'co_editor' : 'batch';
      const o = owners.find((x) => x.id === ownerId);
      return {
        ...c,
        track: TRACK_OF[c.category] ?? c.category,
        role,
        owner: role === 'owner' ? 'You' : o ? (o.role === 'admin' ? 'Content admin' : o.displayName) : 'Content admin',
        enrolled: nEnrolled.get(c.id) ?? 0,
        pendingChanges: pending.find((p) => p.courseId === c.id)?._count ?? 0,
        batches: batches.map((b) => b.code),
        myBatches: batches
          .filter((b) => b.trainerId === trainerId || b.coTrainerIds.includes(trainerId))
          .map((b) => b.code),
      };
    });
    const by = (s: CourseStatus) => items.filter((c) => c.status === s).length;
    return {
      items,
      counts: { all: items.length, published: by('published'), draft: by('draft'), unpublished: by('unpublished') },
    };
  }

  async get(trainerId: string, id: string) {
    const { role } = await this.access(trainerId, id);
    const full: Partial<Awaited<ReturnType<CoursesAdminService['get']>>> = await this.admin.get(id);
    delete full.pricePaise; // price is admin business, not course content
    const { batches = [], ...c } = full;
    const [editors, pending, enrolled] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: [...(c.coEditorIds ?? []), ...(c.ownerId ? [c.ownerId] : [])] } },
        select: { id: true, displayName: true, email: true, role: true },
      }),
      this.prisma.courseChangeRequest.findMany({
        where: { courseId: id, status: { in: ['pending', 'rejected'] } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          code: true,
          kind: true,
          status: true,
          reasonCode: true,
          reasonNote: true,
          decisionNote: true,
          createdAt: true,
          decidedAt: true,
        },
      }),
      this.prisma.enrolment.count({ where: { ...ENROLLED, batch: { courseId: id } } }),
    ]);
    const owner = editors.find((u) => u.id === c.ownerId);
    return {
      ...c,
      track: TRACK_OF[c.category ?? ''] ?? c.category,
      role,
      owner: role === 'owner' ? 'You' : owner && owner.role !== 'admin' ? owner.displayName : 'Content admin',
      coEditors: editors
        .filter((u) => c.coEditorIds?.includes(u.id))
        .map((u) => ({ id: u.id, name: u.displayName, email: u.email })),
      batches: batches.map((b) => ({ id: b.id, code: b.code, name: b.name, status: b.status })),
      enrolled,
      changeRequests: pending,
      editable: ['modules', 'lessons', 'faqs', ...(role === 'batch' ? [] : ['details', 'batches', 'publish'])],
      published: c.status === 'published',
    };
  }

  /** The trainer's own batches, with the course each one runs (for "Assign to batches"). */
  async myBatches(trainerId: string) {
    const rows = await this.prisma.batch.findMany({
      where: { OR: [{ trainerId }, { coTrainerIds: { has: trainerId } }], status: { not: 'completed' } },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, status: true, course: { select: { id: true, title: true } } },
    });
    return rows.map((b) => ({ id: b.id, code: b.code, name: b.name, status: b.status, course: b.course }));
  }

  private fields(dto: TrainerCoursePatchDto) {
    const out: Prisma.CourseUpdateInput = {};
    if (dto.title !== undefined) out.title = dto.title.trim();
    if (dto.track !== undefined) out.category = TRACKS[dto.track];
    if (dto.level !== undefined) out.level = dto.level;
    if (dto.duration !== undefined) out.duration = dto.duration.trim();
    if (dto.summary !== undefined) out.summary = dto.summary.trim();
    if (dto.outcomes !== undefined) out.outcomes = dto.outcomes.map((x) => x.trim()).filter(Boolean);
    return out;
  }

  async create(actor: Actor, dto: TrainerCourseCreateDto) {
    const base =
      dto.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'course';
    for (let i = 0; i < 4; i++) {
      const rnd = randomBytes(3).toString('hex').toUpperCase();
      try {
        const c = await this.prisma.$transaction(async (tx) => {
          const c = await tx.course.create({
            data: {
              ...(this.fields(dto) as Prisma.CourseCreateInput),
              code: `TC-${rnd}`,
              slug: `${base}-${rnd.toLowerCase()}`,
              title: dto.title.trim(),
              category: TRACKS[dto.track],
              duration: dto.duration?.trim() || 'Self-paced',
              access: 'paid', // a Platform Admin sets the price or makes it free
              status: 'draft',
              ownerId: actor.userId,
            },
          });
          if (dto.batchIds?.length) await this.assign(tx, actor.userId, c.id, dto.batchIds);
          return c;
        });
        await this.log('trainer.course.created', c.id, actor, { code: c.code, batches: dto.batchIds ?? [] });
        return { id: c.id, code: c.code, slug: c.slug, status: c.status };
      } catch (e) {
        if (!isUnique(e)) throw e;
      }
    }
    throw Errors.conflict('COURSE_EXISTS', 'Could not pick a free course code. Try again.');
  }

  async patch(actor: Actor, id: string, body: TrainerCoursePatchDto) {
    const c = await this.editor(actor.userId, id);
    const [dto, why] = this.split(body);
    const data = this.fields(dto);
    if (!Object.keys(data).length) throw Errors.validation('Nothing to change.');
    // the admin service applies it on approval, so the payload uses its field names
    const payload = data;
    return this.gate(this.as(actor), c, 'course.patch', null, payload, why, async () => {
      const u = await this.prisma.course.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      await this.log('trainer.course.updated', id, actor, { fields: Object.keys(data) }, why);
      return { id: u.id, version: u.version, status: u.status };
    });
  }

  /** Owner decision (29 Oct): the owner or a co-editor publishes a draft or unpublished course directly. */
  async publish(actor: Actor, id: string) {
    const c = await this.editor(actor.userId, id);
    if (c.status === 'published') throw Errors.conflict('ALREADY_PUBLISHED', 'This course is already published.');
    if (c.status === 'archived') throw Errors.conflict('ARCHIVED', 'An archived course cannot be published.');
    const u = await this.admin.setStatus(id, 'published', this.as(actor));
    const batch = await this.prisma.enrolment.findMany({
      where: { status: 'active', batch: { courseId: id } },
      select: { studentId: true },
    });
    if (batch.length)
      await this.notes.notify(
        batch.map((b) => b.studentId),
        {
          kind: 'course',
          title: `New course content: ${c.title}`,
          body: 'Your batch course is now open in Training Grid.',
          link: '#/academy/lms/courses',
          important: false,
          dedupeKey: `course_published:${id}:${u.version}`,
        },
      );
    return { id, status: u.status, version: u.version };
  }

  /** Taking a published course offline affects students, so it is a change request too. */
  async unpublish(actor: Actor, id: string, body: ChangeReasonDto) {
    const c = await this.editor(actor.userId, id);
    if (c.status !== 'published') throw Errors.conflict('NOT_PUBLISHED', 'Only a published course can be unpublished.');
    return this.gate(this.as(actor), c, 'course.unpublish', null, {}, this.split(body)[1], () => {
      throw new Error('unreachable');
    });
  }

  /* ---------------- batches and co-editors ---------------- */

  private async assign(tx: Prisma.TransactionClient, trainerId: string, courseId: string, batchIds: string[]) {
    const rows = await tx.batch.findMany({
      where: { id: { in: batchIds } },
      select: { id: true, code: true, trainerId: true, coTrainerIds: true, courseId: true },
    });
    for (const id of batchIds) {
      const b = rows.find((x) => x.id === id);
      if (!b || !(b.trainerId === trainerId || b.coTrainerIds.includes(trainerId)))
        throw Errors.notFound('You can only assign batches you lead or co-lead.');
      if (b.courseId && b.courseId !== courseId)
        throw Errors.conflict(
          'BATCH_HAS_COURSE',
          `${b.code} already runs another course. A Platform Admin can move the batch to this course.`,
        );
    }
    await tx.batch.updateMany({ where: { id: { in: batchIds } }, data: { courseId } });
  }

  async assignBatches(actor: Actor, id: string, batchIds: string[]) {
    await this.editor(actor.userId, id);
    await this.prisma.$transaction((tx) => this.assign(tx, actor.userId, id, batchIds));
    await this.log('trainer.course.batches_assigned', id, actor, { batchIds });
    return { ok: true };
  }

  /** Only while the course is not published (students of the batch are using a published course). */
  async unassignBatch(actor: Actor, id: string, batchId: string) {
    const c = await this.editor(actor.userId, id);
    const b = await this.prisma.batch.findFirst({
      where: { id: batchId, courseId: id, OR: [{ trainerId: actor.userId }, { coTrainerIds: { has: actor.userId } }] },
      select: { id: true },
    });
    if (!b) throw Errors.notFound('No batch of yours runs this course with that ID.');
    if (c.status === 'published')
      throw Errors.conflict('COURSE_PUBLISHED', 'Students are using this published course. Ask a Platform Admin.');
    await this.prisma.batch.update({ where: { id: batchId }, data: { courseId: null } });
    await this.log('trainer.course.batch_removed', id, actor, { batchId });
  }

  async addCoEditor(actor: Actor, id: string, email: string) {
    const c = await this.access(actor.userId, id);
    if (c.role !== 'owner') throw new AppError(403, 'NOT_COURSE_OWNER', 'Only the course owner can add co-editors.');
    const u = await this.prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' }, role: 'trainer', status: 'active' },
      select: { id: true, displayName: true },
    });
    if (!u) throw Errors.notFound('No active trainer with that email.');
    if (u.id === actor.userId) throw Errors.validation('You already own this course.', 'email');
    if (c.coEditorIds.includes(u.id))
      throw Errors.conflict('ALREADY_CO_EDITOR', 'This trainer is already a co-editor.');
    await this.prisma.course.update({ where: { id }, data: { coEditorIds: { push: u.id } } });
    await this.log('trainer.course.co_editor_added', id, actor, { userId: u.id });
    await this.notes.notify(u.id, {
      kind: 'course',
      title: `You can now edit "${c.title}"`,
      body: 'The course owner added you as a co-editor.',
      link: `#/trainer/content/${id}`,
      important: false,
      dedupeKey: `co_editor:${id}:${u.id}`,
    });
    return { id: u.id, name: u.displayName };
  }

  async removeCoEditor(actor: Actor, id: string, userId: string) {
    const c = await this.access(actor.userId, id);
    if (c.role !== 'owner') throw new AppError(403, 'NOT_COURSE_OWNER', 'Only the course owner can remove co-editors.');
    if (!c.coEditorIds.includes(userId)) throw Errors.notFound('That trainer is not a co-editor of this course.');
    await this.prisma.course.update({
      where: { id },
      data: { coEditorIds: c.coEditorIds.filter((x) => x !== userId) },
    });
    await this.log('trainer.course.co_editor_removed', id, actor, { userId });
  }

  /** Students of the trainer's own batches that run this course; other batches show as a count only. */
  async students(trainerId: string, id: string) {
    await this.access(trainerId, id);
    const mineB: Prisma.BatchWhereInput = { OR: [{ trainerId }, { coTrainerIds: { has: trainerId } }] };
    const [rows, others, lessons] = await Promise.all([
      this.prisma.enrolment.findMany({
        where: { ...ENROLLED, batch: { courseId: id, ...mineB } },
        orderBy: { createdAt: 'asc' },
        select: {
          status: true,
          batch: { select: { code: true } },
          student: { select: { id: true, code: true, displayName: true } },
        },
      }),
      this.prisma.enrolment.count({ where: { ...ENROLLED, batch: { courseId: id, NOT: mineB } } }),
      this.prisma.lesson.count({ where: { courseId: id, status: 'published' } }),
    ]);
    const prog = await this.prisma.lessonProgress.groupBy({
      by: ['userId'],
      where: { courseId: id, userId: { in: rows.map((r) => r.student.id) } },
      _count: { completedAt: true },
      _max: { lastAccessAt: true },
    });
    return {
      rows: rows.map((r) => {
        const p = prog.find((x) => x.userId === r.student.id);
        return {
          id: r.student.id,
          code: r.student.code,
          name: r.student.displayName,
          batch: r.batch.code,
          status: r.status,
          progress: lessons ? Math.round((100 * (p?._count.completedAt ?? 0)) / lessons) : 0,
          lastActive: p?._max.lastAccessAt ?? null,
        };
      }),
      otherBatches: others,
      publishedLessons: lessons,
    };
  }

  /* ---------------- modules, lessons and FAQs ---------------- */

  private async moduleCourse(id: string) {
    return (await this.prisma.courseModule.findUnique({ where: { id }, select: { courseId: true } }))?.courseId;
  }
  private async lessonCourse(id: string) {
    return (await this.prisma.lesson.findUnique({ where: { id }, select: { courseId: true } }))?.courseId;
  }
  private async faqCourse(id: string) {
    return (await this.prisma.courseFaq.findUnique({ where: { id }, select: { courseId: true } }))?.courseId;
  }

  async addModule(actor: Actor, courseId: string, body: ModuleDto & OptionalReasonDto) {
    const c = await this.access(actor.userId, courseId);
    const [dto, why] = this.split(body);
    return this.gate(actor, c, 'module.add', null, dto, why, () => this.admin.addModule(courseId, dto, this.as(actor)));
  }
  async patchModule(actor: Actor, id: string, body: Partial<ModuleDto> & ChangeReasonDto) {
    const c = await this.access(actor.userId, await this.moduleCourse(id));
    const [dto, why] = this.split(body);
    return this.gate(actor, c, 'module.patch', id, dto, why, () =>
      this.admin.patchModule(id, dto, this.as(actor), why),
    );
  }
  async deleteModule(actor: Actor, id: string, body: ChangeReasonDto) {
    const c = await this.access(actor.userId, await this.moduleCourse(id));
    const why = this.split(body)[1];
    return this.gate(actor, c, 'module.delete', id, {}, why, () => this.admin.deleteModule(id, this.as(actor), why));
  }
  async addLesson(actor: Actor, moduleId: string, body: LessonDto & OptionalReasonDto) {
    const c = await this.access(actor.userId, await this.moduleCourse(moduleId));
    const [dto, why] = this.split(body);
    return this.gate(actor, c, 'lesson.add', moduleId, dto, why, () =>
      this.admin.addLesson(moduleId, dto, this.as(actor)),
    );
  }
  async patchLesson(actor: Actor, id: string, body: LessonPatchDto & ChangeReasonDto) {
    const c = await this.access(actor.userId, await this.lessonCourse(id));
    const [dto, why] = this.split(body);
    return this.gate(actor, c, 'lesson.patch', id, dto, why, () =>
      this.admin.patchLesson(id, dto, this.as(actor), why),
    );
  }
  async deleteLesson(actor: Actor, id: string, body: ChangeReasonDto) {
    const c = await this.access(actor.userId, await this.lessonCourse(id));
    const why = this.split(body)[1];
    return this.gate(actor, c, 'lesson.delete', id, {}, why, () => this.admin.deleteLesson(id, this.as(actor), why));
  }
  async addFaq(actor: Actor, courseId: string, body: FaqDto & OptionalReasonDto) {
    const c = await this.access(actor.userId, courseId);
    const [dto, why] = this.split(body);
    return this.gate(actor, c, 'faq.add', null, dto, why, () => this.admin.addFaq(courseId, dto, this.as(actor)));
  }
  async patchFaq(actor: Actor, id: string, body: Partial<FaqDto> & ChangeReasonDto) {
    const c = await this.access(actor.userId, await this.faqCourse(id));
    const [dto, why] = this.split(body);
    return this.gate(actor, c, 'faq.patch', id, dto, why, () => this.admin.patchFaq(id, dto, this.as(actor), why));
  }
  async deleteFaq(actor: Actor, id: string, body: ChangeReasonDto) {
    const c = await this.access(actor.userId, await this.faqCourse(id));
    const why = this.split(body)[1];
    return this.gate(actor, c, 'faq.delete', id, {}, why, () => this.admin.deleteFaq(id, this.as(actor), why));
  }
}
