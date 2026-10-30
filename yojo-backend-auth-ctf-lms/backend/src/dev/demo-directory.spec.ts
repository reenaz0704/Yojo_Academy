import { loadConfig } from '../config/config.schema';
import { DEMO_PEOPLE, demoDirectoryAllowed } from './demo-directory';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  OTP_HMAC_SECRET: 'x'.repeat(40),
};

describe('sign-in page demo panel (local development only)', () => {
  it('exists only for local and development', () => {
    expect(demoDirectoryAllowed(loadConfig({ ...base, APP_ENV: 'local' }))).toBe(true);
    expect(demoDirectoryAllowed(loadConfig({ ...base, APP_ENV: 'development' }))).toBe(true);
    for (const APP_ENV of ['staging', 'production', 'test'])
      expect(demoDirectoryAllowed(loadConfig({ ...base, APP_ENV }))).toBe(false);
    expect(
      demoDirectoryAllowed(loadConfig({ ...base, NODE_ENV: 'production', APP_ENV: 'local', MAIL_DRIVER: 'disabled' })),
    ).toBe(false);
  });

  it('lists only demo (*.demo) people', () => {
    expect(DEMO_PEOPLE.every((p) => p.email.endsWith('.demo'))).toBe(true);
  });
});
