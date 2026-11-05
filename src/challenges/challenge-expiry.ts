import { isDailyTimeControl } from '../chess/time-control.js';
import type { Challenge } from './entities/challenge.entity.js';

const DEFAULT_CHALLENGE_TTL_MS = 2 * 60 * 1000;

/** How long a daily game's challenge waits: its opponent may not look
 * for days. */
export const DAILY_CHALLENGE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** How long a live game's challenge waits for an answer. Read when needed,
 * so tests can shorten it. */
export function challengeTtlMs(): number {
  return Number(process.env.CHALLENGE_TTL_MS ?? DEFAULT_CHALLENGE_TTL_MS);
}

/** How long this challenge waits for an answer - a daily game's, days. */
export function ttlMsOf(
  challenge: Pick<Challenge, 'initialSeconds' | 'incrementSeconds'>,
): number {
  return isDailyTimeControl(challenge)
    ? DAILY_CHALLENGE_TTL_MS
    : challengeTtlMs();
}

export function challengeExpiresAt(challenge: Challenge): Date {
  return new Date(challenge.createdAt.getTime() + ttlMsOf(challenge));
}

export function isChallengeExpired(
  challenge: Challenge,
  now = new Date(),
): boolean {
  return now >= challengeExpiresAt(challenge);
}
