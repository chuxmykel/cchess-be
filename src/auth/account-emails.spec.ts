import { describe, expect, it } from 'vitest';

import {
  emailChangeRequestedMessage,
  resetPasswordMessage,
  verifyEmailMessage,
} from './account-emails.js';

describe('account emails', () => {
  it('puts the link in both the text and the button', () => {
    const email = verifyEmailMessage(
      'ana',
      'https://api.test/app/verify-email?token=abc',
    );
    expect(email.subject).toBe('Confirm your email for cchess');
    expect(email.text).toContain('https://api.test/app/verify-email?token=abc');
    expect(email.html).toContain(
      'href="https://api.test/app/verify-email?token=abc"',
    );
    expect(email.text).toContain('Hi ana,');
  });

  it('says how long a reset link lasts', () => {
    expect(resetPasswordMessage('ana', 'L').text).toContain('one hour, once');
  });

  it('escapes what a player typed in the HTML', () => {
    const email = emailChangeRequestedMessage(
      'ana',
      '<b>x@y.test</b>',
      'help@test',
    );
    expect(email.html).toContain('&lt;b&gt;x@y.test&lt;/b&gt;');
    expect(email.html).not.toContain('<b>x@y.test');
  });
});
