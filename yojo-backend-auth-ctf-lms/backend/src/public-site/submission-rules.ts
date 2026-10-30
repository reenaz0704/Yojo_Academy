import { createHash } from 'node:crypto';
import type { SubmissionStatus, SubmissionType } from '@prisma/client';

/**
 * Rules for public website submissions (docs/PUBLIC-INVENTORY.md). One table, one lifecycle; each form type
 * declares which fields it may send and which it must send, so a visitor can never set fields a form does not have.
 */

export type SubmissionField = 'name' | 'email' | 'phone' | 'topic' | 'message' | 'preferredAt' | 'consent';

export interface TypeRule {
  label: string;
  /** Fields the form may send (anything else is rejected). */
  allowed: SubmissionField[];
  /** Fields the form must send. */
  required: SubmissionField[];
  /** Fixed list the page offers; null = free text (course title comes from the server-side course list later). */
  topics: string[] | null;
  /** Anonymous forms record consent; the signed-in course request is tied to the account. */
  consentKind: 'contact' | null;
  /** Only a signed-in student may send this type; name and email then come from the account. */
  signedInStudent?: boolean;
}

export const SUBMISSION_RULES: Record<SubmissionType, TypeRule> = {
  contact: {
    label: 'Contact Us',
    allowed: ['name', 'email', 'phone', 'topic', 'message', 'consent'],
    required: ['name', 'email', 'phone', 'topic', 'consent'],
    topics: ['Career counselling', 'Course and batch details', 'Internships', 'Corporate training', 'CTF partnership'],
    consentKind: 'contact',
  },
  mentorship_session: {
    label: 'Mentorship',
    allowed: ['name', 'phone', 'email', 'topic', 'preferredAt', 'consent'],
    required: ['name', 'phone', 'topic', 'consent'],
    topics: ['Offensive security', 'Defensive security (SOC)', 'GRC and audit', 'Cloud security', 'Not sure yet'],
    consentKind: 'contact',
  },
  internship_application: {
    label: 'Internship',
    allowed: ['name', 'email', 'phone', 'topic', 'message', 'consent'],
    required: ['name', 'email', 'topic', 'consent'],
    topics: [
      'SOC detection engineering',
      'Web app pentest',
      'Cloud security posture',
      'GRC and ISO 27001',
      'Secure software',
      // "Our programs" pages (30 Oct): program · internship, as listed in programs.js (OI-65 draft content)
      'Expert Professional · SOC Analyst Intern',
      'Expert Professional · VAPT Intern',
      'Expert Professional · GRC Analyst Intern',
      'Expert Professional · Digital Forensics Intern',
      'Expert Professional · Threat Intelligence Intern',
      'Expert Professional · AI Security Intern',
      'Diploma · Cyber Security Foundations Intern',
      'Diploma · Junior SOC Intern',
      'Diploma · Web Security Intern',
      'Diploma · GRC Documentation Intern',
      'Diploma · AI for Cyber Security Intern',
      'GRC Mentorship · ISO 27001 Implementation Intern',
      'GRC Mentorship · Risk Assessment Intern',
      'GRC Mentorship · Audit Support Intern',
      'GRC Mentorship · Business Continuity Intern',
      'GRC Mentorship · Privacy Compliance Intern (GDPR / DPDP)',
      'GRC Mentorship · AI Governance Intern',
    ],
    consentKind: 'contact',
  },
  course_enrolment: {
    label: 'Course enrolment',
    allowed: ['topic', 'message'],
    required: ['topic'],
    topics: null,
    consentKind: null,
    signedInStudent: true,
  },
};

export const OPEN_STATUSES: SubmissionStatus[] = ['new', 'reviewing', 'assigned', 'in_progress', 'waiting_for_user'];
export const FINAL_STATUSES: SubmissionStatus[] = ['resolved', 'closed', 'rejected'];

/** Allowed status moves. Assignment itself is a separate action (it moves new/reviewing to assigned). */
export const SUBMISSION_TRANSITIONS: Record<SubmissionStatus, SubmissionStatus[]> = {
  new: ['reviewing', 'in_progress', 'closed', 'rejected'],
  reviewing: ['in_progress', 'waiting_for_user', 'resolved', 'closed', 'rejected'],
  assigned: ['reviewing', 'in_progress', 'waiting_for_user', 'resolved', 'closed', 'rejected'],
  in_progress: ['waiting_for_user', 'resolved', 'closed', 'rejected'],
  waiting_for_user: ['in_progress', 'resolved', 'closed'],
  resolved: ['in_progress', 'closed'],
  closed: ['in_progress'],
  rejected: [],
};

export function canMove(from: SubmissionStatus, to: SubmissionStatus): boolean {
  return SUBMISSION_TRANSITIONS[from].includes(to);
}

/** Moves that close or reopen a record need a short written reason (kept in the history). */
export function needsReason(from: SubmissionStatus, to: SubmissionStatus): boolean {
  return FINAL_STATUSES.includes(to) || FINAL_STATUSES.includes(from);
}

/** Same person, same form, same topic within this window = a double click or retry, not a new enquiry. */
export const DUPLICATE_WINDOW_MS = 10 * 60_000;
/** An open enquiry with no first response after this long is shown as overdue ("we reply within one working day"). */
export const RESPONSE_TARGET_MS = 24 * 3600_000;

export function dedupeKey(type: SubmissionType, email?: string | null, phone?: string | null, topic?: string | null) {
  const norm = [type, (email ?? '').trim().toLowerCase(), (phone ?? '').replace(/\D/g, '').slice(-10), topic ?? ''];
  return createHash('sha256').update(norm.join('|')).digest('hex');
}

/** Phone numbers as the forms accept them: optional +, digits, spaces and dashes, 10 to 15 digits. */
export function normalisePhone(v: string): string | null {
  const t = v.trim();
  if (!/^\+?[\d\s-]{10,20}$/.test(t)) return null;
  const digits = t.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return (t.startsWith('+') ? '+' : '') + digits;
}
