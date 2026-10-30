import { canonicalJson, hmacSha256, numericCode, randomToken, safeEqual, sha256 } from './crypto.util';
import { FieldEncryptionService } from './field-encryption.service';
import type { AppConfig } from '../../config/config.schema';

describe('crypto utilities', () => {
  it('random tokens are url-safe and unique', () => {
    const a = randomToken(32);
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(randomToken(32)).not.toBe(a);
  });

  it('sha256 and hmac are stable hex', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hmacSha256('k', 'v')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('safeEqual compares without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('canonicalJson sorts keys deeply', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(
      '{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}',
    );
  });

  it('numericCode gives zero-padded digits', () => {
    for (let i = 0; i < 50; i++) expect(numericCode(6)).toMatch(/^\d{6}$/);
  });
});

describe('FieldEncryptionService (AES-256-GCM)', () => {
  const cfg = {
    FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    FIELD_ENCRYPTION_KEY_ID: 'k1',
  } as AppConfig;
  const enc = new FieldEncryptionService(cfg);

  it('round-trips and uses a fresh IV each time', () => {
    const a = enc.encrypt('JBSWY3DPEHPK3PXP');
    const b = enc.encrypt('JBSWY3DPEHPK3PXP');
    expect(a.equals(b)).toBe(false);
    expect(enc.decrypt(a, 'k1')).toBe('JBSWY3DPEHPK3PXP');
    expect(a.includes(Buffer.from('JBSWY3DPEHPK3PXP'))).toBe(false);
  });

  it('detects tampering', () => {
    const a = enc.encrypt('secret');
    a[a.length - 1] ^= 1;
    expect(() => enc.decrypt(a, 'k1')).toThrow();
  });
});
