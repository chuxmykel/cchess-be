/** The account emails' words: a subject, plain text, and the same as
 * simple HTML. Pure, so their wording is tested on its own. */
export interface AccountEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(paragraphs: string[], button?: { label: string; link: string }) {
  const body = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  const action = button
    ? `<p><a href="${escapeHtml(button.link)}" style="display:inline-block;padding:12px 20px;background:#c2411a;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">${escapeHtml(button.label)}</a></p>` +
      `<p style="color:#666;font-size:13px">Or open this link: ${escapeHtml(button.link)}</p>`
    : '';
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:520px">${body}${action}</div>`;
}

export function verifyEmailMessage(
  username: string,
  link: string,
): AccountEmail {
  const lines = [
    `Hi ${username},`,
    'Confirm this is your email address for cchess. The link works for 24 hours.',
  ];
  const after = "If you didn't create a cchess account, ignore this email.";
  return {
    subject: 'Confirm your email for cchess',
    text: [...lines, link, after].join('\n\n'),
    html: page([...lines], { label: 'Confirm email', link }) + page([after]),
  };
}

export function changeEmailMessage(
  username: string,
  link: string,
): AccountEmail {
  const lines = [
    `Hi ${username},`,
    'Confirm this as the new email address for your cchess account. The link works for 24 hours, and the address changes only once you confirm.',
  ];
  const after = "If you didn't ask for this, ignore this email.";
  return {
    subject: 'Confirm your new email for cchess',
    text: [...lines, link, after].join('\n\n'),
    html: page(lines, { label: 'Confirm new email', link }) + page([after]),
  };
}

/** To the old address, when a change to a new one is asked for. */
export function emailChangeRequestedMessage(
  username: string,
  newEmail: string,
  supportEmail: string,
): AccountEmail {
  const lines = [
    `Hi ${username},`,
    `Someone signed in to your cchess account asked to change its email to ${newEmail}. It changes once that address is confirmed.`,
    `If this wasn't you, change your password and write to ${supportEmail}.`,
  ];
  return {
    subject: 'Your cchess email is being changed',
    text: lines.join('\n\n'),
    html: page(lines),
  };
}

export function resetPasswordMessage(
  username: string,
  link: string,
): AccountEmail {
  const lines = [
    `Hi ${username},`,
    'Set a new password for your cchess account. The link works for one hour, once.',
  ];
  const after =
    "If you didn't ask for this, ignore this email: your password stays as it is.";
  return {
    subject: 'Reset your cchess password',
    text: [...lines, link, after].join('\n\n'),
    html: page(lines, { label: 'Set a new password', link }) + page([after]),
  };
}

export function passwordChangedMessage(
  username: string,
  supportEmail: string,
): AccountEmail {
  const lines = [
    `Hi ${username},`,
    'Your cchess password was just changed, and every device was signed out.',
    `If this wasn't you, reset your password now and write to ${supportEmail}.`,
  ];
  return {
    subject: 'Your cchess password was changed',
    text: lines.join('\n\n'),
    html: page(lines),
  };
}
