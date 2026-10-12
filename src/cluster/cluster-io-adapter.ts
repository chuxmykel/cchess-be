import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { RedisClientType } from 'redis';
import type { ServerOptions } from 'socket.io';

/**
 * Makes `RealtimeGateway`'s `server.to(room).emit(...)` calls reach sockets
 * connected to OTHER worker processes, not just this one - needed because a
 * game's two players (or two challenge participants) can end up on
 * different workers. `RealtimeGateway` itself needs no changes: its
 * `@OnEvent` listeners already only fire on whichever worker actually ran
 * the mutation (see GamesService's ownership routing), and this adapter is
 * what fans that one broadcast out to every worker's matching sockets.
 *
 * Backed by Redis pub/sub, not `@socket.io/cluster-adapter`'s plain Node
 * `cluster` IPC relay - load-testing this under concurrent load (~100
 * simultaneous games) found the IPC-based adapter silently drops some
 * broadcasts under that volume (confirmed via diagnostic logging: moves
 * applied correctly every time, but some sockets never received the
 * broadcast for an intermediate move, desyncing their local ply count and
 * then rejecting their own next move as "not your turn"). Redis pub/sub
 * doesn't have that failure mode at this scale.
 */
export class ClusterIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly pubClient: RedisClientType,
    private readonly subClient: RedisClientType,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): ReturnType<IoAdapter['createIOServer']> {
    const server = super.createIOServer(port, options);
    server.adapter(createAdapter(this.pubClient, this.subClient));
    return server;
  }
}
