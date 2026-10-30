/**
 * LOCAL DEVELOPMENT ONLY. Creates (or resets) the prototype's demo people in the local database so the sign-in page
 * demo panel works against the real server (src/dev/demo-directory.ts):
 *   Riya Sharma and Neha P: existing Yojo students (sign in with "Yes", email code from the demo inbox);
 *   Vikram Rao: trainer; Priya: Platform Admin (demo password + authenticator code shown in the panel).
 * Arjun K is not created: he is the "new student" who signs up with "No".
 * Refuses to run unless APP_ENV is local or development.
 *
 *   npx ts-node --transpile-only scripts/dev-demo-users.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { FieldEncryptionService } from '../src/common/crypto/field-encryption.service';
import { loadConfig } from '../src/config/config.schema';
import { DEMO_PEOPLE, DEMO_STAFF_PASSWORD } from '../src/dev/demo-directory';
import { FREE_PLAN_CODE } from '../src/entitlements/entitlement.service';
import { CONSENT_VERSIONS } from '../src/identity/constants';
import { PasswordService } from '../src/identity/password.service';

const PROFILE = {
  city: 'Hyderabad, TS',
  institutionName: 'Yojo Solutions',
  eduLevel: 'B.Tech / B.E.',
  stream: 'Computer Science',
  gradYear: 2027,
  cgpa: 8.1,
  skills: ['Python', 'Linux'],
  objective: 'SOC analyst role in a product company.',
};

async function main() {
  const cfg = loadConfig();
  if (cfg.APP_ENV !== 'local' && cfg.APP_ENV !== 'development') throw new Error('Local development only.');
  const prisma = new PrismaClient();
  const enc = new FieldEncryptionService(cfg);
  const staffHash = await new PasswordService().hash(DEMO_STAFF_PASSWORD);
  const free = await prisma.plan.findUnique({ where: { code: FREE_PLAN_CODE }, select: { id: true } });
  try {
    for (const p of DEMO_PEOPLE) {
      if (p.role === 'student' && !p.studentNumber) continue; // Arjun signs up himself
      const existing = await prisma.user.findUnique({ where: { email: p.email } });
      if (p.role === 'student') {
        const dob = p.email.startsWith('riya') ? '2004-03-14' : '2002-11-20';
        const user = existing
          ? await prisma.user.update({ where: { id: existing.id }, data: { status: 'active' } })
          : await prisma.user.create({
              data: {
                email: p.email,
                role: 'student',
                status: 'active',
                origin: 'yojo',
                displayName: p.name,
                phone: p.email.startsWith('riya') ? '9800000010' : '9800000012',
                studentProfile: {
                  create: {
                    ...PROFILE,
                    name: p.name,
                    studentNumber: p.studentNumber,
                    dob: new Date(`${dob}T00:00:00Z`),
                  },
                },
                consents: {
                  create: (['terms', 'privacy', 'aup'] as const).map((kind) => ({
                    kind,
                    version: CONSENT_VERSIONS[kind],
                    accepted: true,
                  })),
                },
              },
            });
        if (free && !(await prisma.subscription.count({ where: { studentId: user.id } })))
          await prisma.subscription.create({ data: { studentId: user.id, planId: free.id } });
        // Riya already chose her path (Defensive); Neha has none yet, so the Academy offers the career quiz.
        if (p.email.startsWith('riya') && !(await prisma.careerPathResult.count({ where: { userId: user.id } })))
          await prisma.careerPathResult.create({
            data: {
              userId: user.id,
              quizVersion: 'demo',
              skipped: true,
              chosenPath: 'Defensive',
              chosenAt: new Date(),
              createdAt: new Date(),
            },
          });
        continue;
      }
      const isAdmin = p.role === 'admin';
      const user = existing
        ? await prisma.user.update({
            where: { id: existing.id },
            data: { passwordHash: staffHash, status: 'active', failedLogins: 0, lockedUntil: null },
          })
        : await prisma.user.create({
            data: {
              email: p.email,
              role: isAdmin ? 'admin' : 'trainer',
              ...(isAdmin ? { adminRole: 'platform' as const } : { capability: 'trainer_mentor' as const }),
              status: 'active',
              origin: 'staff',
              displayName: p.name,
              passwordHash: staffHash,
              staffProfile: { create: { displayName: p.name.replace(/\s*\(.*\)$/, ''), speciality: 'Demo account' } },
              consents: {
                create: (['code_of_conduct', 'staff_policy'] as const).map((kind) => ({
                  kind,
                  version: CONSENT_VERSIONS[kind],
                  accepted: true,
                })),
              },
            },
          });
      // the same authenticator key as the prototype, so the panel's code is accepted by the server
      await prisma.mfaFactor.deleteMany({ where: { userId: user.id } });
      await prisma.mfaFactor.create({
        data: {
          userId: user.id,
          type: 'totp',
          secretEnc: new Uint8Array(enc.encrypt(p.totpSecret)),
          keyId: enc.keyId,
          confirmedAt: new Date(),
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
  console.log('Demo people ready: Riya, Neha (students), Vikram (trainer), Priya (Platform Admin). Arjun signs up.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
