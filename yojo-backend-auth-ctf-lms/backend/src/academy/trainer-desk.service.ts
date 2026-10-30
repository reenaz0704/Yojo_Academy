import { Injectable } from '@nestjs/common';
import type { Prisma, RemarkKind, StaffRequestKind } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { RateLimitService } from '../common/guards/rate-limit.service';
import { AppError, Errors } from '../common/errors/app-error';
import type { RequestMeta } from '../identity/types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { PlacementService } from './placement.service';

type Actor = RequestMeta & { userId: string };
const DAY = 86_400_000;

/**
 * Trainer desk (owner, 26 Oct). Everything a trainer does about one student, scoped on the server to students
 * actively enrolled in a batch the trainer leads or co-leads; any other student ID answers 404 (no existence leak):
 *  - student 360: attendance in the trainer's batches, assessment results, lab progress, mentoring history,
 *    visible remarks, the requests raised about the student and a placement summary;
 *  - remarks (shared with the student's trainers and admins) and private notes (author and admins only),
 *    never deleted, edits keep history;
 *  - requests to the Platform Admin: escalate a concern, or ask the admin to contact the guardian (trainers never
 *    see guardian details);
 *  - Lab Monitor: per student step progress, hints used and last activity from the Academy's own mission records
 *    (flags and answers are never returned), and a nudge (an in-app notification to the student);
 *  - start a message to a student, record a mentoring session's outcome;
 *  - student feedback on trainers: students rate sessions they attended (no time limit, one rating per session that
 *    the student may change); trainers read it without names and can neither edit nor delete it.
 * Every write is audited.
 */
