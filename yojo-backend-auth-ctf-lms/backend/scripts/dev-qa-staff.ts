/**
 * Development only: creates (or resets) a QA trainer or QA Platform Admin with a fresh password and authenticator
 * secret. For the trainer it also makes a QA batch it teaches with one QA student, so the consoles can be checked in a
 * browser against the local API. Refuses to run unless APP_ENV is local or development. The sign-in details are
 * written to the file given (keep it outside the repository); they are never printed.
 *
 *   npx ts-node scripts/dev-qa-staff.ts trainer|admin <output-file>
 *
 * Suspend the account again when the check is done (set users.status = 'suspended').
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { FieldEncryptionService } from '../src/common/crypto/field-encryption.service';
import { loadConfig } from '../src/config/config.schema';
import { CONSENT_VERSIONS } from '../src/identity/constants';
import { PasswordService } from '../src/identity/password.service';
import { newTotpSecret } from '../src/identity/totp';

const EMAILS = { trainer: 'qa.trainer.test@yojosolutions.com', admin: 'qa.admin.test@yojosolutions.com' };
const STUDENT = 'qa.student.test@abc-institute.demo';

async function main() {
  const [kind, out] = process.argv.slice(2);
  if ((kind !== 'trainer' && kind !== 'admin') || !out)
    throw new Error('Usage: dev-qa-staff.ts trainer|admin <output-file>');
  const cfg = loadConfig();
  if (cfg.APP_ENV !== 'local' && cfg.APP_ENV !== 'development') throw new Error('Local development only.');
  const isAdmin = kind === 'admin';
  const email = EMAILS[kind];
  const label = isAdmin ? 'QA Admin (test)' : 'QA Trainer (test)';
  const prisma = new PrismaClient();
  const enc = new FieldEncryptionService(cfg);
  const password = `Qa-${randomBytes(9).toString('base64url')}!7`;
  const secret = newTotpSecret();
  const passwordHash = await new PasswordService().hash(password);

  const existing = await prisma.user.findUnique({ where: { email } });
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, status: 'active', failedLogins: 0, lockedUntil: null },
      })
    : await prisma.user.create({
        data: {
          email,
          role: isAdmin ? 'admin' : 'trainer',
          ...(isAdmin ? { adminRole: 'platform' as const } : { capability: 'trainer_mentor' as const }),
          status: 'active',
          origin: 'staff',
          displayName: label,
          passwordHash,
          staffProfile: { create: { displayName: label, speciality: 'QA checks' } },
          consents: {
            create: [
              { kind: 'code_of_conduct', version: CONSENT_VERSIONS.code_of_conduct, accepted: true },
              { kind: 'staff_policy', version: CONSENT_VERSIONS.staff_policy, accepted: true },
            ],
          },
        },
      });
  await prisma.mfaFactor.deleteMany({ where: { userId: user.id } });
  await prisma.mfaFactor.create({
    data: {
      userId: user.id,
      type: 'totp',
      secretEnc: new Uint8Array(enc.encrypt(secret)),
      keyId: enc.keyId,
      confirmedAt: new Date(),
    },
  });

  if (!isAdmin) {
    const student =
      (await prisma.user.findUnique({ where: { email: STUDENT } })) ??
      (await prisma.user.create({
        data: {
          email: STUDENT,
          role: 'student',
          status: 'active',
          origin: 'yojo',
          displayName: 'QA Student (test)',
          studentProfile: { create: { name: 'QA Student (test)' } },
        },
      }));
    const batch =
      (await prisma.batch.findUnique({ where: { code: 'QA-TRAINER' } })) ??
      (await prisma.batch.create({
        data: { code: 'QA-TRAINER', name: 'QA trainer checks (test)', trainerId: user.id, status: 'active' },
      }));
    await prisma.enrolment.upsert({
      where: { studentId_batchId: { studentId: student.id, batchId: batch.id } },
      create: { studentId: student.id, batchId: batch.id, status: 'active' },
      update: { status: 'active' },
    });
  }

  writeFileSync(
    out,
    `${label}, local dev only\nemail: ${email}\npassword: ${password}\ntotp secret (base32): ${secret}\n`,
    {
      mode: 0o600,
    },
  );
  console.log(`${label} ready (${existing ? 'reset' : 'created'}). Details written to the file you gave.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
