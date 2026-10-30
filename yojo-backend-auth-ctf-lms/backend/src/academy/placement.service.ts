import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors/app-error';
import type { RequestMeta } from '../identity/types';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

type Actor = RequestMeta & { userId: string };
const CATEGORIES = ['Offensive', 'Defensive', 'GRC'] as const;

/**
 * Placement Mission (docs/ACADEMY-INVENTORY.md, slice g). Readiness is recalculated on every read from verified
 * records, with weights from settings.placement (default equal 25/25/25/25, a product decision):
 *   resume     = 100 approved by a trainer, 50 submitted or sent back for changes, 0 not submitted;
 *   mock       = half mock interviews done ÷ mockTarget (max 100), half communication skill (the average of the
 *                trainer's 1–5 communication score over recorded interviews, as %; 0 before the first one). OI-49;
 *   internship = milestones verified done ÷ active milestones (0 when none are configured);
 *   portfolio  = trainer-approved projects ÷ portfolioTarget (max 100).
 * Skill gaps list evidence per track (labs cleared, quizzes passed); they are a study aid, not a hiring prediction.
 */
@Injectable()
export class PlacementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async overview(userId: string) {
    const cfg = (await this.settings.get('placement')).value;
    const [resume, mocks, milestones, mine, projects, booked] = await Promise.all([
      this.prisma.resume.findUnique({ where: { userId } }),
      this.prisma.mockInterviewResult.findMany({ where: { studentId: userId }, orderBy: { completedAt: 'desc' } }),
      this.prisma.placementMilestone.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.studentMilestone.findMany({ where: { userId } }),
      this.prisma.portfolioProject.findMany({ where: { userId }, select: { status: true } }),
      this.prisma.sessionRequest.count({
        where: { studentId: userId, purpose: 'mock_interview', status: { in: ['pending', 'approved', 'proposed'] } },
      }),
    ]);
    const rs = resume?.status ?? 'not_submitted';
    const interviews = Math.min(100, Math.round((100 * mocks.length) / cfg.mockTarget));
    const commAvg = mocks.length ? mocks.reduce((s, m) => s + m.communication, 0) / mocks.length : null;
    const communication = commAvg === null ? 0 : Math.round((commAvg / 5) * 100);
    const parts = {
      resume: rs === 'approved' ? 100 : rs === 'not_submitted' ? 0 : 50,
      mock: Math.round((interviews + communication) / 2),
      internship: milestones.length
        ? Math.round(
            (100 * mine.filter((m) => m.status === 'done' && milestones.some((x) => x.id === m.milestoneId)).length) /
              milestones.length,
          )
        : 0,
      portfolio: Math.min(
        100,
        Math.round((100 * projects.filter((p) => p.status === 'approved').length) / cfg.portfolioTarget),
      ),
    };
    const w = cfg.weights;
    const overall = Math.round(
      (parts.resume * w.resume +
        parts.mock * w.mock +
        parts.internship * w.internship +
        parts.portfolio * w.portfolio) /
        100,
    );
    const byId = new Map(mine.map((m) => [m.milestoneId, m]));
    return {
      overall,
      parts: {
        resume: { pct: parts.resume, status: rs, feedback: resume?.feedback ?? null },
        mock: {
          pct: parts.mock,
          interviewsPct: interviews,
          communicationPct: communication,
          communicationAvg: commAvg === null ? null : Math.round(commAvg * 10) / 10,
          done: mocks.length,
          target: cfg.mockTarget,
          booked,
          results: mocks.map((m) => ({
            at: m.completedAt,
            passed: m.passed,
            technical: m.technical,
            communication: m.communication,
            problemSolving: m.problemSolving,
            feedback: m.feedback,
          })),
        },
        internship: {
          pct: parts.internship,
          applicationsOpenAt: cfg.applicationsOpenAt,
          milestones: milestones.map((x) => ({
            id: x.id,
            title: x.title,
            description: x.description,
            dueAt: x.dueAt,
            status: byId.get(x.id)?.status ?? 'pending',
          })),
        },
        portfolio: {
          pct: parts.portfolio,
          approved: projects.filter((p) => p.status === 'approved').length,
          total: projects.length,
          target: cfg.portfolioTarget,
        },
      },
      weights: w,
      rules:
        'Readiness = weighted parts. Resume 100 approved / 50 submitted; mock interview = half interviews done against the target, half communication skill (average trainer score out of 5); portfolio counts approved projects against the target; internship counts verified milestones.',
    };
  }

  /** Resume assembled from the student's own records (nothing typed into this endpoint is trusted for scores). */
  async resume(userId: string) {
    const [u, r, projects, labs, certs, career] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, phone: true, code: true, studentProfile: true },
      }),
      this.prisma.resume.findUnique({ where: { userId } }),
      this.prisma.portfolioProject.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.studentActivity.findMany({
        where: { userId, kind: 'lab_completed' },
        distinct: ['refId'],
        select: { refId: true },
      }),
      this.prisma.certificate.findMany({
        where: { userId, revokedAt: null },
        select: { code: true, issuedAt: true, course: { select: { title: true } } },
      }),
      this.prisma.careerPathResult.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5 }),
    ]);
    const p = u.studentProfile;
    // career quiz (latest taken) and the team chosen (latest choice): part of the resume (owner, 29 Oct)
    const taken = career.find((c) => !c.skipped && c.offensivePct !== null);
    const chosen = career.find((c) => c.chosenPath)?.chosenPath ?? null;
    const TEAM: Record<string, string> = { Offensive: 'Red Team', Defensive: 'Blue Team', GRC: 'Green Team' };
    return {
      name: p?.name ?? null,
      email: u.email,
      phone: u.phone,
      code: u.code,
      city: p?.city ?? null,
      dob: p?.dob ?? null,
      studentNumber: p?.studentNumber ?? null,
      careerPath: {
        path: chosen,
        team: chosen ? (TEAM[chosen] ?? null) : null,
        quiz: taken
          ? {
              at: taken.createdAt,
              suggested: taken.suggested,
              percentages: { Offensive: taken.offensivePct, Defensive: taken.defensivePct, GRC: taken.grcPct },
            }
          : null,
      },
      locked: 'Details from sign-up are locked. To change them, ask Yojo support or your Platform Admin.',
      headline: r?.headline ?? null,
      objective: p?.objective ?? null,
      education: p
        ? {
            level: p.eduLevel,
            stream: p.stream,
            institution: p.institutionName,
            gradYear: p.gradYear,
            cgpa: p.cgpa ? Number(p.cgpa) : null,
          }
        : null,
      skills: p?.skills ?? [],
      certifications: p?.certifications ?? [],
      yojoCertificates: certs.map((c) => ({ code: c.code, course: c.course.title, issuedAt: c.issuedAt })),
      labsCleared: labs.length,
      projects: projects.map((x) => ({
        id: x.id,
        title: x.title,
        description: x.description,
        skills: x.skills,
        repoUrl: x.repoUrl,
        demoUrl: x.demoUrl,
        status: x.status,
      })),
      review: {
        status: r?.status ?? 'not_submitted',
        feedback: r?.feedback ?? null,
        submittedAt: r?.submittedAt ?? null,
        reviewedAt: r?.reviewedAt ?? null,
      },
      pdf: { available: false, reason: 'PDF_NOT_CONFIGURED' },
    };
  }

  async updateResume(
    userId: string,
    dto: { headline?: string; objective?: string; skills?: string[]; certifications?: string[] },
  ) {
    const r = await this.prisma.resume.findUnique({ where: { userId } });
    if (r?.status === 'submitted')
      throw new AppError(409, 'IN_REVIEW', 'Your resume is with a trainer. Wait for the review before editing.');
    // sign-up details are locked once filled: only the headline is free, empty details can still be completed
    const p = await this.prisma.studentProfile.findUnique({ where: { userId } });
    const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== '');
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const locked = (['objective', 'skills', 'certifications'] as const).filter(
      (k) => dto[k] !== undefined && filled(p?.[k]) && !same(dto[k], p?.[k]),
    );
    if (locked.length)
      throw new AppError(
        409,
        'PROFILE_LOCKED',
        'Your sign-up details are locked. To change them, ask Yojo support or your Platform Admin.',
        { details: { fields: locked } },
      );
    await this.prisma.$transaction([
      this.prisma.resume.upsert({
        where: { userId },
        create: { userId, headline: dto.headline },
        update: { ...(dto.headline !== undefined ? { headline: dto.headline } : {}) },
      }),
      this.prisma.studentProfile.update({
        where: { userId },
        data: {
          ...(dto.objective !== undefined ? { objective: dto.objective } : {}),
          ...(dto.skills ? { skills: dto.skills } : {}),
          ...(dto.certifications ? { certifications: dto.certifications } : {}),
        },
      }),
    ]);
    return this.resume(userId);
  }

  async submitResume(userId: string) {
    const snap = await this.resume(userId);
    if (!snap.objective || !snap.skills.length)
      throw Errors.validation('Add a career objective and at least one skill first.', 'objective');
    if (snap.review.status === 'submitted') throw new AppError(409, 'IN_REVIEW', 'Already with a trainer for review.');
    await this.prisma.$transaction([
      this.prisma.resume.upsert({
        where: { userId },
        create: { userId, status: 'submitted', submittedAt: new Date() },
        update: { status: 'submitted', submittedAt: new Date() },
      }),
      this.prisma.resumeVersion.create({ data: { userId, snapshot: snap as unknown as Prisma.InputJsonValue } }),
    ]);
    return { status: 'submitted' };
  }

  // ───────────── portfolio ─────────────

  portfolio(userId: string) {
    return this.prisma.portfolioProject.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  }

  async addProject(userId: string, dto: ProjectInput) {
    if ((await this.prisma.portfolioProject.count({ where: { userId } })) >= 20)
      throw new AppError(409, 'TOO_MANY', 'You can keep up to 20 projects.');
    return this.prisma.portfolioProject.create({ data: { userId, ...dto } });
  }

  async editProject(userId: string, id: string, dto: Partial<ProjectInput>) {
    const p = await this.ownProject(userId, id);
    if (p.status === 'submitted') throw new AppError(409, 'IN_REVIEW', 'This project is with a trainer for review.');
    // Changing an approved project sends it back to "not submitted" so the approval matches what is shown.
    return this.prisma.portfolioProject.update({
      where: { id },
      data: { ...dto, ...(p.status === 'approved' ? { status: 'not_submitted' } : {}) },
    });
  }

  async removeProject(userId: string, id: string) {
    await this.ownProject(userId, id);
    await this.prisma.portfolioProject.delete({ where: { id } });
  }

  async submitProject(userId: string, id: string) {
    const p = await this.ownProject(userId, id);
    if (p.status === 'submitted' || p.status === 'approved')
      throw new AppError(409, 'ALREADY_SUBMITTED', `This project is ${p.status.replace('_', ' ')}.`);
    if (p.description.trim().length < 20)
      throw Errors.validation('Describe the project in a few lines first.', 'description');
    return this.prisma.portfolioProject.update({ where: { id }, data: { status: 'submitted' } });
  }

  async submitMilestone(userId: string, milestoneId: string, evidenceUrl?: string, note?: string) {
    const m = await this.prisma.placementMilestone.findFirst({ where: { id: milestoneId, active: true } });
    if (!m) throw Errors.notFound('No milestone with that ID.');
    const cur = await this.prisma.studentMilestone.findUnique({
      where: { userId_milestoneId: { userId, milestoneId } },
    });
    if (cur?.status === 'done') throw new AppError(409, 'ALREADY_DONE', 'This milestone is already verified.');
    await this.prisma.studentMilestone.upsert({
      where: { userId_milestoneId: { userId, milestoneId } },
      create: { userId, milestoneId, evidenceUrl, note },
      update: { status: 'submitted', evidenceUrl, note },
    });
    return { milestoneId, status: 'submitted' };
  }

  /** Evidence per track, from verified records only. */
  async skillGaps(userId: string) {
    const [labs, quizzes] = await Promise.all([
      this.prisma.studentActivity.groupBy({
        by: ['category'],
        where: { userId, kind: 'lab_completed' },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<{ category: string; n: number }[]>`
        SELECT c.category, COUNT(DISTINCT a.ref_id)::int AS n FROM student_activity a
        JOIN assessments s ON s.code = a.ref_id JOIN courses c ON c.id = s.course_id
        WHERE a.user_id = ${userId}::uuid AND a.kind = 'quiz_passed' GROUP BY c.category`,
    ]);
    const lab = new Map(labs.map((l) => [l.category ?? '', l._count._all]));
    const chosen = await this.prisma.careerPathResult.findFirst({
      where: { userId, chosenPath: { not: null } },
      orderBy: { chosenAt: 'desc' },
      select: { chosenPath: true },
    });
    const onb = chosen
      ? { primary: chosen.chosenPath }
      : await this.prisma.onboardingResult.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          select: { primary: true },
        });
    const tracks = CATEGORIES.map((t) => {
      const q = quizzes
        .filter((x) => x.category.toLowerCase().includes(t === 'GRC' ? 'governance' : t.toLowerCase()))
        .reduce((s, x) => s + x.n, 0);
      return { track: t, labsCleared: lab.get(t) ?? 0, quizzesPassed: q, gap: (lab.get(t) ?? 0) + q === 0 };
    });
    return {
      targetTrack: onb?.primary ?? null,
      tracks,
      note: 'Counts only verified labs and passed quizzes. A study aid, not a hiring prediction.',
    };
  }

  // ───────────── trainer / admin ─────────────

  private async studentScope(actor: Actor, asAdmin: boolean): Promise<Set<string> | null> {
    if (asAdmin) return null;
    const rows = await this.prisma.enrolment.findMany({
      where: {
        status: 'active',
        batch: { OR: [{ trainerId: actor.userId }, { coTrainerIds: { has: actor.userId } }] },
      },
      select: { studentId: true },
    });
    return new Set(rows.map((r) => r.studentId));
  }

  async reviewQueue(actor: Actor, asAdmin: boolean) {
    const scope = await this.studentScope(actor, asAdmin);
    const inScope = scope ? { in: [...scope] } : undefined;
    const [resumes, projects, milestones] = await Promise.all([
      this.prisma.resume.findMany({
        where: { status: 'submitted', ...(inScope ? { userId: inScope } : {}) },
        orderBy: { submittedAt: 'asc' },
      }),
      this.prisma.portfolioProject.findMany({
        where: { status: 'submitted', ...(inScope ? { userId: inScope } : {}) },
        orderBy: { updatedAt: 'asc' },
      }),
      this.prisma.studentMilestone.findMany({
        where: { status: 'submitted', ...(inScope ? { userId: inScope } : {}) },
        include: { milestone: { select: { title: true } } },
      }),
    ]);
    return { resumes, projects, milestones };
  }

  private async assertStudent(actor: Actor, studentId: string, asAdmin: boolean) {
    const scope = await this.studentScope(actor, asAdmin);
    if (scope && !scope.has(studentId)) throw Errors.notFound('No student of yours with that ID.');
  }

  async reviewResume(
    actor: Actor,
    studentId: string,
    approve: boolean,
    feedback: string | undefined,
    asAdmin: boolean,
  ) {
    await this.assertStudent(actor, studentId, asAdmin);
    if (!approve && (!feedback || feedback.trim().length < 5)) throw Errors.reasonRequired();
    const r = await this.prisma.resume.updateMany({
      where: { userId: studentId, status: 'submitted' },
      data: {
        status: approve ? 'approved' : 'changes_requested',
        feedback,
        reviewerId: actor.userId,
        reviewedAt: new Date(),
      },
    });
    if (!r.count) throw Errors.notFound('No resume waiting for review.');
    await this.log(
      approve ? 'academy.resume.approved' : 'academy.resume.changes_requested',
      'user',
      studentId,
      actor,
      asAdmin,
    );
    return { studentId, status: approve ? 'approved' : 'changes_requested' };
  }

  async reviewProject(actor: Actor, id: string, approve: boolean, feedback: string | undefined, asAdmin: boolean) {
    const p = await this.prisma.portfolioProject.findUnique({ where: { id } });
    if (!p) throw Errors.notFound('No project with that ID.');
    await this.assertStudent(actor, p.userId, asAdmin);
    if (!approve && (!feedback || feedback.trim().length < 5)) throw Errors.reasonRequired();
    const r = await this.prisma.portfolioProject.updateMany({
      where: { id, status: 'submitted' },
      data: {
        status: approve ? 'approved' : 'changes_requested',
        feedback,
        reviewerId: actor.userId,
        reviewedAt: new Date(),
      },
    });
    if (!r.count) throw new AppError(409, 'NOT_SUBMITTED', 'This project is not waiting for review.');
    await this.log(
      approve ? 'academy.project.approved' : 'academy.project.changes_requested',
      'portfolio_project',
      id,
      actor,
      asAdmin,
    );
    return { id, status: approve ? 'approved' : 'changes_requested' };
  }

  async verifyMilestone(
    actor: Actor,
    studentId: string,
    milestoneId: string,
    done: boolean,
    note: string | undefined,
    asAdmin: boolean,
  ) {
    await this.assertStudent(actor, studentId, asAdmin);
    const r = await this.prisma.studentMilestone.updateMany({
      where: { userId: studentId, milestoneId, status: 'submitted' },
      data: { status: done ? 'done' : 'changes_requested', note, verifiedBy: actor.userId, verifiedAt: new Date() },
    });
    if (!r.count) throw Errors.notFound('Nothing waiting for review on that milestone.');
    await this.log('academy.milestone.reviewed', 'user', studentId, actor, asAdmin);
    return { studentId, milestoneId, status: done ? 'done' : 'changes_requested' };
  }

  /** Mock interview result: only by the trainer of that booking (or an admin), after it started, once. */
  async mockResult(
    actor: Actor,
    requestId: string,
    dto: { technical: number; communication: number; problemSolving: number; passed: boolean; feedback: string },
    asAdmin: boolean,
  ) {
    const req = await this.prisma.sessionRequest.findUnique({ where: { id: requestId } });
    if (!req || req.purpose !== 'mock_interview' || (!asAdmin && req.trainerId !== actor.userId))
      throw Errors.notFound('No mock interview of yours with that ID.');
    if (req.status !== 'approved' && req.status !== 'completed')
      throw new AppError(409, 'NOT_APPROVED', 'Only an approved mock interview can be recorded.');
    if (req.startsAt.getTime() > Date.now())
      throw new AppError(409, 'NOT_STARTED', 'Record the result after the interview.');
    try {
      await this.prisma.$transaction([
        this.prisma.mockInterviewResult.create({
          data: { requestId, studentId: req.studentId, interviewerId: actor.userId, ...dto },
        }),
        this.prisma.sessionRequest.update({ where: { id: requestId }, data: { status: 'completed' } }),
      ]);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw Errors.conflict('ALREADY_RECORDED', 'This interview already has a result.');
      throw e;
    }
    await this.log('academy.mock.recorded', 'session_request', requestId, actor, asAdmin);
    return { requestId, recorded: true };
  }

  milestones() {
    return this.prisma.placementMilestone.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async addMilestone(actor: Actor, dto: { title: string; description?: string; dueAt?: string; sortOrder?: number }) {
    const m = await this.prisma.placementMilestone.create({
      data: {
        title: dto.title,
        description: dto.description ?? '',
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.log('admin.milestone.created', 'placement_milestone', m.id, actor, true);
    return m;
  }

  async setMilestoneActive(actor: Actor, id: string, active: boolean) {
    const r = await this.prisma.placementMilestone.updateMany({ where: { id }, data: { active } });
    if (!r.count) throw Errors.notFound('No milestone with that ID.');
    await this.log('admin.milestone.updated', 'placement_milestone', id, actor, true);
    return { id, active };
  }

  /** Readiness for every student in a batch (same rules as the student view). */
  async batchReport(batchId: string) {
    const ids = await this.prisma.enrolment.findMany({
      where: { batchId, status: 'active' },
      select: { studentId: true },
    });
    const out = [];
    for (const { studentId } of ids) {
      const o = await this.overview(studentId);
      out.push({
        studentId,
        overall: o.overall,
        resume: o.parts.resume.pct,
        mock: o.parts.mock.pct,
        communication: o.parts.mock.communicationPct,
        internship: o.parts.internship.pct,
        portfolio: o.parts.portfolio.pct,
      });
    }
    return { batchId, students: out };
  }

  private async ownProject(userId: string, id: string) {
    const p = await this.prisma.portfolioProject.findUnique({ where: { id } });
    if (!p || p.userId !== userId) throw Errors.notFound('No project of yours with that ID.');
    return p;
  }

  private log(action: string, type: string, id: string, actor: Actor, asAdmin: boolean) {
    return this.audit.record({
      action,
      actorId: actor.userId,
      actorRole: asAdmin ? 'admin' : 'trainer',
      targetType: type,
      targetId: id,
      ip: actor.ip,
      requestId: actor.requestId,
    });
  }
}

export interface ProjectInput {
  title: string;
  description?: string;
  skills?: string[];
  repoUrl?: string;
  demoUrl?: string;
  isPublic?: boolean;
}
