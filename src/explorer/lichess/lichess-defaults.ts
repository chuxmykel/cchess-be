import type {
  LichessFilters,
  LichessRating,
  LichessSpeed,
} from './lichess-explorer.client.js';

/** The Lichess database's filters as lichess's own explorer starts - the
 * only ones kept in the cache; any others are asked of lichess each time. */
export const DEFAULT_LICHESS_FILTERS: LichessFilters = {
  speeds: ['blitz', 'rapid', 'classical'],
  ratings: [1600, 1800, 2000, 2200, 2500],
};

/** The filters asked for, in a set order, the defaults for any left out. */
export function normalizeFilters(filters: {
  speeds?: LichessSpeed[];
  ratings?: LichessRating[];
}): LichessFilters {
  return {
    speeds: [
      ...new Set(filters.speeds ?? DEFAULT_LICHESS_FILTERS.speeds),
    ].sort(),
    ratings: [
      ...new Set(filters.ratings ?? DEFAULT_LICHESS_FILTERS.ratings),
    ].sort((a, b) => a - b),
  };
}

export function isDefaultFilters(filters: LichessFilters): boolean {
  const defaults = normalizeFilters(DEFAULT_LICHESS_FILTERS);
  const given = normalizeFilters(filters);
  return (
    given.speeds.join(',') === defaults.speeds.join(',') &&
    given.ratings.join(',') === defaults.ratings.join(',')
  );
}
