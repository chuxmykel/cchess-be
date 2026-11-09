import { type MigrationInterface, type QueryRunner, Table } from 'typeorm';

/** What the lichess queue has learned of lichess's rate limit, in one row,
 * so a restart doesn't start from scratch (see LichessFetchState). */
export class AddLichessFetchState1793915400000 implements MigrationInterface {
  name = 'AddLichessFetchState1793915400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'lichess_fetch_state',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            primaryKeyConstraintName: 'PK_lichess_fetch_state',
          },
          { name: 'gapMs', type: 'int' },
          { name: 'floorMs', type: 'int' },
          { name: 'floorSetAt', type: 'timestamptz', isNullable: true },
          { name: 'rateLimitedInARow', type: 'int', default: 0 },
          { name: 'pausedUntil', type: 'timestamptz', isNullable: true },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          { name: 'deletedAt', type: 'timestamptz', isNullable: true },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('lichess_fetch_state');
  }
}
