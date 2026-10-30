import { Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomToken } from '../../common/crypto/crypto.util';
import type { MailMessage, MailPort } from './mail.port';

/**
 * Development only (refused in production by config validation). Writes each email as JSON into DEV_MAIL_DIR so a
 * developer can read the OTP or invite link, and keeps the last 200 in memory for automated tests.
 * The log line never contains the message body, so codes do not reach logs.
 */
export class DevMailAdapter implements MailPort {
  private readonly log = new Logger('DevMail');
  readonly sent: MailMessage[] = [];

  constructor(private readonly dir: string | null) {}

  async send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
    if (this.sent.length > 200) this.sent.shift();
    if (this.dir) {
      await mkdir(this.dir, { recursive: true });
      await writeFile(
        join(this.dir, `${Date.now()}-${msg.template}-${randomToken(4)}.json`),
        JSON.stringify(msg, null, 2),
      );
    }
    this.log.log(`queued ${msg.template} email (dev driver)`);
  }

  lastTo(to: string, template?: MailMessage['template']): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to.toLowerCase() && (!template || m.template === template));
  }
}

export class DisabledMailAdapter implements MailPort {
  private readonly log = new Logger('Mail');
  async send(msg: MailMessage): Promise<void> {
    this.log.warn(`mail driver disabled; ${msg.template} email not sent`);
  }
}
