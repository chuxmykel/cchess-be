import type { RateLimit } from '../common/sliding-window-limiter.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How often each account action may be tried - by who or where it's
 * tried from. In memory, per cluster worker: against abuse, not an exact
 * count. Off with AUTH_RATE_LIMITS=false (the test suites, whose every
 * request comes from one address). */
export const AUTH_RATE_LIMITS = {
  /** Failed sign-ins to one username or email. */
  signInFailuresPerAccount: { messages: 10, perMs: 15 * MINUTE },
  /** Failed sign-ins from one IP address, to any account. */
  signInFailuresPerIp: { messages: 30, perMs: 15 * MINUTE },
  accountsPerIp: { messages: 5, perMs: HOUR },
  guestsPerIp: { messages: 60, perMs: HOUR },
  /** Verification and change-of-address emails to one account. */
  emailsPerAccount: { messages: 3, perMs: HOUR },
  resetsPerAddress: { messages: 3, perMs: HOUR },
  resetsPerIp: { messages: 10, perMs: HOUR },
} satisfies Record<string, RateLimit>;
