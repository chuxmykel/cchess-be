export type GameType = 'bullet' | 'blitz' | 'rapid' | 'classical';

export interface TimeControl {
  /** Starting clock per side, in minutes. 0 is valid (e.g. "0+1" bullet). */
  minutes: number;
  /** Increment added to a player's clock after each of their moves, in seconds. */
  incrementSeconds: number;
}

const MIN_MINUTES = 0;
const MAX_MINUTES = 180;
const MIN_INCREMENT = 0;
const MAX_INCREMENT = 180;

export function isValidTimeControl(tc: TimeControl): boolean {
  return (
    Number.isInteger(tc.minutes) &&
    Number.isInteger(tc.incrementSeconds) &&
    tc.minutes >= MIN_MINUTES &&
    tc.minutes <= MAX_MINUTES &&
    tc.incrementSeconds >= MIN_INCREMENT &&
    tc.incrementSeconds <= MAX_INCREMENT &&
    (tc.minutes > 0 || tc.incrementSeconds > 0)
  );
}

/**
 * Classifies a time control the way Lichess does: by "estimated game
 * duration" (base + 40 increments, in minutes), not just the base time.
 * This is what lets arbitrary/custom time controls (not just the app's 16
 * presets) still bucket sensibly for matchmaking and rating categories.
 */
export function classifyTimeControl(tc: TimeControl): GameType {
  const estimatedMinutes = tc.minutes + (tc.incrementSeconds * 40) / 60;

  if (estimatedMinutes < 3) return 'bullet';
  if (estimatedMinutes < 10) return 'blitz';
  if (estimatedMinutes < 25) return 'rapid';
  return 'classical';
}

export function toClockMs(tc: TimeControl): number {
  return tc.minutes * 60 * 1000;
}

export function incrementMs(tc: TimeControl): number {
  return tc.incrementSeconds * 1000;
}

export function formatTimeControl(tc: TimeControl): string {
  return `${tc.minutes}+${tc.incrementSeconds}`;
}
