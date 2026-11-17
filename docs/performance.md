# Performance

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

## Horizontal scaling (`src/cluster/`, opt-in)

Set `CLUSTER_WORKERS` to shard `GamesService`'s per-move work across
multiple Node processes instead of one - see the Architecture notes in
[CLAUDE.md](../CLAUDE.md) for how game ownership, forwarding, and cross-worker broadcast
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

## CPU cores, not just code, set the real ceiling

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
