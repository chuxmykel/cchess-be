# Features in depth

How the larger features behave, over REST and the socket. The socket events themselves are in [protocol.md](protocol.md).

## Daily games

A daily game gives each move 1, 2, 3, 5, 7 or 14 days, as chess.com's do.
Its time doesn't build up: every move resets the mover's clock to the full
days, and the side to move loses on time when `moveDeadlineAt` (in
`GameStateDto` and the `game:move` push; `null` for a live game) passes.
The first moves have those days too, with no `firstMoveDeadline` - missing
one aborts the game, as a live game's first-move timeout does. It isn't
forfeited by going offline, it takes no pre-moves, it never continues a
rematch series, and it's rated in a `daily` category of its own.

Days away, a timeout can't wait on a timer that a restart would lose:
`DailyDeadlineSweeper` looks every minute, and on boot, for daily games
out of time, each worker ending those it owns.

A player can have up to 50 daily games in progress, played alongside a
live game; a profile's or friend's `playingGameId`, and the lobby's
`gamesInPlay`, count live games only. `GET /games/daily` lists yours in
progress - those on your move first, then each by when its move runs out -
with each one's position, last move, deadline and opponent, enough to draw
it. `GET /games` takes `kind=live` or `kind=daily`.

`POST /daily-seeks { days, rated?, ratingRange?, color? }` starts a game
with a seek already waiting that agrees with it, by the same rules as live
seeks (`{ status: 'matched', game }`), or leaves it waiting, however long
(`{ status: 'queued', seek }`) - the game then arrives as `game:created`.
A waiting seek is claimed by deleting it, so of two seekers at once only
one gets it, on any worker. `GET /daily-seeks` lists yours, at most 10
waiting at once, and `DELETE /daily-seeks/:id` withdraws one. Challenges
send a daily game's days in `initialSeconds`, and wait three days for an
answer.

Conditional moves answer the opponent's next moves in advance:
`POST /games/:id/conditional-moves { basePly, lines }`, while the opponent
is to move, `basePly` the game's move count and each line their move, your
reply, theirs... in UCI - checked legal, and added to any saved from that
position (a last move with no reply is dropped; two different replies to
one move are refused; at most 10 lines). `PUT` with the same body saves
the lines in place of those saved - none clears them. The moment the opponent plays a move one answers,
its reply is played and what follows kept; a move none foresaw drops them
all. `GET` lists yours, `DELETE` drops them, and the opponent never sees
them.

`GET` and `PUT /games/:id/notes { body }` keep your own notes on a game,
up to 4000 characters, seen by nobody else; saving none clears them.

Daily games feed the opening explorer too (below): a game still being
played is left out of it, so a daily game can't be looked up while it's on.

## Game review

A finished game's review - each move classed best to blunder, each side's
accuracy, what to say about each move - is worked out **on the player's
device**, by the app's own Stockfish, not here. The server only keeps what
it found, so nobody analyses the same game twice:

- `GET /games/:id/review` - the review kept for a game: the engine and the
  depth it searched to, each side's accuracy, and `evals`, every position's
  score, best line (UCI) and next best score, the start first. 404 until
  someone has reviewed it.
- `PUT /games/:id/review` - keeps one: only for a completed game (not one
  aborted or still on), with exactly one eval per position (its moves plus
  one). A review searched as deep as the one kept already is ignored, and
  the kept one returned; a deeper one replaces it.

