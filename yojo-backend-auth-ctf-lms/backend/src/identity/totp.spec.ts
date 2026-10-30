import { base32Decode, base32Encode, currentStep, matchTotp, newTotpSecret, otpauthUri, totpAt } from './totp';

// RFC 6238 Appendix B, SHA-1 seed "12345678901234567890"; 8-digit values truncated to the last 6 digits.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const VECTORS: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
];

describe('TOTP (RFC 6238)', () => {
  it.each(VECTORS)('time %i gives %s', (t, code) => {
    expect(totpAt(RFC_SECRET, Math.floor(t / 30))).toBe(code);
  });

  it('base32 round-trips', () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    expect(() => base32Decode('not*base32')).toThrow();
  });

  it('accepts the current, previous and next step only', () => {
    const secret = newTotpSecret();
    const now = 1_800_000_000_000;
    const step = currentStep(now);
    expect(matchTotp(secret, totpAt(secret, step), now)).toBe(step);
    expect(matchTotp(secret, totpAt(secret, step - 1), now)).toBe(step - 1);
    expect(matchTotp(secret, totpAt(secret, step + 1), now)).toBe(step + 1);
    expect(matchTotp(secret, totpAt(secret, step - 3), now)).toBeNull();
    expect(matchTotp(secret, 'abcdef', now)).toBeNull();
  });

  it('builds an otpauth URI with issuer and SHA1/6/30 parameters', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'asha@yojosolutions.com');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=Yojo');
  });

  it('generates 160-bit secrets', () => {
    expect(base32Decode(newTotpSecret())).toHaveLength(20);
  });
});
