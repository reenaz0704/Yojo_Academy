import type { Response } from 'express';
import type { AppConfig } from '../config/config.schema';
import type { AppRequest } from '../common/http/request-context';
import { setSessionCookies } from './cookies';
import type { IssuedSession, RequestMeta } from './types';

export const metaOf = (req: AppRequest): RequestMeta => ({
  ip: req.ip,
  userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
  requestId: req.id === undefined ? undefined : String(req.id),
});

/** Sets the cookies for a new session and returns the body fields every sign-in response shares. */
export function sendSession(res: Response, cfg: AppConfig, s: IssuedSession) {
  setSessionCookies(res, cfg, s.token, s.data.csrf, s.data.absoluteExpiry - Date.now());
  return {
    role: s.data.role,
    adminRole: s.data.adminRole,
    capability: s.data.capability,
    scope: s.data.scope,
    csrfToken: s.data.csrf,
  };
}
