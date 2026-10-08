import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';
import type { AppConfig } from './config/configuration.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<AppConfig, true>);

  mkdirSync(dirname(configService.get('database.path', { infer: true })), { recursive: true });

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
  console.log(`cchess-be listening on :${port} (docs at /docs)`);
}

await bootstrap();
