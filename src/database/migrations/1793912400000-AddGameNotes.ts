import {
  type MigrationInterface,
  type QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

/** Each player's own notes on a game. */
export class AddGameNotes1793912400000 implements MigrationInterface {
  name = 'AddGameNotes1793912400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'game_notes',
        columns: [
          { name: 'userId', type: 'uuid', isPrimary: true },
          { name: 'gameId', type: 'uuid', isPrimary: true },
          { name: 'body', type: 'varchar', length: '4000' },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
        ],
      }),
    );
    for (const [column, table] of [
      ['userId', 'users'],
      ['gameId', 'games'],
    ]) {
      await queryRunner.createForeignKey(
        'game_notes',
        new TableForeignKey({
          columnNames: [column],
          referencedTableName: table,
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('game_notes');
  }
}
