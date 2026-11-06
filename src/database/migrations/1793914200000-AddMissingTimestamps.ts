import { type MigrationInterface, type QueryRunner } from 'typeorm';

/** The timestamps every table has, for the three made without some of them:
 * their deletes become soft deletes. */
export class AddMissingTimestamps1793914200000 implements MigrationInterface {
  name = 'AddMissingTimestamps1793914200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "daily_seeks" ADD "updatedAt" timestamptz NOT NULL DEFAULT now()`,
    );
    await queryRunner.query(
      `UPDATE "daily_seeks" SET "updatedAt" = "createdAt"`,
    );
    for (const table of ['daily_seeks', 'conditional_moves', 'game_notes']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD "deletedAt" timestamptz`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['daily_seeks', 'conditional_moves', 'game_notes']) {
      await queryRunner.query(
        `DELETE FROM "${table}" WHERE "deletedAt" IS NOT NULL`,
      );
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "deletedAt"`);
    }
    await queryRunner.query(
      `ALTER TABLE "daily_seeks" DROP COLUMN "updatedAt"`,
    );
  }
}
