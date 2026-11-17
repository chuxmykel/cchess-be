# Realtime protocol (Socket.IO)

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

| Client -> Server      | Payload                                                              | Server -> Client                                                   | Payload                                                                                                          |
| --------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `game:join`           | `{ gameId }`                                                         | `game:state`                                                       | Full `GameStateDto`                                                                                              |
| `game:move`           | `{ gameId, from, to, promotion? }`                                   | `game:move`                                                        | `{ gameId, move, fen, turn, whiteTimeRemainingMs, blackTimeRemainingMs, firstMoveDeadline, moveDeadlineAt }`     |
| `game:resign`         | `{ gameId }`                                                         | `game:over`                                                        | Full `GameStateDto` (also sent on checkmate/timeout/draw/abort)                                                  |
| `game:abort`          | `{ gameId }`                                                         | `game:drawOffered`                                                 | `{ gameId, by }`                                                                                                 |
| `game:drawOffer`      | `{ gameId }`                                                         | `game:drawDeclined`                                                | `{ gameId }`                                                                                                     |
| `game:drawRespond`    | `{ gameId, accept }`                                                 | `game:created`                                                     | Full `GameStateDto` - pushed to both players, e.g. on a matchmaking pair                                         |
| `matchmaking:seek`    | `{ initialSeconds, incrementSeconds, rated?, ratingRange?, color? }` | `game:error` / `matchmaking:error`                                 | `{ message }` (and `{ gameId, event, message }` for game errors - `event` is what was refused, e.g. `game:move`) |
| `matchmaking:cancel`  | -                                                                    | `challenge:received` / `challenge:accepted` / `challenge:resolved` | `ChallengeDto`                                                                                                   |
| `game:leave`          | `{ gameId }`                                                         | `friend:requestReceived`                                           | `FriendRequestDto` - the requester, described like a friend                                                      |
| `game:watch`          | `{ gameId }`                                                         | `friend:requestAccepted` / `friend:requestResolved`                | `{ id }` - accepted, or declined/cancelled, to both sides                                                        |
| `game:unwatch`        | `{ gameId }`                                                         | `friend:removed`                                                   | `{ userIds }` - the two former friends                                                                           |
| `user:follow`         | `{ userId }`                                                         | `user:gameStarted`                                                 | `{ userId, gameId }` - to sockets following that player, when a game of theirs starts                            |
| `user:unfollow`       | `{ userId }`                                                         | -                                                                  | -                                                                                                                |
| -                     | -                                                                    | `friend:status`                                                    | `{ userId, online, playingGameId }` - to the user's friends                                                      |
| -                     | -                                                                    | `dm:message`                                                       | `{ id, senderId, recipientId, text, attachment, createdAt }` - to both people                                    |
| -                     | -                                                                    | `dm:read`                                                          | `{ userId, readAt }` - to the other person, when `userId` reads (or clears) their messages                       |
| `dm:typing`           | `{ userId }` - the friend being written to                           | `dm:typing`                                                        | `{ userId }` - to that friend, `userId` being who's typing; friends only, at most 3 every 5s                     |
| `game:chat`           | `{ gameId, text }`                                                   | `game:chat`                                                        | `{ id, gameId, userId, kind, text, createdAt }` - to both players                                                |
| `game:chatHistory`    | `{ gameId }`                                                         | `game:chatHistory`                                                 | `{ gameId, messages, readAt }` - to the player who asked                                                         |
| `game:chatRead`       | `{ gameId }`                                                         | -                                                                  | -                                                                                                                |
| -                     | -                                                                    | `game:presence`                                                    | `{ gameId, userId, online }`                                                                                     |
| -                     | -                                                                    | `lobby:stats`                                                      | `{ playersOnline, gamesInPlay }`                                                                                 |
| `game:rematchOffer`   | `{ gameId }`                                                         | `game:rematchOffered`                                              | `{ gameId, by }` - to both players                                                                               |
| `game:rematchDecline` | `{ gameId }`                                                         | `game:rematchDeclined`                                             | `{ gameId, by }` - declined, or withdrawn by the offerer                                                         |

A seek (here or `POST /matchmaking/seek`) is rated unless `rated: false`;
guests' seeks are always casual. `ratingRange: { below, above }` (whole
numbers from 0 to 1000) limits opponents to that far below and above your
rating in the time control's category, and both players' ranges must hold.
A `null` side has no limit; leave the whole range out to accept any rating.
Guests have no rating, so ranges don't apply to them.
`color` - `white`, `black` or `random` (the default) - is the color to
play: a seek pairs only with one that wants the other color or doesn't
mind, and each player gets the color they asked for (a coin decides when
neither minds), as challenges' `color` already does.

Nobody plays two live games at once. While you have one in progress,
seeking (`matchmaking:error`, or 409 from `POST /matchmaking/seek`),
sending a live challenge and accepting one all fail with "Finish your game
in progress first", and accepting a challenge from someone who's since
started a game fails with "<name> is in the middle of a game" (both
`GamesService.assertNotPlaying`). Daily games are played alongside
anything - see [Daily games](features.md#daily-games).

While a seek waits, its socket gets `lobby:stats` straight away and then
every 5 seconds: `playersOnline` counts users with a connected socket and
`gamesInPlay` counts active live games. Under clustering, worker 0 sends them.

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
`game:unwatch` stops them. To move on with a player to their next game,
`user:follow` with their `userId`: that socket then gets
`user:gameStarted` whenever a game of theirs starts, until
`user:unfollow`.

`ping` isn't part of the broadcast protocol above - it's a plain Socket.IO
acknowledgement (payload: the client's own timestamp as a number), echoed
straight back as the ack value for round-trip latency measurement, not a
separate emit.

Disconnecting a socket starts a `GAME_DISCONNECT_GRACE_MS` (default 60s)
countdown per joined game; reconnecting and re-emitting `game:join` before it
elapses cancels it, otherwise the disconnected player forfeits by
abandonment - in a live game; nobody forfeits a daily one so. Disconnecting
also cancels any pending matchmaking seek, but not a daily seek.
