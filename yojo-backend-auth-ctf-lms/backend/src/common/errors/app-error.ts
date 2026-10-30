import { HttpException } from '@nestjs/common';

export type Needs = 'login' | 'mfa' | 'reason' | null;

export interface ProblemBody {
  type: string;
  code: string;
  message: string;
  status: number;
  field: string | null;
  needs: Needs;
  requestId?: string;
  details: Record<string, unknown>;
}

/** The one error type services throw. Rendered as application/problem+json by ProblemFilter (spec §5.3). */
export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly opts: { field?: string; needs?: Needs; details?: Record<string, unknown> } = {},
  ) {
    super(message, status);
  }
}

export const Errors = {
  validation: (message: string, field?: string, details?: Record<string, unknown>) =>
    new AppError(400, 'VALIDATION_FAILED', message, { field, details }),
  unauthenticated: () => new AppError(401, 'UNAUTHENTICATED', 'Please sign in again.', { needs: 'login' }),
  forbidden: (message = 'You do not have access to this action.') => new AppError(403, 'FORBIDDEN', message),
  notFound: (message = 'Not found.') => new AppError(404, 'NOT_FOUND', message),
  conflict: (code: string, message: string) => new AppError(409, code, message),
  stepUpRequired: () =>
    new AppError(428, 'STEP_UP_REQUIRED', 'Enter your authenticator code to continue.', { needs: 'mfa' }),
  stepUpInvalid: () => new AppError(401, 'STEP_UP_INVALID', 'That authenticator code is not right.', { needs: 'mfa' }),
  reasonRequired: () => new AppError(428, 'REASON_REQUIRED', 'Give a reason for this action.', { needs: 'reason' }),
  rateLimited: (retryAfterSec: number) =>
    new AppError(429, 'RATE_LIMITED', `Too many attempts. Try again in ${retryAfterSec} seconds.`, {
      details: { retryAfterSec },
    }),
  unavailable: (code: string, message: string) => new AppError(503, code, message),
};
