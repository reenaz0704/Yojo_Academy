import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { checkContent, isSystemFile, KIND_RULES, type ContentKind } from '../storage/content-rules';
import { StorageService } from '../storage/storage.service';
import type { Actor, ChangeWhy } from './courses-admin.service';
import type { OptionalReasonDto } from './courses.dto';
import { CoursesService } from './courses.service';
import { TrainerCoursesService } from './courses-trainer.service';

const MAX_FILES = 500;
const MAX_COURSE_BYTES = 2 * 1024 * 1024 * 1024;

/** Control characters and the characters Windows forbids in file names. */
const hasBadChar = (x: string) => [...x].some((ch) => ch.charCodeAt(0) < 32 || '<>:"|?*'.includes(ch));

/** "week 1/notes.pdf" style path from a folder upload: forward slashes, no "..", no leading slash, safe characters. */
function cleanPath(raw: string | undefined, fallback: string) {
  const p = (raw || fallback).replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(Boolean);
  if (
    !p.length ||
    p.length > 8 ||
    p.some((x) => x === '..' || x === '.' || x.length > 120 || hasBadChar(x))
  )
    throw Errors.validation('That file or folder name cannot be used.', 'relPath');
  return p.join('/');
}

/**
 * Course files (owner, 29 Oct): trainers upload single files or whole folders with a "type of content", and only
 * matching files are kept (content-rules.ts). Uploads to a published course wait for a Platform Admin like any other
 * change. Bytes go out only through GET /files/:id after a permission check; virus scanning waits for OI-45.
 */
