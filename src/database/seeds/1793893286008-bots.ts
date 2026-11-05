import * as bcrypt from 'bcrypt';
import type { DataSource } from 'typeorm';
import type { Seeder } from 'typeorm-extension';

import { BCRYPT_ROUNDS } from '../../auth/auth.service.js';
import { Rating } from '../../users/entities/rating.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { UsersService } from '../../users/users.service.js';

/** Accounts for the client's scripted opponent (`../cchess`'s
 * `npm run opponent -- --user bot_1`) to play as - one per bot running at
 * once, since an account can only be in one game. */
export const BOT_USERNAMES = ['bot_1', 'bot_2', 'bot_3', 'bot_4', 'bot_5'];
/** Every bot's password - they're for local testing, never production. */
export const BOT_PASSWORD = 'password';

/** Creates the bots, each a registered account with the usual starting
 * ratings. Runs once, like a migration - recorded in the `seeds` table -
 * but a bot already there (made by hand, or before seeding was tracked) is
 * left as it is, ratings and games included. */
export class Bots1793893286008 implements Seeder {
  async run(dataSource: DataSource): Promise<string[]> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to seed bot accounts in production');
    }
    const users = new UsersService(
      dataSource.getRepository(User),
      dataSource.getRepository(Rating),
    );
    const passwordHash = await bcrypt.hash(BOT_PASSWORD, BCRYPT_ROUNDS);
    const created: string[] = [];
    for (const username of BOT_USERNAMES) {
      if (await users.findByUsername(username)) continue;
      await users.createRegisteredUser({
        username,
        email: `${username}@bots.cchess.test`,
        passwordHash,
      });
      created.push(username);
    }
    return created;
  }
}
