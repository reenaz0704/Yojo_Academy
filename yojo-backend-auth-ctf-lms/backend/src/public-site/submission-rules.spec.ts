import {
  canMove,
  dedupeKey,
  needsReason,
  normalisePhone,
  SUBMISSION_RULES,
  SUBMISSION_TRANSITIONS,
} from './submission-rules';

describe('public submission rules', () => {
  it('every required field is also allowed, and anonymous forms require consent', () => {
    for (const [type, r] of Object.entries(SUBMISSION_RULES)) {
      for (const f of r.required) expect({ type, f, ok: r.allowed.includes(f) }).toEqual({ type, f, ok: true });
      if (!r.signedInStudent) expect(r.required).toContain('consent');
    }
  });

  it('lifecycle: no skipping straight to resolved, rejected is final, closed and resolved can reopen', () => {
    expect(canMove('new', 'resolved')).toBe(false);
    expect(canMove('new', 'reviewing')).toBe(true);
    expect(SUBMISSION_TRANSITIONS.rejected).toEqual([]);
    expect(canMove('closed', 'in_progress')).toBe(true);
    expect(canMove('resolved', 'in_progress')).toBe(true);
    expect(canMove('waiting_for_user', 'new')).toBe(false);
  });

  it('closing and reopening need a reason; ordinary moves do not', () => {
    expect(needsReason('in_progress', 'resolved')).toBe(true);
    expect(needsReason('closed', 'in_progress')).toBe(true);
    expect(needsReason('new', 'reviewing')).toBe(false);
  });

  it('duplicate key ignores case and phone formatting', () => {
    expect(dedupeKey('contact', 'A@X.com', '+91 98765-43210', 'Internships')).toBe(
      dedupeKey('contact', 'a@x.com', '9876543210', 'Internships'),
    );
    expect(dedupeKey('contact', 'a@x.com', null, 'Internships')).not.toBe(
      dedupeKey('contact', 'a@x.com', null, 'CTF partnership'),
    );
  });

  it('phones: 10 to 15 digits with optional +, spaces and dashes', () => {
    expect(normalisePhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('98765abc43')).toBeNull();
  });
});
