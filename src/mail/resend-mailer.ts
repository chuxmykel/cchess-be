import { Mailer, type MailMessage } from './mailer.js';

export const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

/** Sends through Resend's HTTP API (https://resend.com/docs/api-reference/
 * emails/send-email) - plain fetch, no SDK. */
export class ResendMailer extends Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {
    super();
  }

  async send(message: MailMessage): Promise<void> {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html && { html: message.html }),
        ...(message.replyTo && { reply_to: message.replyTo }),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(
        `Resend refused the email (${response.status}): ${detail}`,
      );
    }
  }
}
