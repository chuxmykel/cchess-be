# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A real-time chess game server built with NestJS 12 (TypeScript, ESM): auth
(including guest accounts), user profiles with per-category Elo ratings,
friends, matchmaking, direct challenges, and fully rules-enforced games
(`chess.js` 1.4.0 - same version as the client) served over REST and a
Socket.IO gateway. It's the backend for the React Native app at
`../cchess` - see that repo's own CLAUDE.md for the client side.

Postgres via TypeORM, schema managed by real migrations
(`src/database/migrations`, `synchronize: false`) - see "Getting started" in
README for local role/database setup. `better-sqlite3` is still a dependency
for a planned dev-mode toggle (Postgres in prod, SQLite for quick local
dev/testing) that isn't wired up yet - don't assume it's dead weight to
delete, but don't assume anything currently uses it either.

Optional multi-process sharding across CPU cores (`src/cluster/`,
`CLUSTER_WORKERS` env var, off by default) - see Architecture below and
`scripts/load-test/load-test.mjs`'s own comments for how to exercise it.

## Commands

```bash
nvm use                  # Node 24.15.0 pinned in .nvmrc - this is independent of
                          # the frontend's Node 22 pin, not a typo
npm install

npm run start:dev        # watch mode, :3000, docs at /docs (Swagger)
npm run build             # tsc build via `nest build`

npm test                  # unit/integration specs: src/**/*.spec.ts
npx vitest run src/games/games.service.spec.ts   # a single file
npx vitest run -t "name of test or describe"      # filter by name

npm run test:e2e          # full HTTP e2e specs: test/**/*.e2e-spec.ts
                          # (real Postgres - cchess_be_test, see vitest.config.e2e.ts)
npm run test:cov          # coverage

npm run lint               # oxlint --type-aware src/ test/
npm run format             # prettier --write

npm run migration:generate -- src/database/migrations/SomeName  # after an entity change
npm run migration:run      # build + apply pending migrations
npm run migration:revert   # build + roll back the last migration
```

The migration scripts run `node --env-file=.env node_modules/typeorm/cli.js
migration:x -d dist/database/data-source.js` directly against the compiled
CLI entry point, not through the `typeorm` bin - Node's `--env-file` can't
be passed via `NODE_OPTIONS`
(`process.allowedNodeEnvironmentFlags.has('--env-file')` is `false`), so it
has to go straight to the `node` invocation, which means resolving past the
bin's shebang wrapper to `node_modules/typeorm/cli.js` itself. They also
avoid `typeorm-ts-node-esm`, which needs `ts-node` - a dependency this
project deliberately doesn't have (it's `nest build` + `node dist/...`
everywhere else). This means `migration:generate` only sees changes that
have been built - already wired to `npm run build &&` for that reason, but
keep it in mind if you ever invoke the CLI yourself.

`data-source.ts` (the CLI's own `DataSource`, outside Nest's DI) has no
fallback env defaults - `requireEnv()` (`src/common/require-env.ts`) throws
if `.env` is missing any connection var, rather than silently migrating
against a guessed-at database. Its `entities` option is also a glob
(`dist/**/*.entity.js`) instead of a manually maintained class list - safe
here specifically because this file only ever runs against freshly-built
`dist/` (via the `build &&` above). `app.module.ts` keeps an explicit class
list instead: it's also loaded straight from `src/*.ts` by the e2e suite,
and a glob there does a raw Node `import()` that bypasses vitest's TS
transform and breaks on non-compiled files.

There's no `lint:fix` - oxlint's type-aware mode here is check-only; fix
flagged issues by hand.

## Architecture

Each domain is its own Nest module under `src/`. Read `README.md` first -
it covers the move/clock authority model (`GamesService.applyMove`), the
event-emitter decoupling between services and `RealtimeGateway`, the
time-control classification scheme, and the full Socket.IO protocol table.
The notes below are things a future change is likely to trip over that
aren't obvious from reading one file in isolation.

- **`src/chess/`** is framework- and Nest-free on purpose (no `@Injectable`,
  no DI) - `ServerChessEngine` and `time-control.ts` are plain, directly
  Vitest-testable modules, mirroring how `../cchess`'s own `ChessEngine.ts`
  is kept domain-pure. Don't let Nest/TypeORM concepts leak in here.
