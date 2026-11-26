/** An email to send: plain text always, HTML when there's a richer
 * version. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Where a reply goes, when not back to the sender - a report's
   * reporter, say. */
  replyTo?: string;
}

/** Sends the server's email. Injected by this class, so a test or another
 * provider can stand in (see MailModule for which one runs). */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}
