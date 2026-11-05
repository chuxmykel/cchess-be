import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { runSeeder } from 'typeorm-extension';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BOT_PASSWORD,
  BOT_USERNAMES,
  Bots1793893286008,
} from '../src/database/seeds/1793893286008-bots.js';
import { createTestApp } from './utils/app.js';

describe('Bot seeder (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp();
    // truncateAllTables only knows the entities' tables, not the record of
    // seeders run - a previous run's would skip the seeder.
    await app.get(DataSource).query('DROP TABLE IF EXISTS "seeds"');
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates every bot once, each able to sign in', async () => {
    const dataSource = app.get(DataSource);
    const first = await runSeeder(dataSource, Bots1793893286008, {
      seedTracking: true,
    });
    expect(first?.result).toEqual(BOT_USERNAMES);
    expect(
      await runSeeder(dataSource, Bots1793893286008, {
        seedTracking: true,
      }),
    ).toBeUndefined();

    for (const username of BOT_USERNAMES) {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ usernameOrEmail: username, password: BOT_PASSWORD })
        .expect(200);
      expect(login.body.user.username).toBe(username);
      expect(login.body.user.ratings).toHaveLength(4);
    }
  });

  it('leaves bots that are already there alone', async () => {
    const dataSource = app.get(DataSource);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        username: 'bot_1',
        email: 'bot_1@example.com',
        password: 'password123',
      })
      .expect(201);

    const seeded = await runSeeder(dataSource, Bots1793893286008, {
      seedTracking: true,
    });
    expect(seeded?.result).toEqual(BOT_USERNAMES.slice(1));
  });
});
