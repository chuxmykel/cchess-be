import { type MigrationInterface, type QueryRunner } from 'typeorm';

import { SEED_POSITIONS } from '../../explorer/seed-positions.js';

/** The opening explorer's lichess cache: each position looked up, kept for
 * good, and lichess's answer for it, kept while it's opened. The opening
 * book's positions go in pinned, for both databases, to be fetched in the
 * background (see README, "Opening explorer"). */
export class AddExplorerCache1793914800000 implements MigrationInterface {
  name = 'AddExplorerCache1793914800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "explorer_positions" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "db" varchar(16) NOT NULL,
         "epd" varchar(100) NOT NULL,
         "hits" integer NOT NULL DEFAULT 0,
         "lastOpenedAt" timestamptz,
         "pinned" boolean NOT NULL DEFAULT false,
         "createdAt" timestamptz NOT NULL DEFAULT now(),
         "updatedAt" timestamptz NOT NULL DEFAULT now(),
         "deletedAt" timestamptz,
         CONSTRAINT "PK_explorer_positions" PRIMARY KEY ("id"),
         CONSTRAINT "UQ_explorer_positions_db_epd" UNIQUE ("db", "epd")
       )`,
    );
    await queryRunner.query(
      `CREATE TABLE "explorer_cache" (
         "positionId" uuid NOT NULL,
         "payload" json NOT NULL,
         "fetchedAt" timestamptz NOT NULL,
         "createdAt" timestamptz NOT NULL DEFAULT now(),
         "updatedAt" timestamptz NOT NULL DEFAULT now(),
         "deletedAt" timestamptz,
         CONSTRAINT "PK_explorer_cache" PRIMARY KEY ("positionId"),
         CONSTRAINT "FK_explorer_cache_position" FOREIGN KEY ("positionId")
           REFERENCES "explorer_positions"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `INSERT INTO "explorer_positions" ("db", "epd", "pinned")
       SELECT db, epd, true FROM unnest($1::varchar[]) AS epd
       CROSS JOIN (VALUES ('masters'), ('lichess')) AS dbs(db)`,
      [SEED_POSITIONS],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "explorer_cache"`);
    await queryRunner.query(`DROP TABLE "explorer_positions"`);
  }
}
