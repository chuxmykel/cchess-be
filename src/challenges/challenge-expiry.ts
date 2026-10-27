import type { Challenge } from './entities/challenge.entity.js';

const DEFAULT_CHALLENGE_TTL_MS = 2 * 60 * 1000;

/** How long a challenge waits for an answer. Read when needed, so tests
 * can shorten it. */
export function challengeTtlMs(): number {
  return Number(process.env.CHALLENGE_TTL_MS ?? DEFAULT_CHALLENGE_TTL_MS);
}

export function challengeExpiresAt(challenge: Challenge): Date {
  return new Date(challenge.createdAt.getTime() + challengeTtlMs());
}

export function isChallengeExpired(
  challenge: Challenge,
  now = new Date(),
): boolean {
  return now >= challengeExpiresAt(challenge);
}
