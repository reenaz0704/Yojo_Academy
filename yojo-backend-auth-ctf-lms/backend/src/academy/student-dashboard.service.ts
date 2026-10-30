import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { EntitlementService, PAID_KEY } from '../entitlements/entitlement.service';
import type { RequestMeta } from '../identity/types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CoursesService } from './courses.service';
import { MissionsService } from './missions.service';
import { CareerPathService } from './career-path.service';
import { GamificationService } from './gamification.service';
import {
  ONBOARDING_RULES_VERSION,
  publicQuestions,
  QUESTION_COUNT,
  MAX_SKIPS,
  scoreOnboarding,
  validAnswers,
} from './onboarding-quiz';

/** Cyber Command: one call that returns everything the dashboard shows, all derived from server records. */
@Injectable()
export class StudentDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly game: GamificationService,
    private readonly entitlements: EntitlementService,
    private readonly audit: AuditService,
    private readonly courses: CoursesService,
    private readonly missions: MissionsService,
    private readonly career: CareerPathService,
  ) {}

  async onboarding(userId: string) {
    const last = await this.prisma.onboardingResult.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return {
      done: !!last,
      result: last
        ? {
            primary: last.primary,
            secondary: last.secondary,
            provisional: last.provisional,
            confidence: last.confidence,
            scores: { Offensive: last.offensive, Defensive: last.defensive, GRC: last.grc },
            at: last.createdAt,
          }
        : null,
      questions: last ? null : publicQuestions(),
      maxSkips: MAX_SKIPS,
      questionCount: QUESTION_COUNT,
    };
  }

  /** Scores the questionnaire on the server. One result; a retake is a later product decision (30 days or 5 labs). */
  async submitOnboarding(userId: string, answers: unknown[], meta: RequestMeta) {
    if (await this.prisma.onboardingResult.count({ where: { userId } }))
      throw new AppError(409, 'ONBOARDING_DONE', 'You already finished the questionnaire.');
    if (!validAnswers(answers))
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        `Answer all ${QUESTION_COUNT} questions (up to ${MAX_SKIPS} skips).`,
        { field: 'answers' },
      );
    const r = scoreOnboarding(answers as (number | 'skip')[]);
    try {
      await this.prisma.onboardingResult.create({
        data: {
          userId,
          rulesVersion: ONBOARDING_RULES_VERSION,
          answers: answers as Prisma.InputJsonValue,
          offensive: r.scores.Offensive,
          defensive: r.scores.Defensive,
          grc: r.scores.GRC,
          primary: r.primary,
          secondary: r.secondary,
          provisional: r.provisional,
          confidence: r.confidence,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new AppError(409, 'ONBOARDING_DONE', 'You already finished the questionnaire.');
      throw e;
    }
    await this.audit.record({
      action: 'academy.onboarding.scored',
      actorId: userId,
      actorRole: 'student',
      targetType: 'user',
      targetId: userId,
      detail: { primary: r.primary, provisional: r.provisional, rules: ONBOARDING_RULES_VERSION },
      ip: meta.ip,
      requestId: meta.requestId,
    });
    await this.game.evaluateAchievements(userId);
    return r;
  }

  async dashboard(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { code: true, displayName: true, studentProfile: { select: { name: true, displayName: true } } },
    });
    const [total, paid, onboarding, streak, daily, weekly, achievements, division, weekXp, recent, labsCleared] =
      await Promise.all([
        this.game.totalXp(userId),
        this.entitlements.has(userId, PAID_KEY),
        this.onboarding(userId),
        this.game.streak(userId),
        this.game.daily(userId),
        this.game.weeklyOps(userId, false),
        this.game.achievements(userId),
        this.game.division(userId),
        this.game.weekXp(userId),
        this.prisma.xpLedger.findMany({
          where: { userId, kind: 'award', qualifies: true, source: { startsWith: 'lab:' } },
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: { reason: true, delta: true, createdAt: true, source: true },
        }),
        this.prisma.studentActivity.findMany({
          where: { userId, kind: 'lab_completed' },
          distinct: ['refId'],
          select: { refId: true },
        }),
      ]);
    const board = await this.game.leaderboard(userId, 'week');
    const [careerPath, career] = await Promise.all([this.career.pathOf(userId), this.career.latestTaken(userId)]);
    const name = user.studentProfile?.displayName ?? user.studentProfile?.name ?? user.displayName ?? 'Agent';
    return {
      profile: {
        code: user.code,
        name,
        firstName: name.split(' ')[0],
        path: careerPath,
        provisional: !career && (onboarding.result?.provisional ?? false),
        plan: paid ? 'paid' : 'free',
      },
      xp: { total, rank: await this.game.rankOf(total), thisWeek: weekXp },
      tiles: {
        totalXp: total,
        streakDays: streak.current,
        labsCleared: labsCleared.length,
        freeLabsTotal: await this.missions.freeTotal(),
        campaignsWon: await this.courses.campaignsWon(userId),
      },
      streak,
      daily,
      weekly,
      // Power levels start from the latest career-path quiz (percentages), else the older 18-question scores.
      powerLevels: career
        ? { Offensive: career.offensivePct ?? 0, Defensive: career.defensivePct ?? 0, GRC: career.grcPct ?? 0 }
        : onboarding.result
          ? onboarding.result.scores
          : null,
      league: { division, weekXp, rank: board.me?.rank ?? null, endsAt: board.endsAt },
      trophies: achievements,
      recentVictories: recent.map((r) => ({ title: r.reason, xp: r.delta, at: r.createdAt, ref: r.source })),
      activeOperation: await this.missions.activeOperation(userId),
    };
  }
}
