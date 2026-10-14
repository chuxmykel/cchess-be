import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import type { ServerOptions } from 'socket.io';

import { requireEnv } from '../common/require-env.js';

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

/**
 * Connects the Redis clients above and attaches a ClusterIoAdapter to the
 * app - only called when actually sharded (see main.ts), so a
 * non-clustered boot never requires Redis to be running. REDIS_HOST/
 * REDIS_PORT have no fallback here (same reasoning as the DB vars in
 * configuration.ts) - a missing one should fail loudly rather than risk
 * silently connecting to whatever happens to be listening on
 * 127.0.0.1:6379. REDIS_PASSWORD is optional: a password-less Redis is a
 * normal setup, not a guessed-at value standing in for a real one.
 */
export async function setupClusterRedisAdapter(app: INestApplication): Promise<void> {
  const redisLogger = new Logger('Redis');
  const auth = process.env.REDIS_PASSWORD ? `:${process.env.REDIS_PASSWORD}@` : '';
  const url = `redis://${auth}${requireEnv('REDIS_HOST')}:${requireEnv('REDIS_PORT')}`;
  const pubClient = createClient({ url });
  const subClient = pubClient.duplicate();
  // node-redis emits 'error' on every connection hiccup (including
  // transient, auto-retried ones) - without a listener here, an unhandled
  // 'error' event crashes the whole worker process outright, which is a
  // far worse failure mode than a dropped cross-worker broadcast while
  // Redis reconnects.
  pubClient.on('error', (error: Error) => redisLogger.error(`pub client error: ${error.message}`));
  subClient.on('error', (error: Error) => redisLogger.error(`sub client error: ${error.message}`));
  await Promise.all([pubClient.connect(), subClient.connect()]);
  redisLogger.log(`connected (${url.replace(auth, auth ? ':***@' : '')})`);
  app.useWebSocketAdapter(new ClusterIoAdapter(app, pubClient, subClient));
}
