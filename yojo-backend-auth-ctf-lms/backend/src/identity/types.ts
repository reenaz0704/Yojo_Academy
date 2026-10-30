import type { User } from '@prisma/client';
import type { AppConfig } from '../config/config.schema';
import type { SessionData } from './session.service';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export interface IssuedSession {
  token: string;
  data: SessionData;
}

export type SessionUser = Pick<User, 'id' | 'role' | 'adminRole' | 'capability'>;

export function staffDomains(cfg: AppConfig): string[] {
  return cfg.STAFF_EMAIL_DOMAINS.split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function isStaffEmail(cfg: AppConfig, email: string): boolean {
  const domain = email.split('@').pop()?.toLowerCase() ?? '';
  return staffDomains(cfg).includes(domain);
}

export const normEmail = (email: string): string => email.trim().toLowerCase();

/** Whole years between dob and today (UTC). */
export function ageOn(dob: Date, now = new Date()): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}
