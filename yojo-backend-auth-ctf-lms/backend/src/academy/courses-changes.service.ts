import { Injectable } from '@nestjs/common';
import type { CourseChangeStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { CoursesAdminService, type Actor, type ChangeWhy } from './courses-admin.service';
import {
  CHANGE_REASON_LABELS,
  type ChangeReasonCode,
  type CoursePatchDto,
  type FaqDto,
  type LessonDto,
} from './courses.dto';
import { CourseFilesService } from './course-files.service';
import { NotificationsService } from './notifications.service';

const KIND_LABELS: Record<string, string> = {
  'course.patch': 'Edit course details',
  'course.unpublish': 'Unpublish the course',
  'module.add': 'Add a module',
  'module.patch': 'Edit a module',
  'module.delete': 'Delete a module',
  'lesson.add': 'Add a lesson',
  'lesson.patch': 'Edit a lesson',
  'lesson.delete': 'Delete a lesson',
  'faq.add': 'Add an FAQ',
  'faq.patch': 'Edit an FAQ',
  'faq.delete': 'Delete an FAQ',
  'file.add': 'Upload a file',
  'file.delete': 'Remove a file',
  'course.cover': 'Change the cover image',
};

/**
 * Admin console → Courses → Change requests (owner, 29 Oct): a trainer's edit or delete on a published course waits
 * here. Approving applies it through the same admin service (so the same validation and audit run) and raises the
 * course version; rejecting needs a note, which the trainer is shown. Both decisions are audited.
 */
@Injectable()
export class CourseChangesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: CoursesAdminService,
    private readonly audit: AuditService,
    private readonly notes: NotificationsService,
    private readonly files: CourseFilesService,
  ) {}

  async list(status: CourseChangeStatus = 'pending') {
    const rows = await this.prisma.courseChangeRequest.findMany({
      where: { status },
      orderBy: { createdAt: status === 'pending' ? 'asc' : 'desc' },
      take: 200,
      include: { course: { select: { id: true, code: true, title: true, version: true } } },
    });
    const people = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById ?? '']).filter(Boolean))] } },
      select: { id: true, displayName: true, code: true },
    });
    const name = (id: string | null) => people.find((p) => p.id === id)?.displayName ?? null;
    const counts = await this.prisma.courseChangeRequest.groupBy({ by: ['status'], _count: true });
    return {
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        course: r.course,
        kind: r.kind,
        kindLabel: KIND_LABELS[r.kind] ?? r.kind,
        targetId: r.targetId,
        payload: r.payload,
        reasonCode: r.reasonCode,
        reasonLabel: CHANGE_REASON_LABELS[r.reasonCode as ChangeReasonCode] ?? r.reasonCode,
        reasonNote: r.reasonNote,
        requestedBy: name(r.requestedById),
        createdAt: r.createdAt,
        status: r.status,
        decidedBy: name(r.decidedById),
        decidedAt: r.decidedAt,
        decisionNote: r.decisionNote,
      })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    };
  }

  async decide(id: string, approve: boolean, note: string | undefined, actor: Actor) {
    const r = await this.prisma.courseChangeRequest.findUnique({
      where: { id },
      include: { course: { select: { title: true } } },
    });
    if (!r) throw Errors.notFound('No change request with that ID.');
    if (r.status !== 'pending') throw Errors.conflict('ALREADY_DECIDED', 'This change request was already decided.');
    const why: ChangeWhy = { reasonCode: r.reasonCode as ChangeReasonCode, reasonNote: r.reasonNote ?? undefined };
    if (approve)
      await this.apply(r, { ...actor, role: 'admin' }, why); // a failure leaves the request pending
    // a rejected upload was never live: its stored file is removed
    else if (r.kind === 'file.add' || r.kind === 'course.cover')
      await this.files.removeFile(String((r.payload as { fileId?: string }).fileId ?? ''));
    // only one admin can decide it, even when two click at once
    const done = await this.prisma.courseChangeRequest.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: approve ? 'approved' : 'rejected',
        decidedById: actor.userId,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
      },
    });
    if (!done.count) throw Errors.conflict('ALREADY_DECIDED', 'This change request was already decided.');
    await this.audit.record({
      action: approve ? 'admin.course.change_approved' : 'admin.course.change_rejected',
      actorId: actor.userId,
      actorRole: 'admin',
      adminRole: 'platform',
      targetType: 'course',
      targetId: r.courseId,
      reason: note?.trim() || undefined,
      detail: { requestId: r.id, code: r.code, kind: r.kind, requestedById: r.requestedById },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    await this.notes.notify(r.requestedById, {
      kind: 'course',
      title: approve
        ? `${r.code} approved: your change to "${r.course.title}" is live`
        : `${r.code} rejected: your change to "${r.course.title}"`,
      body: approve ? 'The course version went up and students see the change.' : `Admin note: ${note?.trim() ?? ''}`,
      link: `#/trainer/content/${r.courseId}`,
      important: false,
      dedupeKey: `course_change_decided:${r.id}`,
    });
    return { id: r.id, code: r.code, status: approve ? 'approved' : 'rejected' };
  }

  private async apply(
    r: { courseId: string; kind: string; targetId: string | null; payload: Prisma.JsonValue },
    actor: Actor,
    why: ChangeWhy,
  ) {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const t = r.targetId ?? '';
    switch (r.kind) {
      case 'course.patch':
        return this.admin.patch(r.courseId, p as CoursePatchDto, actor); // raises the version itself
      case 'course.unpublish':
        return this.admin.setStatus(r.courseId, 'unpublished', actor); // raises the version itself
      case 'module.add':
        await this.admin.addModule(r.courseId, p as { title: string; sortOrder?: number }, actor);
        break;
      case 'module.patch':
        await this.admin.patchModule(t, p, actor, why);
        break;
      case 'module.delete':
        await this.admin.deleteModule(t, actor, why);
        break;
      case 'lesson.add':
        await this.admin.addLesson(t, p as unknown as LessonDto, actor);
        break;
      case 'lesson.patch':
        await this.admin.patchLesson(t, p, actor, why);
        break;
      case 'lesson.delete':
        await this.admin.deleteLesson(t, actor, why);
        break;
      case 'faq.add':
        await this.admin.addFaq(r.courseId, p as unknown as FaqDto, actor);
        break;
      case 'faq.patch':
        await this.admin.patchFaq(t, p, actor, why);
        break;
      case 'faq.delete':
        await this.admin.deleteFaq(t, actor, why);
        break;
      case 'file.add':
        await this.prisma.courseFile.updateMany({
          where: { id: String(p.fileId), status: 'pending' },
          data: { status: 'active' },
        });
        break;
      case 'course.cover':
        await this.files.setCover(r.courseId, String(p.fileId));
        break;
      case 'file.delete':
        await this.files.removeFile(t);
        break;
      default:
        throw Errors.validation(`Unknown change kind ${r.kind}.`);
    }
    await this.prisma.course.update({ where: { id: r.courseId }, data: { version: { increment: 1 } } });
  }
}
