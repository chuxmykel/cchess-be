# cchess-be

A real-time chess game server built with NestJS: accounts (including guest
play), profiles, friends, matchmaking, direct challenges, and full rules-
enforced games over REST + Socket.IO. Built as the backend for the
[cchess](../cchess) React Native app - see that repo for the client.

## Tech stack

- NestJS 12 (TypeScript, ESM)
- TypeORM + Postgres, schema managed by real migrations (`src/database/migrations`)
  - (`better-sqlite3` is still a dependency for a planned dev-mode toggle -
    Postgres in prod, SQLite for quick local dev/testing - not yet wired up)
- `chess.js` 1.4.0 for rules enforcement - the same version the client uses,
  so FEN/SAN never disagree between server and app
- Passport JWT (access + opaque, hashed, rotating refresh tokens)
- Socket.IO (`@nestjs/websockets`) for real-time gameplay
- `@nestjs/swagger` for OpenAPI docs
- Vitest for unit + e2e tests
- Redis - only used for cross-worker Socket.IO broadcast under optional
  multi-process sharding (`CLUSTER_WORKERS`, see `src/cluster/`); a normal
  single-process boot never touches it

## Getting started

```bash
nvm use 24        # or any Node >= 22.22 / 24.15+ - see package.json engines
npm install
```

Needs a local Postgres (one-time setup - adjust names/password to taste,
just keep them in sync with what you put in `.env` below):

```bash
createuser cchess --login --pwprompt    # or: CREATE ROLE cchess WITH LOGIN PASSWORD '...';
createdb cchess_be --owner=cchess
createdb cchess_be_test --owner=cchess  # used by the test suite, kept separate from dev data
```

Copy `.env.example` to `.env` and fill in the Postgres connection (matching
the `createuser`/`createdb` commands above) and a JWT secret pair (any long
random string works for local dev) - these have no built-in default and the
app fails fast at boot if they're missing (see `src/config/configuration.ts`).
Fill in the `TEST_DB_*` vars too - the test suite reads its own, separate
connection (same role, pointed at `cchess_be_test`, unless you want it
somewhere else entirely, e.g. a different host in CI) rather than sharing
`DB_*` with the dev database, so tests never run against dev data by
accident. Everything else in `.env.example` is optional and has a sane
default.

Then apply the schema and start the server:

```bash
npm run migration:run   # builds, then applies any pending migrations
npm run start:dev       # watch mode
```

The server listens on `:3000` by default. Interactive API docs are served at
`/docs`.

## Commands

```bash
npm run start:dev          # watch mode
npm run build               # tsc build via `nest build`
npm run lint                 # oxlint (type-aware)
npm test                     # unit + integration specs (src/**/*.spec.ts), against Postgres
npm run test:e2e             # full HTTP e2e specs (test/**/*.e2e-spec.ts), against Postgres
npm run test:cov             # coverage

npm run migration:generate -- src/database/migrations/SomeName   # after changing an entity
npm run migration:run        # apply pending migrations
npm run migration:revert     # roll back the last migration
```

Run a single test file: `npx vitest run src/games/games.service.spec.ts`.

Tests run against the real `cchess_be_test` database (not SQLite `:memory:`
or mocks) - each test app boot truncates every table first
(`test/utils/db.ts`), so tests are isolated from each other but share that
one database; don't point `DB_NAME` at your dev database when testing.

## Architecture

Each domain is its own Nest module under `src/`:

