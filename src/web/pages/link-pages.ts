import { escapeHtml, layout } from './layout.js';

const MAIL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`;
const LOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;

/** Who to write to, under each page. */
function helpFooter(supportEmail: string): string {
  const email = escapeHtml(supportEmail);
  return `Trouble with this link? Email <a href="mailto:${email}">${email}</a>.`;
}

/** Shared by both pages: the token from the link, and the form hidden in
 * favour of a note when the link has none (cut short by a mail app). */
const READ_TOKEN = `const token = new URLSearchParams(location.search).get('token') || '';
const form = document.getElementById('form');
const result = document.getElementById('result');
function show(kind, text) { result.className = 'result ' + kind; result.textContent = text; }
if (!token) {
  form.remove();
  show('error', "This link is incomplete. Open it straight from the email, or ask the app for a new one.");
}`;

/** Where a verify-email link lands when the app isn't there to open it:
 * a button, not a visit, does the verifying - mail scanners open links. */
export function verifyEmailPage(supportEmail: string): string {
  return layout(
    'Confirm your email',
    `<div class="icon">${MAIL_ICON}</div>
<h1>Confirm your email</h1>
<p class="lead">Confirm this address for your cchess account, so you can get
back into it if you forget your password.</p>
<form id="form"><button type="submit">Confirm email</button></form>
<p id="result" class="result" role="status"></p>
<p class="note">Didn't ask for this? Ignore the email - nothing changes
unless you confirm.</p>`,
    {
      kind: 'card',
      footer: helpFooter(supportEmail),
      script: `${READ_TOKEN}
form && form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'Confirming...';
  try {
    const response = await fetch('/auth/email/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      form.remove();
      show('done', (body.email || 'Your email') + ' is confirmed. You can go back to the app.');
      return;
    }
    show('error', [].concat(body.message || "That didn't work - try again.").join(' '));
  } catch {
    show('error', "Couldn't reach cchess - check your connection and try again.");
  }
  button.disabled = false;
  button.textContent = 'Confirm email';
});`,
    },
  );
}

export function resetPasswordPage(
  minLength: number,
  supportEmail: string,
): string {
  return layout(
    'Set a new password',
    `<div class="icon">${LOCK_ICON}</div>
<h1>Set a new password</h1>
<p class="lead">Choose a new password for your cchess account. You'll use it
to sign in from now on, on every device.</p>
<form id="form">
<label>New password
<input type="password" id="password" autocomplete="new-password" minlength="${minLength}" maxlength="72" required>
<span class="hint">At least ${minLength} characters.</span>
</label>
<label>Confirm new password
<input type="password" id="confirm" autocomplete="new-password" required>
</label>
<button type="submit">Set password</button>
</form>
<p id="result" class="result" role="status"></p>
<p class="note">This link works for one hour, once. Didn't ask for it? Ignore
the email - your password stays as it is.</p>`,
    {
      kind: 'card',
      footer: helpFooter(supportEmail),
      script: `${READ_TOKEN}
form && form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = document.getElementById('password').value;
  if (password !== document.getElementById('confirm').value) {
    show('error', "The passwords don't match.");
    return;
  }
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'Setting...';
  try {
    const response = await fetch('/auth/password/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      form.remove();
      show('done', 'Your password is set. Sign in to the app with it.');
      return;
    }
    show('error', [].concat(body.message || "That didn't work - try again.").join(' '));
  } catch {
    show('error', "Couldn't reach cchess - check your connection and try again.");
  }
  button.disabled = false;
  button.textContent = 'Set password';
});`,
    },
  );
}
