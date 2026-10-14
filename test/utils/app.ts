import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AppModule } from '../../src/app.module.js';
import { truncateAllTables } from './db.js';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  await truncateAllTables(app.get(DataSource));
  return app;
}

/** Like createTestApp, but actually bound to a real port - needed for Socket.IO tests. */
export async function createListeningTestApp(): Promise<{
  app: INestApplication;
  baseUrl: string;
}> {
  const app = await createTestApp();
  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'string' ? address : address.port;
  return { app, baseUrl: `http://localhost:${port}` };
}

export interface RegisteredUser {
  accessToken: string;
  userId: string;
  username: string;
}

export async function registerUser(
  app: INestApplication,
  usernameSuffix: string,
): Promise<RegisteredUser> {
  const request = (await import('supertest')).default;
  const username = `user_${usernameSuffix}`;
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({
      username,
      email: `${username}@example.com`,
      password: 'password123',
    })
    .expect(201);
  return {
    accessToken: res.body.accessToken,
    userId: res.body.user.id,
    username,
  };
}
