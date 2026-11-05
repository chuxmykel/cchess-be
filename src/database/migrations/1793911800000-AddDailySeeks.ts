import {
  type MigrationInterface,
  type QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

/** Daily games' seeks, which wait in the database for an opponent. */
export class AddDailySeeks1793911800000 implements MigrationInterface {
  name = 'AddDailySeeks1793911800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'daily_seeks',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid' },
          { name: 'initialSeconds', type: 'int' },
          { name: 'rated', type: 'boolean' },
          { name: 'rating', type: 'int', isNullable: true },
          { name: 'ratingBelow', type: 'int', isNullable: true },
          { name: 'ratingAbove', type: 'int', isNullable: true },
          { name: 'color', type: 'varchar', length: '8' },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
        ],
      }),
    );
    await queryRunner.createIndex(
      'daily_seeks',
      new TableIndex({
        name: 'IDX_daily_seeks_time_control',
        columnNames: ['initialSeconds', 'rated'],
      }),
    );
    await queryRunner.createIndex(
      'daily_seeks',
      new TableIndex({
        name: 'IDX_daily_seeks_user',
        columnNames: ['userId'],
      }),
    );
    await queryRunner.createForeignKey(
      'daily_seeks',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('daily_seeks');
  }
}
