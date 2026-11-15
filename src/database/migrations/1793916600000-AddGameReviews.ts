import {
  type MigrationInterface,
  type QueryRunner,
  Table,
  type TableColumnOptions,
  TableForeignKey,
} from 'typeorm';

const TIMESTAMPS: TableColumnOptions[] = [
  { name: 'createdAt', type: 'timestamptz', default: 'now()' },
  { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
  { name: 'deletedAt', type: 'timestamptz', isNullable: true },
];

/** Each finished game's review: the engine's evals of its positions, worked
 * out on a player's device, and each side's accuracy. */
export class AddGameReviews1793916600000 implements MigrationInterface {
  name = 'AddGameReviews1793916600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'game_reviews',
        columns: [
          {
            name: 'gameId',
            type: 'uuid',
            isPrimary: true,
            primaryKeyConstraintName: 'PK_game_reviews',
          },
          { name: 'createdById', type: 'uuid', isNullable: true },
          { name: 'engine', type: 'varchar', length: '64' },
          { name: 'depth', type: 'int' },
          { name: 'whiteAccuracy', type: 'real' },
          { name: 'blackAccuracy', type: 'real' },
          { name: 'evals', type: 'jsonb' },
          ...TIMESTAMPS,
        ],
      }),
    );
    await queryRunner.createForeignKey(
      'game_reviews',
      new TableForeignKey({
        name: 'FK_game_reviews_game',
        columnNames: ['gameId'],
        referencedTableName: 'games',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'game_reviews',
      new TableForeignKey({
        name: 'FK_game_reviews_created_by',
        columnNames: ['createdById'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('game_reviews');
  }
}
