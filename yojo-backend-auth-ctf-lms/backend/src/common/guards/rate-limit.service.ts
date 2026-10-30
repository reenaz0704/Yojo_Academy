import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { randomToken } from '../crypto/crypto.util';
import { Errors } from '../errors/app-error';
import { REDIS } from '../../redis/redis.module';

/** Sliding-window limiter on Redis sorted sets (spec §22.3). Values are [PROVISIONAL] defaults. */
export const RATE_CLASSES: Record<string, { limit: number; windowSec: number }> = {
  otp_send_ip: { limit: 20, windowSec: 3600 },
  otp_verify_ip: { limit: 30, windowSec: 900 },
  verify_account: { limit: 10, windowSec: 900 },
  staff_login_ip: { limit: 50, windowSec: 3600 },
  password_forgot_ip: { limit: 10, windowSec: 3600 },
  access_request_ip: { limit: 5, windowSec: 3600 },
  ctf_login_ip: { limit: 30, windowSec: 900 },
  ctf_register_ip: { limit: 20, windowSec: 3600 },
  step_up_user: { limit: 10, windowSec: 900 },
  general_user: { limit: 300, windowSec: 60 },
  // Public website forms and subscriptions (per IP, and per email or phone hash).
  public_form_ip: { limit: 10, windowSec: 3600 },
  public_form_contact: { limit: 5, windowSec: 3600 },
  subscribe_ip: { limit: 10, windowSec: 3600 },
  unsubscribe_ip: { limit: 30, windowSec: 3600 },
  // Student ↔ trainer messages, per user.
  message_user: { limit: 30, windowSec: 3600 },
  // Trainer desk: remarks and admin requests; lab nudges; student feedback on trainers.
  trainer_note_user: { limit: 40, windowSec: 3600 },
  nudge_user: { limit: 40, windowSec: 3600 },
  feedback_user: { limit: 20, windowSec: 3600 },
  // Mission answer checks, per user (blocks flag brute forcing).
  mission_submit_user: { limit: 30, windowSec: 600 },
  // Intel comments and content reports, per user.
  comment_user: { limit: 20, windowSec: 3600 },
};

@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Records one hit; throws 429 when the window is full. */
  async hit(key: string, limit: number, windowSec: number): Promise<void> {
    const now = Date.now();
    const k = `rl:${key}`;
    const res = await this.redis
      .multi()
      .zremrangebyscore(k, 0, now - windowSec * 1000)
      .zadd(k, now, `${now}:${randomToken(6)}`)
      .zcard(k)
      .zrange(k, 0, 0, 'WITHSCORES')
      .expire(k, windowSec)
      .exec();
    const count = Number(res?.[2]?.[1] ?? 0);
    if (count > limit) {
      const oldest = Number((res?.[3]?.[1] as string[] | undefined)?.[1] ?? now);
      const retry = Math.max(1, Math.ceil((oldest + windowSec * 1000 - now) / 1000));
      throw Errors.rateLimited(retry);
    }
  }

  async hitClass(cls: string, subject: string): Promise<void> {
    const c = RATE_CLASSES[cls];
    if (!c) throw new Error(`unknown rate class ${cls}`);
    await this.hit(`${cls}:${subject}`, c.limit, c.windowSec);
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`rl:${key}`);
  }
}
