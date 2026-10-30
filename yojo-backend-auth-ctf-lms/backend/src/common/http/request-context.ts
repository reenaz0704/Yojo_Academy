import type { Request } from 'express';
import type { SessionData } from '../../identity/session.service';

export interface AppRequest extends Request {
  session?: SessionData & { token: string; hash: string };
  permissionLevel?: 'Y' | 'R';
}

export function clientIp(req: Request): string | undefined {
  return req.ip || undefined;
}
