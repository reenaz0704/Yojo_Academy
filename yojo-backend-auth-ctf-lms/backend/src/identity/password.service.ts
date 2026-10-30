import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Errors } from '../common/errors/app-error';

/** argon2id parameters (spec AUTH-R04: memory 64 MiB, iterations 3, parallelism 1, minimum). */
const ARGON = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

/**
 * A small built-in list of the most common breached passwords. OPEN ITEM: the spec also allows a k-anonymity
 * breached-password API; that needs network access and a provider decision, so only the local list is used now.
 */
const COMMON = new Set([
  'password1!',
  'password123!',
  'p@ssw0rd123',
  'welcome@123',
  'admin@12345',
  'qwerty@1234',
  'india@12345',
  'yojo@123456',
  'letmein@123',
  'iloveyou@123',
  'abc@1234567',
  'test@123456',
  'changeme@123',
  'passw0rd!23',
]);

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON);
  }

  async verify(hash: string | null | undefined, plain: string): Promise<boolean> {
    if (!hash) {
      // Spend comparable time so unknown accounts are not distinguishable by timing (AC-AUTH-09).
      await argon2.hash(plain, ARGON).catch(() => undefined);
      return false;
    }
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /** Policy: at least 10 chars with upper, lower, number and symbol; not common; not one of the last 5. */
  async assertAcceptable(plain: string, history: string[] = [], email?: string): Promise<void> {
    if (typeof plain !== 'string' || plain.length < 10 || plain.length > 128)
      throw Errors.validation('Use 10 to 128 characters.', 'password');
    if (!/[a-z]/.test(plain) || !/[A-Z]/.test(plain) || !/\d/.test(plain) || !/[^A-Za-z0-9]/.test(plain))
      throw Errors.validation('Use upper and lower case letters, a number and a symbol.', 'password');
    if (COMMON.has(plain.toLowerCase())) throw Errors.validation('This password is too common.', 'password');
    if (email && plain.toLowerCase().includes(email.split('@')[0].toLowerCase()))
      throw Errors.validation('Do not use your email name in the password.', 'password');
    for (const old of history.slice(-5))
      if (await this.verify(old, plain))
        throw Errors.validation('Do not reuse one of your last 5 passwords.', 'password');
  }
}
