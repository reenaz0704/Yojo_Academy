/**
 * Test environment. Uses a dedicated database (name must end in _test) and Redis DB 15 so tests never touch
 * development data. The keys below are throwaway test values, not secrets.
 */
process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://yojo:yojo_local_dev@127.0.0.1:5432/yojo_test?schema=public';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15';
process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 42).toString('base64');
process.env.FIELD_ENCRYPTION_KEY_ID = 'test-1';
process.env.OTP_HMAC_SECRET = 'test-only-otp-hmac-secret-0123456789abcdef';
process.env.PUBLIC_APP_URL = 'http://localhost:8000';
process.env.STAFF_EMAIL_DOMAINS = 'yojosolutions.com';
process.env.SESSION_COOKIE_SECURE = 'false';
process.env.TRUST_PROXY_HOPS = '1';
process.env.SWAGGER_ENABLED = 'false';
process.env.MAIL_DRIVER = 'dev';
process.env.DEV_MAIL_DIR = '';
process.env.LOG_LEVEL = 'fatal';
// Never reach a real lab service from tests (the lab-link suite starts its own stand-in). Empty, not deleted:
// Prisma Client loads ./.env when imported and would otherwise fill these in from a developer's local file.
process.env.LAB_PROVIDER_URL = '';
process.env.MISSION_SERVICE_SECRET = '';
export {};
