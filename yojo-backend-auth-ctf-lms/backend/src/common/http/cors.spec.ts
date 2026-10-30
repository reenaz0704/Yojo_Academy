import { allowedOrigin } from './cors';

const site = 'https://academy.yojo.example';

describe('API CORS origins', () => {
  it('local development: the pages server and VS Code Live Server on any localhost port', () => {
    const cfg = { APP_ENV: 'local' as const, PUBLIC_APP_URL: 'http://localhost:8000' };
    expect(allowedOrigin(cfg, 'http://localhost:8000')).toBe(true);
    expect(allowedOrigin(cfg, 'http://127.0.0.1:5500')).toBe(true);
    expect(allowedOrigin(cfg, 'http://localhost:5501')).toBe(true);
    expect(allowedOrigin(cfg, undefined)).toBe(true);
    expect(allowedOrigin(cfg, 'http://evil.example')).toBe(false);
    expect(allowedOrigin(cfg, 'http://localhost.evil.example')).toBe(false);
    expect(allowedOrigin(cfg, 'http://127.0.0.1.evil.example:5500')).toBe(false);
  });

  it('production and staging: only the public site', () => {
    for (const env of ['production', 'staging'] as const) {
      const cfg = { APP_ENV: env, PUBLIC_APP_URL: site };
      expect(allowedOrigin(cfg, site)).toBe(true);
      expect(allowedOrigin(cfg, 'http://localhost:5500')).toBe(false);
      expect(allowedOrigin(cfg, 'http://127.0.0.1:8000')).toBe(false);
    }
  });
});
