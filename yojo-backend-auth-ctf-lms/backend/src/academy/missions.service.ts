import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Mission } from '@prisma/client';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors/app-error';
import { RateLimitService } from '../common/guards/rate-limit.service';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { EntitlementService, PAID_KEY } from '../entitlements/entitlement.service';
import type { RequestMeta } from '../identity/types';
import { PrismaService } from '../prisma/prisma.service';
import { GamificationService } from './gamification.service';
import { checkAnswer, saltedHash, sameHash, type AnswerFormat } from './lab-answers';
import type { HintDto, MissionDto, MissionPatchDto } from './missions.dto';

type Actor = RequestMeta & { userId: string };
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
const normFlag = (s: string) => s.trim();
const hashFlag = (salt: string, flag: string) =>
  createHash('sha256')
    .update(`${salt}:${normFlag(flag)}`)
    .digest('hex');

/**
 * Missions and the World Breach Map (docs/ACADEMY-INVENTORY.md, slice e). XP is paid only after the server verified
 * completion: native missions are checked against a salted hash kept here; missions that need the Python lab
 * service report it as unavailable until that service offers a server-to-server API (no simulated labs).
 * Hint rule (owner, 22 Oct): up to 3 hints; hint n costs gamification.hintPcts[n-1] % (5, 10, 15) of the base,
 * whole numbers (Math.round); base = the lab's reward (cut at completion) or the student's total XP (charged at
 * once), per gamification.hintBase. A hint is charged once per student and mission, never refunded by a retry.
 */
