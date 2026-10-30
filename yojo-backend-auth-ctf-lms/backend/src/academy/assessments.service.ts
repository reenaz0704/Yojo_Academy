import { Injectable } from '@nestjs/common';
import { Prisma, type Assessment, type Attempt, type Question } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors/app-error';
import type { RequestMeta } from '../identity/types';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CoursesService } from './courses.service';
import { GamificationService } from './gamification.service';
import { NotificationsService } from './notifications.service';
import type { AssessmentDto, AssessmentPatchDto, GradeDto, QuestionDto } from './assessments.dto';

type Actor = RequestMeta & { userId: string };
type Answers = Record<string, number | number[] | string>;
const DUE_SOON_MS = 3 * 86_400_000;
const GRACE_MS = 2 * 60_000;
interface StudentAssessment {
  id: string;
  code: string;
  title: string;
  kind: string;
  course: string | null;
  difficulty: string;
  durationMin: number | null;
  dueAt: Date | null;
  maxMarks: number;
  status: string;
  dueSoon: boolean;
  attemptsUsed: number;
  attemptsAllowed: number;
  score: number | null;
  passed: boolean | null;
}
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Incoming Challenges (docs/ACADEMY-INVENTORY.md, slice d). Students reach an assessment only through open access
 * to its course (and its batch, when set). Quiz answer keys and unreleased marks never leave the server. Marks are
 * kept inside 0..max by a database trigger as well; every mark written lands in grade_history.
 * Student status: pending → (due soon) → in_progress → submitted → completed (graded and released) | returned | missed.
 */
