// Single source of truth for every event name this app uses, so a typo in
// an emit/listener pair fails as "constant doesn't exist" (a build error)
// instead of "handler silently never fires" (a runtime no-op neither side
// would notice). Two distinct families, never mixed:
//
// - DOMAIN_EVENTS: server-internal only, emitted by domain services via
//   EventEmitter2 (`this.events.emit(...)`) and consumed by
//   RealtimeGateway's own `@OnEvent(...)` listeners. Never touches a
//   socket directly.
// - WS_EVENTS: the Socket.IO wire protocol with the client - inbound
//   (`@SubscribeMessage(...)`) and outbound (`socket.emit`/`server.to(...)
//   .emit(...)`) event names. A handful of names (e.g. GAME_MOVE) are used
//   for both an inbound client request and the outbound broadcast it
//   triggers - same constant either way, which is what keeps the two
//   directions from drifting apart.

export const DOMAIN_EVENTS = {
  GAME_CREATED: 'game.created',
  GAME_MOVE: 'game.move',
  GAME_ENDED: 'game.ended',
  GAME_DRAW_OFFERED: 'game.drawOffered',
  GAME_DRAW_DECLINED: 'game.drawDeclined',
  GAME_CHAT_MESSAGE: 'game.chatMessage',
  CHALLENGE_CREATED: 'challenge.created',
  CHALLENGE_ACCEPTED: 'challenge.accepted',
  CHALLENGE_DECLINED: 'challenge.declined',
  CHALLENGE_CANCELLED: 'challenge.cancelled',
  CHALLENGE_EXPIRED: 'challenge.expired',
  FRIEND_REQUEST_CREATED: 'friend.requestCreated',
  FRIEND_REQUEST_ACCEPTED: 'friend.requestAccepted',
  FRIEND_REQUEST_DECLINED: 'friend.requestDeclined',
  FRIEND_REQUEST_CANCELLED: 'friend.requestCancelled',
  FRIEND_REMOVED: 'friend.removed',
  DIRECT_MESSAGE_SENT: 'directMessage.sent',
} as const;

export const WS_EVENTS = {
  // Inbound: client -> server
  PING: 'ping',
  GAME_JOIN: 'game:join',
  GAME_LEAVE: 'game:leave',
  GAME_MOVE: 'game:move',
  GAME_RESIGN: 'game:resign',
  GAME_ABORT: 'game:abort',
  GAME_DRAW_OFFER: 'game:drawOffer',
  GAME_DRAW_RESPOND: 'game:drawRespond',
  GAME_CHAT: 'game:chat',
  GAME_CHAT_HISTORY: 'game:chatHistory',
  GAME_WATCH: 'game:watch',
  GAME_UNWATCH: 'game:unwatch',
  MATCHMAKING_SEEK: 'matchmaking:seek',
  MATCHMAKING_CANCEL: 'matchmaking:cancel',

  // Outbound: server -> client
  GAME_STATE: 'game:state',
  GAME_ERROR: 'game:error',
  GAME_CREATED: 'game:created',
  GAME_OVER: 'game:over',
  GAME_DRAW_OFFERED: 'game:drawOffered',
  GAME_DRAW_DECLINED: 'game:drawDeclined',
  MATCHMAKING_ERROR: 'matchmaking:error',
  LOBBY_STATS: 'lobby:stats',
  GAME_PRESENCE: 'game:presence',
  CHALLENGE_RECEIVED: 'challenge:received',
  CHALLENGE_ACCEPTED: 'challenge:accepted',
  CHALLENGE_RESOLVED: 'challenge:resolved',
  FRIEND_REQUEST_RECEIVED: 'friend:requestReceived',
  FRIEND_REQUEST_ACCEPTED: 'friend:requestAccepted',
  FRIEND_REQUEST_RESOLVED: 'friend:requestResolved',
  FRIEND_REMOVED: 'friend:removed',
  FRIEND_STATUS: 'friend:status',
  DIRECT_MESSAGE: 'dm:message',
} as const;
