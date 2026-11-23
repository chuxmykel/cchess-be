import { escapeHtml, layout } from './layout.js';

/**
 * The privacy policy and terms of use. DRAFTS, written for a free chess app
 * run by one person: read them, and have them checked, before the app is
 * published. Change PRIVACY_VERSION / TERMS_VERSION (src/legal/legal.ts)
 * with the words - changing the terms asks every player to accept again.
 */
export function privacyPage(supportEmail: string, updated: string): string {
  const email = escapeHtml(supportEmail);
  return layout(
    'Privacy policy',
    `<h1>Privacy policy</h1>
<p class="muted">Last updated ${escapeHtml(updated)}</p>
<p>cchess is a chess app for playing, analysing and reviewing games. This
policy says what it keeps about you, why, who else sees it, and how to have it
deleted. Questions: <a href="mailto:${email}">${email}</a>.</p>

<h2>What we keep</h2>
<ul>
<li><b>Your account:</b> your username, email address and a hash of your
password (never the password itself), your display name and bio if you add
them, and whether you've verified your email. A guest account has none of
these, only a made-up name.</li>
<li><b>Your games:</b> the moves, results, clocks and ratings of every game
you play, game reviews, notes you write on your games and conditional moves.
Your opponents see the games you played with them.</li>
<li><b>What you write to others:</b> chat in your games, direct messages to
your friends, friend requests, challenges and the players you block.</li>
<li><b>Reports:</b> if you report a player, the report and a copy of the
message reported.</li>
<li><b>When you were last online</b>, shown to other players.</li>
<li><b>Usage and crash data</b>, unless you turn it off in Settings: which
screens and features you use, your device model and operating system, and
crash reports. It's tied to a random identifier, not your name or email, and
your IP address isn't kept.</li>
</ul>
<p>Our server sees your IP address while you use the app, to answer you and to
limit abuse (such as repeated wrong passwords); it isn't stored with your
account.</p>

<h2>Why</h2>
<p>To run the game: to pair you with opponents, keep your rating, show your
history and deliver your messages; to keep players safe, by acting on reports
and limiting abuse; to send the emails your account needs (verifying your
address, resetting your password); and, with usage data, to learn what to
improve. We don't sell your data, show ads or track you across other apps.</p>

<h2>Who else sees it</h2>
<ul>
<li><b>Our hosting provider</b> runs the server and its database.</li>
<li><b>Resend</b> sends our emails, so it handles your email address.</li>
<li><b>PostHog</b> (in the EU) receives the usage and crash data, if you
allow it.</li>
<li><b>Lichess</b> receives the chess positions you look up in the opening
explorer, from our server, never anything about you.</li>
<li><b>GitHub and unpkg</b> serve the Stockfish engine the first time you
analyse; your device downloads it from them directly, so they see its IP
address.</li>
</ul>

<h2>How long we keep it</h2>
<p>As long as your account exists. When you delete it, your email, password,
profile, messages, chat, notes, friends and blocks are deleted at once. Your
finished games stay, so your opponents' histories and ratings still make
sense, but under "Deleted player", with nothing that identifies you. Copies in
our backups are gone within 30 days.</p>

<h2>Deleting your account</h2>
<p>In the app: Settings, Delete account. Or see
<a href="/account/delete">how to delete your account</a> without it.</p>

<h2>Your rights</h2>
<p>You can ask for a copy of your data, have it corrected or deleted, or
object to how it's used, by writing to <a href="mailto:${email}">${email}</a>.
If you're in the EU or UK you can also complain to your data protection
authority.</p>

<h2>Children</h2>
<p>cchess is for players aged 13 and over. If you believe a child under 13 has
an account, write to us and we'll delete it.</p>

<h2>Changes</h2>
<p>If this policy changes, the date above changes, and the app tells you about
anything that matters.</p>`,
  );
}

export function termsPage(supportEmail: string, updated: string): string {
  const email = escapeHtml(supportEmail);
  return layout(
    'Terms of use',
    `<h1>Terms of use</h1>
<p class="muted">Last updated ${escapeHtml(updated)}</p>
<p>These terms apply when you use cchess. By creating an account you accept
them. Questions: <a href="mailto:${email}">${email}</a>.</p>

<h2>Your account</h2>
<p>You must be 13 or older. Keep your password to yourself: you're responsible
for what's done with your account. One account per person; guest accounts are
temporary.</p>

<h2>Playing fairly and kindly</h2>
<p>Don't:</p>
<ul>
<li>use an engine, another person or any outside help while playing a rated or
casual game against a person;</li>
<li>abuse, harass, threaten or insult other players, or post hateful, sexual
or violent content, in chat, messages, your username or your profile;</li>
<li>spam, impersonate others, or try to manipulate ratings (for example by
losing on purpose);</li>
<li>attack, overload or try to break into the service, or use it to collect
other players' data.</li>
</ul>
<p>There is no tolerance for objectionable content or abusive players. You
can block anyone and report them from their profile or a message; we review
reports and may remove content, and suspend or close accounts that break these
rules, without notice.</p>

<h2>What you write</h2>
<p>You keep what you write. You let us store it and show it to the players you
send it to, as the app needs. Your games' moves may be shown to other players
and used, without your name, in the opening explorer's statistics.</p>

<h2>The service</h2>
<p>cchess is free, and provided as it is: it may change, have faults or be
unavailable, and we may stop it. As far as the law allows, we aren't liable
for losses from using it, such as a game lost to a dropped connection.</p>
<p>The analysis engine is Stockfish, free software under the GNU General
Public License, downloaded from its authors' release; see Settings, Licenses.</p>

<h2>Ending</h2>
<p>You can delete your account at any time. We may close an account that
breaks these terms.</p>

<h2>Changes</h2>
<p>If these terms change, the date above changes and the app asks you to accept
them again.</p>`,
  );
}

export function deleteAccountPage(supportEmail: string): string {
  const email = escapeHtml(supportEmail);
  return layout(
    'Delete your account',
    `<h1>Delete your cchess account</h1>
<p><b>In the app:</b> open More, then Settings, then Delete account, and enter
your password. It's deleted at once.</p>
<p><b>Without the app:</b> email <a href="mailto:${email}?subject=Delete%20my%20account">${email}</a>
from the address on your account, with your username, asking for it to be
deleted. We delete it within 7 days and reply when it's done.</p>
<h2>What's deleted</h2>
<p>Your email, password, profile, direct messages, game chat, notes, friends,
challenges and blocks are deleted. Your finished games stay, so your opponents'
histories and ratings still make sense, but under "Deleted player", with
nothing that identifies you. Copies in backups are gone within 30 days. See the
<a href="/legal/privacy">privacy policy</a>.</p>`,
  );
}
