# Architecture

Each domain is its own Nest module under `src/`:

```
auth/          Register/login/guest/refresh/logout. Access JWT (short-lived) +
               opaque refresh token (random, stored only as an HMAC hash, rotated
               on every use - see token.util.ts).
users/         Profile CRUD + per-category Glicko-2 ratings (bullet/blitz/rapid/classical/daily).
friends/       Friend requests as a single self-referencing table with a status
               (pending/accepted/declined), not a separate "friends" table.
profiles/      Another player's profile as you see it (presence, totals, your
               friendship and score with them), their friends, activity, game
               list and rating stats per category.
messages/      Direct messages between friends, with a game or position
               attached if wanted; each person's own read and cleared marks,
               and the inbox built from them.
presence/      Who's connected, from the gateway's user:{id} rooms.
games/         The chess authority: Game/Move entities, GamesService (moves, clocks,
               resign/draw/abort, PGN export), Glicko-2 rating updates on completion,
               and finished games' reviews (GameReviewsService - see features.md, "Game review").
               The PGN is in the standard's export format: the Seven Tag Roster,
               TimeControl in seconds ("300+3"), and each move followed by the
               mover's clock as a { [%clk 0:04:58] } comment.
matchmaking/   An in-memory seek queue (see the README's "Known limitations") that pairs
               players whose time control, rated choice and rating ranges all
               agree, nearest rating first.
daily-seeks/   Daily games' seeks, kept in the database: posted, and left until
               another agrees with it, by the same rules (see features.md, "Daily games").
explorer/      An opening explorer: lichess's Masters and Lichess databases, cached,
               and the games finished here, everyone's or one player's.
challenges/    Challenges to any player (accept -> creates a Game).
realtime/      One Socket.IO gateway for everything live: moves, clocks, draw/resign/
               abort, matchmaking pushes, challenge + friend-request notifications.
chess/         Framework-free: time control classification, and ServerChessEngine,
               a thin wrapper over chess.js that is the actual rules authority
               (mirrors the client's own ChessEngine in the cchess app).
maintenance/   Maintenance before a deploy or reboot: once announced, no new live
               game starts, so the restart comes once the games in progress
               are over (see protocol.md, "Maintenance").
cluster/       Opt-in multi-process sharding (CLUSTER_WORKERS): game ownership,
               forwarding over Node's cluster IPC, Redis-backed broadcast (see
               performance.md, "Horizontal scaling").
database/      The TypeORM data source, migrations and dev/e2e seeders.
common/        Shared pieces: the domain events, a per-key mutex, rate limiting.
config/        Environment configuration, failing fast on missing secrets.
```

## How a game is authoritative

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
flagged can't race the timeout handler. Shutting down (SIGTERM, SIGINT) waits
for the work it holds to finish before the database closes, so a move already
sent to the players is never lost to a deploy.

`GamesService` keeps one in-memory `ServerChessEngine` per active game (so
move validation doesn't replay the whole game from scratch); if it's missing
(e.g. after a restart) it's rebuilt by replaying the game's `Move` rows.

## Decoupling via events, not direct calls

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

## Time control -> game type

`src/chess/time-control.ts` classifies any `{ initialSeconds, incrementSeconds }`
pair into bullet/blitz/rapid/classical by _estimated game duration_
(`(initialSeconds + incrementSeconds * 40) / 60` minutes), the same method Lichess uses - not
a fixed lookup table. This is what makes "any time control", not just the
cchess app's 16 presets, a trivial case: the thresholds (3 / 10 / 25 minutes)
were chosen specifically so they agree with every one of that app's presets
(see `src/chess/time-control.spec.ts`). Both parts are whole seconds - the
starting clock (1 second to 3 hours) as well as the increment - so a
sub-minute start like 5 seconds is exact, and it's stored as an `int`.

A starting clock of whole days with no increment - 1, 2, 3, 5, 7 or 14 -
is a daily game instead, its own category (see features.md, "Daily games"): the days a
move, kept in `initialSeconds` like any other clock, so seeks, challenges
and rematches need nothing more to carry it.

## Guests

`POST /auth/guest` creates a real `User` row (`isGuest: true`, no
email/password) and issues a normal token pair - guests are first-class
players through the whole stack, they just never get `Rating` rows and any
game involving one is automatically unrated (`GamesService.createGame`).
