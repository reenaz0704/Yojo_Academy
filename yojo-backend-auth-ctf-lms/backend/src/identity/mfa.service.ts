import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service';
import { randomToken } from '../common/crypto/crypto.util';
import { AppError, Errors } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../common/guards/rate-limit.service';
import { matchTotp, newTotpSecret, otpauthUri } from './totp';

/** TOTP enrolment, verification with replay protection, recovery codes and step-up checks (spec §6.4). */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enc: FieldEncryptionService,
    private readonly rate: RateLimitService,
  ) {}

  async hasConfirmedTotp(userId: string): Promise<boolean> {
    const f = await this.prisma.mfaFactor.findUnique({ where: { userId_type: { userId, type: 'totp' } } });
    return !!f?.confirmedAt;
  }

  /** Starts (or restarts) enrolment. The secret is returned once and stored encrypted. */
  async beginEnrolment(userId: string, email: string): Promise<{ secret: string; otpauthUri: string }> {
    if (await this.hasConfirmedTotp(userId))
      throw Errors.conflict('MFA_ALREADY_ENROLLED', 'An authenticator is already set up for this account.');
    const secret = newTotpSecret();
    const secretEnc = new Uint8Array(this.enc.encrypt(secret));
    await this.prisma.mfaFactor.upsert({
      where: { userId_type: { userId, type: 'totp' } },
      create: { userId, type: 'totp', secretEnc, keyId: this.enc.keyId },
      update: { secretEnc, keyId: this.enc.keyId, confirmedAt: null, lastUsedStep: null },
    });
    return { secret, otpauthUri: otpauthUri(secret, email) };
  }

  /** Confirms enrolment with a code and returns 10 single-use recovery codes (shown once). */
  async confirmEnrolment(userId: string, code: string): Promise<string[]> {
    const f = await this.prisma.mfaFactor.findUnique({ where: { userId_type: { userId, type: 'totp' } } });
    if (!f) throw Errors.conflict('MFA_NOT_STARTED', 'Start authenticator setup first.');
    if (f.confirmedAt)
      throw Errors.conflict('MFA_ALREADY_ENROLLED', 'An authenticator is already set up for this account.');
    const step = matchTotp(this.enc.decrypt(f.secretEnc, f.keyId), code);
    if (step === null)
      throw new AppError(401, 'TOTP_INVALID', 'That authenticator code is not right.', { needs: 'mfa' });
    const codes = Array.from({ length: 10 }, () => randomToken(6).replace(/[-_]/g, 'x').slice(0, 10).toUpperCase());
    const hashes = await Promise.all(codes.map((c) => argon2.hash(c, { type: argon2.argon2id })));
    await this.prisma.$transaction([
      this.prisma.mfaFactor.update({
        where: { id: f.id },
        data: { confirmedAt: new Date(), lastUsedStep: BigInt(step) },
      }),
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId, codeHash })) }),
    ]);
    return codes;
  }

  /** Verifies a TOTP code for a confirmed factor; a code (step) can be used only once. */
  async verifyTotp(userId: string, code: string): Promise<boolean> {
    const f = await this.prisma.mfaFactor.findUnique({ where: { userId_type: { userId, type: 'totp' } } });
    if (!f?.confirmedAt) return false;
    const step = matchTotp(this.enc.decrypt(f.secretEnc, f.keyId), String(code ?? '').trim());
    if (step === null) return false;
    // Atomic replay check: only advance when the step is newer than the last used one.
    const res = await this.prisma.mfaFactor.updateMany({
      where: { id: f.id, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }] },
      data: { lastUsedStep: BigInt(step) },
    });
    return res.count === 1;
  }

  async useRecoveryCode(userId: string, code: string): Promise<boolean> {
    const candidates = await this.prisma.recoveryCode.findMany({ where: { userId, usedAt: null } });
    for (const c of candidates) {
      if (
        await argon2
          .verify(
            c.codeHash,
            String(code ?? '')
              .trim()
              .toUpperCase(),
          )
          .catch(() => false)
      ) {
        const res = await this.prisma.recoveryCode.updateMany({
          where: { id: c.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        return res.count === 1;
      }
    }
    return false;
  }

  /** For the highest-risk actions: a code must come with this request (X-Step-Up-Code). */
  async requireFreshCode(userId: string, code: string | undefined): Promise<void> {
    if (!code) throw Errors.stepUpRequired();
    await this.rate.hitClass('step_up_user', userId);
    if (!(await this.verifyTotp(userId, code))) throw Errors.stepUpInvalid();
  }

  async removeAll(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.mfaFactor.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
    ]);
  }
}
