import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  return app;
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
    .send({ username, email: `${username}@example.com`, password: 'password123' })
    .expect(201);
  return { accessToken: res.body.accessToken, userId: res.body.user.id, username };
}
