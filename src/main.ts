import cluster from 'node:cluster';

import type { INestApplication } from '@nestjs/common';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';
import { setupClusterRedisAdapter } from './cluster/cluster-io-adapter.js';
import { CLUSTERING_ENABLED, CLUSTER_WORKERS } from './cluster/cluster.util.js';
import {
  DEFAULT_LOG_LEVEL,
  isLogLevel,
  logLevelsFrom,
} from './common/log-levels.js';
import type { AppConfig } from './config/configuration.js';

function configureCors(
  app: INestApplication,
  configService: ConfigService<AppConfig, true>,
): void {
  app.enableCors({
    origin: configService.get('corsOrigin', { infer: true }),
    credentials: true,
  });
}

function configureValidationPipe(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
}

function setupSwagger(app: INestApplication): void {
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
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  // Read straight from the environment, not ConfigService: the logger has
  // to be given before the app exists. dotenv has already loaded .env by
  // now (cluster.util.ts, reached through AppModule's imports).
  const logLevel = process.env.LOG_LEVEL?.trim().toLowerCase();
  const app = await NestFactory.create(AppModule, {
    logger: logLevelsFrom(logLevel),
  });
  if (logLevel && !isLogLevel(logLevel)) {
    logger.warn(
      `LOG_LEVEL "${process.env.LOG_LEVEL}" isn't a level - using "${DEFAULT_LOG_LEVEL}"`,
    );
  }
  const configService = app.get(ConfigService<AppConfig, true>);

  if (CLUSTERING_ENABLED) await setupClusterRedisAdapter(app);

  configureCors(app, configService);
  configureValidationPipe(app);
  setupSwagger(app);

  const port = configService.get('port', { infer: true });
  await app.listen(port);
  logger.log(
    `✅ cchess-be listening on :${port} (docs 📚 at /docs)` +
      (CLUSTERING_ENABLED
        ? ` [cluster worker ${process.env.CLUSTER_WORKER_INDEX}/${CLUSTER_WORKERS}]`
        : ''),
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
