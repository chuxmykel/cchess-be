# cchess-be

[![Lint](https://github.com/chuxmykel/cchess-be/actions/workflows/lint.yml/badge.svg?branch=develop)](https://github.com/chuxmykel/cchess-be/actions/workflows/lint.yml)
[![Unit tests](https://github.com/chuxmykel/cchess-be/actions/workflows/test.yml/badge.svg?branch=develop)](https://github.com/chuxmykel/cchess-be/actions/workflows/test.yml)
[![E2E](https://github.com/chuxmykel/cchess-be/actions/workflows/e2e.yml/badge.svg?branch=develop)](https://github.com/chuxmykel/cchess-be/actions/workflows/e2e.yml)
![NestJS 12](https://img.shields.io/badge/NestJS-12-e0234e)
![Postgres](https://img.shields.io/badge/Postgres-18-336791)

The real-time chess server behind [cchess](https://github.com/chuxmykel/cchess),
the React Native app. It's built with NestJS, Postgres and Socket.IO. Every
move is re-validated and every clock runs on the server, so a client can
never be trusted into an illegal move or an extra second.

## Features

- **Live games:** bullet to classical, with server-authoritative clocks,
  premoves, draw offers, resign and abort, a first-move timeout,
  reconnection grace, rematches and rematch series, plus chat and spectators.
- **Daily games:** 1-14 days a move, conditional moves and private notes.
  The deadlines live in the database, so a restart doesn't lose them.
- **Matchmaking:** live and daily seeks, paired by time control, rated
  choice, color and both players' rating ranges.
- **Ratings:** Glicko-2 per category (bullet, blitz, rapid, classical,
  daily), with history and stats for any period.
- **Accounts:** guests as first-class players, plus registered accounts with
  short-lived JWTs and rotating, hashed refresh tokens.
- **Social:** friends, presence, challenges to anyone, direct messages with
  a game or position attached, and an inbox with read receipts.
- **Game review storage:** reviews are computed on the device, and the
  server keeps them so no game is analysed twice.
- **Opening explorer:** lichess's Masters and Lichess databases behind a
  polite, self-tuning rate-limited queue and a cache, plus the games played
  here.
- **PGN export** and bookmarks.
- **Opt-in multi-process sharding** for when one event loop isn't enough.

## Tech stack

- [NestJS](https://nestjs.com) 12 (TypeScript, ESM)
- Postgres via TypeORM, with real migrations (`src/database/migrations`) and
  seeders via typeorm-extension
- [chess.js](https://github.com/jhlywa/chess.js) 1.4: the same version as the
  app, so FEN and SAN never disagree
- Socket.IO (`@nestjs/websockets`) for everything live
- Passport JWT, with OpenAPI docs via `@nestjs/swagger`
- Vitest, and oxlint (type-aware)
- Redis, only for cross-worker broadcast when `CLUSTER_WORKERS > 1`

## Getting started

```bash
nvm use           # Node 24.15 (.nvmrc) - or any version package.json's engines allows
npm install
```

Create a local Postgres role and two databases, one for dev and one for the
e2e tests:

```bash
createuser cchess --login --pwprompt
createdb cchess_be --owner=cchess
createdb cchess_be_test --owner=cchess
```

Copy `.env.example` to `.env` and fill in the `DB_*` and `TEST_DB_*`
connections and the JWT secrets (any long random strings for local dev).
These have no defaults, and the server refuses to boot without them. Every
other setting is optional.

```bash
npm run migration:run   # build, then apply pending migrations
npm run seed:run        # optional: bot_1-bot_5 (password "password") for ../cchess's opponent script
npm run start:dev       # http://localhost:3000, API docs at /docs
```

## Commands

```bash
npm run start:dev        # watch mode
npm run build            # nest build
npm run lint             # oxlint (type-aware)
npm test                 # unit specs - no database or .env needed
npm run test:e2e         # everything needing Postgres (HTTP + Socket.IO flows, services on a real DB)
npm run test:cov         # coverage

npm run migration:generate -- src/database/migrations/SomeName   # after changing an entity
npm run migration:run    # apply pending migrations
npm run migration:revert # roll back the last one
npm run seed:generate -- src/database/seeds/SomeName  # dev data only; production data is a migration
```

A single file: `npx vitest run src/games/clock.spec.ts`, or
`npm run test:e2e -- test/games.e2e-spec.ts`.

### Testing

`npm test` never reaches a database or any other service. The rules are pure
functions, and services are tested against stand-ins for their repositories,
so it runs anywhere with nothing set up. `npm run test:e2e` covers everything
that needs Postgres: full HTTP and Socket.IO flows (`test/*.e2e-spec.ts`) and
services on a real database (`test/integration/`). It runs against
`cchess_be_test`, which each test app boot truncates first, so never point
`TEST_DB_NAME` at your dev database.

The e2e fixtures seeder (`src/database/seeds/*-e2e-fixtures.ts`) seeds what
the app's Maestro suite plays against: `e2e_main` and `e2e_friend` (password
"password"), finished games for the review and history flows, and two daily
games in progress. It runs only with `SEED_E2E=1`, never with
`NODE_ENV=production`, and is untracked, so a dev `seed:run` doesn't mark it
as run. [cchess-infra](https://github.com/chuxmykel/cchess-infra)'s
`compose.e2e.yaml` and the app's `scripts/e2e/backend-native.sh` both use it.

## Architecture

```
            REST (auth, profiles, history, ...)      Socket.IO (moves, clocks, pushes)
                         │                                    │
                         ▼                                    ▼
  controllers ──▶ GamesService · MatchmakingService · ...  ◀── RealtimeGateway
                         │  emit domain events                ▲
                         └──── @nestjs/event-emitter ─────────┘  pushes to user:{id} rooms
                         │
                         ▼
                  Postgres (TypeORM)
```

- **One authority per game.** Every move, from REST or the socket, goes
  through `GamesService.applyMove`. It re-validates the move, deducts the
  clock before applying it, persists the move and reschedules the flag
  timer, all under a per-game mutex.
- **Services know nothing about sockets.** They emit events, and the gateway
  alone turns those into pushes.
- **One box.** Live games, clocks and the seek queue are in memory, so the
  server runs as one process on one host, or as several workers sharded
  over Node's cluster IPC.

More detail:

- [docs/architecture.md](docs/architecture.md): the modules, the move
  authority, events, time-control classification, guests
- [docs/protocol.md](docs/protocol.md): every Socket.IO event and its
  payloads, seeks, rematches, chat, presence, spectating
- [docs/features.md](docs/features.md): daily games, game review, the
  opening explorer, friends, challenges and messages
- [docs/performance.md](docs/performance.md): the move path's
  optimisations, load testing, horizontal scaling
- [CLAUDE.md](CLAUDE.md): the non-obvious things a change is likely to trip
  over

## Known limitations

- **Matchmaking's seek queue lives on worker 0** under clustering. Matching
  is cheap, so this is fine on one box, but a deployment across several
  machines would need it in a shared store such as Redis.
- **No built-in computer opponent.** The bots (`bot_1`-`bot_5`) are ordinary
  accounts driven by the app repo's `scripts/opponent.js`, which is a
  development and testing tool.

## Related repos

- [cchess](https://github.com/chuxmykel/cchess): the iOS and Android app
- [cchess-infra](https://github.com/chuxmykel/cchess-infra): hosting this
  server on one VPS with Docker Compose

## License

No license has been chosen yet, so all rights are reserved.
