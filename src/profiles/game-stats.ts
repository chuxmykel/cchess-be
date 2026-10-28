import type { GameType } from '../chess/time-control.js';
import type { Game } from '../games/entities/game.entity.js';
import { GAME_TYPES } from '../users/users.service.js';

export interface Score {
  wins: number;
  draws: number;
  losses: number;
}

export interface ActivityDay extends Score {
  /** The UTC day the games ended, as YYYY-MM-DD. */
  date: string;
  category: GameType;
  games: number;
  /** The rating after the day's last rated game, if any were rated. */
  ratingAfter: number | null;
  ratingDiff: number | null;
}

type ScoredGame = Pick<Game, 'whiteId' | 'blackId' | 'result'>;

type ActivityGame = ScoredGame &
  Pick<
    Game,
    | 'gameType'
    | 'endedAt'
    | 'rated'
    | 'whiteRatingAtStart'
    | 'blackRatingAtStart'
    | 'whiteRatingDiff'
    | 'blackRatingDiff'
  >;

export function outcomeFor(
  game: ScoredGame,
  userId: string,
): keyof Score | null {
  if (game.result === null) return null;
  if (game.result === 'draw') return 'draws';
  const won = (game.result === 'white') === (game.whiteId === userId);
  return won ? 'wins' : 'losses';
}

/** The user's wins, draws and losses across these finished games. */
export function scoreFor(games: ScoredGame[], userId: string): Score {
  const score: Score = { wins: 0, draws: 0, losses: 0 };
  for (const game of games) {
    const outcome = outcomeFor(game, userId);
    if (outcome) score[outcome] += 1;
  }
  return score;
}

/** Finished games grouped by the day they ended and their category,
 * newest day first. */
export function summarizeActivity(
  games: ActivityGame[],
  userId: string,
): ActivityDay[] {
  const days = new Map<string, ActivityDay & { lastEndedAt: number }>();
  for (const game of games) {
    if (!game.endedAt) continue;
    const date = game.endedAt.toISOString().slice(0, 10);
    const key = `${date}:${game.gameType}`;
    const day = days.get(key) ?? {
      date,
      category: game.gameType,
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      ratingAfter: null,
      ratingDiff: null,
      lastEndedAt: 0,
    };
    day.games += 1;
    const outcome = outcomeFor(game, userId);
    if (outcome) day[outcome] += 1;

    const asWhite = game.whiteId === userId;
    const ratingAtStart = asWhite
      ? game.whiteRatingAtStart
      : game.blackRatingAtStart;
    const ratingDiff = asWhite ? game.whiteRatingDiff : game.blackRatingDiff;
    if (game.rated && ratingAtStart !== null && ratingDiff !== null) {
      day.ratingDiff = (day.ratingDiff ?? 0) + ratingDiff;
      if (game.endedAt.getTime() >= day.lastEndedAt) {
        day.ratingAfter = Math.round(ratingAtStart) + ratingDiff;
        day.lastEndedAt = game.endedAt.getTime();
      }
    }
    days.set(key, day);
  }
  return [...days.values()]
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        GAME_TYPES.indexOf(a.category) - GAME_TYPES.indexOf(b.category),
    )
    .map(({ lastEndedAt: _lastEndedAt, ...day }) => day);
}
