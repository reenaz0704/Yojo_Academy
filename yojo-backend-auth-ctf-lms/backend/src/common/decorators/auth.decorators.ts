import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import type { Permission } from '../../access/permissions';
import type { AppRequest } from '../http/request-context';

export const PUBLIC_KEY = 'yojo:public';
export const ROLES_KEY = 'yojo:roles';
export const PERMISSION_KEY = 'yojo:permission';
export const STEP_UP_KEY = 'yojo:stepUp';
export const REASON_KEY = 'yojo:reason';
export const ONBOARDING_KEY = 'yojo:onboarding';
export const RATE_KEY = 'yojo:rate';
export const SKIP_CSRF_KEY = 'yojo:skipCsrf';
export const AUDIENCE_KEY = 'yojo:audience';
export const ENTITLEMENT_KEY = 'yojo:entitlement';

/** No session needed. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Route group roles allowed (deny by default for everything else). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
/** Admin permission key from the access matrix; `min: 'Y'` refuses restricted (R) holders. */
export const RequirePermission = (permission: Permission, min: 'Y' | 'R' = 'R') =>
  SetMetadata(PERMISSION_KEY, { permission, min });
/** Step-up MFA: 'window' accepts a step-up in the last 5 minutes; 'fresh' needs X-Step-Up-Code on this request. */
export const StepUp = (mode: 'window' | 'fresh' = 'window') => SetMetadata(STEP_UP_KEY, mode);
/** Body must carry `reason` (5 to 500 characters) or the API answers 428 needs: reason. */
export const RequireReason = () => SetMetadata(REASON_KEY, true);
/** Allowed while a staff account is still completing first-login steps. */
export const AllowOnboarding = () => SetMetadata(ONBOARDING_KEY, true);
/** Named rate-limit class (common/guards/rate-limit.ts). */
export const RateLimit = (cls: string) => SetMetadata(RATE_KEY, cls);
/**
 * Session audiences a route accepts. Default is LMS only, so a CTF session cannot reach LMS routes.
 * 'ctf' routes accept only CTF sessions; 'any' accepts both (logout, session list).
 */
export const Audience = (aud: 'lms' | 'ctf' | 'any') => SetMetadata(AUDIENCE_KEY, aud);
/** Paid access check from server-side entitlements only (EntitlementGuard). */
export const RequireEntitlement = (key: string) => SetMetadata(ENTITLEMENT_KEY, key);
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

export const CurrentSession = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AppRequest>().session;
});
