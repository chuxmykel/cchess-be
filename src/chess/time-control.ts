export type GameType = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'daily';

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

export const SECONDS_PER_DAY = 24 * 60 * 60;

/** The days a daily game gives each move - chess.com's. A daily time
 * control is one of these in initialSeconds, as whole days, with no
 * increment: each move resets the mover's clock to it rather than adding
 * to it (see GamesService.playMove), so the time never builds up. */
export const DAILY_DAYS = [1, 2, 3, 5, 7, 14] as const;

/** The largest starting clock a time control may have - a daily one's. */
export const MAX_DAILY_SECONDS =
  DAILY_DAYS[DAILY_DAYS.length - 1] * SECONDS_PER_DAY;

export function isDailyTimeControl(tc: TimeControl): boolean {
  return tc.initialSeconds >= SECONDS_PER_DAY;
}

/** A daily time control's days per move. */
export function daysPerMove(tc: TimeControl): number {
  return tc.initialSeconds / SECONDS_PER_DAY;
}

export function isValidTimeControl(tc: TimeControl): boolean {
  if (isDailyTimeControl(tc)) {
    return (
      tc.incrementSeconds === 0 &&
      (DAILY_DAYS as readonly number[]).includes(daysPerMove(tc))
    );
  }
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
  if (isDailyTimeControl(tc)) return 'daily';
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

/** "5+3" - or "15s+0" for a start of under a minute, in seconds, or
 * "3 days" for a daily one. */
export function formatTimeControl(tc: TimeControl): string {
  if (isDailyTimeControl(tc)) {
    const days = daysPerMove(tc);
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  const base =
    tc.initialSeconds % 60 === 0
      ? `${tc.initialSeconds / 60}`
      : `${tc.initialSeconds}s`;
  return `${base}+${tc.incrementSeconds}`;
}
