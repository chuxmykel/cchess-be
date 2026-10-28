export type GameType = 'bullet' | 'blitz' | 'rapid' | 'classical';

export interface TimeControl {
  /**
   * Starting clock per side, in whole seconds - so sub-minute base times
   * like 5 seconds are exact. Must be at least 1: there is no "0 base +
   * increment only" time control.
   */
  initialSeconds: number;
  /** Increment added to a player's clock after each of their moves, in seconds. */
  incrementSeconds: number;
}

// Exported so the API boundary (CreateChallengeDto, CreateSeekDto) validates
// against the same bounds this module itself enforces, instead of each DTO
// keeping its own separately-maintained copy of "1 to 10800".
export const MIN_INITIAL_SECONDS = 1;
export const MAX_INITIAL_SECONDS = 180 * 60;
export const MIN_INCREMENT = 0;
export const MAX_INCREMENT = 180;

export function isValidTimeControl(tc: TimeControl): boolean {
  return (
    Number.isInteger(tc.initialSeconds) &&
    Number.isInteger(tc.incrementSeconds) &&
    tc.initialSeconds >= MIN_INITIAL_SECONDS &&
    tc.initialSeconds <= MAX_INITIAL_SECONDS &&
    tc.incrementSeconds >= MIN_INCREMENT &&
    tc.incrementSeconds <= MAX_INCREMENT
  );
}

// How many increments a typical game is assumed to use, for the "estimated
// game duration" formula below - the same assumption Lichess's own
// classifier makes, not a figure specific to this app.
const ASSUMED_INCREMENTS_PER_GAME = 40;

// Estimated-minutes cutoffs between game-type categories - chosen
// specifically so they agree with every one of the cchess app's 16 presets
// (see CLAUDE.md). Each constant is the upper bound of the category named
// before it: below BULLET_MAX, it's bullet; below BLITZ_MAX, blitz; etc.
const BULLET_MAX_ESTIMATED_MINUTES = 3;
const BLITZ_MAX_ESTIMATED_MINUTES = 10;
const RAPID_MAX_ESTIMATED_MINUTES = 25;

/**
 * Classifies a time control the way Lichess does: by "estimated game
 * duration" (base + 40 increments, in minutes), not just the base time.
 * This is what lets arbitrary/custom time controls (not just the app's 16
 * presets) still bucket sensibly for matchmaking and rating categories.
 */
export function classifyTimeControl(tc: TimeControl): GameType {
  const estimatedMinutes =
    (tc.initialSeconds + tc.incrementSeconds * ASSUMED_INCREMENTS_PER_GAME) /
    60;

  if (estimatedMinutes < BULLET_MAX_ESTIMATED_MINUTES) return 'bullet';
  if (estimatedMinutes < BLITZ_MAX_ESTIMATED_MINUTES) return 'blitz';
  if (estimatedMinutes < RAPID_MAX_ESTIMATED_MINUTES) return 'rapid';
  return 'classical';
}

export function toClockMs(tc: TimeControl): number {
  return tc.initialSeconds * 1000;
}

export function incrementMs(tc: TimeControl): number {
  return tc.incrementSeconds * 1000;
}

/** "5+3" - or "15s+0" for a start of under a minute, in seconds. */
export function formatTimeControl(tc: TimeControl): string {
  const base =
    tc.initialSeconds % 60 === 0
      ? `${tc.initialSeconds / 60}`
      : `${tc.initialSeconds}s`;
  return `${base}+${tc.incrementSeconds}`;
}
