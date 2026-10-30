import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const int = (def: number) => z.coerce.number().int().positive().default(def);

/**
 * Every environment variable the backend reads. The process refuses to start when one is missing or malformed
 * (spec v2.0 §24.2). Secrets have no defaults; values marked [PROVISIONAL] in the spec can be overridden in settings.
 */
export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['local', 'development', 'staging', 'production', 'test']).default('local'),
    PORT: int(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    REDIS_QUEUE_URL: z.string().url().optional(),
    // 32-byte key (base64) for AES-256-GCM field encryption of MFA secrets. Production: injected from KMS/secrets manager.
    FIELD_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64 encoded'),
    FIELD_ENCRYPTION_KEY_ID: z.string().min(1).default('local-1'),
    // HMAC key for OTP codes and tokens stored in Redis.
    OTP_HMAC_SECRET: z.string().min(32),
    PUBLIC_APP_URL: z.string().url().default('http://localhost:8000'),
    STAFF_EMAIL_DOMAINS: z.string().default('yojosolutions.com'),
    SESSION_COOKIE_SECURE: bool.default('true'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
    SWAGGER_ENABLED: bool.default('false'),
    MAIL_DRIVER: z.enum(['dev', 'disabled']).default('dev'),
    MAIL_FROM: z.string().default('Yojo Cyber Academy <no-reply@example.invalid>'),
    DEV_MAIL_DIR: z.string().default('.dev-mail'),
    GOOGLE_CLIENT_ID: z.string().optional(),
    // Team inbox that gets a short alert (reference and form only) for each new website enquiry. Unset = no alert.
    ENQUIRY_NOTIFY_EMAIL: z.string().email().optional(),
    // Lab provider for missions that run in the Python mission service. Unset = those missions report the service
    // as unavailable (no fake labs). Requests are signed with MISSION_SERVICE_SECRET (same value in mission-api).
    LAB_PROVIDER_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
    MISSION_SERVICE_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(32).optional()),
    CORS_DISABLED: bool.default('true'),
    SESSION_IDLE_STUDENT_MIN: int(7 * 24 * 60),
    SESSION_ABSOLUTE_STUDENT_MIN: int(30 * 24 * 60),
    SESSION_IDLE_STAFF_MIN: int(30),
    SESSION_ABSOLUTE_STAFF_MIN: int(12 * 60),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === 'production') {
      if (c.MAIL_DRIVER === 'dev')
        ctx.addIssue({
          code: 'custom',
          path: ['MAIL_DRIVER'],
          message: 'dev mail driver is not allowed in production',
        });
      if (!c.SESSION_COOKIE_SECURE)
        ctx.addIssue({ code: 'custom', path: ['SESSION_COOKIE_SECURE'], message: 'must be true in production' });
      if (c.SWAGGER_ENABLED)
        ctx.addIssue({
          code: 'custom',
          path: ['SWAGGER_ENABLED'],
          message: 'API docs must not be public in production',
        });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Names only: values are never printed because some are secrets.
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return parsed.data;
}