@Injectable()
export class MissionsService {
  private health: { at: number; ok: boolean } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly game: GamificationService,
    private readonly entitlements: EntitlementService,
    private readonly audit: AuditService,
    private readonly rate: RateLimitService,
  ) {}

  // ───────────── provider boundary ─────────────

  /** Health of the Python mission service, cached 30 s. Unset URL = unavailable. */
  async providerAvailable(): Promise<boolean> {
    if (!this.cfg.LAB_PROVIDER_URL || !this.cfg.MISSION_SERVICE_SECRET) return false;
    if (this.health && Date.now() - this.health.at < 30_000) return this.health.ok;
    let ok = false;
    try {
      const r = await fetch(new URL('/healthz', this.cfg.LAB_PROVIDER_URL), { signal: AbortSignal.timeout(2000) });
      ok = r.ok;
    } catch {
      ok = false;
    }
    this.health = { at: Date.now(), ok };
    return ok;
  }

  private unavailable() {
    return new AppError(503, 'LAB_SERVICE_UNAVAILABLE', 'Mission service offline. Retry shortly.', {
      details: { configured: !!this.cfg.LAB_PROVIDER_URL },
    });
  }

  // ───────────── student ─────────────

  async list(userId: string, q: { category?: string; q?: string }) {
    const [missions, done, active, paid, available] = await Promise.all([
      this.prisma.mission.findMany({
        where: {
          status: 'published',
          ...(q.category ? { category: q.category } : {}),
          ...(q.q
            ? {
                OR: [
                  { title: { contains: q.q, mode: 'insensitive' } },
                  { description: { contains: q.q, mode: 'insensitive' } },
                  { code: { contains: q.q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      }),
      this.completedCodes(userId),
      this.prisma.missionAttempt.findMany({ where: { userId, status: 'active' }, select: { missionCode: true } }),
      this.entitlements.has(userId, PAID_KEY),
      this.providerAvailable(),
    ]);
    const act = new Set(active.map((a) => a.missionCode));
    return {
      providerAvailable: available,
      items: missions.map((m) => ({
        ...this.card(m),
        state: done.has(m.code)
          ? 'cleared'
          : act.has(m.code)
            ? 'in_progress'
            : this.locked(m, done, paid)
              ? 'locked'
              : 'available',
        lockedReason: done.has(m.code) ? null : this.locked(m, done, paid),
        replayXp: done.has(m.code) ? 0 : null,
        serviceAvailable: m.provider === 'native' ? true : available,
      })),
    };
  }

  async detail(userId: string, code: string) {
    const m = await this.published(code);
    const [done, paid, hints, used, attempt] = await Promise.all([
      this.completedCodes(userId),
      this.entitlements.has(userId, PAID_KEY),
      this.prisma.missionHint.findMany({ where: { missionCode: code }, orderBy: { n: 'asc' }, select: { n: true } }),
      this.prisma.hintUse.findMany({ where: { userId, missionCode: code }, orderBy: { n: 'asc' } }),
      this.prisma.missionAttempt.findFirst({ where: { userId, missionCode: code, status: 'active' } }),
    ]);
    const rules = await this.game.rules();
    const usedTexts = new Map(
      (await this.prisma.missionHint.findMany({ where: { missionCode: code, n: { in: used.map((u) => u.n) } } })).map(
        (h) => [h.n, h.text],
      ),
    );
    const usedPct = used.reduce((s, u) => s + u.pct, 0);
    const steps = await this.objectivesView(userId, code);
    return {
      ...this.card(m),
      steps,
      state: done.has(code) ? 'cleared' : attempt ? 'in_progress' : this.locked(m, done, paid) ? 'locked' : 'available',
      lockedReason: done.has(code) ? null : this.locked(m, done, paid),
      attempt: attempt
        ? {
            id: attempt.id,
            startedAt: attempt.startedAt,
            submissions: attempt.submissions,
            maxSubmissions: m.maxSubmissions,
          }
        : null,
      hints: {
        available: hints.length,
        used: used.map((u) => ({ n: u.n, text: usedTexts.get(u.n) ?? '', pct: u.pct, xpCost: u.xpCost })),
        nextCostPct: used.length < hints.length ? (rules.hintPcts[used.length] ?? null) : null,
        basis: rules.hintBase,
        rewardIfClearedNow: done.has(code)
          ? 0
          : rules.hintBase === 'lab_reward'
            ? Math.round((m.xpReward * Math.max(0, 100 - usedPct)) / 100)
            : m.xpReward,
      },
    };
  }

  async start(userId: string, code: string, meta: RequestMeta) {
    const m = await this.published(code);
    const [done, paid] = await Promise.all([this.completedCodes(userId), this.entitlements.has(userId, PAID_KEY)]);
    const why = done.has(code) ? null : this.locked(m, done, paid);
    if (why)
      throw new AppError(
        403,
        'MISSION_LOCKED',
        why === 'premium' ? 'This mission needs the paid plan.' : 'Clear the earlier missions first.',
        { details: { reason: why } },
      );
    const steps = await this.prisma.missionObjective.count({ where: { missionCode: code } });
    // A lab with steps can always be started: its briefing, quiz and answers are checked here. Only its live
    // environment (lab session) needs the lab service.
    if (!steps && m.provider !== 'native' && !(await this.providerAvailable())) throw this.unavailable();
    if (!steps && m.provider === 'native' && !m.flagHash)
      throw new AppError(503, 'MISSION_NOT_READY', 'This mission is not ready yet.');
    const open = await this.prisma.missionAttempt.findFirst({ where: { userId, missionCode: code, status: 'active' } });
    if (open) return { attemptId: open.id, resumed: true, replay: done.has(code) };
    try {
      const a = await this.prisma.missionAttempt.create({ data: { userId, missionCode: code, startedAt: new Date() } });
      await this.audit.record({
        action: 'academy.mission.started',
        actorId: userId,
        actorRole: 'student',
        targetType: 'mission',
        targetId: code,
        ip: meta.ip,
        requestId: meta.requestId,
      });
      return { attemptId: a.id, resumed: false, replay: done.has(code) };
    } catch (e) {
      if (isUnique(e)) {
        const again = await this.prisma.missionAttempt.findFirstOrThrow({
          where: { userId, missionCode: code, status: 'active' },
        });
        return { attemptId: again.id, resumed: true, replay: done.has(code) };
      }
      throw e;
    }
  }

  /** Reveals the next hint (in order). Charged once per student and mission. */
  async hint(userId: string, code: string) {
    const m = await this.published(code);
    if ((await this.completedCodes(userId)).has(code))
      throw new AppError(409, 'MISSION_CLEARED', 'You already cleared this mission.');
    if (!(await this.prisma.missionAttempt.count({ where: { userId, missionCode: code, status: 'active' } })))
      throw new AppError(409, 'NO_ACTIVE_ATTEMPT', 'Start the mission before asking for a hint.');
    const rules = await this.game.rules();
    const used = await this.prisma.hintUse.count({ where: { userId, missionCode: code } });
    const n = used + 1;
    const max = Math.min(3, rules.hintPcts.length);
    if (n > max) throw new AppError(409, 'NO_HINTS_LEFT', `You have used all ${max} hints.`);
    const h = await this.prisma.missionHint.findUnique({ where: { missionCode_n: { missionCode: code, n } } });
    if (!h) throw new AppError(404, 'NO_HINT', 'No more hints for this mission.');
    const pct = rules.hintPcts[n - 1];
    let xpCost: number | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        if (rules.hintBase === 'total_xp') {
          const total = await this.game.totalXp(userId, tx);
          xpCost = Math.round((total * pct) / 100);
        }
        await tx.hintUse.create({ data: { userId, missionCode: code, n, pct, basis: rules.hintBase, xpCost } });
        if (xpCost)
          await this.game.award(
            {
              userId,
              delta: -xpCost,
              kind: 'penalty',
              source: `hint:${code}:${n}`,
              reason: `Hint ${n} for ${m.title} (${pct}% of total XP)`,
            },
            tx,
          );
      });
    } catch (e) {
      if (isUnique(e)) throw new AppError(409, 'HINT_ALREADY_USED', 'That hint is already open. Reload the mission.');
      throw e;
    }
    return { n, text: h.text, pct, basis: rules.hintBase, xpCost, hintsLeft: max - n };
  }

  /** Checks a native mission's answer on the server. XP only on the first verified clear; replays pay 0. */
  async submit(userId: string, code: string, flag: string, meta: RequestMeta) {
    const m = await this.published(code);
    if (m.provider !== 'native') throw this.unavailable();
    const a = await this.prisma.missionAttempt.findFirst({ where: { userId, missionCode: code, status: 'active' } });
    if (!a) throw new AppError(409, 'NO_ACTIVE_ATTEMPT', 'Start the mission first.');
    await this.rate.hitClass('mission_submit_user', userId);
    if (a.submissions >= m.maxSubmissions)
      throw new AppError(409, 'NO_SUBMISSIONS_LEFT', 'Too many wrong answers for this attempt. Start a new attempt.');
    const ok = !!m.flagHash && !!m.flagSalt && safeEqualHex(hashFlag(m.flagSalt, flag), m.flagHash);
    if (!ok) {
      await this.prisma.missionAttempt.update({ where: { id: a.id }, data: { submissions: { increment: 1 } } });
      throw new AppError(422, 'WRONG_ANSWER', 'That is not the flag. Check the encoding and try again.', {
        details: { submissionsLeft: m.maxSubmissions - a.submissions - 1 },
      });
    }
    return this.complete(userId, m, a.id, meta);
  }

  private async complete(userId: string, m: Mission, attemptId: string, meta: RequestMeta, stepsPaid = false) {
    const rules = await this.game.rules();
    const firstClear = !(await this.completedCodes(userId)).has(m.code);
    const used = await this.prisma.hintUse.findMany({ where: { userId, missionCode: m.code } });
    const cut = rules.hintBase === 'lab_reward' ? used.reduce((s, u) => s + u.pct, 0) : 0;
    // Labs with steps paid each step as it was cleared; the clear itself adds no XP.
    const reward = firstClear && !stepsPaid ? Math.max(0, Math.round((m.xpReward * Math.max(0, 100 - cut)) / 100)) : 0;
    const upd = await this.prisma.missionAttempt.updateMany({
      where: { id: attemptId, status: 'active' },
      data: { status: 'completed', completedAt: new Date(), xpAwarded: reward },
    });
    if (!upd.count) throw new AppError(409, 'ATTEMPT_CLOSED', 'This attempt is already closed.');
    if (firstClear) {
      await this.game.recordActivity(userId, 'lab_completed', m.code, { category: m.category, premium: m.premium });
      if (reward > 0)
        await this.game.award({
          userId,
          delta: reward,
          source: `lab:${m.code}:clear`,
          reason: `Cleared ${m.code} ${m.title}${cut ? ` (−${cut}% for hints)` : ''}`,
          qualifies: true,
        });
      else await this.game.afterChange(userId);
    }
    await this.audit.record({
      action: 'academy.mission.cleared',
      actorId: userId,
      actorRole: 'student',
      targetType: 'mission',
      targetId: m.code,
      detail: { reward, hintCutPct: cut, firstClear },
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return { cleared: true, firstClear, xp: reward, hintCutPct: cut };
  }

  // ───────────── lab steps (objectives) ─────────────

  /** What a student sees of each step: never an answer, hash, salt or quiz key. */
  async objectivesView(userId: string, code: string) {
    const [objs, prog] = await Promise.all([
      this.prisma.missionObjective.findMany({ where: { missionCode: code }, orderBy: { n: 'asc' } }),
      this.prisma.objectiveProgress.findMany({ where: { userId, missionCode: code } }),
    ]);
    const p = new Map(prog.map((x) => [x.n, x]));
    return objs.map((o) => ({
      n: o.n,
      kind: o.kind,
      title: o.title,
      body: o.body,
      xp: o.kind === 'quiz' ? o.perCorrectXp * ((o.quiz as unknown[] | null)?.length ?? 0) : o.xp,
      perCorrectXp: o.kind === 'quiz' ? o.perCorrectXp : undefined,
      answerFormat: o.answerFormat ?? undefined,
      placeholder: o.placeholder ?? undefined,
      questions: o.kind === 'quiz' ? o.quiz : undefined,
      done: !!p.get(o.n)?.completedAt,
      xpAwarded: p.get(o.n)?.xpAwarded ?? null,
      score: p.get(o.n)?.score ?? null,
      maxScore: p.get(o.n)?.maxScore ?? null,
      tries: p.get(o.n)?.tries ?? 0,
    }));
  }

  private async step(userId: string, code: string, n: number, kinds: string[]) {
    const m = await this.published(code);
    const o = await this.prisma.missionObjective.findUnique({ where: { missionCode_n: { missionCode: code, n } } });
    if (!o || !kinds.includes(o.kind)) throw Errors.notFound('No such step in this mission.');
    const a = await this.prisma.missionAttempt.findFirst({ where: { userId, missionCode: code, status: 'active' } });
    if (!a) throw new AppError(409, 'NO_ACTIVE_ATTEMPT', 'Start the mission first.');
    const prev = await this.prisma.objectiveProgress.findUnique({
      where: { userId_missionCode_n: { userId, missionCode: code, n } },
    });
    return { m, o, a, prev };
  }

  /** Pays a step once (ledger source key), with the hint cut when the hint base is the lab reward. */
  private async payStep(userId: string, m: Mission, n: number, base: number, label: string) {
    if (base <= 0 || (await this.completedCodes(userId)).has(m.code)) return 0; // replays pay 0
    const rules = await this.game.rules();
    const used = await this.prisma.hintUse.findMany({ where: { userId, missionCode: m.code } });
    const cut = rules.hintBase === 'lab_reward' ? used.reduce((s, u) => s + u.pct, 0) : 0;
    const reward = Math.max(0, Math.round((base * Math.max(0, 100 - cut)) / 100));
    if (!reward) return 0;
    const ok = await this.game.award({
      userId,
      delta: reward,
      source: `lab:${m.code}:step:${n}`,
      reason: `${m.code} ${label}${cut ? ` (−${cut}% for hints)` : ''}`,
      qualifies: true,
    });
    return ok ? reward : 0;
  }

  /** Marks a step done once; clears the mission when every step is done. */
  private async finishStep(
    userId: string,
    m: Mission,
    attemptId: string,
    n: number,
    xp: number,
    extra: { score?: number; maxScore?: number },
    meta: RequestMeta,
  ) {
    const now = new Date();
    await this.prisma.objectiveProgress.upsert({
      where: { userId_missionCode_n: { userId, missionCode: m.code, n } },
      create: { userId, missionCode: m.code, n, completedAt: now, xpAwarded: xp, updatedAt: now, ...extra },
      update: { completedAt: now, xpAwarded: xp, updatedAt: now, ...extra },
    });
    const [total, done] = await Promise.all([
      this.prisma.missionObjective.count({ where: { missionCode: m.code } }),
      this.prisma.objectiveProgress.count({ where: { userId, missionCode: m.code, completedAt: { not: null } } }),
    ]);
    if (done < total) return { stepDone: true, xp, cleared: false };
    const c = await this.complete(userId, m, attemptId, meta, true);
    return { stepDone: true, xp, cleared: true, firstClear: c.firstClear };
  }

  async readStep(userId: string, code: string, n: number, meta: RequestMeta) {
    const { m, o, a, prev } = await this.step(userId, code, n, ['read']);
    if (prev?.completedAt) return { stepDone: true, xp: 0, already: true, cleared: false };
    const xp = await this.payStep(userId, m, n, o.xp, o.title);
    return this.finishStep(userId, m, a.id, n, xp, {}, meta);
  }

  /** The first scored attempt pays per correct answer; later attempts are practice (0 XP). */
  async quizStep(userId: string, code: string, n: number, answers: number[], meta: RequestMeta) {
    const { m, o, a, prev } = await this.step(userId, code, n, ['quiz']);
    const qs = (o.quiz as { id: string; options: string[] }[]) ?? [];
    const key = (o.quizKey as Record<string, string>) ?? {};
    if (!Array.isArray(answers) || answers.length !== qs.length)
      throw Errors.validation(`Answer all ${qs.length} questions.`, 'answers');
    const correct = qs.map((q, i) => {
      const pick = answers[i];
      if (!Number.isInteger(pick) || pick < 0 || pick >= q.options.length)
        throw Errors.validation(`Question ${i + 1}: pick one of its options.`, 'answers');
      return !!key[q.id] && sameHash(saltedHash(o.answerSalt ?? '', `${q.id}:${pick}`), key[q.id]);
    });
    const score = correct.filter(Boolean).length;
    if (prev?.completedAt) {
      await this.prisma.objectiveProgress.update({
        where: { userId_missionCode_n: { userId, missionCode: code, n } },
        data: { tries: { increment: 1 }, updatedAt: new Date() },
      });
      return { score, total: qs.length, correct, scored: false, xp: 0, stepDone: true, cleared: false };
    }
    const xp = await this.payStep(userId, m, n, score * o.perCorrectXp, `${o.title}: ${score}/${qs.length}`);
    const r = await this.finishStep(userId, m, a.id, n, xp, { score, maxScore: qs.length }, meta);
    return { score, total: qs.length, correct, scored: true, ...r };
  }

  async answerStep(userId: string, code: string, n: number, answer: string, meta: RequestMeta) {
    const { m, o, a, prev } = await this.step(userId, code, n, ['answer', 'lab_answer']);
    if (prev?.completedAt) return { stepDone: true, xp: 0, already: true, cleared: false };
    await this.rate.hitClass('mission_submit_user', userId);
    if (a.submissions >= m.maxSubmissions)
      throw new AppError(409, 'NO_SUBMISSIONS_LEFT', 'Too many wrong answers for this attempt. Start a new attempt.');
    const ok =
      o.answerFormat === 'session_flag'
        ? await this.verifyLabFlag(userId, m, answer)
        : checkAnswer(
            o.answerFormat as Exclude<AnswerFormat, 'session_flag'>,
            answer,
            o.answerSalt ?? '',
            o.answerHash ?? '',
          );
    const now = new Date();
    if (!ok) {
      await this.prisma.$transaction([
        this.prisma.missionAttempt.update({ where: { id: a.id }, data: { submissions: { increment: 1 } } }),
        this.prisma.objectiveProgress.upsert({
          where: { userId_missionCode_n: { userId, missionCode: code, n } },
          create: { userId, missionCode: code, n, tries: 1, updatedAt: now },
          update: { tries: { increment: 1 }, updatedAt: now },
        }),
      ]);
      throw new AppError(422, 'WRONG_ANSWER', 'That is not correct yet. Check your work and try again.', {
        details: { submissionsLeft: m.maxSubmissions - a.submissions - 1 },
      });
    }
    const xp = await this.payStep(userId, m, n, o.xp, o.title);
    return this.finishStep(userId, m, a.id, n, xp, {}, meta);
  }

  // ───────────── lab environments (server-to-server with mission-api) ─────────────

  /**
   * Signed call to the lab service for one Academy user: X-Academy-User, X-Academy-Ts and X-Academy-Sig =
   * HMAC-SHA256(MISSION_SERVICE_SECRET, "<user>|<ts>|<METHOD>|<path>"). The lab service trusts only this signature
   * (with MISSION_INTERNAL_ONLY=1 its old email-token sign-in is off), so identity always comes from this server.
   */
  private async lab(method: 'GET' | 'POST', path: string, userId: string, body?: object) {
    if (!(await this.providerAvailable())) throw this.unavailable();
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', this.cfg.MISSION_SERVICE_SECRET!)
      .update(`${userId}|${ts}|${method}|${path}`)
      .digest('hex');
    let r: Response;
    try {
      r = await fetch(new URL(path, this.cfg.LAB_PROVIDER_URL), {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Academy-User': userId,
          'X-Academy-Ts': ts,
          'X-Academy-Sig': sig,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(method === 'POST' && path.endsWith('/session/start') ? 60_000 : 10_000),
      });
    } catch {
      this.health = null;
      throw this.unavailable();
    }
    const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: r.status, json };
  }

  private async labMission(code: string) {
    const m = await this.published(code);
    if (m.provider === 'native' || !m.providerSlug) throw Errors.notFound('This lab has no live environment.');
    return m;
  }

  private labView(j: Record<string, unknown>) {
    return {
      status: (j.status as string) ?? 'none',
      sessionId: (j.session_id as string) ?? null,
      url: (j.url as string) ?? null,
      expires: (j.expires as string) ?? null,
    };
  }

  /** The student's own lab environment (never another student's: the lab service checks the signed user). */
  async labSession(userId: string, code: string) {
    const m = await this.labMission(code);
    if (!(await this.providerAvailable())) return { available: false, status: 'offline', url: null };
    const r = await this.lab('GET', `/api/${m.providerSlug}/session/current`, userId);
    if (r.status !== 200) throw this.unavailable();
    return { available: true, ...this.labView(r.json) };
  }

  async labStart(userId: string, code: string, meta: RequestMeta) {
    const m = await this.labMission(code);
    if (!(await this.prisma.missionAttempt.count({ where: { userId, missionCode: code, status: 'active' } })))
      throw new AppError(409, 'NO_ACTIVE_ATTEMPT', 'Start the mission first.');
    const r = await this.lab('POST', `/api/${m.providerSlug}/session/start`, userId);
    if (r.status === 503 || r.status === 502)
      throw new AppError(
        503,
        'LAB_ENVIRONMENT_UNAVAILABLE',
        (r.json.detail as string) ?? 'The lab could not be started.',
      );
    if (r.status === 409)
      throw new AppError(409, 'LAB_BUSY', (r.json.detail as string) ?? 'Your lab is changing state.');
    if (r.status !== 200) throw this.unavailable();
    await this.audit.record({
      action: 'academy.lab.started',
      actorId: userId,
      actorRole: 'student',
      targetType: 'mission',
      targetId: code,
      ip: meta.ip,
      requestId: meta.requestId,
    });
    return { available: true, ...this.labView(r.json) };
  }

  async labStop(userId: string, code: string) {
    const m = await this.labMission(code);
    const cur = await this.lab('GET', `/api/${m.providerSlug}/session/current`, userId);
    const sid = cur.json.session_id as string | undefined;
    if (!sid || cur.json.status !== 'active') return { available: true, ...this.labView(cur.json) };
    const r = await this.lab('POST', `/api/${m.providerSlug}/session/stop`, userId, { session_id: sid });
    if (r.status !== 200) throw this.unavailable();
    return { available: true, ...this.labView(r.json) };
  }

  /** Per-session flags live in the lab service; it answers yes or no for this student's own running session. */
  private async verifyLabFlag(userId: string, m: Mission, answer: string): Promise<boolean> {
    if (!m.providerSlug) throw this.unavailable();
    const cur = await this.lab('GET', `/api/${m.providerSlug}/session/current`, userId);
    if (cur.json.status !== 'active' || !cur.json.session_id)
      throw new AppError(409, 'LAB_NOT_RUNNING', 'Start your lab first: the flag belongs to your own running lab.');
    const r = await this.lab('POST', `/api/${m.providerSlug}/submit`, userId, {
      session_id: cur.json.session_id,
      answer,
    });
    if (r.status === 422)
      throw new AppError(422, 'ANSWER_FORMAT', (r.json.detail as string) ?? 'Check the flag format.');
    if (r.status === 410) throw new AppError(409, 'LAB_EXPIRED', 'Your lab session expired. Start the lab again.');
    if (r.status === 429) throw new AppError(429, 'RATE_LIMITED', 'Too many tries. Wait a while and try again.');
    if (r.status !== 200) throw this.unavailable();
    return r.json.accepted === true;
  }

  async abandon(userId: string, code: string) {
    const r = await this.prisma.missionAttempt.updateMany({
      where: { userId, missionCode: code, status: 'active' },
      data: { status: 'abandoned' },
    });
    if (!r.count) throw Errors.notFound('No active attempt for this mission.');
    return { abandoned: true };
  }

  /** World Breach Map: a city is secured once every published mission placed in it is cleared. */
  async cities(userId: string) {
    const [cities, done] = await Promise.all([
      this.prisma.city.findMany({
        orderBy: { sortOrder: 'asc' },
        include: { missions: { where: { status: 'published' }, select: { code: true, title: true, xpReward: true } } },
      }),
      this.completedCodes(userId),
    ]);
    return cities.map((c) => {
      const cleared = c.missions.filter((m) => done.has(m.code)).length;
      return {
        code: c.code,
        name: c.name,
        country: c.country,
        missions: c.missions.length,
        cleared,
        progressPct: c.missions.length ? Math.round((100 * cleared) / c.missions.length) : 0,
        secured: c.missions.length > 0 && cleared === c.missions.length,
        operations: c.missions.map((m) => ({
          code: m.code,
          title: m.title,
          xp: m.xpReward,
          cleared: done.has(m.code),
        })),
      };
    });
  }

  async freeTotal() {
    return this.prisma.mission.count({ where: { status: 'published', premium: false } });
  }

  async activeOperation(userId: string) {
    const a = await this.prisma.missionAttempt.findFirst({
      where: { userId, status: 'active' },
      orderBy: { startedAt: 'desc' },
      include: { mission: { select: { code: true, title: true } } },
    });
    return a ? { code: a.mission.code, title: a.mission.title, startedAt: a.startedAt } : null;
  }

  // ───────────── admin ─────────────

  adminList() {
    return this.prisma.mission
      .findMany({
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        include: { _count: { select: { hints: true, attempts: true } } },
      })
      .then((rows) => rows.map((m) => this.safe(m)));
  }

  /** One mission for the admin editor, with its hint texts (admins write them). The answer hash never leaves. */
  async adminGet(code: string) {
    const m = await this.prisma.mission.findUnique({
      where: { code },
      include: {
        _count: { select: { hints: true, attempts: true } },
        hints: { orderBy: { n: 'asc' }, select: { n: true, text: true } },
      },
    });
    if (!m) throw Errors.notFound('No mission with that code.');
    return this.safe(m);
  }

  async create(actor: Actor, dto: MissionDto) {
    try {
      const m = await this.prisma.mission.create({
        data: { ...this.fields(dto), code: dto.code, title: dto.title, category: dto.category, xpReward: dto.xpReward },
      });
      await this.log('admin.mission.created', m.code, actor, {});
      return this.safe(m);
    } catch (e) {
      if (isUnique(e)) throw Errors.conflict('MISSION_EXISTS', 'A mission with this code already exists.');
      throw e;
    }
  }

  async patch(actor: Actor, code: string, dto: MissionPatchDto) {
    if (!(await this.prisma.mission.findUnique({ where: { code } })))
      throw Errors.notFound('No mission with that code.');
    const m = await this.prisma.mission.update({
      where: { code },
      data: {
        ...this.fields(dto),
        ...(dto.title ? { title: dto.title } : {}),
        ...(dto.category ? { category: dto.category } : {}),
        ...(dto.xpReward !== undefined ? { xpReward: dto.xpReward } : {}),
      },
    });
    await this.log('admin.mission.updated', code, actor, { fields: Object.keys(dto) });
    return this.safe(m);
  }

  /** Write-only: stores a salted hash of the answer; the answer itself is never kept or returned. */
  async setFlag(actor: Actor, code: string, flag: string) {
    const salt = randomBytes(16).toString('hex');
    const r = await this.prisma.mission.updateMany({
      where: { code },
      data: { flagSalt: salt, flagHash: hashFlag(salt, flag), provider: 'native' },
    });
    if (!r.count) throw Errors.notFound('No mission with that code.');
    await this.log('admin.mission.flag_set', code, actor, {});
    return { code, hasFlag: true };
  }

  async setHint(actor: Actor, code: string, dto: HintDto) {
    if (!(await this.prisma.mission.findUnique({ where: { code } })))
      throw Errors.notFound('No mission with that code.');
    await this.prisma.missionHint.upsert({
      where: { missionCode_n: { missionCode: code, n: dto.n } },
      create: { missionCode: code, n: dto.n, text: dto.text },
      update: { text: dto.text },
    });
    await this.log('admin.mission.hint_set', code, actor, { n: dto.n });
    return { code, n: dto.n };
  }

  async completions(code: string) {
    return this.prisma.missionAttempt.findMany({
      where: { missionCode: code, status: 'completed' },
      orderBy: { completedAt: 'desc' },
      take: 500,
      select: { userId: true, completedAt: true, xpAwarded: true },
    });
  }

  cityList() {
    return this.prisma.city.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  // ───────────── helpers ─────────────

  private async published(code: string) {
    const m = await this.prisma.mission.findUnique({ where: { code } });
    if (!m || m.status !== 'published') throw Errors.notFound('No mission with that code.');
    return m;
  }

  async completedCodes(userId: string) {
    const rows = await this.prisma.missionAttempt.findMany({
      where: { userId, status: 'completed' },
      distinct: ['missionCode'],
      select: { missionCode: true },
    });
    return new Set(rows.map((r) => r.missionCode));
  }

  private locked(m: Mission, done: Set<string>, paid: boolean): 'premium' | 'prerequisite' | null {
    if (m.premium && !paid) return 'premium';
    if (m.prerequisites.some((p) => !done.has(p))) return 'prerequisite';
    return null;
  }

  private card(m: Mission) {
    return {
      code: m.code,
      title: m.title,
      description: m.description,
      category: m.category,
      difficulty: m.difficulty,
      estMinutes: m.estMinutes,
      xp: m.xpReward,
      premium: m.premium,
      city: m.cityCode,
      provider: m.provider,
      prerequisites: m.prerequisites,
    };
  }

  private safe<T extends Mission>(m: T) {
    // The answer hash and salt never leave this service.
    const rest: Partial<Mission> = { ...m };
    delete rest.flagHash;
    delete rest.flagSalt;
    return { ...rest, hasFlag: !!m.flagHash };
  }

  private fields(dto: MissionPatchDto) {
    const keys = [
      'description',
      'difficulty',
      'estMinutes',
      'premium',
      'prerequisites',
      'cityCode',
      'provider',
      'providerSlug',
      'maxSubmissions',
      'status',
      'sortOrder',
    ] as const;
    return Object.fromEntries(
      keys.filter((k) => dto[k] !== undefined).map((k) => [k, dto[k]]),
    ) as Partial<Prisma.MissionUncheckedCreateInput>;
  }

  private log(action: string, code: string, actor: Actor, detail: Record<string, unknown>) {
    return this.audit.record({
      action,
      actorId: actor.userId,
      actorRole: 'admin',
      targetType: 'mission',
      targetId: code,
      detail,
      ip: actor.ip,
      requestId: actor.requestId,
    });
  }
}

function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, 'hex'),
    y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}
