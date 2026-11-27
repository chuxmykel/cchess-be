// Every badge there is. A game earns the first 25 - from the game itself,
// or its review - and a player's whole history the milestones: each power
// of ten of games finished, and each multiple of 100 a rating first crosses
// going up. The app's domain/badges.ts names and groups them for players.
export const GAME_BADGE_KINDS = [
  // How it went.
  'swindle',
  'comeback',
  'heldDraw',
  'neverInDoubt',
  'rollercoaster',
  'endgameGrind',
  'fortress',
  'miniature',
  'marathon',
  // Brilliance and tactics.
  'brilliancy',
  'sacrifice',
  'queenSacrifice',
  'forkFrenzy',
  'underpromotion',
  // Checkmates.
  'smotheredMate',
  'backRankMate',
  'pawnMate',
  'kingsMarch',
  // Accuracy and preparation.
  'clean',
  'flawless',
  'bookWorm',
  // The clock.
  'photoFinish',
  'deepThinker',
  'lightningPrecision',
  // The opponent.
  'giantKiller',
] as const;

export const MILESTONE_KINDS = ['gamesPlayed', 'ratingReached'] as const;

export const BADGE_KINDS = [...GAME_BADGE_KINDS, ...MILESTONE_KINDS] as const;

export type GameBadgeKind = (typeof GAME_BADGE_KINDS)[number];
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];
export type BadgeKind = (typeof BADGE_KINDS)[number];
