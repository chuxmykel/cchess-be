import {
  type MigrationInterface,
  type QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

const timestamps = [
  { name: 'createdAt', type: 'timestamptz', default: 'now()' },
  { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
  { name: 'deletedAt', type: 'timestamptz', isNullable: true },
];

/** Puzzles: lichess's (CC0), imported to a pool (puzzles); each player's
 * tries at them (puzzle_attempts) and puzzle rating (puzzle_ratings); and
 * the tactics they missed in their own games, kept to practise on a spaced
 * schedule (personal_puzzles). See docs/features.md, "Puzzles". */
export class AddPuzzles1795700000000 implements MigrationInterface {
  name = 'AddPuzzles1795700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'puzzles',
        columns: [
          { name: 'id', type: 'varchar', length: '16', isPrimary: true },
          { name: 'fen', type: 'varchar', length: '100' },
          { name: 'moves', type: 'text' },
          { name: 'rating', type: 'int' },
          { name: 'ratingDeviation', type: 'int' },
          { name: 'popularity', type: 'int' },
          { name: 'nbPlays', type: 'int' },
          { name: 'themes', type: 'text', isArray: true },
          ...timestamps,
        ],
      }),
    );
    await queryRunner.createIndex(
      'puzzles',
      new TableIndex({ name: 'IDX_puzzles_rating', columnNames: ['rating'] }),
    );
    // No index on themes: TableIndex can't make a GIN one, and a pool of a
    // few tens of thousands is filtered by theme quickly enough without.

    await queryRunner.createTable(
      new Table({
        name: 'puzzle_attempts',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid' },
          { name: 'puzzleId', type: 'varchar', length: '16' },
          { name: 'solved', type: 'boolean' },
          { name: 'ratingBefore', type: 'real' },
          { name: 'ratingAfter', type: 'real' },
          ...timestamps,
        ],
      }),
    );
    await queryRunner.createIndex(
      'puzzle_attempts',
      new TableIndex({
        name: 'IDX_puzzle_attempts_user',
        columnNames: ['userId', 'createdAt'],
      }),
    );
    await queryRunner.createForeignKeys('puzzle_attempts', [
      new TableForeignKey({
        name: 'FK_puzzle_attempts_user',
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
      new TableForeignKey({
        name: 'FK_puzzle_attempts_puzzle',
        columnNames: ['puzzleId'],
        referencedTableName: 'puzzles',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    ]);

    await queryRunner.createTable(
      new Table({
        name: 'puzzle_ratings',
        columns: [
          { name: 'userId', type: 'uuid', isPrimary: true },
          { name: 'rating', type: 'double precision', default: 1500 },
          { name: 'deviation', type: 'double precision', default: 350 },
          { name: 'volatility', type: 'double precision', default: 0.06 },
          { name: 'lastRatedAt', type: 'timestamptz', isNullable: true },
          { name: 'attempts', type: 'int', default: 0 },
          ...timestamps,
        ],
      }),
    );
    await queryRunner.createForeignKey(
      'puzzle_ratings',
      new TableForeignKey({
        name: 'FK_puzzle_ratings_user',
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'personal_puzzles',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid' },
          { name: 'gameId', type: 'uuid' },
          { name: 'ply', type: 'int' },
          { name: 'fen', type: 'varchar', length: '100' },
          { name: 'solution', type: 'text', isArray: true },
          { name: 'themes', type: 'text', isArray: true },
          { name: 'dueAt', type: 'timestamptz' },
          { name: 'step', type: 'int', default: 0 },
          { name: 'solvedCount', type: 'int', default: 0 },
          { name: 'failedCount', type: 'int', default: 0 },
          { name: 'retiredAt', type: 'timestamptz', isNullable: true },
          ...timestamps,
        ],
      }),
    );
    await queryRunner.createIndices('personal_puzzles', [
      new TableIndex({
        name: 'UQ_personal_puzzles_user_game_ply',
        columnNames: ['userId', 'gameId', 'ply'],
        isUnique: true,
      }),
      new TableIndex({
        name: 'IDX_personal_puzzles_due',
        columnNames: ['userId', 'dueAt'],
      }),
    ]);
    await queryRunner.createForeignKeys('personal_puzzles', [
      new TableForeignKey({
        name: 'FK_personal_puzzles_user',
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
      new TableForeignKey({
        name: 'FK_personal_puzzles_game',
        columnNames: ['gameId'],
        referencedTableName: 'games',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('personal_puzzles');
    await queryRunner.dropTable('puzzle_ratings');
    await queryRunner.dropTable('puzzle_attempts');
    await queryRunner.dropTable('puzzles');
  }
}