@Injectable()
export class TrainerDeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rate: RateLimitService,
    private readonly notes: NotificationsService,
    private readonly placement: PlacementService,
  ) {}

  private batchScope(trainerId: string): Prisma.BatchWhereInput {
    return { OR: [{ trainerId }, { coTrainerIds: { has: trainerId } }] };
  }

  /** The trainer's batches that this student is actively enrolled in; 404 when there are none. */
  private async sharedBatches(trainerId: string, studentId: string) {
    const rows = await this.prisma.enrolment.findMany({
      where: { studentId, status: 'active', batch: this.batchScope(trainerId) },
      select: { batch: { select: { id: true, code: true, name: true, courseId: true } } },
    });
    if (!rows.length) throw Errors.notFound('No student of your batches with that ID.');
    return rows.map((r) => r.batch);
  }

  private async studentIdsOf(trainerId: string, batchId?: string) {
    const rows = await this.prisma.enrolment.findMany({
      where: { status: 'active', batch: { ...this.batchScope(trainerId), ...(batchId ? { id: batchId } : {}) } },
      select: { studentId: true, batch: { select: { code: true } } },
    });
    return rows;
  }

  private log(action: string, type: string, id: string, actor: Actor, detail: Record<string, unknown> = {}) {
    return this.audit.record({
      action,
      actorId: actor.userId,
      actorRole: 'trainer',
      targetType: type,
      targetId: id,
      detail,
      ip: actor.ip,
      requestId: actor.requestId,
    });
  }

  // ───────────── student 360 ─────────────

  async student(trainerId: string, studentId: string) {
    const batches = await this.sharedBatches(trainerId, studentId);
    const bIds = batches.map((b) => b.id);
    const courseIds = batches.map((b) => b.courseId).filter((x): x is string => !!x);
    const [
      user,
      sessions,
      attempts,
      missions,
      objectives,
      hints,
      attemptsLab,
      mentoring,
      remarks,
      requests,
      placement,
    ] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: studentId },
        select: {
          code: true,
          displayName: true,
          lastLoginAt: true,
          studentProfile: { select: { name: true } },
        },
      }),
      this.prisma.classSession.findMany({
        where: { batchId: { in: bIds }, startsAt: { lte: new Date() }, status: { not: 'cancelled' } },
        orderBy: { startsAt: 'desc' },
        take: 100,
        select: {
          id: true,
          title: true,
          type: true,
          startsAt: true,
          countsForAttendance: true,
          batch: { select: { code: true } },
          attendance: { where: { studentId }, select: { mark: true } },
        },
      }),
      this.prisma.attempt.findMany({
        where: {
          studentId,
          assessment: {
            OR: [{ batchId: { in: bIds } }, { batchId: null, courseId: { in: courseIds } }],
          },
        },
        orderBy: { startedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          number: true,
          status: true,
          submittedAt: true,
          late: true,
          score: true,
          gradedAt: true,
          assessment: {
            select: { id: true, title: true, kind: true, dueAt: true, maxMarks: true, passMarks: true },
          },
        },
      }),
      this.prisma.mission.findMany({
        where: { status: 'published' },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        select: { code: true, title: true, _count: { select: { objectives: true } } },
      }),
      this.prisma.objectiveProgress.findMany({
        where: { userId: studentId },
        select: { missionCode: true, completedAt: true, updatedAt: true },
      }),
      this.prisma.hintUse.groupBy({ by: ['missionCode'], where: { userId: studentId }, _count: { _all: true } }),
      this.prisma.missionAttempt.findMany({
        where: { userId: studentId },
        select: { missionCode: true, status: true, startedAt: true, completedAt: true },
      }),
      this.prisma.sessionRequest.findMany({
        where: { studentId, trainerId },
        orderBy: { startsAt: 'desc' },
        take: 50,
        select: {
          id: true,
          purpose: true,
          startsAt: true,
          status: true,
          outcome: true,
          followUp: true,
          outcomeAt: true,
        },
      }),
      this.visibleRemarks(trainerId, studentId),
      this.prisma.studentStaffRequest.findMany({
        where: { studentId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          code: true,
          kind: true,
          reason: true,
          status: true,
          resolution: true,
          createdAt: true,
          resolvedAt: true,
          raisedById: true,
        },
      }),
      this.placement.overview(studentId),
    ]);
    const counts = { present: 0, late: 0, absent: 0, excused: 0, unmarked: 0 };
    const attendance = sessions.map((s) => {
      const mark = s.attendance[0]?.mark ?? null;
      if (s.countsForAttendance) mark ? counts[mark]++ : counts.unmarked++;
      return {
        sessionId: s.id,
        title: s.title,
        type: s.type,
        batch: s.batch.code,
        startsAt: s.startsAt,
        countsForAttendance: s.countsForAttendance,
        mark,
      };
    });
    const marked = counts.present + counts.late + counts.absent;
    const hintBy = new Map(hints.map((h) => [h.missionCode, h._count._all]));
    const labs = missions.map((m) => {
      const prog = objectives.filter((o) => o.missionCode === m.code);
      const att = attemptsLab.filter((a) => a.missionCode === m.code);
      const cleared = att.some((a) => a.status === 'completed');
      const active = att.some((a) => a.status === 'active');
      const last = [...prog.map((p) => p.updatedAt), ...att.map((a) => a.completedAt ?? a.startedAt)]
        .filter((d): d is Date => !!d)
        .sort((a, b) => +b - +a)[0];
      return {
        code: m.code,
        title: m.title,
        state: cleared ? 'cleared' : active || prog.length ? 'in_progress' : 'not_started',
        stepsDone: prog.filter((p) => p.completedAt).length,
        steps: m._count.objectives,
        hintsUsed: hintBy.get(m.code) ?? 0,
        lastActivity: last ?? null,
      };
    });
    const names = await this.names(requests.map((r) => r.raisedById));
    return {
      student: {
        id: studentId,
        code: user.code,
        name: user.studentProfile?.name ?? user.displayName,
        lastLoginAt: user.lastLoginAt,
      },
      batches: batches.map((b) => ({ id: b.id, code: b.code, name: b.name })),
      attendance: {
        pct: marked ? Math.round((100 * (counts.present + counts.late)) / marked) : null,
        counts,
        sessions: attendance,
      },
      assessments: attempts.map((a) => ({
        attemptId: a.id,
        assessmentId: a.assessment.id,
        title: a.assessment.title,
        kind: a.assessment.kind,
        dueAt: a.assessment.dueAt,
        attempt: a.number,
        status: a.status,
        submittedAt: a.submittedAt,
        late: a.late,
        score: a.score,
        maxMarks: a.assessment.maxMarks,
        passed: a.score === null ? null : a.score >= a.assessment.passMarks,
      })),
      labs,
      mentoring,
      remarks,
      requests: requests.map(({ raisedById, ...r }) => ({
        ...r,
        raisedBy: names.get(raisedById) ?? null,
        mine: raisedById === trainerId,
      })),
      placement: {
        overall: placement.overall,
        resume: placement.parts.resume.status,
        mocks: placement.parts.mock.done,
        mockTarget: placement.parts.mock.target,
        communicationAvg: placement.parts.mock.communicationAvg,
        portfolioApproved: placement.parts.portfolio.approved,
        internshipPct: placement.parts.internship.pct,
      },
      hidden: 'Fees, payments, guardian details, other batches, lab flags and answers are never shown to trainers.',
    };
  }

  private async names(ids: (string | null)[]) {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = await this.prisma.user.findMany({
      where: { id: { in: uniq } },
      select: { id: true, displayName: true, email: true, staffProfile: { select: { displayName: true } } },
    });
    return new Map(rows.map((r) => [r.id, r.staffProfile?.displayName ?? r.displayName ?? r.email]));
  }

  // ───────────── remarks ─────────────

  private async visibleRemarks(trainerId: string, studentId: string) {
    const rows = await this.prisma.studentRemark.findMany({
      where: { studentId, OR: [{ kind: 'remark' }, { authorId: trainerId }] },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const names = await this.names(rows.map((r) => r.authorId));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      text: r.text,
      author: names.get(r.authorId) ?? null,
      mine: r.authorId === trainerId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      history: r.history as { at: string; text: string }[],
    }));
  }

  async addRemark(actor: Actor, studentId: string, kind: RemarkKind, text: string) {
    await this.sharedBatches(actor.userId, studentId);
    await this.rate.hitClass('trainer_note_user', actor.userId);
    const r = await this.prisma.studentRemark.create({
      data: { studentId, authorId: actor.userId, kind, text: text.trim() },
    });
    await this.log('trainer.remark.added', 'user', studentId, actor, { remarkId: r.id, kind });
    return { id: r.id, kind: r.kind, createdAt: r.createdAt };
  }

  /** Only the author edits, only while the student is still in one of their batches; the old text goes to history. */
  async editRemark(actor: Actor, id: string, text: string) {
    const r = await this.prisma.studentRemark.findUnique({ where: { id } });
    if (!r || r.authorId !== actor.userId) throw Errors.notFound('No remark of yours with that ID.');
    await this.sharedBatches(actor.userId, r.studentId);
    const history = [...(r.history as { at: string; text: string }[]), { at: r.updatedAt.toISOString(), text: r.text }];
    const upd = await this.prisma.studentRemark.updateMany({
      where: { id, updatedAt: r.updatedAt }, // last write does not silently win
      data: { text: text.trim(), history },
    });
    if (!upd.count) throw Errors.conflict('REMARK_CHANGED', 'This remark changed. Reload it.');
    await this.log('trainer.remark.edited', 'user', r.studentId, actor, { remarkId: id });
    return { id, edited: true };
  }

  // ───────────── requests to the Platform Admin ─────────────

  async raiseRequest(actor: Actor, studentId: string, kind: StaffRequestKind, reason: string) {
    await this.sharedBatches(actor.userId, studentId);
    await this.rate.hitClass('trainer_note_user', actor.userId);
    const open = await this.prisma.studentStaffRequest.findFirst({
      where: { studentId, kind, status: 'open', raisedById: actor.userId },
      select: { code: true },
    });
    if (open)
      throw Errors.conflict('REQUEST_OPEN', `You already have an open request (${open.code}) for this student.`);
    const r = await this.prisma.studentStaffRequest.create({
      data: { studentId, raisedById: actor.userId, kind, reason: reason.trim() },
    });
    await this.log(`trainer.request.${kind}`, 'user', studentId, actor, { requestId: r.id, code: r.code });
    const admins = await this.prisma.user.findMany({
      where: { role: 'admin', status: 'active' },
      select: { id: true },
    });
    await this.notes.notify(
      admins.map((a) => a.id),
      {
        kind: 'staff_request',
        title:
          kind === 'escalation' ? `Escalation ${r.code}: a trainer flagged a student` : `${r.code}: contact a guardian`,
        body: 'Open the student report to read the request and resolve it.',
        link: `#/admin/reports/${studentId}`,
        // in-app only: every active admin gets it, and an email per admin would need the mail provider (OI-01)
        important: false,
        dedupeKey: `staff_request:${r.id}`,
      },
    );
    return { id: r.id, code: r.code, status: r.status };
  }

  /** Admin view: open (or all) requests, newest first. */
  async listRequests(status?: 'open' | 'resolved') {
    const rows = await this.prisma.studentStaffRequest.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { student: { select: { code: true, displayName: true, studentProfile: { select: { name: true } } } } },
    });
    const names = await this.names(rows.flatMap((r) => [r.raisedById, r.resolvedById]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        kind: r.kind,
        status: r.status,
        reason: r.reason,
        studentId: r.studentId,
        student: r.student.studentProfile?.name ?? r.student.displayName,
        studentCode: r.student.code,
        raisedBy: names.get(r.raisedById) ?? null,
        createdAt: r.createdAt,
        resolution: r.resolution,
        resolvedBy: r.resolvedById ? (names.get(r.resolvedById) ?? null) : null,
        resolvedAt: r.resolvedAt,
      })),
    };
  }

  async resolveRequest(actor: Actor, id: string, resolution: string) {
    const r = await this.prisma.studentStaffRequest.findUnique({ where: { id } });
    if (!r) throw Errors.notFound('No request with that ID.');
    const upd = await this.prisma.studentStaffRequest.updateMany({
      where: { id, status: 'open' },
      data: { status: 'resolved', resolution: resolution.trim(), resolvedById: actor.userId, resolvedAt: new Date() },
    });
    if (!upd.count) throw Errors.conflict('REQUEST_RESOLVED', 'This request is already resolved.');
    await this.audit.record({
      action: 'admin.staff_request.resolved',
      actorId: actor.userId,
      actorRole: 'admin',
      targetType: 'user',
      targetId: r.studentId,
      detail: { requestId: id, code: r.code },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    await this.notes.notify(r.raisedById, {
      kind: 'staff_request',
      title: `${r.code} resolved by the admin`,
      body: resolution.trim().slice(0, 300),
      link: `#/students/${r.studentId}`, // the trainer console adds its own /trainer prefix
      dedupeKey: `staff_request:${id}:resolved`,
    });
    return { id, status: 'resolved' };
  }

  // ───────────── Lab Monitor ─────────────

  async labs(trainerId: string, batchId?: string) {
    const enr = await this.studentIdsOf(trainerId, batchId);
    if (batchId && !enr.length) {
      const ok = await this.prisma.batch.count({ where: { id: batchId, ...this.batchScope(trainerId) } });
      if (!ok) throw Errors.notFound('No batch of yours with that ID.');
    }
    const ids = [...new Set(enr.map((e) => e.studentId))];
    const batchOf = new Map<string, string[]>();
    for (const e of enr) batchOf.set(e.studentId, [...(batchOf.get(e.studentId) ?? []), e.batch.code]);
    const [missions, people, prog, hints, attempts] = await Promise.all([
      this.prisma.mission.findMany({
        where: { status: 'published' },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        select: { code: true, title: true, _count: { select: { objectives: true } } },
      }),
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, code: true, displayName: true, studentProfile: { select: { name: true } } },
      }),
      this.prisma.objectiveProgress.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, missionCode: true, completedAt: true, updatedAt: true, tries: true },
      }),
      this.prisma.hintUse.groupBy({
        by: ['userId', 'missionCode'],
        where: { userId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.missionAttempt.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, missionCode: true, status: true, startedAt: true, completedAt: true },
      }),
    ]);
    const key = (u: string, m: string) => `${u}|${m}`;
    const hintBy = new Map(hints.map((h) => [key(h.userId, h.missionCode), h._count._all]));
    const now = Date.now();
    const rows = people
      .map((p) => {
        const cells = missions.map((m) => {
          const pr = prog.filter((x) => x.userId === p.id && x.missionCode === m.code);
          const at = attempts.filter((x) => x.userId === p.id && x.missionCode === m.code);
          const cleared = at.some((a) => a.status === 'completed');
          const active = at.some((a) => a.status === 'active');
          const last = [...pr.map((x) => x.updatedAt), ...at.map((a) => a.completedAt ?? a.startedAt)].sort(
            (a, b) => +b - +a,
          )[0];
          const stepsDone = pr.filter((x) => x.completedAt).length;
          // Stuck: an open attempt with no progress for 3 days, or 5+ tries on a step not yet done (informational).
          const stuck =
            !cleared &&
            active &&
            ((last && now - last.getTime() > 3 * DAY) || pr.some((x) => !x.completedAt && x.tries >= 5));
          return {
            code: m.code,
            state: cleared ? 'cleared' : stuck ? 'stuck' : active || pr.length ? 'in_progress' : 'not_started',
            stepsDone,
            steps: m._count.objectives,
            hintsUsed: hintBy.get(key(p.id, m.code)) ?? 0,
            lastActivity: last ?? null,
          };
        });
        return {
          studentId: p.id,
          code: p.code,
          name: p.studentProfile?.name ?? p.displayName,
          batches: batchOf.get(p.id) ?? [],
          cleared: cells.filter((c) => c.state === 'cleared').length,
          stuck: cells.filter((c) => c.state === 'stuck').map((c) => c.code),
          labs: cells,
        };
      })
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    return {
      missions: missions.map((m) => ({ code: m.code, title: m.title, steps: m._count.objectives })),
      students: rows,
      rules: {
        stuck: 'An open lab with no progress for 3 days, or 5 or more tries on a step that is not done yet.',
        hidden: 'Flags, answers and hint texts are never shown to trainers.',
      },
    };
  }

  async nudge(actor: Actor, studentId: string, missionCode: string, message?: string) {
    await this.sharedBatches(actor.userId, studentId);
    const m = await this.prisma.mission.findFirst({ where: { code: missionCode, status: 'published' } });
    if (!m) throw Errors.notFound('No lab with that code.');
    await this.rate.hitClass('nudge_user', actor.userId);
    const day = new Date().toISOString().slice(0, 10);
    const n = await this.notes.notify(studentId, {
      kind: 'nudge',
      title: `Your trainer checked in on ${m.title}`,
      body: (
        message?.trim() || 'Need a hand? Open the lab again, or message your trainer from the Training Grid.'
      ).slice(0, 500),
      link: `#/academy/lab/${m.code}`,
      dedupeKey: `nudge:${m.code}:${day}`, // one nudge per student, lab and day
    });
    if (!n) throw new AppError(409, 'ALREADY_NUDGED', 'This student was already nudged about this lab today.');
    await this.log('trainer.lab.nudged', 'user', studentId, actor, { mission: m.code });
    return { sent: true };
  }

  // ───────────── messages and mentoring ─────────────

  /** A trainer starts a conversation with a student of their batches (the student was the only starter before). */
  async startConversation(actor: Actor, studentId: string, subject: string, body: string) {
    await this.sharedBatches(actor.userId, studentId);
    await this.rate.hitClass('message_user', actor.userId);
    const c = await this.prisma.conversation.create({
      data: {
        studentId,
        staffId: actor.userId,
        subject: subject.trim(),
        messages: { create: { senderId: actor.userId, body: body.trim() } },
      },
    });
    await this.notes.notify(studentId, {
      kind: 'message',
      title: `New message from your trainer: ${subject.trim()}`.slice(0, 150),
      link: '#/lms/trainer',
      dedupeKey: `conversation:${c.id}`,
    });
    await this.log('trainer.message.started', 'conversation', c.id, actor, { studentId });
    return { id: c.id };
  }

  /** After a mentoring session (start time passed, approved or completed): what was covered and the follow-up. */
  async recordOutcome(actor: Actor, id: string, outcome: string, followUp?: string) {
    const r = await this.prisma.sessionRequest.findFirst({ where: { id, trainerId: actor.userId } });
    if (!r) throw Errors.notFound('No session of yours with that ID.');
    if (r.status !== 'approved' && r.status !== 'completed')
      throw new AppError(409, 'NOT_APPROVED', 'Only an approved session can get an outcome.');
    if (r.startsAt.getTime() > Date.now())
      throw new AppError(409, 'NOT_STARTED', 'Record the outcome after the session.');
    await this.prisma.sessionRequest.update({
      where: { id },
      data: { status: 'completed', outcome: outcome.trim(), followUp: followUp?.trim() || null, outcomeAt: new Date() },
    });
    await this.log('trainer.mentoring.outcome', 'session_request', id, actor, { studentId: r.studentId });
    return { id, status: 'completed' };
  }

  /** Mentoring sessions whose time has passed and that still have no outcome (dashboard task). */
  outcomesDue(trainerId: string) {
    return this.prisma.sessionRequest.count({
      where: {
        trainerId,
        purpose: { not: 'mock_interview' }, // a mock interview has its own result form
        status: { in: ['approved', 'completed'] },
        outcome: null,
        startsAt: { lt: new Date() },
      },
    });
  }

  // ───────────── feedback ─────────────

  /**
   * Student: sessions they may rate and what they already rated. No time limit (owner, OI-60): any class they
   * attended (present or late) or mentoring session they had, once it has ended. One rating per session, which the
   * student may change later (so a session never counts twice in an average).
   */
  async studentFeedback(studentId: string) {
    const now = new Date();
    const [classes, mentoring, given] = await Promise.all([
      this.prisma.classSession.findMany({
        where: {
          trainerId: { not: null },
          endsAt: { lte: now },
          status: { not: 'cancelled' },
          attendance: { some: { studentId, mark: { in: ['present', 'late'] } } },
          feedback: { none: { studentId } },
        },
        orderBy: { startsAt: 'desc' },
        take: 50,
        select: {
          id: true,
          title: true,
          type: true,
          startsAt: true,
          trainerId: true,
          batch: { select: { code: true } },
        },
      }),
      this.prisma.sessionRequest.findMany({
        where: { studentId, status: 'completed', endsAt: { lte: now }, feedback: { none: { studentId } } },
        orderBy: { startsAt: 'desc' },
        take: 50,
        select: { id: true, purpose: true, startsAt: true, trainerId: true },
      }),
      this.prisma.trainerFeedback.findMany({
        where: { studentId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          sessionId: true,
          sessionRequestId: true,
          session: { select: { title: true, startsAt: true } },
          sessionRequest: { select: { purpose: true, startsAt: true } },
        },
      }),
    ]);
    const names = await this.names([...classes.map((c) => c.trainerId), ...mentoring.map((m) => m.trainerId)]);
    const mentoringTitle = (purpose: string) =>
      purpose === 'mock_interview' ? 'Mock interview' : purpose === 'doubt' ? 'Doubt session' : 'Mentoring session';
    return {
      rateable: [
        ...classes.map((c) => ({
          kind: 'class' as const,
          sessionId: c.id,
          title: c.title,
          type: c.type,
          batch: c.batch.code,
          at: c.startsAt,
          trainer: names.get(c.trainerId!) ?? null,
        })),
        ...mentoring.map((m) => ({
          kind: 'mentoring' as const,
          sessionRequestId: m.id,
          title: mentoringTitle(m.purpose),
          at: m.startsAt,
          trainer: names.get(m.trainerId) ?? null,
        })),
      ],
      given: given.map((g) => ({
        id: g.id,
        rating: g.rating,
        comment: g.comment,
        at: g.createdAt,
        sessionId: g.sessionId,
        sessionRequestId: g.sessionRequestId,
        about: g.session?.title ?? (g.sessionRequest ? mentoringTitle(g.sessionRequest.purpose) : null),
      })),
    };
  }

  /** Create or change the student's one rating for a session they attended (or a mentoring session they had). */
  async giveFeedback(
    studentId: string,
    dto: { sessionId?: string; sessionRequestId?: string; rating: number; comment?: string },
    meta: RequestMeta,
  ) {
    if (!!dto.sessionId === !!dto.sessionRequestId)
      throw Errors.validation('Rate either a class session or a mentoring session.', 'sessionId');
    await this.rate.hitClass('feedback_user', studentId);
    let trainerId: string;
    if (dto.sessionId) {
      const s = await this.prisma.classSession.findUnique({
        where: { id: dto.sessionId },
        select: {
          trainerId: true,
          endsAt: true,
          status: true,
          attendance: { where: { studentId }, select: { mark: true } },
        },
      });
      const mark = s?.attendance[0]?.mark;
      if (!s || !s.trainerId || s.status === 'cancelled' || (mark !== 'present' && mark !== 'late'))
        throw Errors.notFound('You can rate only sessions you attended.');
      if (s.endsAt.getTime() > Date.now()) throw new AppError(409, 'SESSION_NOT_OVER', 'Rate a session after it ends.');
      trainerId = s.trainerId;
    } else {
      const r = await this.prisma.sessionRequest.findFirst({
        where: { id: dto.sessionRequestId, studentId, status: 'completed' },
        select: { trainerId: true },
      });
      if (!r) throw Errors.notFound('You can rate only your completed mentoring sessions.');
      trainerId = r.trainerId;
    }
    const target = dto.sessionId
      ? { studentId_sessionId: { studentId, sessionId: dto.sessionId } }
      : { studentId_sessionRequestId: { studentId, sessionRequestId: dto.sessionRequestId! } };
    const before = await this.prisma.trainerFeedback.findUnique({ where: target, select: { id: true, rating: true } });
    const comment = dto.comment?.trim() || null;
    const f = before
      ? await this.prisma.trainerFeedback.update({ where: { id: before.id }, data: { rating: dto.rating, comment } })
      : await this.prisma.trainerFeedback.create({
          data: {
            studentId,
            trainerId,
            sessionId: dto.sessionId ?? null,
            sessionRequestId: dto.sessionRequestId ?? null,
            rating: dto.rating,
            comment,
          },
        });
    await this.audit.record({
      action: before ? 'student.feedback.changed' : 'student.feedback.given',
      actorId: studentId,
      actorRole: 'student',
      targetType: 'user',
      targetId: trainerId,
      detail: { feedbackId: f.id, rating: dto.rating, ...(before ? { previousRating: before.rating } : {}) },
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return { id: f.id, changed: !!before };
  }

  /** Trainer (own) or admin (any trainer). Trainers never get student names or IDs. */
  async trainerFeedback(trainerId: string, opts: { page?: number; rating?: number; asAdmin?: boolean } = {}) {
    const where: Prisma.TrainerFeedbackWhereInput = { trainerId, ...(opts.rating ? { rating: opts.rating } : {}) };
    const page = Math.max(1, opts.page ?? 1);
    const [all, total, rows] = await Promise.all([
      this.prisma.trainerFeedback.groupBy({ by: ['rating'], where: { trainerId }, _count: { _all: true } }),
      this.prisma.trainerFeedback.count({ where }),
      this.prisma.trainerFeedback.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * 20,
        take: 20,
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          studentId: true,
          session: { select: { title: true, type: true, startsAt: true, batch: { select: { code: true } } } },
          sessionRequest: { select: { purpose: true, startsAt: true } },
        },
      }),
    ]);
    const count = all.reduce((n, r) => n + r._count._all, 0);
    const sum = all.reduce((n, r) => n + r.rating * r._count._all, 0);
    const names = opts.asAdmin ? await this.names(rows.map((r) => r.studentId)) : null;
    return {
      summary: {
        count,
        average: count ? Math.round((10 * sum) / count) / 10 : null,
        byRating: [5, 4, 3, 2, 1].map((r) => ({ rating: r, count: all.find((x) => x.rating === r)?._count._all ?? 0 })),
      },
      page,
      pageSize: 20,
      total,
      items: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        at: r.createdAt,
        context: r.session
          ? {
              kind: 'class',
              title: r.session.title,
              type: r.session.type,
              batch: r.session.batch.code,
              startsAt: r.session.startsAt,
            }
          : {
              kind: 'mentoring',
              title: r.sessionRequest?.purpose === 'mock_interview' ? 'Mock interview' : 'One-to-one session',
              startsAt: r.sessionRequest?.startsAt ?? null,
            },
        ...(names ? { student: names.get(r.studentId) ?? null } : {}),
      })),
      privacy: opts.asAdmin
        ? 'Admins see who wrote each rating for moderation.'
        : 'Ratings are anonymous: you see the session, not the student. Each student has one rating per session; trainers cannot edit or delete feedback.',
    };
  }
}
