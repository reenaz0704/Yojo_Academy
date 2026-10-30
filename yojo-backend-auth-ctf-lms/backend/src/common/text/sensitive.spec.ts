import { containsPaymentSecret, redact, stripControlChars } from './sensitive';

describe('payment-secret detection (PAY-R09)', () => {
  it.each(['my card 4111 1111 1111 1111', '4111-1111-1111-1111', 'cvv is 123', 'UPI PIN 1234', 'upi  pin'])(
    'flags "%s"',
    (t) => {
      expect(containsPaymentSecret(t)).toBe(true);
    },
  );
  it.each(['phone 98765 43210', 'roll number 2023001234', 'order 1234567890123 (not luhn)', 'hello'])(
    'allows "%s"',
    (t) => {
      expect(containsPaymentSecret(t)).toBe(false);
    },
  );
});

describe('redact', () => {
  it('masks secret-looking keys at any depth', () => {
    const out = redact({
      email: 'a@b.c',
      password: 'x',
      nested: { otpCode: '1', token: 't', list: [{ secret: 's', ok: 1 }] },
    });
    expect(out).toEqual({
      email: 'a@b.c',
      password: '[redacted]',
      nested: { otpCode: '[redacted]', token: '[redacted]', list: [{ secret: '[redacted]', ok: 1 }] },
    });
  });
});

describe('stripControlChars', () => {
  it('removes control characters but keeps tab and newlines', () => {
    expect(stripControlChars({ a: 'he\u0000llo\u0007', b: ['x\u001by'], c: 'line1\nline2\tok', n: 5 })).toEqual({
      a: 'hello',
      b: ['xy'],
      c: 'line1\nline2\tok',
      n: 5,
    });
  });
});
