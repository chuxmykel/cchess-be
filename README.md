# cchess-be

A real-time chess game server built with NestJS: accounts (including guest
play), profiles, friends, matchmaking, direct challenges, and full rules-
enforced games over REST + Socket.IO. Built as the backend for the
[cchess](../cchess) React Native app - see that repo for the client.

## Tech stack

- NestJS 12 (TypeScript, ESM)
- TypeORM + `better-sqlite3` for now - a drop-in swap to Postgres later (see
  `src/app.module.ts`'s `TypeOrmModule.forRootAsync`)
- `chess.js` 1.4.0 for rules enforcement - the same version the client uses,
  so FEN/SAN never disagree between server and app
- Passport JWT (access + opaque, hashed, rotating refresh tokens)
- Socket.IO (`@nestjs/websockets`) for real-time gameplay
- `@nestjs/swagger` for OpenAPI docs
- Vitest for unit + e2e tests

## Getting started

```bash
nvm use 24        # or any Node >= 22.22 / 24.15+ - see package.json engines
npm install
npm run start:dev
```

The server listens on `:3000` by default. Interactive API docs are served at
`/docs`. Copy `.env.example` to `.env` to override any defaults - none are
required for local dev (insecure defaults are used automatically outside
`NODE_ENV=production`, see `src/config/configuration.ts`).

## Commands

```bash
npm run start:dev     # watch mode
npm run build          # tsc build via `nest build`
npm run lint            # oxlint (type-aware)
npm test                # unit + integration specs (src/**/*.spec.ts)
npm run test:e2e        # full HTTP e2e specs (test/**/*.e2e-spec.ts), in-memory SQLite
npm run test:cov        # coverage
```

Run a single test file: `npx vitest run src/games/games.service.spec.ts`.

## Architecture

Each domain is its own Nest module under `src/`:

```
auth/          Register/login/guest/refresh/logout. Access JWT (short-lived) +
               opaque refresh token (random, stored only as an HMAC hash, rotated
               on every use - see token.util.ts).
users/         Profile CRUD + per-category Elo ratings (bullet/blitz/rapid/classical).
friends/       Friend requests as a single self-referencing table with a status
               (pending/accepted/declined), not a separate "friends" table.
games/         The chess authority: Game/Move entities, GamesService (moves, clocks,
               resign/draw/abort, PGN export), Elo updates on completion.
matchmaking/   An in-memory seek queue (see "Known limitations" below) that pairs
               players wanting the same time control, nearest rating first.
challenges/    Direct user-to-user challenges (accept -> creates a Game).
realtime/      One Socket.IO gateway for everything live: moves, clocks, draw/resign/
               abort, matchmaking pushes, challenge + friend-request notifications.
chess/         Framework-free: time control classification, and ServerChessEngine,
               a thin wrapper over chess.js that is the actual rules authority
               (mirrors the client's own ChessEngine in the cchess app).
```

### How a game is authoritative

`GamesService` is the only place game state is mutated. Every move - whether
it arrived over REST (`POST /games/:id/moves`, mostly useful for testing/bots)
or the realtime gateway (`game:move`) - goes through the same
`GamesService.applyMove`, which:

1. Re-validates the move against `ServerChessEngine` (never trusts the client).
2. Computes elapsed time since the last move and deducts it from the mover's
   clock *before* applying the move, so a move submitted after the flag fell
   is rejected as a time forfeit instead of silently succeeding.
3. Persists the `Move` row and updated `Game` row, then reschedules a
   `setTimeout` flag-fall for whoever's turn it now is.
4. Checks `chess.js` for checkmate/stalemate/insufficient
   material/threefold/fifty-move and finalizes the game if so (including Elo
   updates for rated games).

A per-game `KeyedMutex` (`src/common/keyed-mutex.ts`) serializes all of
`applyMove`/`resign`/`offerDraw`/`respondDraw`/`abort`/the flag-fall timer for
a given game id, so a move landing at the exact instant a clock would have
flagged can't race the timeout handler.

`GamesService` keeps one in-memory `ServerChessEngine` per active game (so
move validation doesn't replay the whole game from scratch); if it's missing
(e.g. after a restart) it's rebuilt by replaying the game's `Move` rows.

### Decoupling via events, not direct calls

`GamesService`, `MatchmakingService`, `ChallengesService`, and
`FriendsService` know nothing about Socket.IO. They emit plain events via
`@nestjs/event-emitter` (`game.created`, `game.move`, `game.ended`,
`challenge.created`, `friend.requestAccepted`, etc.), and `RealtimeGateway`
is the only thing that listens and pushes to the right Socket.IO room
(`game:{id}` for game state, `user:{id}` for personal notifications like "you
got matched" or "you were challenged"). This is what lets e.g. matchmaking
pair two players who are never in the same request: the second player's
HTTP/socket call creates the game and emits `game.created`, which the gateway
pushes to *both* players' personal rooms.

### Time control -> game type

`src/chess/time-control.ts` classifies any `{ minutes, incrementSeconds }`
pair into bullet/blitz/rapid/classical by *estimated game duration*
(`minutes + incrementSeconds * 40 / 60`), the same method Lichess uses - not
a fixed lookup table. This is what makes "any time control", not just the
cchess app's 16 presets, a trivial case: the thresholds (3 / 10 / 25 minutes)
were chosen specifically so they agree with every one of that app's presets
(see `src/chess/time-control.spec.ts`).

### Guests

`POST /auth/guest` creates a real `User` row (`isGuest: true`, no
email/password) and issues a normal token pair - guests are first-class
players through the whole stack, they just never get `Rating` rows and any
game involving one is automatically unrated (`GamesService.createGame`).

## Realtime protocol (Socket.IO)

Connect with the access token in the handshake: `io(url, { auth: { token } })`.
Every connected socket auto-joins a `user:{id}` room for direct pushes.

| Client -> Server | Payload | Server -> Client | Payload |
| --- | --- | --- | --- |
| `game:join` | `{ gameId }` | `game:state` | Full `GameStateDto` |
| `game:move` | `{ gameId, from, to, promotion? }` | `game:move` | `{ gameId, move, fen, turn, whiteTimeRemainingMs, blackTimeRemainingMs }` |
| `game:resign` | `{ gameId }` | `game:over` | Full `GameStateDto` (also sent on checkmate/timeout/draw/abort) |
| `game:abort` | `{ gameId }` | `game:drawOffered` | `{ gameId, by }` |
| `game:drawOffer` | `{ gameId }` | `game:drawDeclined` | `{ gameId }` |
| `game:drawRespond` | `{ gameId, accept }` | `game:created` | Full `GameStateDto` - pushed to both players, e.g. on a matchmaking pair |
| `matchmaking:seek` | `{ minutes, incrementSeconds }` | `game:error` / `matchmaking:error` | `{ message }` (and `{ gameId, message }` for game errors) |
| `matchmaking:cancel` | - | `challenge:received` / `challenge:accepted` / `challenge:resolved` | `ChallengeDto` |
| | | `friend:requestReceived` / `friend:requestAccepted` | `{ id, from? }` |

Disconnecting a socket starts a `GAME_DISCONNECT_GRACE_MS` (default 60s)
countdown per joined game; reconnecting and re-emitting `game:join` before it
elapses cancels it, otherwise the disconnected player forfeits by
abandonment. Disconnecting also cancels any pending matchmaking seek.

## Known limitations (by design, for this phase)

- **SQLite + `synchronize: true`**: fine for a single-process dev/demo
  deployment; swapping to Postgres means also switching to real migrations.
- **In-memory matchmaking queue and per-game clock timers/engine cache**:
  single-process only. A multi-instance deployment needs the seek queue and
  game-ownership moved to a shared store (Redis, or sticky-session + a
  message bus for cross-instance event delivery).
- **No bot opponent** - the client's "Play Stockfish" stub is intentionally
  out of scope for this phase.
- **CORS on the Socket.IO gateway is wide open** (`origin: '*'`) since
  `@WebSocketGateway` options are static decorator metadata evaluated before
  DI is available; lock this down (custom adapter reading `ConfigService`)
  before any non-dev deployment.
