import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../common/errors/app-error';

/**
 * Lab answer normalisation and salted hashing (ported from mission-api's domaindate.py and fingerprint.py so the
 * Academy accepts exactly what the lab service accepted). An answer is normalised first, then compared as
 * sha256(salt + ':' + normalised) against the stored hash; the plain answer is never stored.
 */
export type AnswerFormat = 'text' | 'set' | 'date' | 'count' | 'session_flag';

export const newSalt = () => randomBytes(16).toString('hex');
export const saltedHash = (salt: string, value: string) =>
  createHash('sha256').update(`${salt}:${value}`).digest('hex');
export const sameHash = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

const bad = (message: string) => new AppError(422, 'ANSWER_FORMAT', message);

// ── dates ──
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const pad = (n: number) => String(n).padStart(2, '0');
function mk(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
    ? `${y}-${pad(m)}-${pad(d)}`
    : null;
}
/** Returns YYYY-MM-DD; ambiguous numeric dates (05-06-2028) are refused rather than guessed. */
export function parseDate(text: string): string {
  const s = (text ?? '').trim().replace(/\s+/g, ' ');
  if (!s || s.length > 40) throw bad('Enter the date, for example 2030-01-31.');
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i.exec(s);
  if (m) {
    const d = mk(+m[1], +m[2], +m[3]);
    if (d) return d;
    throw bad('That is not a valid calendar date.');
  }
  m = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/.exec(s);
  if (m) {
    const [a, b, c] = [m[1], m[2], m[3]];
    const found = new Set<string>();
    if (a.length === 4 && c.length <= 2) {
      const d = mk(+a, +b, +c);
      if (d) found.add(d);
    } else if (c.length === 4 && a.length <= 2) {
      for (const d of [mk(+c, +b, +a), mk(+c, +a, +b)]) if (d) found.add(d);
    }
    if (found.size === 1) return [...found][0];
    if (found.size > 1) throw bad('That date could be read two ways. Write it as YYYY-MM-DD.');
    throw bad('That is not a valid calendar date.');
  }
  let day: string, mon: string, year: string;
  const w1 = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9}),? (\d{4})$/i.exec(s);
  const w2 = /^([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/i.exec(s);
  if (w1) [day, mon, year] = [w1[1], w1[2], w1[3]];
  else if (w2) [mon, day, year] = [w2[1], w2[2], w2[3]];
  else throw bad('Use a full date such as 2030-01-31. Partial dates are not accepted.');
  const mi = MONTHS.findIndex((full) => full.startsWith(mon.toLowerCase()) && mon.length >= 3);
  if (mi < 0) throw bad('I could not read that month.');
  const out = mk(+year, mi + 1, +day);
  if (!out) throw bad('That is not a valid calendar date.');
  return out;
}

// ── technology sets ──
const ALIASES: Record<string, string> = {
  'node.js': 'node.js',
  nodejs: 'node.js',
  node: 'node.js',
  'node js': 'node.js',
  html: 'html',
  html5: 'html',
  'html 5': 'html',
  apache: 'apache',
  'apache http server': 'apache',
  'apache httpd': 'apache',
  httpd: 'apache',
  express: 'express',
  'express.js': 'express',
  expressjs: 'express',
  css: 'css',
  javascript: 'javascript',
  js: 'javascript',
};
export function parseSet(text: string): string[] {
  if ((text ?? '').length > 200) throw bad('Answer is too long.');
  const items = text
    .split(/[,;\n/|]+/)
    .map((p) =>
      p
        .replace(/\s+/g, ' ')
        .replace(/^[ .\t]+|[ .\t]+$/g, '')
        .toLowerCase(),
    )
    .filter(Boolean);
  if (!items.length) throw bad('Enter at least one item.');
  if (items.length > 20 || items.some((i) => i.length > 40)) throw bad('Too many or too long entries.');
  return [...new Set(items.map((i) => ALIASES[i] ?? i))];
}

export function parseCount(text: string): string {
  const t = (text ?? '').trim();
  if (!/^[0-9]{1,4}$/.test(t))
    throw bad('Enter a whole number, for example 7. Negative numbers, decimals and text are not accepted.');
  return String(Number(t));
}

/** Normalised form that is hashed and stored (for `set`, one hash per required item, joined by commas). */
export function hashAnswer(format: Exclude<AnswerFormat, 'session_flag'>, answer: string, salt: string): string {
  if (format === 'set')
    return parseSet(answer)
      .map((i) => saltedHash(salt, i))
      .sort()
      .join(',');
  return saltedHash(salt, normalise(format, answer));
}

function normalise(format: 'text' | 'date' | 'count', answer: string) {
  if (format === 'date') return parseDate(answer);
  if (format === 'count') return parseCount(answer);
  const t = (answer ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t || t.length > 200) throw bad('Enter your answer.');
  return t;
}

/** True when the answer matches. `set`: every required item present, extras allowed (mission-api's default). */
export function checkAnswer(
  format: Exclude<AnswerFormat, 'session_flag'>,
  answer: string,
  salt: string,
  stored: string,
): boolean {
  if (format === 'set') {
    const got = new Set(parseSet(answer).map((i) => saltedHash(salt, i)));
    const need = stored.split(',').filter(Boolean);
    return need.length > 0 && need.every((h) => got.has(h));
  }
  return sameHash(saltedHash(salt, normalise(format, answer)), stored);
}