@Injectable()
export class AssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly courses: CoursesService,
    private readonly game: GamificationService,
    private readonly settings: SettingsService,
    private readonly notes: NotificationsService,
  ) {}

  // ───────────── access ─────────────

  private async canTake(userId: string, a: Pick<Assessment, 'courseId' | 'batchId' | 'status'>) {
    if (a.status === 'draft') return false;
    const c = await this.prisma.course.findUnique({ where: { id: a.courseId } });
    if (!c || c.status !== 'published') return false;
    const acc = await this.courses.accessFor(userId, c);
    if (acc.state === 'locked') return false;
    if (a.batchId)
      return !!(await this.prisma.enrolment.count({
        where: { studentId: userId, batchId: a.batchId, status: 'active' },
      }));
    return true;
  }

  private async dueFor(userId: string, a: Assessment) {
    const ext = await this.prisma.assessmentExtension.findUnique({
      where: { assessmentId_studentId: { assessmentId: a.id, studentId: userId } },
    });
    return ext?.dueAt ?? a.dueAt;
  }

  private released(a: Assessment, now = Date.now()) {
    if (a.resultsRelease === 'immediate') return true;
    if (a.resultsRelease === 'after_due') return !!a.dueAt && now > a.dueAt.getTime();
    return !!a.releasedAt;
  }

  private statusOf(a: Assessment, attempts: Attempt[], due: Date | null, now = Date.now()) {
    const last = attempts[attempts.length - 1];
    if (last?.status === 'in_progress') return 'in_progress';
    if (last?.status === 'returned') return 'returned';
    if (attempts.some((x) => x.status === 'graded') && this.released(a, now)) return 'completed';
    if (last) return 'submitted';
    if (a.status === 'closed' || (due && now > due.getTime() && !a.allowLate)) return 'missed';
    return 'pending';
  }

  // ───────────── student ─────────────

  /** All assessments the student can take, with status, due-soon flag and released results. */
  async list(userId: string, filter?: string) {
    const all = await this.prisma.assessment.findMany({
      where: { status: { in: ['published', 'closed'] } },
      orderBy: [{ dueAt: 'asc' }, { title: 'asc' }],
      include: { attempts: { where: { studentId: userId }, orderBy: { number: 'asc' } } },
    });
    const courseTitles = new Map(
      (
        await this.prisma.course.findMany({
          where: { id: { in: all.map((a) => a.courseId) } },
          select: { id: true, title: true },
        })
      ).map((c) => [c.id, c.title]),
    );
    const now = Date.now();
    const out: StudentAssessment[] = [];
    for (const a of all) {
      if (!(await this.canTake(userId, a))) continue;
      const due = await this.dueFor(userId, a);
      const status = this.statusOf(a, a.attempts, due, now);
      const dueSoon =
        (status === 'pending' || status === 'in_progress') &&
        !!due &&
        due.getTime() - now <= DUE_SOON_MS &&
        due.getTime() > now;
      const best = this.released(a, now)
        ? Math.max(...a.attempts.filter((x) => x.status === 'graded').map((x) => x.score ?? 0), -1)
        : -1;
      out.push({
        id: a.id,
        code: a.code,
        title: a.title,
        kind: a.kind,
        course: courseTitles.get(a.courseId) ?? null,
        difficulty: a.difficulty,
        durationMin: a.durationMin,
        dueAt: due,
        maxMarks: a.maxMarks,
        status,
        dueSoon,
        attemptsUsed: a.attempts.filter((x) => x.status !== 'in_progress').length,
        attemptsAllowed: a.attemptsAllowed,
        score: best >= 0 ? best : null,
        passed: best >= 0 ? best >= a.passMarks : null,
      });
    }
    const counts = { pending: 0, due_soon: 0, submitted: 0, completed: 0 };
    for (const x of out) {
      if (x.status === 'pending' || x.status === 'in_progress' || x.status === 'returned') counts.pending++;
      if (x.dueSoon) counts.due_soon++;
      if (x.status === 'submitted') counts.submitted++;
      if (x.status === 'completed') counts.completed++;
    }
    const pick = (x: StudentAssessment) =>
      !filter || filter === 'all'
        ? true
        : filter === 'due_soon'
          ? x.dueSoon
          : filter === 'pending'
            ? ['pending', 'in_progress', 'returned'].includes(x.status)
            : x.status === filter;
    return { counts, items: out.filter(pick), dueSoonRule: 'due within 3 days and not yet submitted' };
  }

  async detail(userId: string, id: string) {
    const a = await this.prisma.assessment.findUnique({ where: { id } });
    if (!a || !(await this.canTake(userId, a))) throw Errors.notFound('No assessment with that ID.');
    const attempts = await this.prisma.attempt.findMany({
      where: { assessmentId: id, studentId: userId },
      orderBy: { number: 'asc' },
    });
    const due = await this.dueFor(userId, a);
    const rel = this.released(a);
    return {
      id: a.id,
      code: a.code,
      title: a.title,
      instructions: a.instructions,
      kind: a.kind,
      format: a.format,
      durationMin: a.durationMin,
      opensAt: a.opensAt,
      dueAt: due,
      maxMarks: a.maxMarks,
      passMarks: a.passMarks,
      attemptsAllowed: a.attemptsAllowed,
      allowLate: a.allowLate,
      status: this.statusOf(a, attempts, due),
      resultsVisible: rel,
      attempts: attempts.map((x) => ({
        id: x.id,
        number: x.number,
        status: x.status,
        startedAt: x.startedAt,
        submittedAt: x.submittedAt,
        late: x.late,
        score: rel && x.status === 'graded' ? x.score : null,
        feedback:
          rel && (x.status === 'graded' || x.status === 'returned')
            ? x.feedback
            : x.status === 'returned'
              ? x.feedback
              : null,
      })),
    };
  }

  /** Starts (or resumes) an attempt. Quiz questions come without answer keys. */
  async start(userId: string, id: string) {
    const a = await this.prisma.assessment.findUnique({
      where: { id },
      include: { questions: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!a || !(await this.canTake(userId, a))) throw Errors.notFound('No assessment with that ID.');
    if (a.status !== 'published') throw new AppError(409, 'ASSESSMENT_CLOSED', 'This assessment is closed.');
    const now = new Date();
    if (a.opensAt && a.opensAt > now)
      throw new AppError(409, 'NOT_OPEN_YET', `This opens on ${a.opensAt.toISOString().slice(0, 16)}Z.`);
    await this.closeExpired(userId, a);
    const open = await this.prisma.attempt.findFirst({
      where: { assessmentId: id, studentId: userId, status: 'in_progress' },
    });
    if (open) return this.attemptView(a, open);
    const due = await this.dueFor(userId, a);
    if (due && now > due && !a.allowLate) throw new AppError(409, 'DEADLINE_PASSED', 'The deadline has passed.');
    const used = await this.prisma.attempt.count({ where: { assessmentId: id, studentId: userId } });
    if (used >= a.attemptsAllowed)
      throw new AppError(409, 'NO_ATTEMPTS_LEFT', `You have used all ${a.attemptsAllowed} attempt(s).`);
    try {
      const att = await this.prisma.attempt.create({
        data: {
          assessmentId: id,
          studentId: userId,
          number: used + 1,
          startedAt: now,
          expiresAt: a.durationMin ? new Date(now.getTime() + a.durationMin * 60_000) : null,
        },
      });
      return this.attemptView(a, att);
    } catch (e) {
      if (isUnique(e)) {
        const again = await this.prisma.attempt.findFirst({
          where: { assessmentId: id, studentId: userId, status: 'in_progress' },
        });
        if (again) return this.attemptView(a, again);
      }
      throw e;
    }
  }

  private attemptView(a: Assessment & { questions: Question[] }, att: Attempt) {
    return {
      attemptId: att.id,
      number: att.number,
      startedAt: att.startedAt,
      expiresAt: att.expiresAt,
      format: a.format,
      questions:
        a.format === 'questions'
          ? a.questions.map((q) => ({ id: q.id, kind: q.kind, prompt: q.prompt, options: q.options, marks: q.marks }))
          : [],
    };
  }

  /** An attempt whose time ran out is closed with what was handed in (nothing), so it cannot block a new one. */
  private async closeExpired(userId: string, a: Assessment & { questions: Question[] }) {
    const stale = await this.prisma.attempt.findMany({
      where: {
        assessmentId: a.id,
        studentId: userId,
        status: 'in_progress',
        expiresAt: { lt: new Date(Date.now() - GRACE_MS) },
      },
    });
    for (const s of stale) {
      const auto = a.format === 'questions' && a.autoGrade;
      await this.prisma.attempt.update({
        where: { id: s.id },
        data: auto
          ? { status: 'graded', submittedAt: s.expiresAt, autoScore: 0, score: 0, gradedAt: new Date() }
          : { status: 'submitted', submittedAt: s.expiresAt },
      });
    }
  }

  async submit(userId: string, attemptId: string, body: { answers?: Answers; text?: string; labRef?: string }) {
    const att = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { assessment: { include: { questions: true } } },
    });
    if (!att || att.studentId !== userId) throw Errors.notFound('No attempt with that ID.');
    const a = att.assessment;
    const resubmission = att.status === 'returned' && a.format !== 'questions';
    if (att.status !== 'in_progress' && !resubmission)
      throw new AppError(409, 'ALREADY_SUBMITTED', 'This attempt was already handed in.');
    const now = new Date();
    if (att.status === 'in_progress' && att.expiresAt && now.getTime() > att.expiresAt.getTime() + GRACE_MS) {
      await this.closeExpired(userId, a);
      throw new AppError(409, 'TIME_UP', 'Time ran out for this attempt.');
    }
    const due = await this.dueFor(userId, a);
    const late = !!due && now > due;
    if (late && !a.allowLate && !resubmission) throw new AppError(409, 'DEADLINE_PASSED', 'The deadline has passed.');
    const data: Prisma.AttemptUpdateInput = { submittedAt: now, late };
    if (a.format === 'questions') {
      const answers = body.answers ?? {};
      const known = new Set(a.questions.map((q) => q.id));
      if (Object.keys(answers).some((k) => !known.has(k)))
        throw Errors.validation('Answer only the questions of this quiz.', 'answers');
      data.answers = answers as Prisma.InputJsonValue;
      if (a.autoGrade) {
        const score = a.questions.reduce((sum, q) => sum + (correct(q, answers[q.id]) ? q.marks : 0), 0);
        Object.assign(data, {
          autoScore: Math.min(score, a.maxMarks),
          score: Math.min(score, a.maxMarks),
          status: 'graded',
          gradedAt: now,
        });
      } else data.status = 'submitted';
    } else if (a.format === 'text') {
      if (!body.text || !body.text.trim()) throw Errors.validation('Write your answer before submitting.', 'text');
      Object.assign(data, { textResponse: body.text, status: 'submitted' });
    } else if (a.format === 'lab_result') {
      if (!body.labRef) throw Errors.validation('Give the lab you cleared.', 'labRef');
      const ok = await this.prisma.studentActivity.count({
        where: { userId, kind: 'lab_completed', refId: body.labRef },
      });
      if (!ok)
        throw new AppError(409, 'LAB_NOT_CLEARED', 'Clear the lab first; only verified lab results can be submitted.');
      Object.assign(data, { labRef: body.labRef, status: 'submitted' });
    } else
      throw new AppError(
        503,
        'STORAGE_NOT_CONFIGURED',
        'File uploads are not available yet. Ask your trainer for another way to hand in.',
      );
    const upd = await this.prisma.attempt.updateMany({
      where: { id: attemptId, status: att.status },
      data: data as Prisma.AttemptUpdateManyMutationInput,
    });
    if (!upd.count) throw new AppError(409, 'ALREADY_SUBMITTED', 'This attempt was already handed in.');
    if (data.status === 'graded') {
      await this.prisma.gradeHistory.create({
        data: { attemptId, fromScore: null, toScore: data.score as number, reason: 'auto-graded', actorId: userId },
      });
      if ((data.score as number) >= a.passMarks) await this.onPass(userId, a);
    }
    const rel = this.released(a);
    return {
      attemptId,
      status: data.status ?? 'submitted',
      late,
      score: rel && data.status === 'graded' ? data.score : null,
      passed: rel && data.status === 'graded' ? (data.score as number) >= a.passMarks : null,
      resultsVisible: rel,
    };
  }

  /** A passed quiz is a verified result: it completes the matching quiz lesson and pays quiz XP once. */
  private async onPass(userId: string, a: Assessment) {
    if (a.kind !== 'quiz' && a.kind !== 'exam') return;
    await this.game.recordActivity(userId, 'quiz_passed', a.code);
    const xp = (await this.settings.get('xp')).value.quizPass;
    if (xp > 0)
      await this.game.award({ userId, delta: xp, source: `quiz:${a.code}:pass`, reason: `Passed ${a.title}` });
    else await this.game.afterChange(userId);
  }

  async results(userId: string) {
    const r = await this.list(userId, 'completed');
    return r.items;
  }

  // ───────────── trainer / admin ─────────────

  /** Courses and batches a trainer may run assessments for. Admins: everything. */
  private async scope(actor: Actor, asAdmin: boolean) {
    if (asAdmin) return null;
    const batches = await this.prisma.batch.findMany({
      where: { OR: [{ trainerId: actor.userId }, { coTrainerIds: { has: actor.userId } }] },
      select: { id: true, courseId: true },
    });
    return {
      batchIds: new Set(batches.map((b) => b.id)),
      courseIds: new Set(batches.map((b) => b.courseId).filter((x): x is string => !!x)),
    };
  }

  private async mine(actor: Actor, id: string, asAdmin: boolean) {
    const a = await this.prisma.assessment.findUnique({
      where: { id },
      include: { questions: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!a) throw Errors.notFound('No assessment with that ID.');
    const sc = await this.scope(actor, asAdmin);
    if (sc && !(a.batchId ? sc.batchIds.has(a.batchId) : sc.courseIds.has(a.courseId)))
      throw Errors.notFound('No assessment with that ID.');
    return a;
  }

  async staffList(actor: Actor, asAdmin: boolean) {
    const sc = await this.scope(actor, asAdmin);
    const where: Prisma.AssessmentWhereInput = sc
      ? { OR: [{ batchId: { in: [...sc.batchIds] } }, { batchId: null, courseId: { in: [...sc.courseIds] } }] }
      : {};
    return this.prisma.assessment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { _count: { select: { attempts: true, questions: true } } },
    });
  }

  async staffGet(actor: Actor, id: string, asAdmin: boolean) {
    return this.mine(actor, id, asAdmin); // staff see answer keys of their own assessments
  }

  async create(actor: Actor, dto: AssessmentDto, asAdmin: boolean) {
    const sc = await this.scope(actor, asAdmin);
    if (sc && !(dto.batchId ? sc.batchIds.has(dto.batchId) : sc.courseIds.has(dto.courseId)))
      throw Errors.forbidden('You can create assessments only for courses and batches you teach.');
    if (dto.batchId && !(await this.prisma.batch.count({ where: { id: dto.batchId, courseId: dto.courseId } })))
      throw Errors.validation('That batch does not run this course.', 'batchId');
    if (dto.passMarks > dto.maxMarks) throw Errors.validation('Pass marks cannot exceed max marks.', 'passMarks');
    try {
      const a = await this.prisma.assessment.create({
        data: {
          code: dto.code,
          courseId: dto.courseId,
          batchId: dto.batchId,
          title: dto.title,
          instructions: dto.instructions ?? '',
          kind: dto.kind,
          difficulty: dto.difficulty ?? '',
          durationMin: dto.durationMin,
          opensAt: dto.opensAt ? new Date(dto.opensAt) : null,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          maxMarks: dto.maxMarks,
          passMarks: dto.passMarks,
          attemptsAllowed: dto.attemptsAllowed ?? 1,
          format: dto.format,
          autoGrade: dto.format === 'questions' && (dto.autoGrade ?? true),
          rubric: (dto.rubric ?? undefined) as Prisma.InputJsonValue | undefined,
          allowLate: dto.allowLate ?? false,
          resultsRelease: dto.resultsRelease ?? 'immediate',
          createdById: actor.userId,
        },
      });
      await this.log('academy.assessment.created', a.id, actor, { code: a.code });
      return a;
    } catch (e) {
      if (isUnique(e)) throw Errors.conflict('CODE_TAKEN', 'An assessment with this code already exists.');
      throw e;
    }
  }

  async patch(actor: Actor, id: string, dto: AssessmentPatchDto, asAdmin: boolean) {
    const a = await this.mine(actor, id, asAdmin);
    const started = await this.prisma.attempt.count({ where: { assessmentId: id } });
    if (started && (dto.maxMarks !== undefined || dto.passMarks !== undefined || dto.format !== undefined))
      throw new AppError(409, 'HAS_ATTEMPTS', 'Marks and format cannot change after students have started.');
    const max = dto.maxMarks ?? a.maxMarks,
      pass = dto.passMarks ?? a.passMarks;
    if (pass > max) throw Errors.validation('Pass marks cannot exceed max marks.', 'passMarks');
    const u = await this.prisma.assessment.update({
      where: { id },
      data: {
        ...(dto.title ? { title: dto.title } : {}),
        ...(dto.instructions !== undefined ? { instructions: dto.instructions } : {}),
        ...(dto.difficulty !== undefined ? { difficulty: dto.difficulty } : {}),
        ...(dto.durationMin !== undefined ? { durationMin: dto.durationMin } : {}),
        ...(dto.opensAt !== undefined ? { opensAt: dto.opensAt ? new Date(dto.opensAt) : null } : {}),
        ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt ? new Date(dto.dueAt) : null } : {}),
        ...(dto.maxMarks !== undefined ? { maxMarks: dto.maxMarks } : {}),
        ...(dto.passMarks !== undefined ? { passMarks: dto.passMarks } : {}),
        ...(dto.attemptsAllowed !== undefined ? { attemptsAllowed: dto.attemptsAllowed } : {}),
        ...(dto.allowLate !== undefined ? { allowLate: dto.allowLate } : {}),
        ...(dto.resultsRelease !== undefined ? { resultsRelease: dto.resultsRelease } : {}),
      },
    });
    await this.log('academy.assessment.updated', id, actor, { fields: Object.keys(dto) });
    return u;
  }

  async setStatus(actor: Actor, id: string, status: 'published' | 'closed' | 'draft', asAdmin: boolean) {
    const a = await this.mine(actor, id, asAdmin);
    if (status === 'published' && a.format === 'questions' && !a.questions.length)
      throw new AppError(409, 'NOT_PUBLISHABLE', 'Add questions before publishing a quiz.');
    if (
      status === 'published' &&
      a.format === 'questions' &&
      a.autoGrade &&
      a.questions.reduce((s, q) => s + q.marks, 0) !== a.maxMarks
    )
      throw new AppError(409, 'MARKS_MISMATCH', 'Question marks must add up to the max marks.');
    if (status === 'draft' && (await this.prisma.attempt.count({ where: { assessmentId: id } })))
      throw new AppError(409, 'HAS_ATTEMPTS', 'Students have started: close it instead.');
    const u = await this.prisma.assessment.update({ where: { id }, data: { status } });
    await this.log(`academy.assessment.${status}`, id, actor, {});
    return u;
  }

  async release(actor: Actor, id: string, asAdmin: boolean) {
    await this.mine(actor, id, asAdmin);
    const u = await this.prisma.assessment.update({ where: { id }, data: { releasedAt: new Date() } });
    await this.log('academy.assessment.released', id, actor, {});
    const graded = await this.prisma.attempt.findMany({
      where: { assessmentId: id, status: 'graded' },
      select: { studentId: true },
    });
    await this.notes.notify(
      graded.map((g) => g.studentId),
      { kind: 'grade', title: `Results released: ${u.title}`, link: '#/lms/assessments', dedupeKey: `release:${id}` },
    );
    return { id, releasedAt: u.releasedAt };
  }

  async addQuestion(actor: Actor, id: string, dto: QuestionDto, asAdmin: boolean) {
    await this.mine(actor, id, asAdmin);
    if (await this.prisma.attempt.count({ where: { assessmentId: id } }))
      throw new AppError(409, 'HAS_ATTEMPTS', 'Questions cannot change after students have started.');
    checkKey(dto);
    const q = await this.prisma.question.create({
      data: {
        assessmentId: id,
        kind: dto.kind,
        prompt: dto.prompt,
        options: dto.options ?? [],
        answerKey: dto.answerKey as Prisma.InputJsonValue,
        marks: dto.marks ?? 1,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.log('academy.assessment.question_added', id, actor, { questionId: q.id });
    return q;
  }

  async deleteQuestion(actor: Actor, questionId: string, asAdmin: boolean) {
    const q = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!q) throw Errors.notFound('No question with that ID.');
    await this.mine(actor, q.assessmentId, asAdmin);
    if (await this.prisma.attempt.count({ where: { assessmentId: q.assessmentId } }))
      throw new AppError(409, 'HAS_ATTEMPTS', 'Questions cannot change after students have started.');
    await this.prisma.question.delete({ where: { id: questionId } });
  }

  /** Submissions of students the caller may see (trainer: own batches; admin: all). */
  async submissions(actor: Actor, id: string, asAdmin: boolean) {
    const a = await this.mine(actor, id, asAdmin);
    let studentFilter: Prisma.AttemptWhereInput = {};
    if (!asAdmin) {
      const sc = (await this.scope(actor, false))!;
      const ids = await this.prisma.enrolment.findMany({
        where: { batchId: { in: [...sc.batchIds] }, status: 'active' },
        select: { studentId: true },
      });
      studentFilter = { studentId: { in: ids.map((x) => x.studentId) } };
    }
    const rows = await this.prisma.attempt.findMany({
      where: { assessmentId: a.id, ...studentFilter, status: { not: 'in_progress' } },
      orderBy: [{ status: 'asc' }, { submittedAt: 'asc' }],
    });
    const names = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: rows.map((r) => r.studentId) } },
          select: { id: true, code: true, studentProfile: { select: { name: true } } },
        })
      ).map((u) => [u.id, { code: u.code, name: u.studentProfile?.name ?? null }]),
    );
    return rows.map((r) => ({ ...r, student: names.get(r.studentId) ?? null }));
  }

  /** Grade or return for revision. A changed mark needs a reason; every mark is kept in grade_history. */
  async grade(actor: Actor, attemptId: string, dto: GradeDto, asAdmin: boolean) {
    const att = await this.prisma.attempt.findUnique({ where: { id: attemptId } });
    if (!att) throw Errors.notFound('No attempt with that ID.');
    const a = await this.mine(actor, att.assessmentId, asAdmin);
    if (!asAdmin) {
      const sc = (await this.scope(actor, false))!;
      const ok = await this.prisma.enrolment.count({
        where: { studentId: att.studentId, batchId: { in: [...sc.batchIds] }, status: 'active' },
      });
      if (!ok) throw Errors.notFound('No attempt with that ID.');
    }
    if (att.status === 'in_progress')
      throw new AppError(409, 'NOT_SUBMITTED', 'The student has not handed this in yet.');
    if (dto.score > a.maxMarks || dto.score < 0)
      throw Errors.validation(`Give a mark from 0 to ${a.maxMarks}.`, 'score');
    const changing = att.score !== null && att.score !== dto.score;
    if (changing && (!dto.reason || dto.reason.trim().length < 5)) throw Errors.reasonRequired();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.attempt.update({
        where: { id: attemptId },
        data: {
          score: dto.score,
          feedback: dto.feedback,
          rubricScores: (dto.rubricScores ?? undefined) as Prisma.InputJsonValue | undefined,
          status: dto.returnForRevision ? 'returned' : 'graded',
          gradedById: actor.userId,
          gradedAt: now,
        },
      });
      await tx.gradeHistory.create({
        data: {
          attemptId,
          fromScore: att.score,
          toScore: dto.score,
          reason: dto.reason ?? null,
          actorId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: changing ? 'academy.grade.changed' : 'academy.grade.given',
          actorId: actor.userId,
          actorRole: asAdmin ? 'admin' : 'trainer',
          targetType: 'attempt',
          targetId: attemptId,
          detail: { from: att.score, to: dto.score, returned: !!dto.returnForRevision },
          reason: dto.reason,
          ip: actor.ip,
          requestId: actor.requestId,
        },
        tx,
      );
    });
    if (!dto.returnForRevision && dto.score >= a.passMarks) await this.onPass(att.studentId, a);
    // Scores stay hidden until results are released, so the bell says only what the student may already see.
    if (dto.returnForRevision || this.released(a))
      await this.notes.notify(att.studentId, {
        kind: 'grade',
        title: dto.returnForRevision ? `Returned for revision: ${a.title}` : `Graded: ${a.title}`,
        link: '#/lms/assessments',
        important: !!dto.returnForRevision,
        dedupeKey: `grade:${attemptId}:${now.getTime()}`,
      });
    return { attemptId, score: dto.score, status: dto.returnForRevision ? 'returned' : 'graded' };
  }

  async extend(actor: Actor, id: string, studentId: string, dueAt: string, reason: string, asAdmin: boolean) {
    await this.mine(actor, id, asAdmin);
    const d = new Date(dueAt);
    if (d.getTime() < Date.now()) throw Errors.validation('The new deadline must be in the future.', 'dueAt');
    await this.prisma.assessmentExtension.upsert({
      where: { assessmentId_studentId: { assessmentId: id, studentId } },
      create: { assessmentId: id, studentId, dueAt: d, grantedById: actor.userId, reason },
      update: { dueAt: d, grantedById: actor.userId, reason },
    });
    await this.log('academy.assessment.extension', id, actor, { studentId, dueAt }, reason);
    return { assessmentId: id, studentId, dueAt: d };
  }

  async report(actor: Actor, id: string, asAdmin: boolean) {
    const a = await this.mine(actor, id, asAdmin);
    const graded = await this.prisma.attempt.findMany({
      where: { assessmentId: id, status: 'graded' },
      select: { studentId: true, score: true },
    });
    const best = new Map<string, number>();
    for (const g of graded) best.set(g.studentId, Math.max(best.get(g.studentId) ?? 0, g.score ?? 0));
    const scores = [...best.values()];
    return {
      id,
      title: a.title,
      maxMarks: a.maxMarks,
      graded: scores.length,
      submitted: await this.prisma.attempt.count({
        where: { assessmentId: id, status: { in: ['submitted', 'returned'] } },
      }),
      average: scores.length ? Math.round((10 * scores.reduce((s, x) => s + x, 0)) / scores.length) / 10 : null,
      passRatePct: scores.length
        ? Math.round((100 * scores.filter((x) => x >= a.passMarks).length) / scores.length)
        : null,
      rule: "Each student's best graded attempt counts once.",
    };
  }

  private log(action: string, id: string, actor: Actor, detail: Record<string, unknown>, reason?: string) {
    return this.audit.record({
      action,
      actorId: actor.userId,
      targetType: 'assessment',
      targetId: id,
      detail,
      reason,
      ip: actor.ip,
      requestId: actor.requestId,
    });
  }
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function correct(q: Question, given: number | number[] | string | undefined): boolean {
  if (given === undefined) return false;
  const key = q.answerKey as unknown;
  if (q.kind === 'single') return typeof given === 'number' && given === key;
  if (q.kind === 'multi') {
    if (!Array.isArray(given) || !Array.isArray(key)) return false;
    const a = [...new Set(given)].sort(),
      b = [...(key as number[])].sort();
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return typeof given === 'string' && Array.isArray(key) && (key as string[]).some((k) => norm(k) === norm(given));
}

function checkKey(dto: QuestionDto) {
  const n = dto.options?.length ?? 0;
  const k = dto.answerKey as unknown;
  const ok =
    dto.kind === 'single'
      ? typeof k === 'number' && Number.isInteger(k) && k >= 0 && k < n
      : dto.kind === 'multi'
        ? Array.isArray(k) &&
          k.length > 0 &&
          k.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < n)
        : Array.isArray(k) &&
          k.length > 0 &&
          k.every((x) => typeof x === 'string' && x.trim().length > 0 && x.length <= 200);
  if (!ok) throw Errors.validation('The answer key does not fit the question.', 'answerKey');
  if (dto.kind !== 'short_text' && n < 2) throw Errors.validation('Give at least two options.', 'options');
}
