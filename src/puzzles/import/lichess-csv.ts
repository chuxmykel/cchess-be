// Lichess's puzzle database (https://database.lichess.org, CC0): one CSV
// row a puzzle -
//   PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,
//   GameUrl,OpeningTags[,DailyDate]
// - no field holding a comma: moves, themes and openings are
// space-separated. What the import keeps of it, and which it keeps.

export const LICHESS_PUZZLES_URL =
  'https://database.lichess.org/lichess_db_puzzle.csv.zst';

export type PuzzleRow = {
  id: string;
  fen: string;
  moves: string;
  rating: number;
  ratingDeviation: number;
  popularity: number;
  nbPlays: number;
  themes: string[];
};

/** Which puzzles the pool keeps: well liked and well played, spread over
 * the ratings people play at - capped per band of `band` points, so no band
 * takes the pool. */
export const IMPORT_FILTER = {
  minPopularity: 80,
  minPlays: 500,
  minRating: 600,
  maxRating: 2800,
  band: 100,
} as const;

const ID = /^[a-zA-Z0-9]{1,16}$/;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** A row as a puzzle - or null for the header, or a row that isn't one. */
export function parseRow(line: string): PuzzleRow | null {
  const fields = line.split(',');
  if (fields.length < 8) return null;
  const [id, fen, moves, rating, deviation, popularity, plays, themes] = fields;
  const numbers = [rating, deviation, popularity, plays].map(Number);
  if (!ID.test(id) || numbers.some((n) => !Number.isInteger(n))) return null;
  const moveList = moves.split(' ');
  if (moveList.length < 2 || !moveList.every((m) => UCI.test(m))) return null;
  if (fen.length > 100 || fen.split(' ').length !== 6) return null;
  return {
    id,
    fen,
    moves,
    rating: numbers[0],
    ratingDeviation: numbers[1],
    popularity: numbers[2],
    nbPlays: numbers[3],
    themes: themes.split(' ').filter(Boolean),
  };
}

/** A selector keeping up to `limit` puzzles that pass the filter, spread
 * over the rating bands: each band its even share. */
export function makeSelector(limit: number): (row: PuzzleRow) => boolean {
  const { minPopularity, minPlays, minRating, maxRating, band } = IMPORT_FILTER;
  const bands = Math.ceil((maxRating - minRating) / band);
  const perBand = Math.ceil(limit / bands);
  const kept = new Map<number, number>();
  let total = 0;
  return (row) => {
    if (total >= limit) return false;
    if (row.popularity < minPopularity || row.nbPlays < minPlays) return false;
    if (row.rating < minRating || row.rating >= maxRating) return false;
    const at = Math.floor((row.rating - minRating) / band);
    const count = kept.get(at) ?? 0;
    if (count >= perBand) return false;
    kept.set(at, count + 1);
    total += 1;
    return true;
  };
}
