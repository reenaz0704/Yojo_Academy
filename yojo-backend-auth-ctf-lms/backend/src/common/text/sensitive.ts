/** v1.0 rule kept in v2.0 (§13.2 PAY-R09): free text with card numbers, "CVV" or "UPI PIN" is refused. */
function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export function containsPaymentSecret(text: string): boolean {
  if (/\bcvv\b|\bupi\s*pin\b/i.test(text)) return true;
  const candidates = text.match(/(?:\d[ -]?){13,19}/g) ?? [];
  return candidates.some((c) => {
    const digits = c.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && luhn(digits);
  });
}

/** Keys whose values must never reach logs or audit details. */
export const SENSITIVE_KEY = /pass(word)?|otp|code|token|secret|cookie|authorization|signature|flag|answer|cvv|pin\b/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>))
    out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  return out;
}

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Spec §22.4: control characters are stripped from free text (tab, CR and LF are kept). Returns a new value. */
export function stripControlChars(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.replace(CONTROL, '');
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => stripControlChars(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = stripControlChars(v, depth + 1);
  return out;
}
