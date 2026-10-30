/**
 * Creates the first Platform Admin invite when no admin exists yet (spec §6.4.1 needs an existing Platform Admin to
 * invite anyone, so the very first one comes from this one-off command run by an operator).
 *
 *   npm run db:bootstrap-admin -- someone@yojosolutions.com
 *
 * Prints the invite link once. The token is stored only as SHA-256. Refuses to run when any admin already exists.
 */
import { PrismaClient } from '@prisma/client';
import { loadLocalEnv } from '../src/config/load-env';
import { AuditService } from '../src/audit/audit.service';
import { randomToken, sha256 } from '../src/common/crypto/crypto.util';
import { loadConfig } from '../src/config/config.schema';
import { INVITE_TTL_MS } from '../src/identity/constants';
import { isStaffEmail, normEmail } from '../src/identity/types';
import type { PrismaService } from '../src/prisma/prisma.service';

async function main(): Promise<void> {
  loadLocalEnv();
  const cfg = loadConfig();
  const email = normEmail(process.argv[2] ?? '');
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('usage: npm run db:bootstrap-admin -- <email>');
  if (!isStaffEmail(cfg, email))
    throw new Error(`email must use one of STAFF_EMAIL_DOMAINS (${cfg.STAFF_EMAIL_DOMAINS})`);
  const prisma = new PrismaClient();
  try {
    if (await prisma.user.count({ where: { role: 'admin' } }))
      throw new Error('an admin already exists; use the admin console to invite staff');
    const token = randomToken(32);
    await prisma.$transaction(async (tx) => {
      await tx.staffInvite.updateMany({
        where: { email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const inv = await tx.staffInvite.create({
        data: {
          email,
          role: 'admin',
          adminRole: 'platform',
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });
      // Same hash-chained audit path as the app, inside this transaction.
      await new AuditService(prisma as unknown as PrismaService).record(
        { action: 'staff.invite.bootstrap', targetType: 'staff_invite', targetId: inv.id, detail: { email } },
        tx,
      );
    });
    process.stdout.write(
      `Platform Admin invite created for ${email} (valid 72 hours, shown once):\n${cfg.PUBLIC_APP_URL}/login.html#invite=${token}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
