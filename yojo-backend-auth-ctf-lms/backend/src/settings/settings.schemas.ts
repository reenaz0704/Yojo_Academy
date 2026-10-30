import { z } from 'zod';

/**
 * System Settings sections (spec §7.10 settings row, values [PROVISIONAL] from the design document and prototype).
 * Every PUT is validated against these schemas; unknown keys are rejected.
 */
const plan = z
  .object({
    code: z.string().regex(/^[A-Z0-9-]{2,32}$/),
    name: z.string().min(1).max(60),
    pricePaise: z.number().int().min(0),
    active: z.boolean(),
  })
  .strict();

export const SETTINGS_SCHEMAS = {
  plans: z.object({ plans: z.array(plan).max(30) }).strict(),
  xp: z
    .object({
      easyLab: z.number().int().min(0).max(10_000),
      mediumLab: z.number().int().min(0).max(10_000),
      hardLab: z.number().int().min(0).max(10_000),
      dailyStreak: z.number().int().min(0).max(1_000),
      quizPass: z.number().int().min(0).max(1_000),
    })
    .strict(),
  ai: z
    .object({
      studentDailyCap: z.number().int().min(0).max(10_000),
      staffDailyCap: z.number().int().min(0).max(10_000),
      guestDailyCap: z.number().int().min(0).max(1_000),
      monthlySpendCapInr: z.number().int().min(0).nullable(),
    })
    .strict(),
  promos: z
    .object({
      codes: z
        .array(
          z
            .object({
              code: z.string().regex(/^[A-Z0-9]{3,20}$/),
              percentOff: z.number().int().min(1).max(100),
              active: z.boolean(),
            })
            .strict(),
        )
        .max(100),
    })
    .strict(),
  maintenance: z.object({ enabled: z.boolean(), message: z.string().max(300) }).strict(),
  policy: z
    .object({
      attendanceMinPct: z.number().int().min(1).max(100),
      // Performance index (trainer/admin batch overview): attendance %, quiz average %, labs cleared % (OI-42).
      piWeights: z
        .object({
          attendance: z.number().int().min(0).max(100),
          quiz: z.number().int().min(0).max(100),
          labs: z.number().int().min(0).max(100),
        })
        .strict()
        .refine((w) => w.attendance + w.quiz + w.labs === 100, 'PI weights must add up to 100'),
      broadcastSecondAdminThreshold: z.number().int().min(1),
      approvalTargetHours: z.number().int().min(1).max(720),
    })
    .strict(),
  auth: z
    .object({
      otpTtlSec: z.number().int().min(60).max(900),
      otpMaxTries: z.number().int().min(1).max(10),
      otpResendSec: z.number().int().min(10).max(300),
      staffLockAfterFailures: z.number().int().min(3).max(20),
      staffLockMinutes: z.number().int().min(1).max(1440),
      stepUpWindowSec: z.number().int().min(60).max(1800),
    })
    .strict(),
  // Student Academy rules (owner's decisions of 22 Oct 2026; see docs/ACADEMY-INVENTORY.md).
  gamification: z
    .object({
      dailyPatchXp: z
        .object({
          learn: z.number().int().min(1).max(1000),
          lab: z.number().int().min(1).max(1000),
          read: z.number().int().min(1).max(1000),
        })
        .strict(),
      weeklyOps: z
        .object({
          labsTarget: z.number().int().min(1).max(50),
          labsXp: z.number().int().min(1).max(5000),
          streakTarget: z.number().int().min(1).max(30),
          streakXp: z.number().int().min(1).max(5000),
          patchesTarget: z.number().int().min(1).max(21),
          patchesXp: z.number().int().min(1).max(5000),
        })
        .strict(),
      // A streak survives this many hours after the last qualifying activity.
      streakGraceHours: z.number().int().min(24).max(168),
      // Keeping a broken streak costs this % of the current total XP (Math.round, half up).
      streakKeepCostPct: z.number().int().min(0).max(100),
      // Hint n costs hintPcts[n-1] % of the base, whole numbers; the base is the lab reward or the student's total XP.
      hintPcts: z.array(z.number().int().min(0).max(100)).min(1).max(5),
      hintBase: z.enum(['lab_reward', 'total_xp']),
      // [rank name, XP needed], ascending.
      ranks: z
        .array(z.tuple([z.string().min(2).max(40), z.number().int().min(0)]))
        .min(1)
        .max(20)
        .refine((r) => r.every((x, i) => i === 0 || x[1] > r[i - 1][1]), 'ranks must ascend'),
      // Weekly league: how many move up and down when a week closes.
      leaguePromote: z.number().int().min(0).max(50),
      leagueDemote: z.number().int().min(0).max(50),
    })
    .strict(),
  // Placement Mission readiness (weights are a product decision; default = the page's equal average).
  placement: z
    .object({
      weights: z
        .object({
          resume: z.number().int().min(0).max(100),
          mock: z.number().int().min(0).max(100),
          internship: z.number().int().min(0).max(100),
          portfolio: z.number().int().min(0).max(100),
        })
        .strict()
        .refine((w) => w.resume + w.mock + w.internship + w.portfolio === 100, 'weights must add up to 100'),
      mockTarget: z.number().int().min(1).max(20),
      portfolioTarget: z.number().int().min(1).max(20),
      // When internship applications open (ISO date-time) or null when not announced.
      applicationsOpenAt: z.string().datetime().nullable(),
    })
    .strict(),
} as const;

