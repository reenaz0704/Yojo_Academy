/**
 * Policy and consent versions the API accepts. OPEN ITEM: the legal texts and their version labels are owned by
 * Yojo; these labels are placeholders until the final documents are published.
 */
export const CONSENT_VERSIONS = {
  terms: '2026-10-draft',
  privacy: '2026-10-draft',
  aup: '2026-10-draft',
  marketing: '2026-10-draft',
  parental: '2026-10-draft',
  code_of_conduct: '2026-10-draft',
  staff_policy: '2026-10-draft',
  ctf_rules: '2026-10-draft',
  ctf_contact: '2026-10-draft',
  // Public website: "I agree to be contacted" on the forms, and the separate event-reminder subscription.
  contact: '2026-10-draft',
  event_reminder: '2026-10-draft',
} as const;

export const INVITE_TTL_MS = 72 * 3600_000;
export const PASSWORD_RESET_TTL_SEC = 30 * 60;
export const MFA_REENROL_TTL_SEC = 72 * 3600;
export const STAFF_CHALLENGE_TTL_SEC = 5 * 60;
export const STAFF_CHALLENGE_MAX_TRIES = 5;
export const SIGNUP_TICKET_TTL_SEC = 15 * 60;
export const SUPPORT_PURPOSE_TTL_MS = 30 * 60_000;
export const DUAL_CONTROL_TTL_MS = 48 * 3600_000;