@Injectable()
export class CourseFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly trainer: TrainerCoursesService,
    private readonly courses: CoursesService,
    private readonly audit: AuditService,
  ) {}

  private view(f: {
    id: string;
    kind: string;
    name: string;
    relPath: string;
    mime: string;
    sizeBytes: number;
    status: string;
    scanStatus: string;
    createdAt: Date;
  }) {
    return {
      id: f.id,
      kind: f.kind,
      name: f.name,
      relPath: f.relPath,
      mime: f.mime,
      sizeBytes: f.sizeBytes,
      status: f.status,
      scanStatus: f.scanStatus,
      createdAt: f.createdAt,
      url: `/files/${f.id}`,
    };
  }

  async list(trainerId: string, courseId: string) {
    await this.trainer.access(trainerId, courseId);
    const rows = await this.prisma.courseFile.findMany({
      where: { courseId, status: { in: ['active', 'pending'] } },
      orderBy: [{ kind: 'asc' }, { relPath: 'asc' }],
    });
    return {
      items: rows.map((f) => this.view(f)),
      storage: this.storage.available ? 'local-disk (development)' : null,
      kinds: Object.entries(KIND_RULES).map(([kind, r]) => ({
        kind,
        label: r.label,
        ext: r.ext,
        maxMb: Math.round(r.maxBytes / 1048576),
      })),
      scan: 'Virus scanning needs a provider (OI-45): files are marked "pending scan" until one is connected.',
    };
  }

  async upload(
    actor: Actor,
    courseId: string,
    kind: ContentKind,
    file: { originalname: string; mimetype: string; buffer: Buffer } | undefined,
    relPathRaw: string | undefined,
    reason: OptionalReasonDto,
  ) {
    const driver = this.storage.use();
    const c = await this.trainer.access(actor.userId, courseId);
    if (kind === 'cover' && c.role === 'batch')
      throw new AppError(403, 'NOT_COURSE_EDITOR', 'Only the course owner and its co-editors change the cover image.');
    if (!file) throw Errors.validation('Choose a file to upload.', 'file');
    const relPath = cleanPath(relPathRaw, file.originalname);
    if (isSystemFile(relPath)) throw new AppError(422, 'SYSTEM_FILE', 'Hidden and system files are skipped.');
    const name = relPath.split('/').pop()!;
    const ok = checkContent(kind, name, file.mimetype, file.buffer);
    if (!ok.ok) throw new AppError(422, 'FILE_TYPE_REFUSED', ok.reason, { field: 'file' });
    const agg = await this.prisma.courseFile.aggregate({
      where: { courseId, status: { in: ['active', 'pending'] } },
      _count: true,
      _sum: { sizeBytes: true },
    });
    if (agg._count >= MAX_FILES) throw Errors.conflict('TOO_MANY_FILES', `A course can hold ${MAX_FILES} files.`);
    if ((agg._sum.sizeBytes ?? 0) + file.buffer.length > MAX_COURSE_BYTES)
      throw Errors.conflict('COURSE_STORAGE_FULL', 'This course has used its 2 GB of file space.');

    const why: ChangeWhy | undefined = reason.reasonCode
      ? { reasonCode: reason.reasonCode, reasonNote: reason.reasonNote?.trim() || undefined }
      : undefined;
    if (c.status === 'published' && !why)
      throw Errors.validation('This course is published: choose a reason for the change.', 'reasonCode');
    const id = randomUUID();
    const storageKey = `courses/${courseId}/${id}`;
    await driver.put(storageKey, file.buffer);
    const f = await this.prisma.courseFile.create({
      data: {
        id,
        courseId,
        kind,
        name,
        relPath,
        mime: ok.mime,
        sizeBytes: file.buffer.length,
        storageKey,
        status: c.status === 'published' ? 'pending' : 'active',
        uploadedById: actor.userId,
      },
    });
    await this.log('trainer.course.file_uploaded', courseId, actor, { fileId: id, kind, relPath, size: f.sizeBytes });
    const res = await this.trainer.gate(
      actor,
      c,
      kind === 'cover' ? 'course.cover' : 'file.add',
      null,
      { fileId: id, name: relPath, kind },
      why,
      async () => {
        if (kind === 'cover') await this.setCover(courseId, id);
        return this.view(f);
      },
    );
    return res;
  }

  /** The new cover replaces the old one (the old file is removed). */
  async setCover(courseId: string, fileId: string) {
    const c = await this.prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { coverFileId: true } });
    await this.prisma.$transaction([
      this.prisma.courseFile.update({ where: { id: fileId }, data: { status: 'active' } }),
      this.prisma.course.update({ where: { id: courseId }, data: { coverFileId: fileId } }),
    ]);
    if (c.coverFileId && c.coverFileId !== fileId) await this.removeFile(c.coverFileId);
  }

  /** Removes a file: lessons pointing at it are detached, the bytes are deleted, the row is kept as "removed". */
  async removeFile(fileId: string) {
    const f = await this.prisma.courseFile.findUnique({ where: { id: fileId } });
    if (!f || f.status === 'removed') return;
    await this.prisma.$transaction([
      this.prisma.lesson.updateMany({
        where: { fileKey: fileId },
        data: { fileKey: null, fileName: null, fileSizeMb: null },
      }),
      this.prisma.course.updateMany({ where: { coverFileId: fileId }, data: { coverFileId: null } }),
      this.prisma.courseFile.update({ where: { id: fileId }, data: { status: 'removed' } }),
    ]);
    if (this.storage.available) await this.storage.use().remove(f.storageKey);
  }

  async remove(actor: Actor, fileId: string, reason: OptionalReasonDto) {
    const f = await this.prisma.courseFile.findFirst({ where: { id: fileId, status: { in: ['active', 'pending'] } } });
    const c = await this.trainer.access(actor.userId, f?.courseId);
    const why: ChangeWhy | undefined = reason.reasonCode
      ? { reasonCode: reason.reasonCode, reasonNote: reason.reasonNote?.trim() || undefined }
      : undefined;
    // a file still waiting for approval was never live: its uploader can withdraw it straight away
    if (f!.status === 'pending' && f!.uploadedById === actor.userId) {
      await this.removeFile(fileId);
      return null;
    }
    return this.trainer.gate(actor, c, 'file.delete', fileId, { name: f!.relPath }, why, async () => {
      await this.removeFile(fileId);
      await this.log('trainer.course.file_removed', c.id, actor, { fileId }, why);
      return null;
    });
  }

  /**
   * GET /files/:id. Staff: trainers of the course (any status) and admins. Students: only an active file used by a
   * published lesson of a published course they can open.
   */
  async open(user: { userId: string; role: string }, fileId: string) {
    const f = await this.prisma.courseFile.findUnique({ where: { id: fileId } });
    if (!f || f.status === 'removed') throw Errors.notFound('File not found.');
    let ok = false;
    if (user.role === 'admin') ok = true;
    else if (user.role === 'trainer')
      ok = await this.trainer.access(user.userId, f.courseId).then(
        () => true,
        () => false,
      );
    else if (user.role === 'student') {
      const cover = await this.prisma.course.count({ where: { coverFileId: f.id, status: 'published' } });
      ok = f.status === 'active' && (cover > 0 || (await this.courses.canOpenFile(user.userId, f.id)));
    }
    if (!ok) throw Errors.notFound('File not found.');
    const { stream, size } = await this.storage.use().open(f.storageKey);
    return { stream, size, mime: f.mime, name: f.name, kind: f.kind };
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
}
