import { HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import type { AppConfig } from '../config/configuration.js';
import { toChallengeDto } from '../challenges/dto/challenge.dto.js';
import type {
  ChallengeAcceptedEvent,
  ChallengeCreatedEvent,
  ChallengeResolvedEvent,
} from '../challenges/challenges.service.js';
import { toGameStateDto, toMoveDto } from '../games/dto/game-state.dto.js';
import type { GameDrawOfferEvent, GameEndedEvent, GameMoveEvent } from '../games/games.service.js';
import { GamesService } from '../games/games.service.js';
import type { FriendRequestEvent } from '../friends/friends.service.js';
import { MatchmakingService } from '../matchmaking/matchmaking.service.js';
import { UsersService } from '../users/users.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { verifySocketToken } from './ws-auth.util.js';

function userRoom(userId: string): string {
  return `user:${userId}`;
}

interface SocketData {
  user: AuthenticatedUser;
  joinedGames: Set<string>;
}

/**
 * The single realtime namespace for the whole app: game play (moves, clock,
 * resign/draw/abort), matchmaking pairing pushes, and challenge/friend
 * notifications. Split into one gateway rather than several because they
 * all share the same auth handshake and `user:{id}` personal room.
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: false },
  pingTimeout: 60_000,
  // websocket-only (no HTTP long-polling) means every connection is a
  // single persistent TCP connection from the start - which is what lets
  // clustering (see src/cluster/) work with Node's own default round-robin
  // port sharing across workers, with no sticky-session proxy needed. A
  // polling connection's repeated short-lived requests would need one to
  // keep landing on the same worker, which plain round-robin doesn't
  // guarantee.
  transports: ['websocket'],
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly abandonmentTimers = new Map<string, NodeJS.Timeout>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly gamesService: GamesService,
    private readonly matchmakingService: MatchmakingService,
    private readonly usersService: UsersService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const user = verifySocketToken(this.jwtService, socket);
      (socket.data as SocketData).user = user;
      (socket.data as SocketData).joinedGames = new Set();
      await socket.join(userRoom(user.userId));
      await this.usersService.touchLastSeen(user.userId);
      this.logger.debug(`socket connected: ${socket.id} (user ${user.username})`);
    } catch (error) {
      this.logger.warn(`rejecting unauthenticated socket ${socket.id}: ${(error as Error).message}`);
      socket.emit('auth:error', { message: 'Authentication failed' });
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket): void {
    const data = socket.data as Partial<SocketData>;
    if (!data.user) return;

    const userId = data.user.userId;
    const stillConnectedElsewhere = (this.server.sockets.adapter.rooms.get(userRoom(userId))?.size ?? 0) > 0;
    if (stillConnectedElsewhere) return;

    this.matchmakingService.cancelSeek(userId);

    const graceMs = this.configService.get('game.disconnectGraceMs', { infer: true });
    for (const gameId of data.joinedGames ?? []) {
      this.scheduleAbandonmentForfeit(gameId, userId, graceMs);
    }
  }

  private scheduleAbandonmentForfeit(gameId: string, userId: string, graceMs: number): void {
    const key = `${gameId}:${userId}`;
    const existing = this.abandonmentTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.abandonmentTimers.delete(key);
      void this.gamesService.forfeitByAbandonment(gameId, userId).catch((error) => {
        this.logger.warn(`abandonment forfeit failed for game ${gameId}: ${(error as Error).message}`);
      });
    }, graceMs);
    timer.unref?.();
    this.abandonmentTimers.set(key, timer);
  }

  private cancelAbandonmentForfeit(gameId: string, userId: string): void {
    const key = `${gameId}:${userId}`;
    const existing = this.abandonmentTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.abandonmentTimers.delete(key);
    }
  }

  // Client-initiated RTT probe (see ../../cchess's useConnectionLatency) -
  // Engine.IO's own heartbeat is server-initiated, so it can't be read as a
  // round-trip sample. The client sends its own timestamp via an ack
  // callback (socket.timeout(ms).emit('ping', Date.now(), cb)); echoing it
  // back is all an ack-based RTT measurement needs - returning a non-nil
  // value here is what makes Nest invoke the client's ack callback at all.
  @SubscribeMessage('ping')
  onPing(@MessageBody() clientTime: number): number {
    return clientTime;
  }

  @SubscribeMessage('game:join')
  async onJoinGame(@ConnectedSocket() socket: Socket, @MessageBody() payload: { gameId: string }) {
    const user = (socket.data as SocketData).user;
    (socket.data as SocketData).joinedGames.add(payload.gameId);
    this.cancelAbandonmentForfeit(payload.gameId, user.userId);

    const game = await this.gamesService.getGameWithMoves(payload.gameId);
    socket.emit('game:state', toGameStateDto(game));
  }

  @SubscribeMessage('game:leave')
  onLeaveGame(@ConnectedSocket() socket: Socket, @MessageBody() payload: { gameId: string }) {
    (socket.data as SocketData).joinedGames.delete(payload.gameId);
  }

  @SubscribeMessage('game:move')
  async onMove(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { gameId: string; from: string; to: string; promotion?: string },
  ) {
    const user = (socket.data as SocketData).user;
    try {
      await this.gamesService.applyMove(payload.gameId, user.userId, payload.from, payload.to, payload.promotion);
    } catch (error) {
      this.logIfUnexpected(`game:move (game ${payload.gameId})`, error);
      socket.emit('game:error', { gameId: payload.gameId, message: (error as Error).message });
    }
  }

  @SubscribeMessage('game:resign')
  async onResign(@ConnectedSocket() socket: Socket, @MessageBody() payload: { gameId: string }) {
    await this.guard(socket, payload.gameId, () => this.gamesService.resign(payload.gameId, this.userId(socket)));
  }

  @SubscribeMessage('game:abort')
  async onAbort(@ConnectedSocket() socket: Socket, @MessageBody() payload: { gameId: string }) {
    await this.guard(socket, payload.gameId, () => this.gamesService.abort(payload.gameId, this.userId(socket)));
  }

  @SubscribeMessage('game:drawOffer')
  async onDrawOffer(@ConnectedSocket() socket: Socket, @MessageBody() payload: { gameId: string }) {
    await this.guard(socket, payload.gameId, () => this.gamesService.offerDraw(payload.gameId, this.userId(socket)));
  }

  @SubscribeMessage('game:drawRespond')
  async onDrawRespond(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { gameId: string; accept: boolean },
  ) {
    await this.guard(socket, payload.gameId, () =>
      this.gamesService.respondDraw(payload.gameId, this.userId(socket), payload.accept),
    );
  }

  @SubscribeMessage('matchmaking:seek')
  async onSeek(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { minutes: number; incrementSeconds: number },
  ) {
    const user = await this.usersService.findByIdOrThrow(this.userId(socket));
    try {
      const result = await this.matchmakingService.seek(user, payload);
      socket.emit('matchmaking:status', result.status === 'matched' ? { status: 'matched' } : result);
    } catch (error) {
      this.logIfUnexpected('matchmaking:seek', error);
      socket.emit('matchmaking:error', { message: (error as Error).message });
    }
  }

  @SubscribeMessage('matchmaking:cancel')
  onCancelSeek(@ConnectedSocket() socket: Socket) {
    this.matchmakingService.cancelSeek(this.userId(socket));
  }

  private userId(socket: Socket): string {
    return (socket.data as SocketData).user.userId;
  }

  private async guard(socket: Socket, gameId: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logIfUnexpected(`game action (game ${gameId})`, error);
      socket.emit('game:error', { gameId, message: (error as Error).message });
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

  @OnEvent('game.created')
  onGameCreated({ game }: GameEndedEvent) {
    const dto = toGameStateDto(game);
    this.server.to(userRoom(game.whiteId)).to(userRoom(game.blackId)).emit('game:created', dto);
  }

  @OnEvent('game.move')
  onGameMove({ game, move }: GameMoveEvent) {
    this.server.to(userRoom(game.whiteId)).to(userRoom(game.blackId)).emit('game:move', {
      gameId: game.id,
      move: toMoveDto(move),
      fen: game.fen,
      turn: game.turn,
      whiteTimeRemainingMs: game.whiteTimeRemainingMs,
      blackTimeRemainingMs: game.blackTimeRemainingMs,
    });
  }

  @OnEvent('game.ended')
  onGameEnded({ game }: GameEndedEvent) {
    this.server.to(userRoom(game.whiteId)).to(userRoom(game.blackId)).emit('game:over', toGameStateDto(game));
  }

  @OnEvent('game.drawOffered')
  onDrawOffered({ game }: GameDrawOfferEvent) {
    this.server
      .to(userRoom(game.whiteId))
      .to(userRoom(game.blackId))
      .emit('game:drawOffered', { gameId: game.id, by: game.drawOfferedBy });
  }

  @OnEvent('game.drawDeclined')
  onDrawDeclined({ game }: GameDrawOfferEvent) {
    this.server.to(userRoom(game.whiteId)).to(userRoom(game.blackId)).emit('game:drawDeclined', { gameId: game.id });
  }

  @OnEvent('challenge.created')
  onChallengeCreated({ challenge }: ChallengeCreatedEvent) {
    this.server.to(userRoom(challenge.opponentId)).emit('challenge:received', toChallengeDto(challenge));
  }

  @OnEvent('challenge.accepted')
  onChallengeAccepted({ challenge }: ChallengeAcceptedEvent) {
    this.server.to(userRoom(challenge.challengerId)).emit('challenge:accepted', toChallengeDto(challenge));
  }

  @OnEvent(['challenge.declined', 'challenge.cancelled'])
  onChallengeResolved({ challenge }: ChallengeResolvedEvent) {
    this.server
      .to(userRoom(challenge.challengerId))
      .to(userRoom(challenge.opponentId))
      .emit('challenge:resolved', toChallengeDto(challenge));
  }

  @OnEvent('friend.requestCreated')
  onFriendRequestCreated({ friendship }: FriendRequestEvent) {
    this.server.to(userRoom(friendship.addresseeId)).emit('friend:requestReceived', {
      id: friendship.id,
      from: friendship.requesterId,
    });
  }

  @OnEvent('friend.requestAccepted')
  onFriendRequestAccepted({ friendship }: FriendRequestEvent) {
    this.server
      .to(userRoom(friendship.requesterId))
      .to(userRoom(friendship.addresseeId))
      .emit('friend:requestAccepted', { id: friendship.id });
  }
}
