import {
  type MigrationInterface,
  type QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

/** Badges: each one a player earned - in a game, from the game or its
 * review, or a milestone, with the game that reached it (user_badges); and
 * each reviewed move's class, kept with its review, which the review's
 * badges are read from. See docs/features.md, "Badges". */
export class AddUserBadges1795800000000 implements MigrationInterface {
  name = 'AddUserBadges1795800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'user_badges',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid' },
          { name: 'kind', type: 'varchar', length: '32' },
          { name: 'gameId', type: 'uuid', isNullable: true },
          { name: 'category', type: 'varchar', length: '16', isNullable: true },
          { name: 'value', type: 'int', isNullable: true },
          { name: 'key', type: 'varchar', length: '80' },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          { name: 'deletedAt', type: 'timestamptz', isNullable: true },
        ],
      }),
    );
    await queryRunner.createIndices('user_badges', [
      new TableIndex({
        name: 'UQ_user_badges_user_key',
        columnNames: ['userId', 'key'],
        isUnique: true,
      }),
      new TableIndex({
        name: 'IDX_user_badges_user',
        columnNames: ['userId', 'createdAt'],
      }),
    ]);
    await queryRunner.createForeignKeys('user_badges', [
      new TableForeignKey({
        name: 'FK_user_badges_user',
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
      new TableForeignKey({
        name: 'FK_user_badges_game',
        columnNames: ['gameId'],
        referencedTableName: 'games',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    ]);
    await queryRunner.addColumn(
      'game_reviews',
      new TableColumn({ name: 'moveClasses', type: 'jsonb', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('game_reviews', 'moveClasses');
    await queryRunner.dropTable('user_badges');
  }
}
