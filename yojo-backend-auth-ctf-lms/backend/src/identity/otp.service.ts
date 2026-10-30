import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { hmacSha256, numericCode, randomToken, safeEqual, sha256 } from '../common/crypto/crypto.util';
import { AppError, Errors } from '../common/errors/app-error';
import { REDIS } from '../redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import { RateLimitService } from '../common/guards/rate-limit.service';

interface Challenge {
  emailHash: string;
  email: string;
  purpose: string;
  codeHmac: string;
  triesLeft: number;
  expiresAt: number;
}

/**
 * Email OTP (spec §6.3): 6 digits, 5 minutes, 3 tries, resend after 30 s, only an HMAC of the code in Redis.
 * After 5 burned codes in an hour the email cools down for 15 minutes.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly settings: SettingsService,
    private readonly rate: RateLimitService,
  ) {}

  async issue(
    email: string,
    purpose: string,
  ): Promise<{ challengeId: string; code: string; ttlSec: number; resendSec: number }> {
    const { value: auth } = await this.settings.get('auth');
    const emailHash = sha256(email.toLowerCase());
    if (await this.redis.exists(`otp:cool:${emailHash}`))
      throw new AppError(429, 'OTP_COOLDOWN', 'Too many codes were tried. Wait 15 minutes and try again.', {
        details: { retryAfterSec: await this.redis.ttl(`otp:cool:${emailHash}`) },
      });
    const resendKey = `otp:resend:${purpose}:${emailHash}`;
    const ok = await this.redis.set(resendKey, '1', 'EX', auth.otpResendSec, 'NX');
    if (!ok) throw Errors.rateLimited(Math.max(1, await this.redis.ttl(resendKey)));
    const hourKey = `otp:hour:${emailHash}`;
    const sent = await this.redis.incr(hourKey);
    if (sent === 1) await this.redis.expire(hourKey, 3600);
    if (sent > 5) throw Errors.rateLimited(Math.max(1, await this.redis.ttl(hourKey)));

    const code = numericCode(6);
    const challengeId = `otp_${randomToken(12)}`;
    const ch: Challenge = {
      emailHash,
      email: email.toLowerCase(),
      purpose,
      codeHmac: hmacSha256(this.cfg.OTP_HMAC_SECRET, `${challengeId}:${code}`),
      triesLeft: auth.otpMaxTries,
      expiresAt: Date.now() + auth.otpTtlSec * 1000,
    };
    await this.redis.set(`otp:ch:${challengeId}`, JSON.stringify(ch), 'EX', auth.otpTtlSec);
    return { challengeId, code, ttlSec: auth.otpTtlSec, resendSec: auth.otpResendSec };
  }

  /** Returns the verified email. Wrong codes decrement tries; the last wrong try burns the code. */
  async verify(challengeId: string, code: string, purpose: string): Promise<string> {
    const key = `otp:ch:${challengeId}`;
    const raw = await this.redis.get(key);
    if (!raw) throw new AppError(401, 'OTP_EXPIRED', 'This code has expired. Ask for a new code.');
    const ch = JSON.parse(raw) as Challenge;
    if (ch.purpose !== purpose || Date.now() > ch.expiresAt) {
      await this.redis.del(key);
      throw new AppError(401, 'OTP_EXPIRED', 'This code has expired. Ask for a new code.');
    }
    await this.rate.hitClass('verify_account', ch.emailHash);
    const expect = hmacSha256(this.cfg.OTP_HMAC_SECRET, `${challengeId}:${String(code).trim()}`);
    if (!safeEqual(expect, ch.codeHmac)) {
      ch.triesLeft -= 1;
      if (ch.triesLeft <= 0) {
        await this.redis.del(key);
        const burned = await this.redis.incr(`otp:burn:${ch.emailHash}`);
        if (burned === 1) await this.redis.expire(`otp:burn:${ch.emailHash}`, 3600);
        if (burned >= 5) await this.redis.set(`otp:cool:${ch.emailHash}`, '1', 'EX', 900);
        throw new AppError(401, 'OTP_BURNED', 'Too many wrong codes. Ask for a new code.');
      }
      await this.redis.set(key, JSON.stringify(ch), 'PX', Math.max(1, ch.expiresAt - Date.now()));
      throw new AppError(
        401,
        'OTP_INVALID',
        `That code is not right. ${ch.triesLeft} ${ch.triesLeft === 1 ? 'try' : 'tries'} left.`,
        {
          details: { triesLeft: ch.triesLeft },
        },
      );
    }
    await this.redis.del(key);
    return ch.email;
  }
}
