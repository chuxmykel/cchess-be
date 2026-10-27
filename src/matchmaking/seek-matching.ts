import type { TimeControl } from '../chess/time-control.js';

export const MAX_RATING_RANGE_DELTA = 1000;

/** How far below and above the seeker's own rating an opponent may be;
 * a null side has no limit. */
export interface RatingRange {
  below: number | null;
  above: number | null;
}

export interface SeekRequest extends TimeControl {
  rated?: boolean;
  ratingRange?: RatingRange;
}

export interface SeekCriteria extends TimeControl {
  userId: string;
  rated: boolean;
  /** Null for guests, who have no rating. */
  rating: number | null;
  /** Null when any opponent's rating is acceptable. */
  ratingRange: RatingRange | null;
}

function isValidDelta(delta: unknown): boolean {
  if (delta === null || delta === undefined) return true;
  return (
    Number.isInteger(delta) &&
    (delta as number) >= 0 &&
    (delta as number) <= MAX_RATING_RANGE_DELTA
  );
}

export function isValidRatingRange(range: RatingRange): boolean {
  return isValidDelta(range.below) && isValidDelta(range.above);
}

function acceptsRating(seek: SeekCriteria, rating: number | null): boolean {
  if (seek.ratingRange === null || seek.rating === null || rating === null) {
    return true;
  }
  const { below, above } = seek.ratingRange;
  return (
    (below == null || rating >= seek.rating - below) &&
    (above == null || rating <= seek.rating + above)
  );
}

export function canPair(first: SeekCriteria, second: SeekCriteria): boolean {
  return (
    first.userId !== second.userId &&
    first.minutes === second.minutes &&
    first.incrementSeconds === second.incrementSeconds &&
    first.rated === second.rated &&
    acceptsRating(first, second.rating) &&
    acceptsRating(second, first.rating)
  );
}

function ratingGap(first: SeekCriteria, second: SeekCriteria): number {
  return first.rating === null || second.rating === null
    ? 0
    : Math.abs(first.rating - second.rating);
}

/** The waiting seek closest in rating to the seeker's, among those that pair
 * with it; the earliest one wins a tie. */
export function findBestOpponent<TSeek extends SeekCriteria>(
  seeker: SeekCriteria,
  waitingSeeks: Iterable<TSeek>,
): TSeek | undefined {
  let best: TSeek | undefined;
  for (const waiting of waitingSeeks) {
    if (!canPair(seeker, waiting)) continue;
    if (!best || ratingGap(seeker, waiting) < ratingGap(seeker, best)) {
      best = waiting;
    }
  }
  return best;
}
