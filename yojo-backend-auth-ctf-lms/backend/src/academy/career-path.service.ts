import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors/app-error';
import type { RequestMeta } from '../identity/types';
import { PrismaService } from '../prisma/prisma.service';
import {
  CAREER_QUESTIONS,
  CAREER_QUIZ_VERSION,
  CAREER_RETAKE_DAYS,
  publicCareerQuestions,
  scoreCareer,
  TRACKS,
  type Track,
} from './career-quiz';
import { GamificationService } from './gamification.service';

const DAY = 86_400_000;

/**
 * Career-path quiz and the student's chosen path (owner, 24 Oct). The quiz is optional and only suggests a track;
 * the student's own choice drives the Academy path. Rules:
 * - New students who signed up themselves (origin `signup`) are asked first; Yojo-origin students are never forced
 *   but may open it.
 * - One take per CAREER_RETAKE_DAYS (30) days, counted from the last completed take; skipping does not count.
 * - The chosen path can be changed at any time; each change is audited. Reports show the latest result and choice.
 */
@Injectable()
export class CareerPathService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly game: GamificationService,
  ) {}

  /** The path the Academy uses: the latest choice, else the older 18-question result, else none. */
  async pathOf(userId: string): Promise<Track | null> {
    const c = await this.prisma.careerPathResult.findFirst({
      where: { userId, chosenPath: { not: null } },
      orderBy: { chosenAt: 'desc' },
      select: { chosenPath: true },
    });
    if (c?.chosenPath) return c.chosenPath as Track;
    const o = await this.prisma.onboardingResult.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { primary: true },
    });
    return (o?.primary as Track | undefined) ?? null;
  }

  /** Latest completed take, for power levels and reports. */
  latestTaken(userId: string) {
    return this.prisma.careerPathResult.findFirst({
      where: { userId, skipped: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  private view(r: Prisma.CareerPathResultGetPayload<object> | null) {
    if (!r) return null;
    return {
      id: r.id,
      skipped: r.skipped,
      percentages: r.skipped ? null : { Offensive: r.offensivePct, Defensive: r.defensivePct, GRC: r.grcPct },
      suggested: r.suggested,
      tiedWith: r.tiedWith,
      chosenPath: r.chosenPath,
      chosenAt: r.chosenAt,
      at: r.createdAt,
      quizVersion: r.quizVersion,
    };
  }

  async status(userId: string) {
    const [u, latest, taken, path] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { origin: true } }),
      this.prisma.careerPathResult.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      this.latestTaken(userId),
      this.pathOf(userId),
    ]);
    const retakeAt = taken ? new Date(taken.createdAt.getTime() + CAREER_RETAKE_DAYS * DAY) : null;
    const canTake = !retakeAt || retakeAt.getTime() <= Date.now();
    return {
      path,
      // Asked first only for self-signed-up students with no path and no quiz record yet.
      required: u.origin === 'signup' && !path && !latest,
      needsPath: !path,
      result: this.view(latest),
      canTake,
      retakeAt: canTake ? null : retakeAt,
      questions: canTake ? publicCareerQuestions() : null,
      tracks: TRACKS,
      rules: {
        questions: CAREER_QUESTIONS.length,
        scoring: 'Each answer counts for one track. Percentage = answers for that track ÷ 15 × 100, rounded.',
        tie: 'On a tie the suggestion follows Defensive, Offensive, GRC and the tie is shown, so you can pick.',
        retakeDays: CAREER_RETAKE_DAYS,
        optional: 'The quiz only suggests a track. You choose your path, and you can change it later.',
      },
    };
  }

  async take(userId: string, answers: unknown, meta: RequestMeta) {
    const taken = await this.latestTaken(userId);
    if (taken && taken.createdAt.getTime() + CAREER_RETAKE_DAYS * DAY > Date.now())
      throw new AppError(409, 'RETAKE_TOO_SOON', `You can take the quiz again after ${CAREER_RETAKE_DAYS} days.`, {
        details: { retakeAt: new Date(taken.createdAt.getTime() + CAREER_RETAKE_DAYS * DAY) },
      });
    const s = scoreCareer(answers);
    if (!s)
      throw Errors.validation(`Answer all ${CAREER_QUESTIONS.length} questions with one of their options.`, 'answers');
    const r = await this.prisma.careerPathResult.create({
      data: {
        userId,
        quizVersion: CAREER_QUIZ_VERSION,
        answers: answers as Prisma.InputJsonValue,
        offensivePct: s.percentages.Offensive,
        defensivePct: s.percentages.Defensive,
        grcPct: s.percentages.GRC,
        suggested: s.suggested,
        tiedWith: s.tiedWith,
        createdAt: new Date(),
      },
    });
    await this.audit.record({
      action: 'academy.career_quiz.taken',
      actorId: userId,
      actorRole: 'student',
      targetType: 'user',
      targetId: userId,
      detail: { suggested: s.suggested, percentages: s.percentages, version: CAREER_QUIZ_VERSION },
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return this.view(r);
  }

  /** Choose (or change) the path. With no quiz record yet this records a skip. */
  async choose(userId: string, path: Track, meta: RequestMeta) {
    if (!(TRACKS as readonly string[]).includes(path))
      throw Errors.validation('Choose Offensive, Defensive or GRC.', 'path');
    const before = await this.pathOf(userId);
    const latest = await this.prisma.careerPathResult.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const now = new Date();
    const r = latest
      ? await this.prisma.careerPathResult.update({
          where: { id: latest.id },
          data: { chosenPath: path, chosenAt: now },
        })
      : await this.prisma.careerPathResult.create({
          data: {
            userId,
            quizVersion: CAREER_QUIZ_VERSION,
            skipped: true,
            chosenPath: path,
            chosenAt: now,
            createdAt: now,
          },
        });
    await this.audit.record({
      action: latest ? 'academy.career_path.chosen' : 'academy.career_quiz.skipped',
      actorId: userId,
      actorRole: 'student',
      targetType: 'user',
      targetId: userId,
      detail: { from: before, to: path, suggested: latest?.suggested ?? null },
      ip: meta.ip,
      requestId: meta.requestId,
    });
    await this.game.evaluateAchievements(userId); // "Pathfinder: faction chosen"
    return this.view(r);
  }
}
