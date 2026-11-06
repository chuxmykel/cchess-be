import {
  type MigrationInterface,
  type QueryRunner,
  Table,
  type TableColumnOptions,
  TableForeignKey,
  TableUnique,
} from 'typeorm';

import { SEED_POSITIONS } from '../../explorer/seed-positions.js';

/** Rows inserted at a time - well under Postgres's 65,535 parameters. */
const SEED_BATCH = 1_000;

const TIMESTAMPS: TableColumnOptions[] = [
  { name: 'createdAt', type: 'timestamptz', default: 'now()' },
  { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
  { name: 'deletedAt', type: 'timestamptz', isNullable: true },
];

/** The opening explorer's lichess cache: each position looked up, kept for
 * good, and lichess's answer for it, kept while it's opened. The opening
 * book's positions go in pinned, for both databases, to be fetched in the
 * background (see README, "Opening explorer"). */
export class AddExplorerCache1793914800000 implements MigrationInterface {
  name = 'AddExplorerCache1793914800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'explorer_positions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            primaryKeyConstraintName: 'PK_explorer_positions',
            default: 'uuid_generate_v4()',
          },
          { name: 'db', type: 'varchar', length: '16' },
          { name: 'epd', type: 'varchar', length: '100' },
          { name: 'hits', type: 'integer', default: 0 },
          { name: 'lastOpenedAt', type: 'timestamptz', isNullable: true },
          { name: 'pinned', type: 'boolean', default: false },
          ...TIMESTAMPS,
        ],
      }),
    );
    await queryRunner.createUniqueConstraint(
      'explorer_positions',
      new TableUnique({
        name: 'UQ_explorer_positions_db_epd',
        columnNames: ['db', 'epd'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'explorer_cache',
        columns: [
          {
            name: 'positionId',
            type: 'uuid',
            isPrimary: true,
            primaryKeyConstraintName: 'PK_explorer_cache',
          },
          { name: 'payload', type: 'json' },
          { name: 'fetchedAt', type: 'timestamptz' },
          ...TIMESTAMPS,
        ],
      }),
    );
    await queryRunner.createForeignKey(
      'explorer_cache',
      new TableForeignKey({
        name: 'FK_explorer_cache_position',
        columnNames: ['positionId'],
        referencedTableName: 'explorer_positions',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    const seed = SEED_POSITIONS.flatMap((epd) =>
      ['masters', 'lichess'].map((db) => ({ db, epd, pinned: true })),
    );
    for (let i = 0; i < seed.length; i += SEED_BATCH) {
      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into('explorer_positions', ['db', 'epd', 'pinned'])
        .values(seed.slice(i, i + SEED_BATCH))
        .execute();
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('explorer_cache');
    await queryRunner.dropTable('explorer_positions');
  }
}
