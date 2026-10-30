import { loadConfig } from './config.schema';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  OTP_HMAC_SECRET: 'x'.repeat(40),
};

describe('config validation (spec §24.2)', () => {
  it('accepts a minimal valid environment with safe defaults', () => {
    const c = loadConfig({ ...base });
    expect(c.PORT).toBe(3000);
    expect(c.SESSION_COOKIE_SECURE).toBe(true);
    expect(c.SWAGGER_ENABLED).toBe(false);
    expect(c.SESSION_IDLE_STAFF_MIN).toBe(30);
  });

  it('refuses a missing secret and names the variable without printing values', () => {
    const secret = 'super-secret-value-should-not-print-xxxxxxxx';
    try {
      loadConfig({
        ...base,
        FIELD_ENCRYPTION_KEY: 'short',
        OTP_HMAC_SECRET: undefined,
        DATABASE_URL: `postgresql://u:${secret}@h/db`,
      });
      fail('expected error');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('FIELD_ENCRYPTION_KEY');
      expect(msg).toContain('OTP_HMAC_SECRET');
      expect(msg).not.toContain(secret);
    }
  });

  it('refuses unsafe production settings', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', MAIL_DRIVER: 'dev' })).toThrow(/MAIL_DRIVER/);
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', MAIL_DRIVER: 'disabled', SESSION_COOKIE_SECURE: 'false' }),
    ).toThrow(/SESSION_COOKIE_SECURE/);
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', MAIL_DRIVER: 'disabled', SWAGGER_ENABLED: 'true' }),
    ).toThrow(/SWAGGER_ENABLED/);
  });
});
