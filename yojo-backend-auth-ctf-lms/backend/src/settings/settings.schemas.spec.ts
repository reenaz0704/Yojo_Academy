import { SETTINGS_DEFAULTS, SETTINGS_SCHEMAS, SETTINGS_SECTIONS, STEP_UP_SECTIONS } from './settings.schemas';

describe('settings schemas', () => {
  it.each(SETTINGS_SECTIONS)('default for %s passes its own schema', (section) => {
    expect(SETTINGS_SCHEMAS[section].safeParse(SETTINGS_DEFAULTS[section]).success).toBe(true);
  });

  it('auth defaults match the spec (OTP 5 min, 3 tries, 30 s resend, step-up 5 min)', () => {
    expect(SETTINGS_DEFAULTS.auth).toMatchObject({
      otpTtlSec: 300,
      otpMaxTries: 3,
      otpResendSec: 30,
      stepUpWindowSec: 300,
    });
  });

  it('rejects unknown keys (strict) and out-of-range values', () => {
    expect(SETTINGS_SCHEMAS.maintenance.safeParse({ enabled: true, message: 'x', extra: 1 }).success).toBe(false);
    expect(SETTINGS_SCHEMAS.auth.safeParse({ ...SETTINGS_DEFAULTS.auth, otpMaxTries: 0 }).success).toBe(false);
  });

  it('policy PI weights must add up to 100', () => {
    const p = SETTINGS_DEFAULTS.policy as { piWeights: Record<string, number> };
    const bad = { ...SETTINGS_DEFAULTS.policy, piWeights: { ...p.piWeights, attendance: p.piWeights.attendance + 1 } };
    expect(SETTINGS_SCHEMAS.policy.safeParse(bad).success).toBe(false);
  });

  it('policy, plans and auth need step-up', () => {
    expect(STEP_UP_SECTIONS.sort()).toEqual(['auth', 'plans', 'policy']);
  });
});
