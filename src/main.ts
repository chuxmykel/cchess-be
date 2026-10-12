import cluster from 'node:cluster';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createClient } from 'redis';

import { AppModule } from './app.module.js';
import { ClusterIoAdapter } from './cluster/cluster-io-adapter.js';
import { CLUSTERING_ENABLED, CLUSTER_WORKERS } from './cluster/cluster.util.js';
import type { AppConfig } from './config/configuration.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<AppConfig, true>);

  if (CLUSTERING_ENABLED) {
    // Cross-worker Socket.IO room broadcast (see cluster-io-adapter.ts) -
    // only needed when actually sharded, so a non-clustered boot never
    // requires Redis to be running.
    const redisLogger = new Logger('Redis');
    const auth = process.env.REDIS_PASSWORD ? `:${process.env.REDIS_PASSWORD}@` : '';
    const url = `redis://${auth}${process.env.REDIS_HOST ?? '127.0.0.1'}:${process.env.REDIS_PORT ?? 6379}`;
    const pubClient = createClient({ url });
    const subClient = pubClient.duplicate();
    // node-redis emits 'error' on every connection hiccup (including
    // transient, auto-retried ones) - without a listener here, an
    // unhandled 'error' event crashes the whole worker process outright,
    // which is a far worse failure mode than a dropped cross-worker
    // broadcast while Redis reconnects.
    pubClient.on('error', (error: Error) => redisLogger.error(`pub client error: ${error.message}`));
    subClient.on('error', (error: Error) => redisLogger.error(`sub client error: ${error.message}`));
    await Promise.all([pubClient.connect(), subClient.connect()]);
    redisLogger.log(`connected (${url.replace(auth, auth ? ':***@' : '')})`);
    app.useWebSocketAdapter(new ClusterIoAdapter(app, pubClient, subClient));
  }

  app.enableCors({ origin: configService.get('corsOrigin', { infer: true }), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('cchess API')
    .setDescription(
      'Chess game server: auth, profiles, friends, matchmaking, challenges, and real-time play. ' +
        'REST handles everything except moves/live state, which also stream over Socket.IO - see README.md.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = configService.get('port', { infer: true });
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(
    `cchess-be listening on :${port} (docs at /docs)` +
      (CLUSTERING_ENABLED ? ` [cluster worker ${process.env.CLUSTER_WORKER_INDEX}/${CLUSTER_WORKERS}]` : ''),
  );
}

if (CLUSTERING_ENABLED && cluster.isPrimary) {
  // The primary only forks workers and relays their IPC traffic - it never
  // boots a Nest app itself (see cluster-primary.ts and CLAUDE.md).
  const { runClusterPrimary } = await import('./cluster/cluster-primary.js');
  runClusterPrimary(CLUSTER_WORKERS);
} else {
  await bootstrap();
}
