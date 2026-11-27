// Every bar the badges are judged by, in one place to tune. Winning
// chances are a side's, 0 to 100 (lichess's curve).
export const BADGES = {
  // Where a side stands: losing under the first, winning from the second.
  losingBelow: 35,
  winningFrom: 65,
  // Swindle: the game all but lost (below this), and not lost.
  swindleBelow: 10,
  // Never in doubt: never below this after the book, and won.
  neverInDoubtFrom: 50,
  // Rollercoaster: the lead - a side winning - changing hands this often.
  leadChanges: 3,
  // Fortress: a draw this many points of material down.
  fortressDown: 3,
  // Miniature and Marathon: a win in this few, or this many, moves of
  // your own.
  miniatureMoves: 20,
  marathonMoves: 60,
  // Fork frenzy: forks in one game.
  forks: 3,
  // Clean game: no mistake, miss or blunder, this accurate, this long.
  cleanAccuracy: 90,
  cleanMoves: 20,
  // Flawless: not even an inaccuracy, this accurate, this long.
  flawlessAccuracy: 95,
  flawlessMoves: 25,
  // Book worm: moves of your own from the book.
  bookMoves: 12,
  // Photo finish: a win with less than this on the clock.
  photoFinishMs: 5_000,
  // Deep thinker: a think this long that found the best move.
  deepThinkMs: 60_000,
  // Lightning precision: this accurate in a bullet game, this long.
  lightningAccuracy: 85,
  // Giant killer: a win over a player rated this much higher.
  giantKillerGap: 200,
  // The first games-played milestone; each next is ten times it.
  firstGamesMilestone: 10,
  // Rating milestones: each multiple of this.
  ratingStep: 100,
} as const;

// An endgame: little left besides kings and pawns (the app's themes.ts).
export const ENDGAME_MATERIAL = { withoutQueens: 26, withQueens: 13 } as const;
