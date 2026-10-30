import { Inject, Injectable } from '@nestjs/common';
import type { AdminRole, Capability, UserRole } from '@prisma/client';
import Redis from 'ioredis';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { randomToken, sha256 } from '../common/crypto/crypto.util';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

export interface SessionData {
  sid: string; // user_sessions.id
  userId: string;
  role: UserRole;
  adminRole: AdminRole | null;
  capability: Capability | null;
  scope: 'full' | 'onboarding';
  /** 'ctf' sessions come from the CTF username login and may only reach /ctf/* plus logout/sessions. */
  aud?: 'lms' | 'ctf';
  createdAt: number;
  lastActivity: number;
  absoluteExpiry: number;
  idleMs: number;
  stepUpAt: number | null;
  csrf: string;
}

/** CTF sessions: 8 hour absolute lifetime (CTF journey brief). */
export const CTF_SESSION_ABSOLUTE_MS = 8 * 3600_000;

const KEY = (hash: string) => `sess:${hash}`;
const USER_SET = (userId: string) => `usess:${userId}`;

/**
 * Opaque server-side sessions (ADR-05, spec §6.5). The cookie holds a 256-bit random token; Redis holds the
 * session under its SHA-256 so a Redis dump does not reveal usable tokens. user_sessions keeps the device list.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  private lifetimes(role: UserRole, aud: 'lms' | 'ctf'): { idleMs: number; absMs: number } {
    if (aud === 'ctf') return { idleMs: this.cfg.SESSION_IDLE_STUDENT_MIN * 60_000, absMs: CTF_SESSION_ABSOLUTE_MS };
    const staff = role === 'trainer' || role === 'admin';
    const idle = staff ? this.cfg.SESSION_IDLE_STAFF_MIN : this.cfg.SESSION_IDLE_STUDENT_MIN;
    const abs = staff ? this.cfg.SESSION_ABSOLUTE_STAFF_MIN : this.cfg.SESSION_ABSOLUTE_STUDENT_MIN;
    return { idleMs: idle * 60_000, absMs: abs * 60_000 };
  }

  async create(
    user: { id: string; role: UserRole; adminRole: AdminRole | null; capability: Capability | null },
    scope: 'full' | 'onboarding',
    meta: { ip?: string; userAgent?: string },
    aud: 'lms' | 'ctf' = 'lms',
  ): Promise<{ token: string; data: SessionData }> {
    const token = randomToken(32);
    const hash = sha256(token);
    const now = Date.now();
    const { idleMs, absMs } = this.lifetimes(user.role, aud);
    const row = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        sessionHash: hash,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300),
        expiresAt: new Date(now + absMs),
      },
    });
    const data: SessionData = {
      sid: row.id,
      userId: user.id,
      role: user.role,
      adminRole: user.adminRole,
      capability: user.capability,
      scope,
      aud,
      createdAt: now,
      lastActivity: now,
      absoluteExpiry: now + absMs,
      idleMs,
      stepUpAt: null,
      csrf: randomToken(24),
    };
    await this.write(hash, data);
    await this.redis.sadd(USER_SET(user.id), hash);
    return { token, data };
  }

  /** Loads and touches a session; returns null when missing, idle-expired or past its absolute expiry. */
  async load(token: string): Promise<(SessionData & { hash: string }) | null> {
    if (!token || token.length > 100) return null;
    const hash = sha256(token);
    const raw = await this.redis.get(KEY(hash));
    if (!raw) return null;
    const data = JSON.parse(raw) as SessionData;
    const now = Date.now();
    if (now > data.absoluteExpiry || now - data.lastActivity > data.idleMs) {
      await this.revokeHash(hash, data.userId, 'expired');
      return null;
    }
    data.lastActivity = now;
    await this.write(hash, data);
    return { ...data, hash };
  }

  async update(hash: string, data: SessionData): Promise<void> {
    await this.write(hash, data);
  }

  async revokeHash(hash: string, userId: string, reason: string): Promise<void> {
    await this.redis.del(KEY(hash));
    await this.redis.srem(USER_SET(userId), hash);
    await this.prisma.userSession.updateMany({
      where: { sessionHash: hash, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  /** Revokes every session of a user (password reset, role change, suspension, MFA reset). */
  async revokeAll(userId: string, reason: string, exceptHash?: string): Promise<number> {
    const hashes = await this.redis.smembers(USER_SET(userId));
    const targets = hashes.filter((h) => h !== exceptHash);
    if (targets.length) {
      await this.redis.del(...targets.map(KEY));
      await this.redis.srem(USER_SET(userId), ...targets);
    }
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null, ...(exceptHash ? { NOT: { sessionHash: exceptHash } } : {}) },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    return targets.length;
  }

  private async write(hash: string, data: SessionData): Promise<void> {
    const ttlMs = Math.max(1000, Math.min(data.idleMs, data.absoluteExpiry - Date.now()));
    await this.redis.set(KEY(hash), JSON.stringify(data), 'PX', ttlMs);
  }
}