The app works out every class and comment from the evals, so wording can
change without the stored reviews changing. Game lists (`GET /games`, a
player's `GET /users/:username/games`) carry `accuracy` and
`opponentAccuracy` once a game's been reviewed, null until then.

Why the device: Stockfish takes a CPU core flat out for 40-80s a game, and
the server has one core to share with every live game's clocks and moves -
on the $4 droplet, about 200 MB of memory to spare too (see cchess-infra's
hosting report). A review is client-computed, so the server can't vouch
for it; it's informational only and never touches ratings. If server-side
review is ever wanted, it belongs on a separate worker, with the same
endpoints.

## Opening explorer

`GET /explorer?fen=` lists every move played from a position, the most
played first (at most 20), with how those games ended, and the position's
own totals (`totalGames`, `whiteWins`, `draws`, `blackWins`). `db` picks
the games:

- **left out** - every finished game here. Each move keeps the position it
  was played from (`moves.positionKey`, its EPD), so transpositions meet.
- **`player`** - one player's finished games here, from one side
  (`user`, `color`).
- **`masters`** and **`lichess`** - lichess's two databases
  (explorer.lichess.ovh). Lichess's can be narrowed by `speeds` and
  `ratings` (comma lists, as lichess's own); left out, they're lichess's
  defaults - blitz, rapid and classical, 1600 and up.

The answer says where it came from (`source`). It's `cchess`, the games
played here, whenever lichess can't be asked: it's rate-limiting us, it's
out of reach, or there's no `LICHESS_TOKEN`.

The server asks lichess as the app's own lichess account. That's a
personal token with no scopes, never a player's. Lichess asks API clients
to send one request at a time and to wait a minute after a 429, so:

- **One queue** (`LichessFetchQueue`, on worker 0 under clustering, which
  the other workers reach over `ClusterBus`) sends every request. The same
  position asked twice at once is sent once.
- **Players go first.** A player's request goes before the cache's own.
- **After a 429**, lichess is left alone for two minutes - five minutes
  from the fifth 429 with no answer between them, until lichess answers
  again. A player asking meanwhile is answered from the games here at
  once.
- **The cache's requests find lichess's limit.** Lichess doesn't publish
  it (in practice, about 50 requests a minute). They start a second
  apart; each 429 doubles the gap, up to 10 seconds, and every 100
  requests answered in a row shorten it by a tenth - never back to within
  a tenth of a gap that was rate-limited, though that floor is lowered by
  a tenth after each day with no 429. So the cache settles just under the
  limit, leaving the rest for players.
- **What it learns is kept** in `lichess_fetch_state` (one row: the gap,
  its floor, the 429s in a row and any pause under way), so a restart
  takes up where it left off rather than starting at a second again.

Masters, and Lichess with its default filters, are kept in the database:

- **`explorer_positions`** - each position asked about, kept for good:
  how often it's opened, when last, and whether it's pinned.
- **`explorer_cache`** - lichess's answer, trimmed to what's shown.
  - An answer over 30 days old is served marked `stale` while it's fetched
    afresh.
  - One whose position has gone 90 days unopened is soft-deleted, then
    purged 30 days later.

Other filters are asked of lichess every time and kept nowhere.

**Pinned positions** are every position along lichess's named openings,
7,983 of them, seeded pinned for both databases by the `AddExplorerCache`
migration (`src/explorer/seed-positions.ts`, built by
`node scripts/build-explorer-seed.mjs` from lichess's CC0 chess-openings,
at the commit the app's opening names come from). They never expire.

`ExplorerSweeper` keeps the cache up on worker 0. It fetches pinned
positions with no answer, or one gone stale, through the queue's
background lane, after any player's and as far apart as lichess's limit
needs. With a token, the first fill takes most of a day; after that each
month's refresh trickles in the same way. `EXPLORER_MAINTENANCE=false` turns the
upkeep off.

## Friends, challenges and messages

`GET /friends` describes each friend with their ratings, whether they're
`online`, and `playingGameId` while they're in a game; the `friend:status`
push keeps that current - on a user's first connect and last disconnect,
and when their games start or end. Only one friendship or request can be
live between two users.

Anyone can challenge any player, friend or not. `POST /challenges` takes
`{ opponentUsername, initialSeconds, incrementSeconds, color?, rated? }` (rated
unless `rated: false`), replaces any pending challenge to the same player,
and expires after `CHALLENGE_TTL_MS` (default 2 minutes; three days for a
daily game; `expiresAt` in `ChallengeDto`). Expiry is pushed as `challenge:resolved` with status
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
`GET /games/counts` and `GET /users/:username/games/counts` count finished
games by how each ended for that player and its type - `{ result,
gameType, count }`, one for each pair played - so a history's filters can
show how many each choice matches without asking again.
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

Direct messages are between friends: `POST /messages/:username { text,
attachment }` (up to 500 characters after trimming, at most 10 per 10
seconds). `attachment` is optional - a game, `{ kind: 'game', gameId }`, or a
position, `{ kind: 'position', fen }` - and with one the text may be left
out. `GET /messages/:username` (newest first, `limit`/`before`) is the
history. `POST /messages/:username/read` marks them read (pushing `dm:read`
to the other person), `GET /messages/:username/seen` says when the other
person last read yours, `GET /messages/unread` counts unread messages by
sender, and `DELETE /messages/:username` clears the history for the caller
only.

`GET /messages` is the inbox: a conversation for each person you have
messages with since you last cleared them, the newest message first - the
person, that message, how many of theirs you haven't read, and when they
last read yours. A page of `limit` (1-100, default 30); `before` (the last
one's `lastMessage.createdAt`) gives the next.

## Accounts and safety

### Email

Every account email is a single-use link, kept only as a hash
(`email_tokens`), its token in the link alone:

- Signing up mails a link to verify the address (24 hours); `GET
/users/me`'s `emailVerified` says whether it has been. `POST
/auth/email/verification` sends a new one.
- `POST /auth/email/change { email, password }` mails a link to the new
  address (24 hours) and tells the old one; the address changes only once
  the link is used. `POST /auth/email/verify { token }` uses either kind.
- `POST /auth/password/forgot { email }` mails a reset link (one hour) when
  the address has an account - always 204, so it never says whether it
  does. `POST /auth/password/reset { token, password }` sets the new
  password, revokes every refresh token and mails a notice.

A new link of a kind replaces the unused one before it. Links open
`<PUBLIC_URL>/app/verify-email` or `/app/reset-password`: the app, where
it's installed, by a universal / app link, or else the server's own page.
Mail goes through `Mailer` (`src/mail/`): Resend when `RESEND_API_KEY` is
set, otherwise logged.

Sign-ins, sign-ups, guests and these emails are rate limited, per account
and per IP address (`src/auth/rate-limits.ts`): only failed sign-ins count
toward theirs. The limits are in memory, per cluster worker, and off with
`AUTH_RATE_LIMITS=false`, as both test suites run. Behind a proxy,
`TRUST_PROXY` says which addresses to believe in `X-Forwarded-For`.

### Deleting an account

`DELETE /users/me { password }` (no password for a guest) deletes the
account, as both app stores require. Games in progress end first - aborted
while they can be, resigned after - and any seek is withdrawn. Then, in one
transaction, everything personal is soft-deleted, as every delete here
is: direct messages and conversations both ways, game chat and read marks,
notes, conditional moves, bookmarks, daily seeks, friendships, challenges,
blocks and reports both ways, refresh and email tokens; reviews it asked
for lose their `createdById`. Erasing those rows for good - within the 30
days the privacy policy promises - is a purge still to be written.

The user row stays, anonymised - `deleted_<random>`, "Deleted player", no
email, password, bio or last-seen - with `accountDeletedAt` set, so its
finished games and ratings still make sense in its opponents' history. Its
sockets close (`user.deleted`), its access tokens are refused from then on
(the JWT strategy and the socket handshake look the account up), and it
never appears in player search.

### Blocking

`POST /users/:username/block` blocks a player, `DELETE` the same path
unblocks, and `GET /users/me/blocks` lists those you've blocked, the latest
first. A block works both ways, whoever made it: the two can't send each
other friend requests or challenges (403), rematch, or chat in a game, and
matchmaking and daily seeks never pair them. Blocking ends a friendship or
a request between them, and cancels the challenges waiting either way -
through `user.blocked`, which `FriendsService` and `ChallengesService`
hear, pushing the usual `friend:*` and `challenge:*` events. A profile's
`blockedByYou` says whether you've blocked them; nothing tells a player
they've been blocked.

### Reports and moderation

`POST /reports { username, reason, details?, gameId?, messageId? }` reports
a player - `reason` one of abuse, hate, sexual, spam, cheating, username or
other. With `messageId` it's for a message: a chat message of `gameId`'s,
the reporter's game, or without `gameId` a direct message the reported
player sent the reporter; a copy of its words is kept with the report, so
it can be judged once the message is gone. At most 10 an hour per player.
Each report is mailed to `SUPPORT_EMAIL`, with the commands to act on it.

Acting on reports is done from the server itself (`LoopbackOnlyGuard`, as
for maintenance - `docker compose exec api curl ...`):

- `GET /internal/reports?status=open|resolved`, and
  `POST /internal/reports/:id/resolve`.
- `POST /internal/users/:username/suspend` signs the player out everywhere
  (refresh tokens revoked, sockets closed by `user.suspended`) and refuses
  their sign-ins (403) and tokens until `.../unsuspend`.
- `DELETE /internal/game-chat/:id` and `DELETE /internal/direct-messages/:id`
  take a message down: soft-deleted, so it's gone from both players at
  once, and erased for good by the purge (see "Deleting an account").

### House bots

Computer opponents the server runs (cchess-infra's `housebots`), so a
reviewer or tester always finds a game, are ordinary accounts marked as
bots: `POST /internal/users/:username/bot` (and `DELETE` to unmark) sets
`users.isBot`. Matchmaking never pairs two bots (`canPair`), so any number
can wait at one time control and a player always gets one; `isBot` is in a
game's players, profiles and player search, for the app to tag them. Daily
seeks aren't affected - the bots don't seek daily games.

### Filtering what players write

Game chat and direct messages are kept as written, and have slurs and
obscenities masked with asterisks as they're sent out ("you \*\*\*\*ing
idiot") - in the one mapper each goes out by (`toChatMessageDto`,
`toDirectMessageDto`), so a report keeps what was really said; a username,
display name or bio with one is refused (400). The words are the
`obscenity` package's English list, with its handling of look-alikes
("sh1t", "fuuuck") and its whitelist, so "Scunthorpe" and "assessment" pass
(`src/common/profanity.ts`).

### Terms of use

Signing up needs `acceptTerms: true` (400 without), and records the terms'
version and when (`users.termsVersion`, `termsAcceptedAt`). The version is
the date the terms last changed (`TERMS_VERSION`, `src/legal/legal.ts`):
`GET /users/me`'s `termsAccepted` is false once they change, or for a guest,
and `POST /users/me/terms` accepts the version in force.

### Pages and app config

The server serves a few pages of its own (`src/web/`), signed out, for the
stores and for players without the app:

- `/legal/privacy` and `/legal/terms` - drafts to review before publishing;
  their dates are `PRIVACY_VERSION` and `TERMS_VERSION`.
- `/account/delete` - how to delete an account, in the app or by email.
- `/app/verify-email` and `/app/reset-password` - where email links land
  when the app isn't installed to open them: a button or a form there does
  the work (mail scanners open links, so a visit alone does nothing).
- `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
  - let the app open `/app/*` links itself (universal links, app links), once
    `APPLE_TEAM_ID` and `ANDROID_CERT_SHA256` are set.

`GET /app/config` is what the app reads on launch: `minimumVersion`
(`MIN_APP_VERSION`) - an older app asks to be updated - the terms' and
policy's versions and URLs, and the support address.

The API docs (`/docs`) are served outside production only, unless
`SWAGGER=true`.
