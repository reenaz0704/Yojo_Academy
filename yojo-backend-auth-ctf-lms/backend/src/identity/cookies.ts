import type { Response } from 'express';
import type { AppConfig } from '../config/config.schema';

/**
 * Cookie names (spec §6.5). With HTTPS the __Host- prefix pins the cookie to this host, path / and Secure.
 * Plain-HTTP local development cannot use the prefix, so it falls back to ys / yc.
 */
export function cookieNames(cfg: AppConfig): { session: string; csrf: string } {
  return cfg.SESSION_COOKIE_SECURE ? { session: '__Host-ys', csrf: '__Host-yc' } : { session: 'ys', csrf: 'yc' };
}

export function setSessionCookies(res: Response, cfg: AppConfig, token: string, csrf: string, maxAgeMs: number): void {
  const n = cookieNames(cfg);
  const base = { secure: cfg.SESSION_COOKIE_SECURE, sameSite: 'lax' as const, path: '/', maxAge: maxAgeMs };
  res.cookie(n.session, token, { ...base, httpOnly: true });
  // Readable by the front end so it can echo it in X-CSRF-Token (double submit, checked against the session).
  res.cookie(n.csrf, csrf, { ...base, httpOnly: false });
}

export function setPreSessionCsrf(res: Response, cfg: AppConfig, csrf: string): void {
  const n = cookieNames(cfg);
  res.cookie(n.csrf, csrf, {
    secure: cfg.SESSION_COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    httpOnly: false,
    maxAge: 2 * 3600_000,
  });
}

export function clearSessionCookies(res: Response, cfg: AppConfig): void {
  const n = cookieNames(cfg);
  const opts = { secure: cfg.SESSION_COOKIE_SECURE, sameSite: 'lax' as const, path: '/' };
  res.clearCookie(n.session, { ...opts, httpOnly: true });
  res.clearCookie(n.csrf, opts);
}
