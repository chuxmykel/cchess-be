import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/configuration.js';
import { LogMailer } from './log-mailer.js';
import { Mailer } from './mailer.js';
import { ResendMailer } from './resend-mailer.js';

/** Global: account email, reports and anything else that mails inject
 * Mailer. Resend when RESEND_API_KEY is set, otherwise the log - never a
 * failed boot, so a server can be deployed before its mail is set up. */
@Global()
@Module({
  providers: [
    {
      provide: Mailer,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): Mailer => {
        const { resendApiKey, from } = config.get('mail', { infer: true });
        if (resendApiKey) return new ResendMailer(resendApiKey, from);
        if (process.env.NODE_ENV === 'production') {
          new Logger('Mail').warn(
            'RESEND_API_KEY is not set: email is logged, not sent',
          );
        }
        return new LogMailer();
      },
    },
  ],
  exports: [Mailer],
})
export class MailModule {}