export type SettingsSection = keyof typeof SETTINGS_SCHEMAS;
export const SETTINGS_SECTIONS = Object.keys(SETTINGS_SCHEMAS) as SettingsSection[];
/** Sections whose change needs a fresh authenticator code (spec §6.4.4). */
export const STEP_UP_SECTIONS: SettingsSection[] = ['policy', 'plans', 'auth'];

export const SETTINGS_DEFAULTS: { [K in SettingsSection]: z.infer<(typeof SETTINGS_SCHEMAS)[K]> } = {
  plans: {
    plans: [
      { code: 'FREE', name: 'Free', pricePaise: 0, active: true },
      { code: 'FOUNDATIONS', name: 'Foundations', pricePaise: 0, active: false },
      { code: 'SOC-ANALYST', name: 'SOC Analyst', pricePaise: 0, active: false },
      { code: 'GRC-ANALYST', name: 'GRC Analyst', pricePaise: 0, active: false },
    ],
  },
  xp: { easyLab: 50, mediumLab: 100, hardLab: 200, dailyStreak: 10, quizPass: 40 },
  ai: { studentDailyCap: 30, staffDailyCap: 100, guestDailyCap: 10, monthlySpendCapInr: null },
  promos: { codes: [] },
  maintenance: { enabled: false, message: '' },
  policy: {
    attendanceMinPct: 75,
    piWeights: { attendance: 20, quiz: 40, labs: 40 }, // owner, 24 Oct
    broadcastSecondAdminThreshold: 200,
    approvalTargetHours: 24,
  },
  auth: {
    otpTtlSec: 300,
    otpMaxTries: 3,
    otpResendSec: 30,
    staffLockAfterFailures: 5,
    staffLockMinutes: 15,
    stepUpWindowSec: 300,
  },
  gamification: {
    dailyPatchXp: { learn: 40, lab: 60, read: 20 },
    weeklyOps: { labsTarget: 3, labsXp: 150, streakTarget: 5, streakXp: 100, patchesTarget: 10, patchesXp: 80 },
    streakGraceHours: 48,
    streakKeepCostPct: 10,
    hintPcts: [5, 10, 15],
    hintBase: 'lab_reward',
    ranks: [
      ['Rookie', 0],
      ['Packet Scout', 250],
      ['Cyber Apprentice', 750],
      ['Security Operative', 1750],
      ['Threat Hunter', 3500],
      ['Yojo Cyber Elite', 7000],
    ],
    leaguePromote: 7,
    leagueDemote: 5,
  },
  placement: {
    weights: { resume: 25, mock: 25, internship: 25, portfolio: 25 },
    mockTarget: 3,
    portfolioTarget: 5,
    applicationsOpenAt: null,
  },
};