- **`GamesService` is the single source of truth for game state.** Every
  move, whether it came in over REST (`POST /games/:id/moves`) or the
  gateway (`game:move`), goes through `GamesService.applyMove` - never
  mutate a `Game`/`Move` row anywhere else.
- **Relation properties on entities must be typed `Relation<T>`** (from
  `typeorm`), not the bare class, e.g. `white!: Relation<User>;`. This repo
  is ESM, and TypeScript's `emitDecoratorMetadata` otherwise emits the raw
  class reference as `design:type`, which throws `ReferenceError: Cannot
access 'X' before initialization` at runtime for any circular entity
  pair (`Game` <-> `Move` is the one that actually cycles today, but every
  entity relation here uses `Relation<T>` defensively). If you add a new
  `@ManyToOne`/`@OneToOne` and skip this, it may work in this module but
  break the moment something imports it circularly - just always do it.
- **All relative imports need an explicit `.js` extension** (e.g. `from
'./games.service.js'` even though the file is `games.service.ts`) - this
  is a `"module": "nodenext"` ESM project, not the usual Nest CommonJS
  setup. `tsc` will fail loudly if you forget.
- **TypeORM `relations` options take the object form**, not a string array
  - `relations: { white: true, black: true }`, not `['white', 'black']`.
    This version of TypeORM (1.x) dropped the array shorthand.
- **Per-game mutex**: `GamesService` serializes `applyMove`/`resign`/
  `offerDraw`/`respondDraw`/`abort`/flag-fall-timeout per game id through
  `KeyedMutex` (`src/common/keyed-mutex.ts`). Any new game-mutating method
  needs to go through `this.mutex.runExclusive(gameId, ...)` too, or it can
  race the clock's `setTimeout`.
- **Services never depend on `RealtimeGateway` directly** - they emit
  events via `EventEmitter2` (`game.created`, `game.move`, `game.ended`,
  `challenge.*`, `friend.*`) and only `RealtimeGateway` listens
  (`@OnEvent`) and pushes to Socket.IO rooms. Keep it this way; it's what
  lets e.g. a matchmaking pairing notify the _other_ player, who isn't the
  one making the current request.
- **Guests are real `User` rows** (`isGuest: true`, `POST /auth/guest`),
  not a separate concept - they just never get `Rating` rows, and
  `GamesService.createGame` automatically marks a game `rated: false` if
  either side is a guest. Don't special-case guests outside of those two
  places - a guest simply has no `Rating` row, which is how e.g. a game
  records a null rating for them.
- **Games record their players' ratings.** `createGame` stores each
  player's category rating at the start (`whiteRating`/`blackRating`, also
  for casual games), and `finalize` stores what a rated, completed game did
  to them (`whiteRatingDiff`/`blackRatingDiff`) on the game row before
  applying it to the `Rating` rows. Elo is computed from those starting
  ratings, the ones shown beside the players, not whatever the ratings
  have become since. They reach clients as `rating` on each player in
  `GameStateDto` (so `game:state`/`game:created`/`game:over`), the two
  diffs on it, and `opponentRating`/`ratingDiff` in `GET /games`.
- **Matchmaking's seek queue and `GamesService`'s per-game clock
  timers/engine cache are all in-process memory**, not persisted - don't
  assume they survive a restart. Under `CLUSTER_WORKERS > 1` they're made
  _routable_ across worker processes (see below) rather than moved out of
  memory entirely; a bare restart still loses them the same as today.
