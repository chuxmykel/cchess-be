import {
  type MigrationInterface,
  type QueryRunner,
  TableColumn,
} from 'typeorm';

const SOFT_DELETED = ['daily_seeks', 'conditional_moves', 'game_notes'];

/** The timestamps every table has, for the three made without some of them:
 * their deletes become soft deletes. */
export class AddMissingTimestamps1793914200000 implements MigrationInterface {
  name = 'AddMissingTimestamps1793914200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'daily_seeks',
      new TableColumn({
        name: 'updatedAt',
        type: 'timestamptz',
        default: 'now()',
      }),
    );
    await queryRunner.manager
      .createQueryBuilder()
      .update('daily_seeks')
      .set({ updatedAt: () => '"createdAt"' })
      .execute();
    for (const table of SOFT_DELETED) {
      await queryRunner.addColumn(
        table,
        new TableColumn({
          name: 'deletedAt',
          type: 'timestamptz',
          isNullable: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of SOFT_DELETED) {
      await queryRunner.manager
        .createQueryBuilder()
        .delete()
        .from(table)
        .where('"deletedAt" IS NOT NULL')
        .execute();
      await queryRunner.dropColumn(table, 'deletedAt');
    }
    await queryRunner.dropColumn('daily_seeks', 'updatedAt');
  }
}