```
auth/          Register/login/guest/refresh/logout. Access JWT (short-lived) +
               opaque refresh token (random, stored only as an HMAC hash, rotated
               on every use - see token.util.ts).
users/         Profile CRUD + per-category Glicko-2 ratings (bullet/blitz/rapid/classical).
friends/       Friend requests as a single self-referencing table with a status
               (pending/accepted/declined), not a separate "friends" table.
profiles/      Another player's profile as you see it (presence, totals, your
               friendship and score with them), their friends, activity, game
               list and rating stats per category.
messages/      Direct messages between friends; each person's own read and
               cleared marks.
presence/      Who's connected, from the gateway's user:{id} rooms.
games/         The chess authority: Game/Move entities, GamesService (moves, clocks,
               resign/draw/abort, PGN export), Glicko-2 rating updates on completion.
               The PGN is in the standard's export format: the Seven Tag Roster,
               TimeControl in seconds ("300+3"), and each move followed by the
               mover's clock as a { [%clk 0:04:58] } comment.
matchmaking/   An in-memory seek queue (see "Known limitations" below) that pairs
               players whose time control, rated choice and rating ranges all
               agree, nearest rating first.
challenges/    Challenges to any player (accept -> creates a Game).
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
   clock _before_ applying the move, so a move submitted after the flag fell
   is rejected as a time forfeit instead of silently succeeding.
3. Persists the `Move` row and updated `Game` row, then reschedules a
   `setTimeout` flag-fall for whoever's turn it now is.
4. Checks `chess.js` for checkmate/stalemate/insufficient
   material/threefold/fifty-move and finalizes the game if so (including
   Glicko-2 rating updates for rated games, recorded on the game row as each player's
   rating change alongside the ratings they started with).

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
pushes to _both_ players' personal rooms.

### Time control -> game type

`src/chess/time-control.ts` classifies any `{ initialSeconds, incrementSeconds }`
pair into bullet/blitz/rapid/classical by _estimated game duration_
(`(initialSeconds + incrementSeconds * 40) / 60` minutes), the same method Lichess uses - not
a fixed lookup table. This is what makes "any time control", not just the
cchess app's 16 presets, a trivial case: the thresholds (3 / 10 / 25 minutes)
were chosen specifically so they agree with every one of that app's presets
(see `src/chess/time-control.spec.ts`). Both parts are whole seconds - the
starting clock (1 second to 3 hours) as well as the increment - so a
sub-minute start like 5 seconds is exact, and it's stored as an `int`.

### Guests

`POST /auth/guest` creates a real `User` row (`isGuest: true`, no
email/password) and issues a normal token pair - guests are first-class
players through the whole stack, they just never get `Rating` rows and any
game involving one is automatically unrated (`GamesService.createGame`).

## Realtime protocol (Socket.IO)

Connect with the access token in the handshake: `io(url, { auth: { token } })`.
Every connected socket auto-joins a `user:{id}` room for direct pushes - this
is also where `game:*` events are sent (not a separate per-game room), so a
client may receive a game's moves before it has itself emitted `game:join`
for that particular game; track the server's own `move.ply` idempotently
rather than counting received events.

The gateway's own CORS is wide open (`origin: '*', credentials: false` -
see `realtime.gateway.ts`), unlike REST's configurable origin - intentional,
not an oversight: `@WebSocketGateway` options are static decorator metadata
evaluated before DI exists, so it can't read `ConfigService` the way REST's
CORS does, but that's fine here specifically because auth travels in the
handshake's own `auth.token` payload above, never a cookie - there's no
ambient credential for a cross-origin page to ride on, so there's nothing
an origin restriction would protect. This stops being true the moment any
client authenticates via a cookie instead (e.g. a future browser client) -
revisit `origin`/`credentials` together if that ever happens.

| Client -> Server      | Payload                                                      | Server -> Client                                                   | Payload                                                                                      |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `game:join`           | `{ gameId }`                                                 | `game:state`                                                       | Full `GameStateDto`                                                                          |
| `game:move`           | `{ gameId, from, to, promotion? }`                           | `game:move`                                                        | `{ gameId, move, fen, turn, whiteTimeRemainingMs, blackTimeRemainingMs, firstMoveDeadline }` |
| `game:resign`         | `{ gameId }`                                                 | `game:over`                                                        | Full `GameStateDto` (also sent on checkmate/timeout/draw/abort)                              |
| `game:abort`          | `{ gameId }`                                                 | `game:drawOffered`                                                 | `{ gameId, by }`                                                                             |
| `game:drawOffer`      | `{ gameId }`                                                 | `game:drawDeclined`                                                | `{ gameId }`                                                                                 |
| `game:drawRespond`    | `{ gameId, accept }`                                         | `game:created`                                                     | Full `GameStateDto` - pushed to both players, e.g. on a matchmaking pair                     |
| `matchmaking:seek`    | `{ initialSeconds, incrementSeconds, rated?, ratingRange? }` | `game:error` / `matchmaking:error`                                 | `{ message }` (and `{ gameId, message }` for game errors)                                    |
| `matchmaking:cancel`  | -                                                            | `challenge:received` / `challenge:accepted` / `challenge:resolved` | `ChallengeDto`                                                                               |
| `game:leave`          | `{ gameId }`                                                 | `friend:requestReceived`                                           | `FriendRequestDto` - the requester, described like a friend                                  |
| `game:watch`          | `{ gameId }`                                                 | `friend:requestAccepted` / `friend:requestResolved`                | `{ id }` - accepted, or declined/cancelled, to both sides                                    |
| `game:unwatch`        | `{ gameId }`                                                 | `friend:removed`                                                   | `{ userIds }` - the two former friends                                                       |
| -                     | -                                                            | `friend:status`                                                    | `{ userId, online, playingGameId }` - to the user's friends                                  |
| -                     | -                                                            | `dm:message`                                                       | `{ id, senderId, recipientId, text, createdAt }` - to both people                            |
| `game:chat`           | `{ gameId, text }`                                           | `game:chat`                                                        | `{ id, gameId, userId, kind, text, createdAt }` - to both players                            |
| `game:chatHistory`    | `{ gameId }`                                                 | `game:chatHistory`                                                 | `{ gameId, messages, readAt }` - to the player who asked                                     |
| `game:chatRead`       | `{ gameId }`                                                 | -                                                                  | -                                                                                            |
| -                     | -                                                            | `game:presence`                                                    | `{ gameId, userId, online }`                                                                 |
| -                     | -                                                            | `lobby:stats`                                                      | `{ playersOnline, gamesInPlay }`                                                             |
| `game:rematchOffer`   | `{ gameId }`                                                 | `game:rematchOffered`                                              | `{ gameId, by }` - to both players                                                           |
| `game:rematchDecline` | `{ gameId }`                                                 | `game:rematchDeclined`                                             | `{ gameId, by }` - declined, or withdrawn by the offerer                                     |

A seek (here or `POST /matchmaking/seek`) is rated unless `rated: false`;
guests' seeks are always casual. `ratingRange: { below, above }` (whole
numbers from 0 to 1000) limits opponents to that far below and above your
rating in the time control's category, and both players' ranges must hold.
A `null` side has no limit; leave the whole range out to accept any rating.
Guests have no rating, so ranges don't apply to them.

Nobody plays two games at once. While you have a game in progress,
seeking (`matchmaking:error`, or 409 from `POST /matchmaking/seek`),
sending a challenge and accepting one all fail with "Finish your game in
progress first", and accepting a challenge from someone who's since
started a game fails with "<name> is in the middle of a game" (both
`GamesService.assertNotPlaying`).

While a seek waits, its socket gets `lobby:stats` straight away and then
every 5 seconds: `playersOnline` counts users with a connected socket and
`gamesInPlay` counts active games. Under clustering, worker 0 sends them.

Once a game is over, either player can send `game:rematchOffer`; when the
other has offered too, the rematch starts - same time control and rated
choice, colors swapped - and arrives like any new game, as `game:created`,
its `rematchOfId` naming the game it follows. `game:rematchDecline` turns
down the opponent's offer or withdraws your own. A rematch of a game still
in play or aborted, by someone who didn't play in it, or by a player now in
another game is refused with `game:error`. `GameStateDto.series` keeps a rematch
series' score - each side's points, a draw counting half, this game
included once it's over - and is `null` outside a series; the rows store
the score going into each game (`seriesWhitePoints`/`seriesBlackPoints`).
Two players paired any other way - a seek or a challenge - carry their
series on too, when each one's last finished game was against the other,
at the same time control, just as rated, and ended within the hour
(`seriesContinuedBy` in `src/games/rematch-series.ts`). Playing anyone
else in between ends the series; aborted games are ignored. The points
follow each player whichever colors they get, and the game it follows has
its `rematchGameId` set, as an offered rematch does.

Resigning and offering a draw wait until both sides have played a move -
before that the game can only be aborted - and come back as `game:error`
"Too early to resign/offer a draw - abort the game instead".

Neither clock runs until both sides have played a move. Until then the side
to move has `GAME_FIRST_MOVE_TIMEOUT_MS` (default 30s) to play its first
move - from the start of the game for white, from white's first move for
black - or the game is aborted. `firstMoveDeadline` (in `GameStateDto` and
the `game:move` push) says when, and is `null` once both sides have moved.

Joining a game sends the joiner a `game:presence` for their opponent
(connected or not) and tells the opponent the joiner is online; a player
whose last socket disconnects is reported offline to their opponents.

Chat is between a game's two players only. A message is trimmed and must be
1-140 characters, and each player can send at most 5 per 10 seconds; a
rejected one comes back as `game:error`. Messages are kept, and
`game:chatHistory` returns them oldest first. Each has a `kind`: `message`
for a player's words, or `draw-offered`, `draw-declined` or
`draw-accepted` - notes the server adds itself, with empty text and
`userId` naming who did it, so a draw's story stays in the history.
`game:chatRead` marks the chat read up to now for the player who sends it
(kept in `game_chat_reads`, apart from the cached `games` row), and
`game:chatHistory` includes their `readAt` (`null` if they never have),
for counting what's unread.

Chat stays open for `GAME_CHAT_WINDOW_MS` (default 14 days) after a game
ends; after that a message gets `game:error` "Chat closed". `chatClosesAt`
in `GameStateDto` says when (`null` while the game is on).

Any user can bookmark any game: `GET`, `PUT` and `DELETE
/games/:id/bookmark` each answer `{ bookmarked }`.

`game:watch` lets anyone follow a game they aren't playing: it answers
with `game:state` and then sends that socket the game's `game:move` and
`game:over` pushes, without presence or abandonment bookkeeping.
`game:unwatch` stops them.

### Friends, challenges and messages

`GET /friends` describes each friend with their ratings, whether they're
`online`, and `playingGameId` while they're in a game; the `friend:status`
push keeps that current - on a user's first connect and last disconnect,
and when their games start or end. Only one friendship or request can be
live between two users.

Anyone can challenge any player, friend or not. `POST /challenges` takes
`{ opponentUsername, initialSeconds, incrementSeconds, color?, rated? }` (rated
unless `rated: false`), replaces any pending challenge to the same player,
and expires after `CHALLENGE_TTL_MS` (default 2 minutes; `expiresAt` in
`ChallengeDto`). Expiry is pushed as `challenge:resolved` with status
`expired`, and accepting an expired one fails.

`GET /users/:username` is a player's profile as the caller sees it: ratings,
`lastSeenAt`/`online`/`playingGameId`, `gamesPlayed` and `timePlayedMs` over
finished games, `friendsCount`, `friendship: { status, requestId }` (`self`, `none`,
`friends`, or a pending `outgoing`/`incoming` request) and `score` - the
caller's wins, draws and losses against them (`null` on their own).
`GET /users/:username/friends` lists their friends, the most recently added
first, as `/friends` describes yours (presence, ratings) plus `friendsSince`.
`GET /users/:username/activity` groups their last 30 days of finished games
by UTC day and category, and `GET /users/:username/games` lists their games
like `GET /games` does yours (`limit`, `before`). Both leave out aborted
games unless asked for them with `status=aborted`.
`GET /users/:username/ratings/:category?period=` sums up one category over
`1w`, `1m` (the default), `3m`, `1y` or `all`: the rating now; its
`history` (the rating going into the period's first rated game, then after
each UTC day's closing rating - thinned to at most 1,000 points beyond
that, keeping each stretch's lowest and highest); the `highest` and `lowest` of those, and `ratingChange` from the
first to the last; and, over every finished game in the category, rated or
casual, the games, wins, draws and losses, `timePlayedMs`, and the longest
win and losing streaks. `bestWin` and `worstLoss` are the rated win over the
highest-rated opponent and the rated loss to the lowest-rated one.
`GET /users?search=<term>&limit=&offset=` finds registered players (never
guests, never the caller) whose username or display name contains the term,
any case: an exact username first, then names starting with it, then the
rest, by username (`limit` 1-20, default 10; `offset` skips that many, for
the next page).

Direct messages are between friends: `POST /messages/:username { text }`
(1-500 characters after trimming, at most 10 per 10 seconds), and
`GET /messages/:username` (newest first, `limit`/`before`) for the history.
`POST /messages/:username/read` marks them read, `GET /messages/unread`
counts unread messages by sender, and `DELETE /messages/:username` clears
the history for the caller only.

`ping` isn't part of the broadcast protocol above - it's a plain Socket.IO
acknowledgement (payload: the client's own timestamp as a number), echoed
straight back as the ack value for round-trip latency measurement, not a
separate emit.

Disconnecting a socket starts a `GAME_DISCONNECT_GRACE_MS` (default 60s)
countdown per joined game; reconnecting and re-emitting `game:join` before it
elapses cancels it, otherwise the disconnected player forfeits by
abandonment. Disconnecting also cancels any pending matchmaking seek.

## Performance notes

`GamesService`'s move-application path (`applyMove`) is written to minimize
per-move DB cost, since it's the one thing called far more often than
anything else in the system:

- It never loads the `white`/`black` relations (`getGameOrThrow` is a plain,
  relation-free lookup) - nothing on the move/clock/resign/draw/abort path
  actually needs the joined `User` rows, only the plain `whiteId`/`blackId`
  columns. The handful of callers that do need player profiles
  (`getGameWithMoves`, used for display and PGN export) do their own
  relation-loaded fetch instead.
- The `Move` insert and the `Game` update for a single move are one
  transaction, not two separate commits, written as raw parameterized SQL
  rather than `manager.save()`/`QueryBuilder` - profiling under load found
  the query builder's per-call regex SQL templating was the single
  largest CPU cost on this path, bigger than chess.js's own move
  validation. Both statements are fixed shape, so there's nothing a query
  builder buys per call.
- `ServerChessEngine.attemptMove` resolves checkmate/stalemate/draw
  detection itself instead of a separate post-hoc call - chess.js's
  `isCheckmate()`/`isStalemate()` each independently regenerate the full
  legal-move list (its most expensive operation), so a second call after
  `attemptMove` already computed the same thing doubled that cost for free.
- Finalizing a game reuses the in-memory cache of its moves (with their
  clocks) for the PGN instead of re-querying every `Move` row - unless a
  restart left the cache short of the engine's history.

These were found and measured via `scripts/load-test/load-test.mjs` (see its own
comments for usage) - a harness that boots the real server and plays many
real games end-to-end over Socket.IO, timing each phase and sampling server
RSS. Moving off synchronous SQLite onto Postgres (this server's current
state) was the biggest lever of all: `better-sqlite3` blocked the entire
event loop for every read/write, so one game's DB call stalled every other
game's processing too, regardless of how unrelated they were; Postgres's
async driver lets the event loop interleave many games' work during I/O wait
instead.

Per-move _latency_ (not just aggregate throughput) was the more important
number once concurrency got high: both SQLite and Postgres degrade roughly
linearly as concurrent games increase, because every game's move logic runs
on the one Node event loop regardless of DB backend - a few hundred
concurrent games already pushes median move latency well past what's
tolerable for bullet chess, long before either DB "falls over" in the
throughput sense. That's what `src/cluster/` (below) addresses.

### Horizontal scaling (`src/cluster/`, opt-in)

Set `CLUSTER_WORKERS` to shard `GamesService`'s per-move work across
multiple Node processes instead of one - see the Architecture notes in
CLAUDE.md for how game ownership, forwarding, and cross-worker broadcast
work. Needs Redis running (`REDIS_HOST`/`REDIS_PORT`) only when
`CLUSTER_WORKERS > 1`; a normal single-process boot (the default) never
touches it.

**Don't just set this to the core count.** Load testing at several
concurrency levels (100/500/1000 simultaneous bullet games) on a 10-core
machine found `CLUSTER_WORKERS=4` to be the latency sweet spot - both
median and tail (p95/p99) latency got _worse_ past 4 workers, not just
flatter, as cross-worker coordination overhead (the cluster-bus IPC relay,
the Redis pub/sub hop) grew faster than the extra parallelism was worth.
This held up whether those workers ran in one process or were split
across several - total worker count was the variable that mattered, not
how many processes it was divided into. Benchmark this per deployment
(`scripts/load-test/load-test.mjs` with `CLUSTER_WORKERS` set to a few candidate
values) rather than assuming a higher number is free.

### CPU cores, not just code, set the real ceiling

After the move-path optimizations above, 500 concurrent bullet games holds
p99 move latency around 150ms on a 10-core machine at `CLUSTER_WORKERS=4`.
The identical code, same optimizations, same Postgres/Redis, running on a
2-core machine at `CLUSTER_WORKERS=2` tops out around 100-150 concurrent
games for the same latency target - past that it degrades sharply (and with
high run-to-run variance, the signature of a box near its saturation
point), because chess.js's legal-move generation genuinely has a per-move
CPU floor that only more cores - not more code changes - can buy more of.
Don't assume a latency regression on smaller hardware is a logic bug;
check core count and `CLUSTER_WORKERS` first.

`DB_POOL_SIZE` (env var) overrides the `CLUSTER_WORKERS`-derived pool size
formula outright - matters when Postgres is on a separate host from the
app with its own `max_connections` headroom to spend; the formula's own
default is conservative because it assumes they're colocated.

## Known limitations (by design, for this phase)

- **Matchmaking's seek queue is pinned to worker 0 under clustering**
  (not fully distributed) - fine, since matching is cheap and infrequent
  relative to per-move traffic, but still a single point for that one
  operation. A truly multi-_machine_ deployment (not just multi-process on
  one box) would need it in a shared store (e.g. Redis) instead.
- **No bot opponent** - the client's "Play Stockfish" stub is intentionally
  out of scope for this phase.
