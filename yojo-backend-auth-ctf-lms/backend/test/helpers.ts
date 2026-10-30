import type { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient, type AdminRole, type Capability } from '@prisma/client';
import request from 'supertest';
import type { Response } from 'supertest';
import Redis from 'ioredis';
import { createApp } from '../src/bootstrap';
import { sha256 } from '../src/common/crypto/crypto.util';
import { REDIS } from '../src/redis/redis.module';
import { FieldEncryptionService } from '../src/common/crypto/field-encryption.service';
import { CONSENT_VERSIONS } from '../src/identity/constants';
import { DevMailAdapter } from '../src/identity/mail/dev-mail.adapter';
import { MAIL_PORT } from '../src/identity/mail/mail.port';
import { PasswordService } from '../src/identity/password.service';
import { currentStep, newTotpSecret, totpAt } from '../src/identity/totp';
import { PrismaService } from '../src/prisma/prisma.service';

export const STAFF_PASSWORD = 'Str0ng-Staff-Pass!';
// Random start: each test file gets its own module registry, so a fixed counter would reuse IPs across files.
let ipCounter = Math.floor(Math.random() * 16_000_000);
let emailCounter = 0;
export const uniq = (prefix: string, domain = 'abc-institute.demo') =>
  `${prefix}.${Date.now().toString(36)}${emailCounter++}@${domain}`;

export interface TestCtx {
  app: INestApplication;
  prisma: PrismaService;
  mail: DevMailAdapter;
  server: ReturnType<INestApplication['getHttpServer']>;
}

export async function startApp(): Promise<TestCtx> {
  const app = await createApp({ logger: false });
  await app.init();
  return { app, prisma: app.get(PrismaService), mail: app.get<DevMailAdapter>(MAIL_PORT), server: app.getHttpServer() };
}

/**
 * A browser-like client: keeps cookies, echoes the CSRF token, and uses its own client IP (X-Forwarded-For)
 * so per-IP rate limits of one test do not affect another.
 */
export class Client {
  readonly agent: ReturnType<typeof request.agent>;
  readonly ip = `10.${Math.floor(ipCounter / 65536) % 256}.${Math.floor(ipCounter / 256) % 256}.${ipCounter++ % 256}`;
  csrf = '';

  constructor(server: TestCtx['server']) {
    this.agent = request.agent(server);
  }

  private track(res: Response): Response {
    const set = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    for (const c of set) {
      const m = /^yc=([^;]*)/.exec(c);
      if (m) this.csrf = decodeURIComponent(m[1]);
    }
    return res;
  }

  async init(): Promise<this> {
    this.track(await this.agent.get('/api/v1/auth/csrf').set('X-Forwarded-For', this.ip));
    return this;
  }

  async get(path: string, headers: Record<string, string> = {}): Promise<Response> {
    return this.track(await this.agent.get(`/api/v1${path}`).set('X-Forwarded-For', this.ip).set(headers));
  }

  async send(
    method: 'post' | 'put' | 'patch' | 'delete',
    path: string,
    body?: object,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const req = this.agent[method](`/api/v1${path}`)
      .set('X-Forwarded-For', this.ip)
      .set('X-CSRF-Token', this.csrf)
      .set(headers);
    return this.track(await (body ? req.send(body) : req));
  }

  post(path: string, body?: object, headers?: Record<string, string>) {
    return this.send('post', path, body, headers);
  }
}

/** Current TOTP code; clears the replay marker first so a test can use several codes inside one 30 s step. */
export async function totp(prisma: PrismaClient, userId: string, secret: string): Promise<string> {
  await prisma.mfaFactor.updateMany({ where: { userId }, data: { lastUsedStep: null } });
  return totpAt(secret, currentStep());
}

export interface StaffUser {
  id: string;
  email: string;
  secret: string;
  client: Client;
}

/**
 * Creates an active staff account directly in the database (password, confirmed TOTP, policies accepted), then
 * signs in through the real API. The full invite and onboarding flow has its own tests in auth-staff.e2e-spec.ts.
 */
