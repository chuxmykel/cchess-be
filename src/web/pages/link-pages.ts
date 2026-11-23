import { layout } from './layout.js';

/** Where a verify-email link lands when the app isn't there to open it:
 * a button, not a visit, does the verifying - mail scanners open links. */
export function verifyEmailPage(): string {
  return layout(
    'Confirm your email',
    `<h1>Confirm your email</h1>
<p>Confirm this address for your cchess account.</p>
<form id="form"><button type="submit">Confirm email</button></form>
<p id="result" role="status"></p>`,
    `const token = new URLSearchParams(location.search).get('token') || '';
document.getElementById('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  const result = document.getElementById('result');
  button.disabled = true;
  const response = await fetch('/auth/email/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const body = await response.json().catch(() => ({}));
  result.textContent = response.ok
    ? 'Done: ' + body.email + ' is confirmed. You can go back to the app.'
    : (body.message || 'That didn\\'t work - try again.');
  if (!response.ok) button.disabled = false;
});`,
  );
}

export function resetPasswordPage(minLength: number): string {
  return layout(
    'Set a new password',
    `<h1>Set a new password</h1>
<form id="form">
<input type="password" id="password" autocomplete="new-password" minlength="${minLength}" maxlength="72" placeholder="New password" required>
<input type="password" id="confirm" autocomplete="new-password" placeholder="The same again" required>
<button type="submit">Set password</button>
</form>
<p id="result" role="status"></p>`,
    `const token = new URLSearchParams(location.search).get('token') || '';
document.getElementById('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = document.getElementById('result');
  const password = document.getElementById('password').value;
  if (password !== document.getElementById('confirm').value) {
    result.textContent = "The passwords don't match.";
    return;
  }
  const button = event.target.querySelector('button');
  button.disabled = true;
  const response = await fetch('/auth/password/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.ok) {
    event.target.remove();
    result.textContent = 'Your password is set. Sign in to the app with it.';
  } else {
    result.textContent = [].concat(body.message || "That didn't work - try again.").join(' ');
    button.disabled = false;
  }
});`,
  );
}
