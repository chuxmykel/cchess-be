import { HttpException, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayInit,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import type { AppConfig } from '../config/configuration.js';
import { CLUSTERING_ENABLED, WORKER_INDEX } from '../cluster/cluster.util.js';
import { DOMAIN_EVENTS, WS_EVENTS } from '../common/events.js';
import { toChallengeDto } from '../challenges/dto/challenge.dto.js';
import type {
  ChallengeAcceptedEvent,
  ChallengeCreatedEvent,
  ChallengeResolvedEvent,
} from '../challenges/challenges.service.js';
import { toGameStateDto, toMoveDto } from '../games/dto/game-state.dto.js';
import type { GameEvent, GameMoveEvent } from '../games/games.service.js';
import { GamesService } from '../games/games.service.js';
import {
  GameChatService,
  type GameChatEvent,
} from '../games/game-chat.service.js';
import { toChatMessageDto } from '../games/dto/chat-message.dto.js';
import { firstMoveDeadline } from '../games/first-move.js';
import { RematchService, type RematchEvent } from '../games/rematch.service.js';
import {
  FriendsService,
  type FriendRequestEvent,
} from '../friends/friends.service.js';
import { MatchmakingService } from '../matchmaking/matchmaking.service.js';
import { toDirectMessageDto } from '../messages/dto/direct-message.dto.js';
import type { DirectMessageEvent } from '../messages/messages.service.js';
import { PresenceService, userRoom } from '../presence/presence.service.js';
import type { SeekRequest } from '../matchmaking/seek-matching.js';
import { UsersService } from '../users/users.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { verifySocketToken } from './ws-auth.util.js';

/** Sockets watching a game they aren't playing in. */
function watchRoom(gameId: string): string {
  return `game:${gameId}:watch`;
}

/** Sockets with a seek waiting for an opponent, who get `lobby:stats`. */
const LOBBY_ROOM = 'lobby';
const LOBBY_STATS_INTERVAL_MS = 5_000;
// One worker is enough to send the stats to the whole cluster's lobby room,
// the same one matchmaking runs on.
const LOBBY_STATS_WORKER = 0;

export interface LobbyStats {
  playersOnline: number;
  gamesInPlay: number;
}

// Composite key for `abandonmentTimers` - scoped per game+user pair, since
// a disconnecting socket only threatens forfeiture of the games it
// actually joined, not every game that player is in.
function abandonmentTimerKey(gameId: string, userId: string): string {
  return `${gameId}:${userId}`;
}

interface SocketData {
  user: AuthenticatedUser;
  /** Each game this socket joined, mapped to the opponent's user id. */
  joinedGames: Map<string, string>;
}

// Wildcard origin, no credentials - WS auth travels in the handshake's own
// `auth.token` payload (see ws-auth.util.ts), never a cookie, so unlike
// main.ts's REST CORS (configurable origin, credentials: true) there's
// nothing credentialed here for an origin restriction to protect.
const GATEWAY_CORS_OPTIONS = { origin: '*', credentials: false } as const;

// Socket.IO's own transport-level keep-alive: how long the server waits
// for a pong before treating a connection as dead. Unrelated to
// `game.disconnectGraceMs` below, which is this app's own grace period
// before forfeiting an abandoned game once a disconnect is already known.
const PING_TIMEOUT_MS = 60_000;

/**
 * The single realtime namespace for the whole app: game play (moves, clock,
 * resign/draw/abort), matchmaking pairing pushes, and challenge/friend
 * notifications. Split into one gateway rather than several because they
 * all share the same auth handshake and `user:{id}` personal room.
 */
@WebSocketGateway({
  cors: GATEWAY_CORS_OPTIONS,
  pingTimeout: PING_TIMEOUT_MS,
  // websocket-only (no HTTP long-polling) means every connection is a
  // single persistent TCP connection from the start - which is what lets
  // clustering (see src/cluster/) work with Node's own default round-robin
  // port sharing across workers, with no sticky-session proxy needed. A
  // polling connection's repeated short-lived requests would need one to
  // keep landing on the same worker, which plain round-robin doesn't
  // guarantee.
  transports: ['websocket'],
})
export class RealtimeGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly abandonmentTimers = new Map<string, NodeJS.Timeout>();
  private lobbyStatsTimer: NodeJS.Timeout | null = null;
  // Nest closes the database before the sockets on shutdown, so the
  // disconnects that follow have nothing left to record.
  private shuttingDown = false;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly gamesService: GamesService,
    private readonly gameChatService: GameChatService,
    private readonly rematchService: RematchService,
    private readonly matchmakingService: MatchmakingService,
    private readonly usersService: UsersService,
    private readonly friendsService: FriendsService,
    private readonly presenceService: PresenceService,
  ) {}

  afterInit(): void {
    this.presenceService.attach(this.server);
    if (CLUSTERING_ENABLED && WORKER_INDEX !== LOBBY_STATS_WORKER) return;
    this.lobbyStatsTimer = setInterval(() => {
      void this.sendLobbyStats().catch((error) => {
        this.logger.warn(`lobby stats failed: ${(error as Error).message}`);
      });
    }, LOBBY_STATS_INTERVAL_MS);
    this.lobbyStatsTimer.unref?.();
  }

  onModuleDestroy(): void {
    this.shuttingDown = true;
    if (this.lobbyStatsTimer) clearInterval(this.lobbyStatsTimer);
  }

  private async lobbyStats(): Promise<LobbyStats> {
    const [sockets, gamesInPlay] = await Promise.all([
      this.server.fetchSockets(),
      this.gamesService.countActiveGames(),
    ]);
    const onlineUserIds = new Set(
      sockets
        .map((socket) => (socket.data as Partial<SocketData>).user?.userId)
        .filter((userId) => userId !== undefined),
    );
    return { playersOnline: onlineUserIds.size, gamesInPlay };
  }

  private async sendLobbyStats(): Promise<void> {
    const seekers = await this.server.in(LOBBY_ROOM).fetchSockets();
    if (seekers.length === 0) return;
    this.server
      .to(LOBBY_ROOM)
      .emit(WS_EVENTS.LOBBY_STATS, await this.lobbyStats());
  }

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const user = verifySocketToken(this.jwtService, socket);
      (socket.data as SocketData).user = user;
      (socket.data as SocketData).joinedGames = new Map();
      await socket.join(userRoom(user.userId));
      await this.usersService.touchLastSeen(user.userId);
      const sockets = await this.server
        .in(userRoom(user.userId))
        .fetchSockets();
      if (sockets.length === 1) await this.sendFriendStatus(user.userId);
      this.logger.debug(
        `socket connected: ${socket.id} (user ${user.username})`,
      );
    } catch (error) {
      this.logger.warn(
        `rejecting unauthenticated socket ${socket.id}: ${(error as Error).message}`,
      );
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const data = socket.data as Partial<SocketData>;
    if (!data.user || this.shuttingDown) return;

    const userId = data.user.userId;
    if (await this.presenceService.isOnline(userId)) return;

    this.matchmakingService.cancelSeek(userId);

    const graceMs = this.configService.get('game.disconnectGraceMs', {
      infer: true,
    });
    for (const [gameId, opponentId] of data.joinedGames ?? []) {
      this.scheduleAbandonmentForfeit(gameId, userId, graceMs);
      this.sendPresence(opponentId, gameId, userId, false);
    }
    await this.usersService.touchLastSeen(userId);
    await this.sendFriendStatus(userId);
  }

  /** Tells the user's friends whether they're online and playing. */
  private async sendFriendStatus(userId: string): Promise<void> {
    try {
      const friendIds = await this.friendsService.friendIds(userId);
      if (friendIds.length === 0) return;
      const [online, playing] = await Promise.all([
        this.presenceService.isOnline(userId),
        this.gamesService.activeGameIdsFor([userId]),
      ]);
      this.server.to(friendIds.map(userRoom)).emit(WS_EVENTS.FRIEND_STATUS, {
        userId,
        online,
        playingGameId: playing.get(userId) ?? null,
      });
    } catch (error) {
      this.logger.warn(
        `friend status for ${userId} failed: ${(error as Error).message}`,
      );
    }
  }

  private scheduleAbandonmentForfeit(
    gameId: string,
    userId: string,
    graceMs: number,
  ): void {
    const key = abandonmentTimerKey(gameId, userId);
    const existing = this.abandonmentTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.abandonmentTimers.delete(key);
      void this.gamesService
        .forfeitByAbandonment(gameId, userId)
        .catch((error) => {
          this.logger.warn(
            `abandonment forfeit failed for game ${gameId}: ${(error as Error).message}`,
          );
        });
    }, graceMs);
    timer.unref?.();
    this.abandonmentTimers.set(key, timer);
  }

  private cancelAbandonmentForfeit(gameId: string, userId: string): void {
    const key = abandonmentTimerKey(gameId, userId);
    const existing = this.abandonmentTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.abandonmentTimers.delete(key);
    }
  }

  private sendPresence(
    toUserId: string,
    gameId: string,
    userId: string,
    online: boolean,
  ): void {
    this.server
      .to(userRoom(toUserId))
      .emit(WS_EVENTS.GAME_PRESENCE, { gameId, userId, online });
  }

  @SubscribeMessage(WS_EVENTS.PING)
  onPing(@MessageBody() clientTime: number): number {
    return clientTime;
  }

  @SubscribeMessage(WS_EVENTS.GAME_JOIN)
  async onJoinGame(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { gameId: string },
  ) {
    const user = (socket.data as SocketData).user;
    this.cancelAbandonmentForfeit(payload.gameId, user.userId);

    const game = await this.gamesService.getGameWithMoves(payload.gameId);
    const opponentId =
      game.whiteId === user.userId ? game.blackId : game.whiteId;
    (socket.data as SocketData).joinedGames.set(payload.gameId, opponentId);
    socket.emit(WS_EVENTS.GAME_STATE, toGameStateDto(game));

    this.sendPresence(opponentId, payload.gameId, user.userId, true);
    socket.emit(WS_EVENTS.GAME_PRESENCE, {
      gameId: payload.gameId,
      userId: opponentId,
      online: await this.presenceService.isOnline(opponentId),
    });
  }

  @SubscribeMessage(WS_EVENTS.GAME_WATCH)
  async onWatchGame(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { gameId: string },
  ) {
    await this.runGameAction(
      socket,
      WS_EVENTS.GAME_WATCH,
      payload.gameId,
      async () => {
        const game = await this.gamesService.getGameWithMoves(payload.gameId);
        await socket.join(watchRoom(payload.gameId));
        socket.emit(WS_EVENTS.GAME_STATE, toGameStateDto(game));
      },
    );
  }

  @SubscribeMessage(WS_EVENTS.GAME_UNWATCH)
  async onUnwatchGame(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { gameId: string },
  ) {
    await socket.leave(watchRoom(payload.gameId));
  }

  @SubscribeMessage(WS_EVENTS.GAME_LEAVE)
  onLeaveGame(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { gameId: string },
  ) {
    (socket.data as SocketData).joinedGames.delete(payload.gameId);
  }

  @SubscribeMessage(WS_EVENTS.GAME_MOVE)
  async onMove(
    @ConnectedSocket() socket: Socket,
    @MessageBody()
    payload: { gameId: string; from: string; to: string; promotion?: string },
  ) {
    const user = (socket.data as SocketData).user;
    await this.runGameAction(socket, WS_EVENTS.GAME_MOVE, payload.gameId, () =>
      this.gamesService.applyMove(
        payload.gameId,
        user.userId,
        payload.from,
        payload.to,
        payload.promotion,
      ),
    );
  }

  @SubscribeMessage(WS_EVENTS.GAME_RESIGN)
  async onResign(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { gameId: string },
  ) {
    await this.runGameAction(
      socket,
      WS_EVENTS.GAME_RESIGN,
      payload.gameId,
      () => this.gamesService.resign(payload.gameId, this.userId(socket)),
    );
  }

  @SubscribeMessage(WS_EVENTS.GAME_ABORT)
  async onAbort(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { gameId: string },
  ) {
    await this.runGameAction(socket, WS_EVENTS.GAME_ABORT, payload.gameId, () =>
      this.gamesService.abort(payload.gameId, this.userId(socket)),
    );
  }

  @SubscribeMessage(WS_EVENTS.GAME_DRAW_OFFER)
  async onDrawOffer(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { gameId: string },
  ) {
    await this.runGameAction(
      socket,
      WS_EVENTS.GAME_DRAW_OFFER,
      payload.gameId,
      () => this.gamesService.offerDraw(payload.gameId, this.userId(socket)),
    );
  }

  @SubscribeMessage(WS_EVENTS.GAME_DRAW_RESPOND)
  async onDrawRespond(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { gameId: string; accept: boolean },
  ) {
    await this.runGameAction(
      socket,
      WS_EVENTS.GAME_DRAW_RESPOND,
      payload.gameId,
      () =>
        this.gamesService.respondDraw(
          payload.gameId,
          this.userId(socket),
          payload.accept,
        ),
    );
  }

  @SubscribeMessage(WS_EVENTS.GAME_REMATCH_OFFER)
  async onRematchOffer(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { gameId: string },
  ) {
    await this.runGameAction(
      socket,
      WS_EVENTS.GAME_REMATCH_OFFER,
      payload.gameId,
      () => this.rematchService.offer(payload.gameId, this.userId(socket)),
    );
  }

  @SubscribeMessage(WS_EVENTS.GAME_REMATCH_DECLINE)
  async onRematchDecline(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { gameId: string },
  ) {
    await this.runGameAction(
      socket,
      WS_EVENTS.GAME_REMATCH_DECLINE,
      payload.gameId,
      () => this.rematchService.decline(payload.gameId, this.userId(socket)),
    );
  }

  @SubscribeMessage(WS_EVENTS.GAME_CHAT)
  async onChat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { gameId: string; text: string },
  ) {
    await this.runGameAction(socket, WS_EVENTS.GAME_CHAT, payload.gameId, () =>
      this.gameChatService.send(
        payload.gameId,
        this.userId(socket),
        payload.text,
      ),
    );
  }

  @SubscribeMessage(WS_EVENTS.GAME_CHAT_HISTORY)
  async onChatHistory(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { gameId: string },
  ) {
    await this.runGameAction(
      socket,
      WS_EVENTS.GAME_CHAT_HISTORY,
      payload.gameId,
      async () => {
        const { messages, readAt } = await this.gameChatService.history(
          payload.gameId,
          this.userId(socket),
        );
        socket.emit(WS_EVENTS.GAME_CHAT_HISTORY, {
          gameId: payload.gameId,
          messages: messages.map(toChatMessageDto),
          readAt,
        });
      },
    );
  }

  /** The player has seen their game's chat, up to now. */
  @SubscribeMessage(WS_EVENTS.GAME_CHAT_READ)
  async onChatRead(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { gameId: string },
  ) {
    await this.runGameAction(
      socket,
      WS_EVENTS.GAME_CHAT_READ,
      payload.gameId,
      async () => {
        await this.gameChatService.markRead(
          payload.gameId,
          this.userId(socket),
        );
      },
    );
  }

  @SubscribeMessage(WS_EVENTS.MATCHMAKING_SEEK)
  async onSeek(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: SeekRequest,
  ) {
    const user = await this.usersService.findByIdOrThrow(this.userId(socket));
    try {
      const result = await this.matchmakingService.seek(user, payload);
      if (result.status === 'queued') {
        await socket.join(LOBBY_ROOM);
        socket.emit(WS_EVENTS.LOBBY_STATS, await this.lobbyStats());
      }
    } catch (error) {
      this.logIfUnexpected('matchmaking:seek', error);
      socket.emit(WS_EVENTS.MATCHMAKING_ERROR, {
        message: (error as Error).message,
      });
    }
  }

  @SubscribeMessage(WS_EVENTS.MATCHMAKING_CANCEL)
  async onCancelSeek(@ConnectedSocket() socket: Socket) {
    this.matchmakingService.cancelSeek(this.userId(socket));
    await socket.leave(LOBBY_ROOM);
  }

  private userId(socket: Socket): string {
    return (socket.data as SocketData).user.userId;
  }

  private async runGameAction(
    socket: Socket,
    event: string,
    gameId: string,
    fn: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logIfUnexpected(`${event} (game ${gameId})`, error);
      socket.emit(WS_EVENTS.GAME_ERROR, {
        gameId,
        message: (error as Error).message,
      });
    }
  }

  /**
   * Business-rule rejections (BadRequestException/ConflictException/etc.,
   * everything GamesService/MatchmakingService throw for an expected reason
   * like "not your turn" or "no draw offer to respond to") are already
   * communicated to the client via the *:error emit right after this call -
   * logging those too would just be noise on every normal rejection. An
   * error that ISN'T one of those (a thrown TypeError, a DB failure, a bug)
   * has nowhere else to surface: a WS message handler's only "response" is
   * that one emit back to the single client who sent it, never something
   * an HTTP exception filter would log server-side the way a REST 5xx is.
   */
  private logIfUnexpected(context: string, error: unknown): void {
    if (error instanceof HttpException) return;
    const err = error as Error;
    this.logger.error(`${context}: ${err.message}`, err.stack);
  }

  @OnEvent(DOMAIN_EVENTS.GAME_CREATED)
  onGameCreated({ game }: GameEvent) {
    const dto = toGameStateDto(game);
    this.server
      .in(userRoom(game.whiteId))
      .in(userRoom(game.blackId))
      .socketsLeave(LOBBY_ROOM);
    this.server
      .to(userRoom(game.whiteId))
      .to(userRoom(game.blackId))
      .emit(WS_EVENTS.GAME_CREATED, dto);
    void this.sendFriendStatus(game.whiteId);
    void this.sendFriendStatus(game.blackId);
  }

  @OnEvent(DOMAIN_EVENTS.GAME_MOVE)
  onGameMove({ game, move }: GameMoveEvent) {
    this.server
      .to(userRoom(game.whiteId))
      .to(userRoom(game.blackId))
      .to(watchRoom(game.id))
      .emit(WS_EVENTS.GAME_MOVE, {
        gameId: game.id,
        move: toMoveDto(move),
        fen: game.fen,
        turn: game.turn,
        whiteTimeRemainingMs: game.whiteTimeRemainingMs,
        blackTimeRemainingMs: game.blackTimeRemainingMs,
        firstMoveDeadline: firstMoveDeadline(game),
      });
  }

  @OnEvent(DOMAIN_EVENTS.GAME_ENDED)
  onGameEnded({ game }: GameEvent) {
    this.server
      .to(userRoom(game.whiteId))
      .to(userRoom(game.blackId))
      .to(watchRoom(game.id))
      .emit(WS_EVENTS.GAME_OVER, toGameStateDto(game));
    void this.sendFriendStatus(game.whiteId);
    void this.sendFriendStatus(game.blackId);
  }

  @OnEvent(DOMAIN_EVENTS.GAME_DRAW_OFFERED)
  onDrawOffered({ game }: GameEvent) {
    this.server
      .to(userRoom(game.whiteId))
      .to(userRoom(game.blackId))
      .emit(WS_EVENTS.GAME_DRAW_OFFERED, {
        gameId: game.id,
        by: game.drawOfferedBy,
      });
  }

  @OnEvent(DOMAIN_EVENTS.GAME_DRAW_DECLINED)
  onDrawDeclined({ game }: GameEvent) {
    this.server
      .to(userRoom(game.whiteId))
      .to(userRoom(game.blackId))
      .emit(WS_EVENTS.GAME_DRAW_DECLINED, { gameId: game.id });
  }

  @OnEvent(DOMAIN_EVENTS.GAME_REMATCH_OFFERED)
  onRematchOffered({ game, by }: RematchEvent) {
    this.server
      .to(userRoom(game.whiteId))
      .to(userRoom(game.blackId))
      .emit(WS_EVENTS.GAME_REMATCH_OFFERED, { gameId: game.id, by });
  }

  @OnEvent(DOMAIN_EVENTS.GAME_REMATCH_DECLINED)
  onRematchDeclined({ game, by }: RematchEvent) {
    this.server
      .to(userRoom(game.whiteId))
      .to(userRoom(game.blackId))
      .emit(WS_EVENTS.GAME_REMATCH_DECLINED, { gameId: game.id, by });
  }

  @OnEvent(DOMAIN_EVENTS.GAME_CHAT_MESSAGE)
  onChatMessage({ game, message }: GameChatEvent) {
    this.server
      .to(userRoom(game.whiteId))
      .to(userRoom(game.blackId))
      .emit(WS_EVENTS.GAME_CHAT, toChatMessageDto(message));
  }

  @OnEvent(DOMAIN_EVENTS.CHALLENGE_CREATED)
  onChallengeCreated({ challenge }: ChallengeCreatedEvent) {
    this.server
      .to(userRoom(challenge.opponentId))
      .emit(WS_EVENTS.CHALLENGE_RECEIVED, toChallengeDto(challenge));
  }

  @OnEvent(DOMAIN_EVENTS.CHALLENGE_ACCEPTED)
  onChallengeAccepted({ challenge }: ChallengeAcceptedEvent) {
    this.server
      .to(userRoom(challenge.challengerId))
      .emit(WS_EVENTS.CHALLENGE_ACCEPTED, toChallengeDto(challenge));
  }

  // One decorator per event: EventEmitter2 reads an array as the parts of
  // a single dotted event name, not as a list of events.
  @OnEvent(DOMAIN_EVENTS.CHALLENGE_DECLINED)
  @OnEvent(DOMAIN_EVENTS.CHALLENGE_CANCELLED)
  @OnEvent(DOMAIN_EVENTS.CHALLENGE_EXPIRED)
  onChallengeResolved({ challenge }: ChallengeResolvedEvent) {
    this.server
      .to(userRoom(challenge.challengerId))
      .to(userRoom(challenge.opponentId))
      .emit(WS_EVENTS.CHALLENGE_RESOLVED, toChallengeDto(challenge));
  }

  @OnEvent(DOMAIN_EVENTS.FRIEND_REQUEST_CREATED)
  async onFriendRequestCreated({ friendship }: FriendRequestEvent) {
    const request =
      await this.friendsService.describeIncomingRequest(friendship);
    this.server
      .to(userRoom(friendship.addresseeId))
      .emit(WS_EVENTS.FRIEND_REQUEST_RECEIVED, request);
  }

  @OnEvent(DOMAIN_EVENTS.FRIEND_REQUEST_ACCEPTED)
  onFriendRequestAccepted({ friendship }: FriendRequestEvent) {
    this.server
      .to(userRoom(friendship.requesterId))
      .to(userRoom(friendship.addresseeId))
      .emit(WS_EVENTS.FRIEND_REQUEST_ACCEPTED, { id: friendship.id });
  }

  @OnEvent(DOMAIN_EVENTS.FRIEND_REQUEST_DECLINED)
  @OnEvent(DOMAIN_EVENTS.FRIEND_REQUEST_CANCELLED)
  onFriendRequestResolved({ friendship }: FriendRequestEvent) {
    this.server
      .to(userRoom(friendship.requesterId))
      .to(userRoom(friendship.addresseeId))
      .emit(WS_EVENTS.FRIEND_REQUEST_RESOLVED, { id: friendship.id });
  }

  @OnEvent(DOMAIN_EVENTS.FRIEND_REMOVED)
  onFriendRemoved({ friendship }: FriendRequestEvent) {
    this.server
      .to(userRoom(friendship.requesterId))
      .to(userRoom(friendship.addresseeId))
      .emit(WS_EVENTS.FRIEND_REMOVED, {
        userIds: [friendship.requesterId, friendship.addresseeId],
      });
  }

  @OnEvent(DOMAIN_EVENTS.DIRECT_MESSAGE_SENT)
  onDirectMessage({ message }: DirectMessageEvent) {
    this.server
      .to(userRoom(message.senderId))
      .to(userRoom(message.recipientId))
      .emit(WS_EVENTS.DIRECT_MESSAGE, toDirectMessageDto(message));
  }
}
