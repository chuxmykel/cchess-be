import {
  type MigrationInterface,
  type QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

/** Each player's conditional moves in a daily game. */
export class AddConditionalMoves1793913600000 implements MigrationInterface {
  name = 'AddConditionalMoves1793913600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'conditional_moves',
        columns: [
          { name: 'userId', type: 'uuid', isPrimary: true },
          { name: 'gameId', type: 'uuid', isPrimary: true },
          { name: 'basePly', type: 'int' },
          { name: 'tree', type: 'jsonb' },
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
        'conditional_moves',
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
    await queryRunner.dropTable('conditional_moves');
  }
}
