/**
 * Idempotent seed: role_permissions from the access matrix (spec §6.6) and default settings.
 * Safe to run repeatedly: permission rows are upserted, rows no longer in the matrix are removed, existing settings
 * are never overwritten (an admin may have changed them). No users or credentials are created here.
 * The two upcoming events shown on the website's CTF page are created if missing (never overwritten). Their year is an
 * assumption (OPEN-ITEMS OI-30): the page shows only "18 Jan" and "08 Feb".
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { matrixRows } from '../src/access/permissions';
import { SETTINGS_DEFAULTS } from '../src/settings/settings.schemas';
import { hashAnswer, newSalt, saltedHash } from '../src/academy/lab-answers';
import { LAB_CONTENT } from './lab-content';

export async function seed(
  prisma: PrismaClient,
): Promise<{ permissions: number; removed: number; settingsCreated: number; eventsCreated: number }> {
  const rows = matrixRows();
  await prisma.$transaction(
    rows.map((r) =>
      prisma.rolePermission.upsert({
        where: { adminRole_permission: { adminRole: r.adminRole, permission: r.permission } },
        create: r,
        update: { level: r.level },
      }),
    ),
  );
  const keep = new Set(rows.map((r) => `${r.adminRole}:${r.permission}`));
  const existing = await prisma.rolePermission.findMany();
  const extra = existing.filter((e) => !keep.has(`${e.adminRole}:${e.permission}`)).map((e) => e.id);
  if (extra.length) await prisma.rolePermission.deleteMany({ where: { id: { in: extra } } });

  let settingsCreated = 0;
  for (const [section, value] of Object.entries(SETTINGS_DEFAULTS)) {
    const found = await prisma.setting.findUnique({ where: { section } });
    if (found) continue;
    await prisma.setting.create({ data: { section, value: value as Prisma.InputJsonValue, version: 1 } });
    settingsCreated++;
  }

  let eventsCreated = 0;
  for (const e of LISTED_EVENTS) {
    if (await prisma.ctfEvent.findUnique({ where: { slug: e.slug } })) continue;
    await prisma.ctfEvent.create({ data: { ...e, status: 'draft', listed: true } });
    eventsCreated++;
  }
  // Achievement definitions (the 12 trophies on the Academy dashboard). Created if missing, never overwritten.
  for (const [i, a] of ACHIEVEMENTS.entries())
    await prisma.achievement.upsert({ where: { code: a.code }, create: { ...a, sortOrder: i }, update: {} });
  // World Breach Map cities and the missions that exist today (the Python mission service, XP from its config).
  // Created if missing, never overwritten; mission categories are a default to confirm (OPEN-ITEMS).
  for (const [i, c] of CITIES.entries())
    await prisma.city.upsert({
      where: { code: c[0] },
      create: { code: c[0], name: c[1], country: c[2], sortOrder: i },
      update: {},
    });
  for (const [i, m] of SERVICE_MISSIONS.entries())
    await prisma.mission.upsert({
      where: { code: m[0] },
      create: {
        code: m[0],
        providerSlug: m[1],
        title: m[2],
        category: m[3],
        xpReward: m[4],
        difficulty: 'Beginner',
        estMinutes: m[5],
        provider: 'mission-api',
        status: 'published',
        sortOrder: i,
      },
      update: {},
    });
  // Lab steps, quizzes, answers and hints (24 Oct). Added only to a mission that has no steps yet, so an admin's
  // later edits are never overwritten. Answers and quiz keys are stored as salted hashes only.
  for (const [code, c] of Object.entries(LAB_CONTENT)) {
    if (!(await prisma.mission.findUnique({ where: { code } }))) continue;
    if (await prisma.missionObjective.count({ where: { missionCode: code } })) continue;
    const total = c.steps.reduce((t, st) => t + (st.xp ?? 0) + (st.perCorrectXp ?? 0) * (st.quiz?.length ?? 0), 0);
    await prisma.$transaction([
      prisma.mission.update({ where: { code }, data: { provider: c.provider, xpReward: total } }),
      ...c.steps.map((st, i) => {
        const salt = newSalt();
        const quiz = st.quiz?.map((q, k) => ({ id: `q${k + 1}`, prompt: q.prompt, options: q.options }));
        const quizKey = st.quiz
          ? Object.fromEntries(st.quiz.map((q, k) => [`q${k + 1}`, saltedHash(salt, `q${k + 1}:${q.answer}`)]))
          : undefined;
        return prisma.missionObjective.create({
          data: {
            missionCode: code,
            n: i + 1,
            kind: st.kind,
            title: st.title,
            body: st.body ?? '',
            xp: st.xp ?? 0,
            perCorrectXp: st.perCorrectXp ?? 0,
            answerFormat: st.format ?? null,
            answerSalt: st.answer !== undefined || st.quiz ? salt : null,
            answerHash:
              st.answer !== undefined && st.format && st.format !== 'session_flag'
                ? hashAnswer(st.format, st.answer, salt)
                : null,
            placeholder: st.placeholder ?? null,
            quiz: quiz as Prisma.InputJsonValue | undefined,
            quizKey: quizKey as Prisma.InputJsonValue | undefined,
          },
        });
      }),
    ]);
    for (const [i, text] of c.hints.entries())
      await prisma.missionHint.upsert({
        where: { missionCode_n: { missionCode: code, n: i + 1 } },
        create: { missionCode: code, n: i + 1, text },
        update: {},
      });
  }
  return { permissions: rows.length, removed: extra.length, settingsCreated, eventsCreated };
}

const CITIES: [string, string, string][] = [
  ['tokyo', 'Tokyo', 'Japan'],
  ['paris', 'Paris', 'France'],
  ['newyork', 'New York', 'USA'],
  ['london', 'London', 'United Kingdom'],
  ['dubai', 'Dubai', 'UAE'],
  ['delhi', 'New Delhi', 'India'],
  ['singapore', 'Singapore', 'Singapore'],
  ['sydney', 'Sydney', 'Australia'],
  ['rio', 'Rio de Janeiro', 'Brazil'],
  ['cairo', 'Cairo', 'Egypt'],
  ['berlin', 'Berlin', 'Germany'],
  ['toronto', 'Toronto', 'Canada'],
  ['seoul', 'Seoul', 'South Korea'],
  ['mumbai', 'Mumbai', 'India'],
  ['capetown', 'Cape Town', 'South Africa'],
];

// mission-api/main.py MISSIONS and db.py MAX_XP (default values).
const SERVICE_MISSIONS: [string, string, string, string, number, string][] = [
  ['INT-01', 'm1', 'Introduction to Cybersecurity', 'Foundations', 100, '20-30'],
  ['REC-01', 'm2', 'Reconnaissance Fundamentals', 'Offensive', 50, '20-30'],
  ['WEB-01', 'm3', 'Web Technology Fingerprinting', 'Offensive', 50, '15-25'],
  ['INFO-01', 'm4', 'Information Gathering', 'Offensive', 50, '20-30'],
  ['DOM-01', 'm5', 'Domain Expiration Intelligence', 'Offensive', 50, '20-30'],
  ['SUB-01', 'm6', 'Subdomain Enumeration', 'Offensive', 50, '20-30'],
  ['END-01', 'm7', 'Endpoint Discovery', 'Offensive', 50, '20-30'],
  ['DIR-01', 'm8', 'Hidden Directory Discovery', 'Offensive', 50, '20-30'],
  ['IMG-01', 'm9', 'Image Metadata Analysis', 'Offensive', 50, '20-30'],
];

// Rule kinds are evaluated in GamificationService (factFor). blogs_published waits for the Intel module.
const ACHIEVEMENTS = [
  {
    code: 'first-defensive',
    title: 'Star-Spangled Shield: first defensive op',
    icon: '🛡️',
    ruleKind: 'lab_category',
    ruleArg: 'Defensive',
    threshold: 1,
  },
  {
    code: 'first-offensive',
    title: 'Blade Master: first offensive op',
    icon: '⚔️',
    ruleKind: 'lab_category',
    ruleArg: 'Offensive',
    threshold: 1,
  },
  {
    code: 'first-grc',
    title: 'Holocron Keeper: first GRC op',
    icon: '📜',
    ruleKind: 'lab_category',
    ruleArg: 'GRC',
    threshold: 1,
  },
  {
    code: 'streak-7',
    title: 'Infinity Streak: 7-day streak',
    icon: '🔥',
    ruleKind: 'longest_streak',
    ruleArg: null,
    threshold: 7,
  },
  {
    code: 'xp-1000',
    title: 'Thunder Strike: 1,000 XP',
    icon: '⚡',
    ruleKind: 'xp_total',
    ruleArg: null,
    threshold: 1000,
  },
  {
    code: 'pathfinder',
    title: 'Pathfinder: faction chosen',
    icon: '🧭',
    ruleKind: 'onboarding_done',
    ruleArg: null,
    threshold: 1,
  },
  {
    code: 'league-win',
    title: 'Galactic Champion: win a weekly league',
    icon: '🏆',
    ruleKind: 'league_win',
    ruleArg: null,
    threshold: 1,
  },
  {
    code: 'blogs-3',
    title: 'Lorekeeper: 3 live blogs',
    icon: '📚',
    ruleKind: 'blogs_published',
    ruleArg: null,
    threshold: 3,
  },
  {
    code: 'labs-10',
    title: 'Sharpshooter: 10 ops cleared',
    icon: '🎯',
    ruleKind: 'labs_total',
    ruleArg: null,
    threshold: 10,
  },
  {
    code: 'premium-lab',
    title: 'Mad Scientist: clear a premium lab',
    icon: '🧪',
    ruleKind: 'premium_lab',
    ruleArg: null,
    threshold: 1,
  },
  {
    code: 'streak-30',
    title: 'Hyperspace: 30-day streak',
    icon: '🌌',
    ruleKind: 'longest_streak',
    ruleArg: null,
    threshold: 30,
  },
  {
    code: 'elite',
    title: 'Elite Crown: reach Yojo Cyber Elite',
    icon: '👑',
    ruleKind: 'xp_total',
    ruleArg: null,
    threshold: 7000,
  },
];

const LISTED_EVENTS = [
  {
    slug: 'web-breakers-sprint',
    name: 'Web Breakers Sprint',
    startsAt: new Date('2027-01-18T04:30:00Z'),
    durationHours: 6,
    format: 'Solo',
  },
  {
    slug: 'blue-team-hunt-soc',
    name: 'Blue Team Hunt: SOC edition',
    startsAt: new Date('2027-02-08T04:30:00Z'),
    durationHours: 12,
    format: 'Teams 1-3',
  },
];

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then((r) =>
      process.stdout.write(
        `seed ok: ${r.permissions} permission rows, ${r.removed} removed, ${r.settingsCreated} settings created, ${r.eventsCreated} events created, achievements ok\n`,
      ),
    )
    .catch((e: unknown) => {
      process.stderr.write(`seed failed: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
