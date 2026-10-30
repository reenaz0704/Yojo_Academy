import { Injectable } from '@nestjs/common';
import { Prisma, type ActivityKind, type LeagueDivision, type XpKind } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors/app-error';
import type { RequestMeta } from '../identity/types';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { addDays, dateCol, dayOf, istDay, istDayStart, istWeekStart } from './ist';

type Tx = Prisma.TransactionClient;
export type DailyKey = 'learn' | 'lab' | 'read';
const DAILY: Record<DailyKey, { title: string; activity: ActivityKind }> = {
  learn: { title: 'Finish 1 learning task', activity: 'lesson_completed' },
  lab: { title: 'Clear 1 lab objective', activity: 'lab_completed' },
  read: { title: 'Read 1 blog in Intel', activity: 'blog_read' },
};
export const DIVISIONS: LeagueDivision[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
export const DIVISION_NAMES: Record<LeagueDivision, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  diamond: 'Diamond',
};
/** Where a student stands in this week's league race (OI-51). */
export type LeagueZone = 'promotion' | 'safe' | 'demotion' | 'not_started';

/** The weekly league in plain words for students (OI-51, owner 24 Oct: "best and understandable"). */
export function leagueGuide(promote: number, demote: number) {
  return [
    'There are 5 divisions: Bronze → Silver → Gold → Platinum → Diamond. Everyone starts in Bronze.',
    'Each week (Monday 00:00 to Sunday 23:59 IST) you race only against students in your own division. Earn XP from labs, quizzes, lessons and daily patches.',
    `When the week closes, the top ${promote} move up one division.`,
    `The bottom ${demote} move down one division, but only when more than ${promote + demote} students in the division earned XP that week, so a small group never pushes anyone down.`,
    'Everyone else stays. Bronze cannot go lower and Diamond cannot go higher. If you earn no XP in a week you stay where you are.',
    'Your total XP and rank badge never go down because of the league.',
  ];
}
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export interface AwardInput {
  userId: string;
  delta: number;
  source: string;
  reason: string;
  kind?: XpKind;
  /** Lab or daily-patch XP: the IST day counts toward the streak. */
  qualifies?: boolean;
  actorId?: string | null;
}

/**
 * XP, streaks, daily patches, weekly ops, achievements and the weekly league (docs/ACADEMY-INVENTORY.md).
 * Every number the dashboard shows is derived here from xp_ledger and student_activity; nothing is taken from the
 * client. Rewards are idempotent: one ledger row per (user, source).
 */
