import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { projectStudentForTrainer } from '../access/trainer-projection';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import type { AdminActor } from './admin-users.service';
import type { BatchDto, BatchPatchDto } from './lms.dto';

type Tx = Prisma.TransactionClient;
const day = (d?: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : d === null ? null : undefined);

/** Batches, enrolments and the trainer's batch scope (a trainer sees only batches they lead or co-lead). */
@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private scope(trainerId: string): Prisma.BatchWhereInput {
    return { OR: [{ trainerId }, { coTrainerIds: { has: trainerId } }] };
  }

  trainerBatches(trainerId: string) {
    return this.prisma.batch.findMany({
      where: this.scope(trainerId),
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        mode: true,
        status: true,
        startDate: true,
        endDate: true,
        courseId: true,
        course: { select: { title: true } },
        _count: { select: { enrolments: { where: { status: 'active' } } } },
      },
    });
  }

  /** Out-of-scope and missing batches answer the same 404, so ids of other batches are not confirmed. */
  async trainerBatch(trainerId: string, id: string) {
    const b = await this.prisma.batch.findFirst({
      where: { id, ...this.scope(trainerId) },
      select: { id: true, code: true, name: true, mode: true, status: true, startDate: true, endDate: true },
    });
    if (!b) throw Errors.notFound();
    return b;
  }

  async trainerBatchStudents(trainerId: string, id: string) {
    const b = await this.trainerBatch(trainerId, id);
    const rows = await this.prisma.enrolment.findMany({
      where: { batchId: id, status: 'active' },
      select: {
        student: {
          select: { id: true, displayName: true, lastLoginAt: true, studentProfile: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return {
      batch: { id: b.id, code: b.code },
      items: rows.map((r) =>
        projectStudentForTrainer({
          id: r.student.id,
          name: r.student.studentProfile?.name ?? r.student.displayName,
          batch: b.code,
          lastActive: r.student.lastLoginAt,
          // Fields such as email, phone and guardian are never selected for trainers.
        }),
      ),
    };
  }

  listAll() {
    return this.prisma.batch.findMany({
      orderBy: { code: 'asc' },
      include: { _count: { select: { enrolments: true } } },
      take: 500,
    });
  }

  private async assertTrainers(ids: (string | null | undefined)[]) {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    if (!want.length) return;
    const found = await this.prisma.user.count({
      where: { id: { in: want }, role: 'trainer', status: { not: 'deleted' } },
    });
    if (found !== want.length) throw Errors.validation('Choose trainers from the staff list.', 'trainerId');
  }

  async create(dto: BatchDto, actor: AdminActor) {
    await this.assertTrainers([dto.trainerId, ...(dto.coTrainerIds ?? [])]);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const b = await tx.batch.create({
          data: {
            code: dto.code,
            name: dto.name,
            trainerId: dto.trainerId,
            coTrainerIds: dto.coTrainerIds ?? [],
            mode: dto.mode,
            startDate: day(dto.startDate),
            endDate: day(dto.endDate),
            status: dto.status,
            courseId: dto.courseId,
          },
        });
        await this.log(tx, 'batch.created', b.id, actor, { code: b.code, trainerId: b.trainerId });
        return b;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw Errors.conflict('BATCH_CODE_TAKEN', 'A batch with this code already exists.');
      throw e;
    }
  }

  async update(id: string, dto: BatchPatchDto, actor: AdminActor) {
    await this.assertTrainers([dto.trainerId, ...(dto.coTrainerIds ?? [])]);
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.batch.findUnique({ where: { id }, select: { id: true } }))) throw Errors.notFound();
      const b = await tx.batch.update({
        where: { id },
        data: {
          name: dto.name,
          trainerId: dto.trainerId,
          coTrainerIds: dto.coTrainerIds,
          mode: dto.mode,
          startDate: day(dto.startDate),
          endDate: day(dto.endDate),
          status: dto.status,
          courseId: dto.courseId,
        },
      });
      await this.log(tx, 'batch.updated', b.id, actor, { changed: Object.keys(dto) });
      return b;
    });
  }

  async enrol(studentId: string, batchId: string, actor: AdminActor) {
    const [student, batch] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: studentId }, select: { role: true } }),
      this.prisma.batch.findUnique({ where: { id: batchId }, select: { id: true, status: true } }),
    ]);
    if (!student || student.role !== 'student') throw Errors.notFound();
    if (!batch) throw Errors.validation('Choose a batch from the list.', 'batchId');
    return this.prisma.$transaction(async (tx) => {
      const e = await tx.enrolment.upsert({
        where: { studentId_batchId: { studentId, batchId } },
        create: { studentId, batchId },
        update: { status: 'active' },
      });
      await this.log(tx, 'enrolment.created', studentId, actor, { batchId }, 'user');
      return { id: e.id, studentId, batchId, status: e.status };
    });
  }

  /** Applies the batch scope carried by a trainer invite once the invite is accepted. */
  static async applyInviteScope(tx: Tx, trainerId: string, batchIds: string[]) {
    for (const id of batchIds) {
      const b = await tx.batch.findUnique({ where: { id }, select: { trainerId: true, coTrainerIds: true } });
      if (!b) continue;
      if (!b.trainerId) await tx.batch.update({ where: { id }, data: { trainerId } });
      else if (b.trainerId !== trainerId && !b.coTrainerIds.includes(trainerId))
        await tx.batch.update({ where: { id }, data: { coTrainerIds: { push: trainerId } } });
    }
  }

  private log(
    tx: Tx,
    action: string,
    targetId: string,
    actor: AdminActor,
    detail: Record<string, unknown>,
    targetType = 'batch',
  ) {
    return this.audit.record(
      {
        action,
        actorId: actor.userId,
        actorRole: 'admin',
        adminRole: 'platform',
        targetType,
        targetId,
        detail,
        ip: actor.ip,
        requestId: actor.requestId,
      },
      tx,
    );
  }
}
