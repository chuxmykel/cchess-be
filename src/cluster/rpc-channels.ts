// Single source of truth for ClusterBus RPC channel names - each one is used
// twice (the owning service's `onRequest` registration and every other
// worker's `request()` call site), so a typo in either place fails as
// "handler doesn't exist" (a build error) instead of a silent timeout. See
// cluster-bus.ts for the request/response mechanics these name.

export const GAMES_RPC = {
  CREATE: 'games:create',
  APPLY_MOVE: 'games:applyMove',
  RESIGN: 'games:resign',
  ABORT: 'games:abort',
  OFFER_DRAW: 'games:offerDraw',
  RESPOND_DRAW: 'games:respondDraw',
  FORFEIT_BY_ABANDONMENT: 'games:forfeitByAbandonment',
  GET_WITH_MOVES: 'games:getWithMoves',
} as const;

export const MM_RPC = {
  SEEK: 'mm:seek',
  CANCEL: 'mm:cancel',
  STATUS: 'mm:status',
} as const;