@Injectable()
export class GamificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  rules() {
    return this.settings.get('gamification').then((r) => r.value);
  }

  // ───────────── ledger ─────────────

  /** Writes one ledger row. Returns false (and writes nothing) when the source was already rewarded. */
  async award(a: AwardInput, tx?: Tx): Promise<boolean> {
    if (!Number.isInteger(a.delta) || a.delta === 0) return false;
    const now = new Date();
    const write = async (t: Tx) => {
      await t.xpLedger.create({
        data: {
          userId: a.userId,
          delta: a.delta,
          kind: a.kind ?? (a.delta > 0 ? 'award' : 'penalty'),
          source: a.source,
          reason: a.reason,
          qualifies: !!a.qualifies,
          actorId: a.actorId ?? null,
          weekStart: dateCol(istWeekStart(now)),
        },
      });
      if (a.qualifies) await this.markStreakDay(t, a.userId, now);
    };
    try {
      if (tx) await write(tx);
      else await this.prisma.$transaction(write);
    } catch (e) {
      if (isUnique(e)) return false;
      throw e;
    }
    if (!tx) await this.afterChange(a.userId);
    return true;
  }

  /** Re-checks weekly ops and achievements after XP or activity changed (both idempotent). */
  async afterChange(userId: string) {
    await this.weeklyOps(userId, true);
    await this.evaluateAchievements(userId);
  }

  async totalXp(userId: string, tx: Tx | PrismaService = this.prisma): Promise<number> {
    const r = await tx.xpLedger.aggregate({ where: { userId }, _sum: { delta: true } });
    return r._sum.delta ?? 0;
  }

  async weekXp(userId: string, week = istWeekStart()): Promise<number> {
    const r = await this.prisma.xpLedger.aggregate({
      where: { userId, weekStart: dateCol(week) },
      _sum: { delta: true },
    });
    return Math.max(0, r._sum.delta ?? 0);
  }

  /** Records a verified learning event (lesson completed, lab cleared, blog read…). Duplicates on the same day are ignored. */
  async recordActivity(
    userId: string,
    kind: ActivityKind,
    refId: string,
    extra: { category?: string | null; premium?: boolean } = {},
    tx?: Tx,
  ): Promise<boolean> {
    const now = new Date();
    try {
      await (tx ?? this.prisma).studentActivity.create({
        data: {
          userId,
          kind,
          refId,
          category: extra.category ?? null,
          premium: !!extra.premium,
          day: dateCol(istDay(now)),
          weekStart: dateCol(istWeekStart(now)),
        },
      });
      return true;
    } catch (e) {
      if (isUnique(e)) return false;
      throw e;
    }
  }

  // ───────────── streak ─────────────

  private async markStreakDay(tx: Tx, userId: string, at: Date) {
    const day = istDay(at);
    await tx.streakDay.upsert({
      where: { userId_day: { userId, day: dateCol(day) } },
      create: { userId, day: dateCol(day) },
      update: {},
    });
    const open = await tx.streakBreak.findFirst({ where: { userId, decidedAt: null }, select: { id: true } });
    if (open) return; // frozen until the student decides; the day is kept and applied after the decision
    const st = await tx.streakState.findUnique({ where: { userId } });
    const graceMs = (await this.rules()).streakGraceHours * 3600_000;
    if (st?.lastQualifiedDay && dayOf(st.lastQualifiedDay) === day) return;
    if (st && st.current > 0 && st.lastQualifiedAt && at.getTime() - st.lastQualifiedAt.getTime() > graceMs) {
      // Grace already ran out before this activity: open the decision instead of extending a dead streak.
      await this.openBreak(tx, userId, st.current, st.lastQualifiedAt);
      return;
    }
    const current = (st?.current ?? 0) + 1;
    await tx.streakState.upsert({
      where: { userId },
      create: { userId, current, longest: current, lastQualifiedDay: dateCol(day), lastQualifiedAt: at },
      update: {
        current,
        longest: Math.max(st?.longest ?? 0, current),
        lastQualifiedDay: dateCol(day),
        lastQualifiedAt: at,
      },
    });
  }

  private async openBreak(tx: Tx, userId: string, length: number, lastActiveAt: Date) {
    // ON CONFLICT DO NOTHING: the partial unique index allows one open break per student. A caught unique error
    // would abort the surrounding transaction, so duplicates are skipped instead.
    await tx.streakBreak.createMany({ data: [{ userId, streakLength: length, lastActiveAt }], skipDuplicates: true });
  }

  /** Current streak view; opens the keep/reset decision when the grace period has run out. */
  async streak(userId: string) {
    const r = await this.rules();
    const now = new Date();
    const view = await this.prisma.$transaction(async (tx) => {
      const st = await tx.streakState.findUnique({ where: { userId } });
      if (
        st &&
        st.current > 0 &&
        st.lastQualifiedAt &&
        now.getTime() - st.lastQualifiedAt.getTime() > r.streakGraceHours * 3600_000
      )
        await this.openBreak(tx, userId, st.current, st.lastQualifiedAt);
      const open = await tx.streakBreak.findFirst({ where: { userId, decidedAt: null } });
      return { st, open };
    });
    const today = istDay(now);
    const days = await this.prisma.streakDay.findMany({
      where: { userId, day: { gte: dateCol(addDays(today, -27)) } },
      select: { day: true },
    });
    const on = new Set(days.map((d) => dayOf(d.day)));
    let pending = null;
    if (view.open) {
      const total = await this.totalXp(userId);
      const cost = Math.round((total * r.streakKeepCostPct) / 100);
      const awayDays = Math.max(1, Math.floor((now.getTime() - view.open.lastActiveAt.getTime()) / 86_400_000));
      pending = {
        breakId: view.open.id,
        streakLength: view.open.streakLength,
        awayDays,
        keepCostXp: cost,
        xpNow: total,
        xpAfterKeep: total - cost,
        keepCostPct: r.streakKeepCostPct,
      };
    }
    return {
      current: view.open ? view.open.streakLength : (view.st?.current ?? 0),
      longest: view.st?.longest ?? 0,
      lastQualifiedDay: view.st?.lastQualifiedDay ? dayOf(view.st.lastQualifiedDay) : null,
      graceHours: r.streakGraceHours,
      graceEndsAt:
        view.st?.lastQualifiedAt && !view.open
          ? new Date(view.st.lastQualifiedAt.getTime() + r.streakGraceHours * 3600_000).toISOString()
          : null,
      todayCounts: on.has(today),
      last28: Array.from({ length: 28 }, (_, i) => {
        const d = addDays(today, i - 27);
        return { day: d, active: on.has(d) };
      }),
      pendingDecision: pending,
      rule: 'The streak moves up only on a day (IST) you earn XP from a lab or a daily patch.',
    };
  }

  /**
   * The student's answer to the "You missed your streak" pop-up. Keep: pay round(10% of total XP) (Math.round, half
   * up) and continue the streak. Reset: keep the XP, streak 0. Exactly one decision per break; a repeat of the same
   * answer returns the stored result, a different answer is refused.
   */
  async decide(userId: string, breakId: string, decision: 'keep' | 'reset', meta: RequestMeta) {
    const r = await this.rules();
    const result = await this.prisma.$transaction(async (tx) => {
      const b = await tx.streakBreak.findFirst({ where: { id: breakId, userId } });
      if (!b) throw Errors.notFound('No streak decision to make.');
      if (b.decidedAt) {
        if (b.decision !== decision)
          throw new AppError(409, 'STREAK_ALREADY_DECIDED', `You already chose to ${b.decision} this streak.`);
        return { replay: true, decision, xpCost: b.xpCost ?? 0 };
      }
      const now = new Date();
      const today = istDay(now);
      const total = await this.totalXp(userId, tx);
      const cost = decision === 'keep' ? Math.round((total * r.streakKeepCostPct) / 100) : 0;
      const claimed = await tx.streakBreak.updateMany({
        where: { id: b.id, decidedAt: null },
        data: { decision, decidedAt: now, xpCost: cost },
      });
      if (!claimed.count) throw new AppError(409, 'STREAK_ALREADY_DECIDED', 'This streak decision was already made.');
      if (cost > 0)
        await tx.xpLedger.create({
          data: {
            userId,
            delta: -cost,
            kind: 'penalty',
            source: `streak_keep:${b.id}`,
            reason: `Kept a ${b.streakLength}-day streak (${r.streakKeepCostPct}% of ${total} XP)`,
            weekStart: dateCol(istWeekStart(now)),
          },
        });
      // A qualifying day recorded while the decision was pending counts now.
      const qualifiedToday = !!(await tx.streakDay.findUnique({
        where: { userId_day: { userId, day: dateCol(today) } },
      }));
      const st = await tx.streakState.findUnique({ where: { userId } });
      const base = decision === 'keep' ? b.streakLength : 0;
      const current = base + (qualifiedToday ? 1 : 0);
      await tx.streakState.upsert({
        where: { userId },
        create: {
          userId,
          current,
          longest: current,
          lastQualifiedDay: qualifiedToday ? dateCol(today) : null,
          lastQualifiedAt: decision === 'keep' || qualifiedToday ? now : null,
        },
        update: {
          current,
          longest: Math.max(st?.longest ?? 0, current),
          // Keep restarts the grace period from now, so tomorrow's lab continues the streak.
          lastQualifiedDay: qualifiedToday ? dateCol(today) : decision === 'keep' ? dateCol(addDays(today, -1)) : null,
          lastQualifiedAt: decision === 'keep' || qualifiedToday ? now : null,
        },
      });
      await this.audit.record(
        {
          action: 'academy.streak.decision',
          actorId: userId,
          actorRole: 'student',
          targetType: 'streak_break',
          targetId: b.id,
          detail: { decision, streakLength: b.streakLength, xpCost: cost, totalBefore: total },
          ip: meta.ip,
          requestId: meta.requestId,
        },
        tx,
      );
      return { replay: false, decision, xpCost: cost };
    });
    await this.afterChange(userId);
    return { ...result, streak: await this.streak(userId), totalXp: await this.totalXp(userId) };
  }

  // ───────────── daily patches ─────────────

  async daily(userId: string) {
    const r = await this.rules();
    const today = istDay();
    const [acts, claims] = await Promise.all([
      this.prisma.studentActivity.findMany({
        where: { userId, day: dateCol(today) },
        select: { kind: true },
      }),
      this.prisma.xpLedger.findMany({
        where: { userId, source: { startsWith: `daily:${today}:` } },
        select: { source: true },
      }),
    ]);
    const done = new Set(acts.map((a) => a.kind));
    const claimed = new Set(claims.map((c) => c.source.split(':')[2]));
    return {
      day: today,
      resetsAt: istDayStart(addDays(today, 1)).toISOString(),
      items: (Object.keys(DAILY) as DailyKey[]).map((k) => ({
        key: k,
        title: DAILY[k].title,
        xp: r.dailyPatchXp[k],
        done: done.has(DAILY[k].activity),
        claimed: claimed.has(k),
      })),
    };
  }

  /** Claims a daily patch only when the matching activity was recorded by the server today (IST). Once per day. */
  async claimDaily(userId: string, key: DailyKey) {
    const r = await this.rules();
    const today = istDay();
    const did = await this.prisma.studentActivity.count({
      where: { userId, day: dateCol(today), kind: DAILY[key].activity },
    });
    if (!did)
      throw new AppError(409, 'PATCH_NOT_DONE', 'Finish the task first. Progress comes only from verified activity.');
    const ok = await this.award({
      userId,
      delta: r.dailyPatchXp[key],
      source: `daily:${today}:${key}`,
      reason: `Daily patch: ${DAILY[key].title}`,
      qualifies: true,
    });
    if (!ok) throw new AppError(409, 'ALREADY_CLAIMED', 'You already claimed this patch today.');
    return { claimed: true, xp: r.dailyPatchXp[key], daily: await this.daily(userId) };
  }

  // ───────────── weekly ops ─────────────

  /** Weekly field ops for the current IST week. With award=true, completed ops are paid once (source weekly:<week>:<op>). */
  async weeklyOps(userId: string, award = false) {
    const r = (await this.rules()).weeklyOps;
    const week = istWeekStart();
    const [labs, patches, st, open] = await Promise.all([
      this.prisma.studentActivity.findMany({
        where: { userId, weekStart: dateCol(week), kind: 'lab_completed' },
        distinct: ['refId'],
        select: { refId: true },
      }),
      this.prisma.xpLedger.count({ where: { userId, weekStart: dateCol(week), source: { startsWith: 'daily:' } } }),
      this.prisma.streakState.findUnique({ where: { userId }, select: { current: true } }),
      this.prisma.streakBreak.count({ where: { userId, decidedAt: null } }),
    ]);
    const streak = open ? 0 : (st?.current ?? 0);
    const ops = [
      {
        key: 'labs',
        title: `Clear ${r.labsTarget} labs this week`,
        progress: labs.length,
        target: r.labsTarget,
        xp: r.labsXp,
      },
      {
        key: 'streak',
        title: `Keep a ${r.streakTarget}-day streak`,
        progress: streak,
        target: r.streakTarget,
        xp: r.streakXp,
      },
      {
        key: 'patches',
        title: `Claim ${r.patchesTarget} daily patches`,
        progress: patches,
        target: r.patchesTarget,
        xp: r.patchesXp,
      },
    ];
    const paid = new Set(
      (
        await this.prisma.xpLedger.findMany({
          where: { userId, source: { startsWith: `weekly:${week}:` } },
          select: { source: true },
        })
      ).map((x) => x.source.split(':')[2]),
    );
    if (award)
      for (const o of ops)
        if (o.progress >= o.target && !paid.has(o.key)) {
          const ok = await this.award(
            { userId, delta: o.xp, source: `weekly:${week}:${o.key}`, reason: `Weekly op: ${o.title}` },
            undefined,
          );
          if (ok) paid.add(o.key);
        }
    return {
      weekStart: week,
      endsAt: istDayStart(addDays(week, 7)).toISOString(),
      ops: ops.map((o) => ({
        ...o,
        progress: Math.min(o.progress, o.target),
        completed: o.progress >= o.target,
        paid: paid.has(o.key),
      })),
    };
  }

  // ───────────── achievements ─────────────

  async evaluateAchievements(userId: string) {
    const defs = await this.prisma.achievement.findMany({ where: { active: true } });
    const have = new Set(
      (await this.prisma.userAchievement.findMany({ where: { userId }, select: { code: true } })).map((x) => x.code),
    );
    const todo = defs.filter((d) => !have.has(d.code));
    if (!todo.length) return;
    const facts = await this.facts(userId);
    for (const d of todo) {
      const v = factFor(facts, d.ruleKind, d.ruleArg);
      if (v === null || v < d.threshold) continue;
      try {
        await this.prisma.userAchievement.create({ data: { userId, code: d.code } });
      } catch (e) {
        if (!isUnique(e)) throw e;
      }
    }
  }

  private async facts(userId: string) {
    const [total, st, labs, premium, cats, leagueWins, onboarding, blogs] = await Promise.all([
      this.totalXp(userId),
      this.prisma.streakState.findUnique({ where: { userId }, select: { longest: true } }),
      this.prisma.studentActivity.findMany({
        where: { userId, kind: 'lab_completed' },
        distinct: ['refId'],
        select: { refId: true },
      }),
      this.prisma.studentActivity.count({ where: { userId, kind: 'lab_completed', premium: true } }),
      this.prisma.studentActivity.groupBy({
        by: ['category'],
        where: { userId, kind: 'lab_completed' },
        _count: { _all: true },
      }),
      this.prisma.leagueResult.count({ where: { userId, rank: 1, weekXp: { gt: 0 } } }),
      this.prisma.onboardingResult
        .count({ where: { userId } })
        .then(
          async (n) => n + (await this.prisma.careerPathResult.count({ where: { userId, chosenPath: { not: null } } })),
        ),
      this.prisma.blog.count({ where: { authorId: userId, status: 'published' } }),
    ]);
    return {
      total,
      longest: st?.longest ?? 0,
      labs: labs.length,
      premium,
      byCategory: Object.fromEntries(cats.map((c) => [c.category ?? '', c._count._all])) as Record<string, number>,
      leagueWins,
      onboarding,
      blogs,
    };
  }

  async achievements(userId: string) {
    const [defs, mine] = await Promise.all([
      this.prisma.achievement.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.userAchievement.findMany({ where: { userId } }),
    ]);
    const at = new Map(mine.map((m) => [m.code, m.awardedAt]));
    return {
      earned: mine.length,
      total: defs.length,
      items: defs.map((d) => ({
        code: d.code,
        title: d.title,
        icon: d.icon,
        earned: at.has(d.code),
        awardedAt: at.get(d.code) ?? null,
      })),
    };
  }

  // ───────────── ranks, league, leaderboard ─────────────

  async rankOf(total: number) {
    const ranks = (await this.rules()).ranks;
    let i = 0;
    ranks.forEach((r, k) => {
      if (total >= r[1]) i = k;
    });
    const next = ranks[i + 1] ?? null;
    return {
      name: ranks[i][0],
      level: i + 1,
      next: next ? { name: next[0], xp: next[1] } : null,
      progressPct: next ? Math.min(100, Math.round((100 * total) / next[1])) : 100,
    };
  }

  async division(userId: string): Promise<LeagueDivision> {
    const m = await this.prisma.leagueMembership.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: { division: true },
    });
    return m.division;
  }

  /**
   * Leaderboards. week = this IST week's net XP inside the student's league division; all = total XP across
   * students; college = this week's XP among students of the same institution. Shows display names only and leaves
   * out students who turned "show me" off (the viewer still sees their own row). Ties: earlier account first.
   */
  async leaderboard(userId: string, tab: 'week' | 'all' | 'college') {
    const week = istWeekStart();
    const me = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { studentProfile: { select: { institutionName: true, showOnBoard: true } } },
    });
    const division = await this.division(userId);
    const inst = me.studentProfile?.institutionName ?? null;
    if (tab === 'college' && !inst)
      return {
        tab,
        division: null,
        weekStart: week,
        endsAt: istDayStart(addDays(week, 7)).toISOString(),
        rows: [],
        me: null,
        showOnBoard: me.studentProfile?.showOnBoard ?? true,
        rule: 'Add your institution to your profile to see your college board.',
      };
    const filter =
      tab === 'week'
        ? Prisma.sql`AND COALESCE(lm.division, 'bronze') = ${division}::"LeagueDivision"`
        : tab === 'college'
          ? Prisma.sql`AND sp.institution_name = ${inst}`
          : Prisma.empty;
    const weekOnly = tab === 'all' ? Prisma.empty : Prisma.sql`AND x.week_start = ${dateCol(week)}::date`;
    const rows = await this.prisma.$queryRaw<
      { id: string; name: string | null; code: string; xp: number; shown: boolean }[]
    >`
      SELECT u.id, COALESCE(sp.display_name, u.display_name, split_part(sp.name, ' ', 1)) AS name, u.code,
             GREATEST(COALESCE(SUM(x.delta), 0), 0)::int AS xp, COALESCE(sp.show_on_board, true) AS shown
      FROM users u
      JOIN student_profiles sp ON sp.user_id = u.id
      LEFT JOIN league_memberships lm ON lm.user_id = u.id
      JOIN xp_ledger x ON x.user_id = u.id ${weekOnly}
      WHERE u.role = 'student' AND u.status = 'active' ${filter}
      GROUP BY u.id, sp.display_name, u.display_name, sp.name, u.code, sp.show_on_board, u.created_at
      HAVING COALESCE(SUM(x.delta), 0) > 0
      ORDER BY xp DESC, u.created_at ASC
      LIMIT 500`;
    const lr = await this.rules();
    // Zone from the full order (hidden students still race; they are just not named).
    const at = rows.findIndex((x) => x.id === userId);
    const idx = DIVISIONS.indexOf(division);
    const zone: LeagueZone =
      at < 0
        ? 'not_started'
        : at < lr.leaguePromote && idx < DIVISIONS.length - 1
          ? 'promotion'
          : rows.length > lr.leaguePromote + lr.leagueDemote && at >= rows.length - lr.leagueDemote && idx > 0
            ? 'demotion'
            : 'safe';
    const ranked = rows
      .filter((r) => r.shown || r.id === userId)
      .map((r, i) => ({
        rank: i + 1,
        name: r.id === userId ? (r.shown ? `${r.name ?? 'You'} (you)` : 'Hidden learner (you)') : (r.name ?? 'Learner'),
        xp: r.xp,
        me: r.id === userId,
      }));
    const mine = ranked.find((r) => r.me) ?? null;
    return {
      tab,
      division: tab === 'week' ? division : null,
      weekStart: tab === 'all' ? null : week,
      endsAt: istDayStart(addDays(week, 7)).toISOString(),
      rows: ranked.slice(0, 50),
      me: mine,
      showOnBoard: me.studentProfile?.showOnBoard ?? true,
      rule: 'Display names only. Ties: earlier account first. Weekly reset Monday 00:00 IST.',
      league:
        tab === 'week'
          ? {
              division,
              divisionName: DIVISION_NAMES[division],
              divisions: DIVISIONS.map((d) => ({ id: d, name: DIVISION_NAMES[d], mine: d === division })),
              promoteTop: idx < DIVISIONS.length - 1 ? lr.leaguePromote : 0,
              demoteBottom: idx > 0 ? lr.leagueDemote : 0,
              players: rows.length,
              zone,
              guide: leagueGuide(lr.leaguePromote, lr.leagueDemote),
            }
          : null,
    };
  }

  /**
   * Closes an IST week (run by the worker on Monday 00:05 IST; idempotent). In each division students with XP that
   * week are ranked; the top N move up and the bottom M move down (settings), others stay. Results are kept.
   */
  async closeWeek(week: string) {
    const r = await this.rules();
    const done = await this.prisma.leagueResult.count({ where: { weekStart: dateCol(week) } });
    if (done) return { week, closed: false, reason: 'already closed' };
    const rows = await this.prisma.$queryRaw<{ user_id: string; division: LeagueDivision | null; xp: number }[]>`
      SELECT x.user_id, lm.division, SUM(x.delta)::int AS xp
      FROM xp_ledger x JOIN users u ON u.id = x.user_id LEFT JOIN league_memberships lm ON lm.user_id = x.user_id
      WHERE x.week_start = ${dateCol(week)}::date AND u.role = 'student'
      GROUP BY x.user_id, lm.division, u.created_at
      HAVING SUM(x.delta) > 0
      ORDER BY xp DESC, u.created_at ASC`;
    const byDiv = new Map<LeagueDivision, typeof rows>();
    for (const row of rows) {
      const d = row.division ?? 'bronze';
      byDiv.set(d, [...(byDiv.get(d) ?? []), row]);
    }
    let written = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const [div, list] of byDiv) {
        const idx = DIVISIONS.indexOf(div);
        for (let i = 0; i < list.length; i++) {
          const promote = i < r.leaguePromote && idx < DIVISIONS.length - 1;
          const demote =
            !promote && i >= list.length - r.leagueDemote && list.length > r.leaguePromote + r.leagueDemote && idx > 0;
          const to = promote ? DIVISIONS[idx + 1] : demote ? DIVISIONS[idx - 1] : div;
          await tx.leagueResult.create({
            data: {
              weekStart: dateCol(week),
              userId: list[i].user_id,
              division: div,
              rank: i + 1,
              weekXp: list[i].xp,
              outcome: promote ? 'promoted' : demote ? 'demoted' : 'stayed',
            },
          });
          await tx.leagueMembership.upsert({
            where: { userId: list[i].user_id },
            create: { userId: list[i].user_id, division: to },
            update: { division: to },
          });
          written++;
        }
      }
    });
    for (const row of rows) await this.evaluateAchievements(row.user_id);
    return { week, closed: true, results: written };
  }

  // ───────────── admin ─────────────

  async ledger(userId: string, limit = 50, before?: string) {
    const rows = await this.prisma.xpLedger.findMany({
      where: { userId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      select: { id: true, delta: true, kind: true, source: true, reason: true, actorId: true, createdAt: true },
    });
    return { total: await this.totalXp(userId), items: rows };
  }

  /** Admin correction with a written reason; can never take the total below zero. */
  async correct(userId: string, delta: number, reason: string, actor: RequestMeta & { userId: string }) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!u || u.role !== 'student') throw Errors.notFound('No student with that ID.');
    const now = new Date();
    const id = await this.prisma.$transaction(async (tx) => {
      const total = await this.totalXp(userId, tx);
      if (total + delta < 0)
        throw Errors.validation(`This would take the total below zero (now ${total} XP).`, 'delta');
      const row = await tx.xpLedger.create({
        data: {
          userId,
          delta,
          kind: 'correction',
          source: `admin:${now.getTime()}:${actor.userId.slice(0, 8)}`,
          reason,
          actorId: actor.userId,
          weekStart: dateCol(istWeekStart(now)),
        },
      });
      await this.audit.record(
        {
          action: 'admin.xp.corrected',
          actorId: actor.userId,
          actorRole: 'admin',
          targetType: 'user',
          targetId: userId,
          detail: { delta, before: total },
          reason,
          ip: actor.ip,
          requestId: actor.requestId,
        },
        tx,
      );
      return row.id;
    });
    await this.afterChange(userId);
    return { id, total: await this.totalXp(userId) };
  }
}

function factFor(
  f: Awaited<ReturnType<GamificationService['facts']>>,
  kind: string,
  arg: string | null,
): number | null {
  switch (kind) {
    case 'xp_total':
      return f.total;
    case 'longest_streak':
      return f.longest;
    case 'labs_total':
      return f.labs;
    case 'lab_category':
      return f.byCategory[arg ?? ''] ?? 0;
    case 'premium_lab':
      return f.premium;
    case 'league_win':
      return f.leagueWins;
    case 'onboarding_done':
      return f.onboarding;
    case 'blogs_published':
      return f.blogs;
    default:
      return null; // an unknown rule kind is skipped, never guessed
  }
}

export { DAILY };
