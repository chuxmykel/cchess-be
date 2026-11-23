import { Logger } from '@nestjs/common';

import { Mailer, type MailMessage } from './mailer.js';

/** Sends nothing: logs each email, and keeps it for a test to read. The
 * mailer in development and tests, and wherever no provider is set up. */
export class LogMailer extends Mailer {
  private readonly logger = new Logger('Mail');
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    this.logger.log(
      `(not sent) to ${message.to}: ${message.subject}\n${message.text}`,
    );
  }
}
