import { PasswordService } from './password.service';

describe('PasswordService (staff password policy, spec §6.4 / §22)', () => {
  const svc = new PasswordService();
  const good = 'Correct-Horse-9';

  it('hashes with argon2id and verifies', async () => {
    const h = await svc.hash(good);
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await svc.verify(h, good)).toBe(true);
    expect(await svc.verify(h, 'Correct-Horse-8')).toBe(false);
  });

  it('returns false (not throw) for a missing hash, still spending argon2 time', async () => {
    expect(await svc.verify(null, good)).toBe(false);
    expect(await svc.verify('garbage', good)).toBe(false);
  });

  it.each([
    ['short', 'Ab1!short'],
    ['no symbol', 'Abcdefgh123'],
    ['no digit', 'Abcdefgh!!x'],
    ['no upper', 'abcdefg1!xx'],
    ['no lower', 'ABCDEFG1!XX'],
  ])('refuses %s', async (_label, pw) => {
    await expect(svc.assertAcceptable(pw)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      opts: { field: 'password' },
    });
  });

  it('refuses the email name inside the password', async () => {
    await expect(svc.assertAcceptable('Ramesh-2026!x', [], 'ramesh@yojosolutions.com')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('refuses reuse of one of the last five passwords', async () => {
    const old = await svc.hash(good);
    await expect(svc.assertAcceptable(good, [old])).rejects.toMatchObject({
      message: expect.stringContaining('last 5'),
    });
    await expect(svc.assertAcceptable('Another-Pass-77', [old])).resolves.toBeUndefined();
  });
});
