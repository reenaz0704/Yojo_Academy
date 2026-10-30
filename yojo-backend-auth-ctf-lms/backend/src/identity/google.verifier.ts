import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { AppError, Errors } from '../common/errors/app-error';

export interface GoogleIdentity {
  sub: string;
  email: string;
}

/**
 * Verifies Google ID tokens (signature via Google's JWKS, iss, aud, exp, email_verified). Disabled until
 * GOOGLE_CLIENT_ID is configured (no credentials yet): the endpoint answers 503 GOOGLE_NOT_CONFIGURED.
 */
@Injectable()
export class GoogleVerifier {
  private jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  get configured(): boolean {
    return !!this.cfg.GOOGLE_CLIENT_ID;
  }

  async verify(idToken: string): Promise<GoogleIdentity> {
    if (!this.cfg.GOOGLE_CLIENT_ID)
      throw Errors.unavailable(
        'GOOGLE_NOT_CONFIGURED',
        'Google sign-in is not set up yet. Use the email code instead.',
      );
    try {
      const { payload } = await jwtVerify(idToken, this.jwks, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: this.cfg.GOOGLE_CLIENT_ID,
      });
      if (!payload.sub || typeof payload.email !== 'string' || payload.email_verified !== true)
        throw new Error('unverified email');
      return { sub: payload.sub, email: payload.email.toLowerCase() };
    } catch {
      throw new AppError(401, 'GOOGLE_TOKEN_INVALID', 'Google sign-in failed. Try again or use the email code.');
    }
  }
}
