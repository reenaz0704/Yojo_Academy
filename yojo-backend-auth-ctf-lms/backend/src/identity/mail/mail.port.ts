export interface MailMessage {
  to: string;
  template:
    | 'otp'
    | 'staff_invite'
    | 'password_reset'
    | 'password_changed'
    | 'mfa_reset'
    | 'access_request_declined'
    | 'ctf_password_reset'
    | 'submission_received'
    | 'submission_staff_alert'
    | 'submission_assigned'
    | 'subscription_confirmed'
    | 'academy_notification';
  subject: string;
  text: string;
}

/**
 * Transactional email port (spec §26). Real providers (SES, SendGrid, ZeptoMail; OD-11) plug in as adapters
 * once credentials exist. Until then the dev adapter writes messages to a local folder for developers.
 */
export interface MailPort {
  send(msg: MailMessage): Promise<void>;
}

export const MAIL_PORT = Symbol('MAIL_PORT');
