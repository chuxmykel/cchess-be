import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Each move's position before it was played (see position-key.ts), for
 * the opening explorer - every move so far filled in from the move before
 * it, or the usual starting position for a game's first. */
export class AddMovePositionKeys1793913000000 implements MigrationInterface {
  name = 'AddMovePositionKeys1793913000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "moves" ADD "positionKey" varchar(100)`,
    );
    await queryRunner.query(
      `UPDATE "moves" AS m SET "positionKey" = before.key
       FROM (
         SELECT id, array_to_string((string_to_array(COALESCE(
           LAG("fenAfter") OVER (PARTITION BY "gameId" ORDER BY ply),
           'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
         ), ' '))[1:4], ' ') AS key
         FROM "moves"
       ) AS before
       WHERE m.id = before.id`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_moves_position_key" ON "moves" ("positionKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_moves_position_key"`);
    await queryRunner.query(`ALTER TABLE "moves" DROP COLUMN "positionKey"`);
  }
}
