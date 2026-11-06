import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The daily games still being played, which DailyDeadlineSweeper reads
 * every minute - a small share of all games, so a partial index. */
export class AddActiveDailyGamesIndex1793911311000 implements MigrationInterface {
  name = 'AddActiveDailyGamesIndex1793911311000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // IF NOT EXISTS: an earlier draft of this migration, under another
    // timestamp, already made it in some development databases.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_games_active_daily" ON "games" ("whiteId", "blackId")
       WHERE status = 'active' AND "gameType" = 'daily'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_games_active_daily"`);
  }
}