- **Multi-process sharding (`src/cluster/`, opt-in via `CLUSTER_WORKERS`)**
  parallelizes the one thing that actually needed it - `GamesService`'s
  per-move work - without touching its logic. `main.ts` forks one Node
  worker per shard; each `gameId` is deterministically owned by exactly one
  worker (`cluster.util.ts`'s `ownerIndex`, a plain hash mod worker count -
  no coordination needed). `GamesService`'s mutating methods
  (`createGame`/`applyMove`/`resign`/`abort`/`offerDraw`/`respondDraw`/
  `forfeitByAbandonment`) check `isMine(gameId)` and forward to the owning
  worker over `ClusterBus` (`cluster-bus.ts`, request/response RPC over
  Node's own `cluster` IPC, relayed by the primary - see
  `cluster-primary.ts`) when they don't own it; the owning worker's copy of
  the SAME method then runs the real mutex/engine-cache/DB logic exactly as
  it does single-process. `MatchmakingService` takes a simpler path: its
  seek queue is pinned entirely to worker 0 (matching is cheap/infrequent,
  not worth distributing) rather than ownership-routed per seek.
  Socket.IO's own cross-worker room broadcast rides on
  `@socket.io/redis-adapter` (`cluster-io-adapter.ts`) - **not** plain
  `cluster` IPC, which load testing found silently drops some broadcasts
  under concurrent load (~100 simultaneous games); Redis doesn't have that
  failure mode at this scale. `RealtimeGateway` needed no changes for any
  of this: its `@OnEvent` listeners already only fire on whichever worker
  actually ran the mutation, and the adapter is what fans that one
  broadcast out to every worker's matching sockets.
  **A related gotcha if you ever add a new broadcast target**: game events
  go to the players' `user:{id}` rooms (permanent, joined at
  `handleConnection`), not a per-game room joined on `game:join` - this
  means a socket can be listening for a game's moves _before_ its own
  client has processed `game:created`/`game:join` for that game, so a
  client-side move counter must track the server's own ply number
  idempotently (ignore a `ply` at or below what you've already applied),
  not blindly `+= 1` per event received - a 'game:state' snapshot and a
  live `game:move` push can describe the same ply through two independent
  channels that arrive in either order. `scripts/load-test/load-test.mjs` had exactly
  this bug (harness-side only - the server's own game state was never
  wrong in any of this investigation); fixed there, and worth keeping in
  mind for the real client too.
  **Worker count isn't "more is better"** - load testing on a 10-core
  machine across several concurrency levels (100/500/1000 simultaneous
  bullet games) consistently found `CLUSTER_WORKERS=4` as the latency
  sweet spot: throughput improves from 1 to ~4 workers, then p95/p99
  latency gets _worse_ past 4, not just flatter, as cross-worker
  coordination overhead (the `ClusterBus` IPC relay through the primary,
  the Redis publish/subscribe hop) grows faster than the per-worker CPU
  relief is worth. The same total-worker-count ceiling holds whether it's
  one process or split across several (e.g. two 2-worker processes
  performs like one 4-worker process; two 4-worker processes performs like
  one 8-worker process, which is already past the sweet spot) - re-measure
  per deployment rather than assuming either "more workers" or "more
  processes" is free.
- **`GamesService` keeps live `Game`/`Move` state in memory per game it
  owns** (`gameCache`/`movesCache`, alongside the existing `engines`
  cache) - `getGameOrThrow`/`getGameWithMoves` read from these first,
  falling back to the DB only on a cold cache (e.g. just after a worker
  restart). `applyMove` also broadcasts the `game.move` event _before_
  awaiting its own DB write, not after - `EventEmitter2`'s dispatch into
  `RealtimeGateway`'s listener is synchronous, so the socket.io frame is
  already queued on the OS socket before the DB transaction's `await` even
  starts, cutting the DB round trip out of player-perceived move latency.
  Two correctness consequences this creates, both already handled, worth
  knowing before changing any of it:
  1. Broadcasting before the write lands means a REST read racing the
     broadcast (a client reacts to `game:move` and immediately does
     `GET /games/:id`) could otherwise beat the DB write and see a stale
     move count - this is exactly what `movesCache` exists to prevent:
     `getGameWithMoves` serves from it instead of the `moves` table for
     any game this worker still has cached.
  2. `getGameWithMoves` is ownership-routed (`isMine`/`ownerIndex`
     forwarding over `ClusterBus`, mirroring every mutating method) even
     though it's a read - necessary because Node's `cluster` module
     round-robins HTTP requests across workers regardless of which one
     owns a given `gameId`, and only the owning worker's cache is
     guaranteed consistent with its own in-flight write. `getGameOrThrow`
     doesn't need this: it's only ever called from within an
     already-ownership-routed mutating method, never directly from a
     controller.
- **`applyMove`'s DB writes use raw parameterized SQL (`manager.query()`),
  not `manager.save()`/`QueryBuilder`** - profiling a loaded cluster found
  TypeORM's query builder re-templating the full SQL text with regex on
  every call (`replacePropertyNamesForTheWholeQuery` et al.) was the single
  largest CPU cost on this path, bigger than chess.js's own move
  validation. The Move insert and Game update are both fixed-shape
  statements, so a query builder isn't buying anything per call - static
  SQL text with `$1`/`$2` placeholders skips that templating entirely for
  the same transaction/semantics. Worth checking for the same pattern
  (`manager.save`/`createQueryBuilder` on a hot, high-frequency path)
  before assuming any other slow endpoint needs a different fix.
- **`ServerChessEngine.attemptMove` resolves the full game-over reason
  itself** (checkmate/stalemate/insufficient-material/etc.), rather than
  callers making a separate `getGameOverReason()` call afterward -
  chess.js's `isCheckmate()`/`isStalemate()` each independently regenerate
  the full legal-move list (its most expensive operation), so calling
  either a second time after `attemptMove` already needed that same
  information doubles the cost for nothing. `getGameOverReason()` still
  exists as a public method (used to inspect an already-built engine
  outside of a move, and by its own tests) - just don't call it right
  after `attemptMove` on the hot path.
- **`DB_POOL_SIZE` env var overrides the cluster-aware pool size formula
  outright** (see `app.module.ts`) - useful when Postgres is on a separate
  host from the app with its own `max_connections` headroom to spend; the
  formula's own conservative default assumes they're colocated.
- **`getGameOrThrow` never loads the `white`/`black` relations** - it's used
  on the hot move/resign/draw/abort path, and nothing there needs the joined
  `User` rows (`colorOf` only compares `whiteId`/`blackId` columns). Only
  `getGameWithMoves` (display/PGN callers) does a relation-loaded fetch.
  `finalize()` attaches `game.white`/`game.black` itself (two PK lookups,
  once per finished game) because the `game.ended` event it emits always
  needs them for the broadcast DTO. If you add a new method that reads
  `game.white`/`game.black` from a game object that came from
  `getGameOrThrow`, it'll be `undefined` at runtime despite the TS type
  saying otherwise - either fetch relations explicitly or use
  `getGameWithMoves`.

## Testing

Both the unit/integration specs and the e2e specs now hit a real Postgres
database (`cchess_be_test`), not SQLite `:memory:` or mocks - that changed
two things worth knowing before you add a test:

- **No more free per-test isolation.** SQLite `:memory:` gave every test a
  throwaway database for free; a shared Postgres database doesn't. Every
  test app boot (`test/utils/app.ts`'s `createTestApp()`, and
  `games.service.spec.ts`'s own `buildModule()`) truncates every table first
  via `test/utils/db.ts`'s `truncateAllTables` (table names come from entity
  metadata, not a hardcoded list). If you build a new test harness that
  spins up its own `TestingModule`/`DataSource` instead of reusing one of
  these, it needs the same truncate call, or state will leak between tests
  and across repeated full-suite runs.
- **Fake timers don't mix with real async I/O.** `vi.advanceTimersByTimeAsync`
  drains the microtask queue and fires due fake timers in a loop, but a real
  Postgres query's promise resolves via libuv's I/O poll phase (an actual
  network round-trip), not just microtasks - it does not reliably resolve
  inside that loop. This bit the flag-fall test (`games.service.spec.ts`)
  when the DB was still synchronous SQLite (where every query resolved on
  the very next microtask tick, masking the issue entirely). The fix there:
  don't fake time at all - construct the game with a 0ms-clock time control
  (`{ minutes: 0, incrementSeconds: 1 }`) so the real `setTimeout` fires
  almost immediately, then poll with a short real delay instead of asserting
  immediately. If you need to test something timer-driven again, reach for
  that pattern (or a tiny real wait) before fake timers.

Otherwise:

- `src/**/*.spec.ts` - colocated with the code. Pure logic
  (`time-control.spec.ts`, `elo.spec.ts`, `chess-engine.spec.ts`) needs no
  DB. `games.service.spec.ts` is an integration test against Postgres, built
  via a local `Test.createTestingModule` (not full `AppModule`) registering
  just the entities it needs.
- `test/*.e2e-spec.ts` - full HTTP (and, for `realtime.e2e-spec.ts`,
  Socket.IO) flows through the real `AppModule` via `test/utils/app.ts`'s
  `createTestApp()`/`createListeningTestApp()`. These hit controllers +
  guards + DTO validation together, not just services - prefer adding here
  over a new isolated service test when a feature spans a full request.