export async function makeStaff(
  ctx: TestCtx,
  role: 'admin' | 'trainer',
  sub: { adminRole?: AdminRole; capability?: Capability },
): Promise<StaffUser> {
  const email = uniq(role === 'admin' ? `admin-${sub.adminRole}` : 'trainer', 'yojosolutions.com');
  const secret = newTotpSecret();
  const enc = ctx.app.get(FieldEncryptionService);
  const user = await ctx.prisma.user.create({
    data: {
      email,
      role,
      adminRole: sub.adminRole ?? null,
      capability: sub.capability ?? null,
      status: 'active',
      origin: 'staff',
      passwordHash: await new PasswordService().hash(STAFF_PASSWORD),
      staffProfile: { create: { displayName: 'Test Staff', speciality: 'Testing' } },
      mfaFactors: {
        create: {
          type: 'totp',
          secretEnc: new Uint8Array(enc.encrypt(secret)),
          keyId: enc.keyId,
          confirmedAt: new Date(),
        },
      },
      consents: {
        create: [
          { kind: 'code_of_conduct', version: CONSENT_VERSIONS.code_of_conduct, accepted: true },
          { kind: 'staff_policy', version: CONSENT_VERSIONS.staff_policy, accepted: true },
        ],
      },
    },
  });
  const client = await new Client(ctx.server).init();
  await staffLogin(ctx, client, email, user.id, secret);
  return { id: user.id, email, secret, client };
}

export async function staffLogin(
  ctx: TestCtx,
  client: Client,
  email: string,
  userId: string,
  secret: string,
  password = STAFF_PASSWORD,
): Promise<Response> {
  const step1 = await client.post('/auth/staff/login', { email, password });
  if (step1.status !== 200 || step1.body.next !== 'totp')
    throw new Error(`login step 1 failed: ${step1.status} ${JSON.stringify(step1.body)}`);
  const step2 = await client.post('/auth/staff/totp', {
    challengeId: step1.body.challengeId,
    code: await totp(ctx.prisma, userId, secret),
  });
  if (step2.status !== 200) throw new Error(`login step 2 failed: ${step2.status} ${JSON.stringify(step2.body)}`);
  return step2;
}

/** Signs a new student up through the OTP flow and returns the signed-in client. */
export async function makeStudent(
  ctx: TestCtx,
  opts: { email?: string } = {},
): Promise<{ client: Client; email: string; id: string }> {
  const email = opts.email ?? uniq('student');
  const client = await new Client(ctx.server).init();
  const sent = await client.post('/auth/student/otp', { email, purpose: 'signup' });
  const code = /(\d{6})/.exec(ctx.mail.lastTo(email, 'otp')!.text)![1];
  const verified = await client.post('/auth/student/verify', { challengeId: sent.body.challengeId, code });
  const signup = await client.post('/auth/signup', {
    signupTicket: verified.body.signupTicket,
    name: 'Test Student',
    institutionName: 'Test Institute',
    dob: '2000-01-15',
    consents: { terms: true, privacy: true, aup: true },
  });
  if (signup.status !== 201) throw new Error(`signup failed: ${signup.status} ${JSON.stringify(signup.body)}`);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { client, email, id: user.id };
}

/** Clears the 30-second resend window for an email so a test can request a second code at once. */
export async function clearResend(ctx: TestCtx, email: string): Promise<void> {
  const redis = ctx.app.get<Redis>(REDIS);
  const keys = await redis.keys(`otp:resend:*:${sha256(email.toLowerCase())}`);
  if (keys.length) await redis.del(...keys);
}

/** Polls until fn returns a value (for work that finishes after the response, such as reset emails). */
export async function waitFor<T>(fn: () => T | undefined, timeoutMs = 3000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

export const otpFrom = (ctx: TestCtx, email: string) => /(\d{6})/.exec(ctx.mail.lastTo(email, 'otp')!.text)![1];
export const linkToken = (text: string, key: string) => new RegExp(`#${key}=([\\w-]+)`).exec(text)![1];
export { Prisma };
