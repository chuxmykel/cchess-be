/**
 * Standard Elo update with a provisional K-factor for newer players, the
 * same shape used by FIDE/USCF/most online chess servers: new players'
 * ratings move faster until they've played enough games to be trustworthy.
 */

const PROVISIONAL_GAMES_THRESHOLD = 30;
const PROVISIONAL_K = 40;
const ESTABLISHED_K = 20;
// The standard Elo formula's rating-difference divisor - a 400-point gap
// means the stronger player is "expected" to score 10x as often. Distinct
// from matchmaking.service.ts's RATING_WINDOW, which is coincidentally also
// 400 but is a pairing-tolerance figure, not part of this formula.
const ELO_RATING_SCALE = 400;

export type EloScore = 1 | 0.5 | 0;

function kFactor(gamesPlayed: number): number {
  return gamesPlayed < PROVISIONAL_GAMES_THRESHOLD ? PROVISIONAL_K : ESTABLISHED_K;
}

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / ELO_RATING_SCALE));
}

export function computeEloDelta(
  playerRating: number,
  playerGamesPlayed: number,
  opponentRating: number,
  score: EloScore,
): number {
  const expected = expectedScore(playerRating, opponentRating);
  const delta = kFactor(playerGamesPlayed) * (score - expected);
  return Math.round(delta);
}

export interface EloUpdateResult {
  whiteDelta: number;
  blackDelta: number;
}

export function computeGameEloDeltas(params: {
  whiteRating: number;
  whiteGamesPlayed: number;
  blackRating: number;
  blackGamesPlayed: number;
  result: 'white' | 'black' | 'draw';
}): EloUpdateResult {
  const whiteScore: EloScore = params.result === 'white' ? 1 : params.result === 'draw' ? 0.5 : 0;
  const blackScore: EloScore = params.result === 'black' ? 1 : params.result === 'draw' ? 0.5 : 0;

  return {
    whiteDelta: computeEloDelta(params.whiteRating, params.whiteGamesPlayed, params.blackRating, whiteScore),
    blackDelta: computeEloDelta(params.blackRating, params.blackGamesPlayed, params.whiteRating, blackScore),
  };
}
