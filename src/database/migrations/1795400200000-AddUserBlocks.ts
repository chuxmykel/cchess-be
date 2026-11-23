import {
  type MigrationInterface,
  type QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

/** Players blocking players. */
export class AddUserBlocks1795400200000 implements MigrationInterface {
  name = 'AddUserBlocks1795400200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'user_blocks',
        columns: [
          { name: 'blockerId', type: 'uuid', isPrimary: true },
          { name: 'blockedId', type: 'uuid', isPrimary: true },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          { name: 'deletedAt', type: 'timestamptz', isNullable: true },
        ],
      }),
    );
    for (const column of ['blockerId', 'blockedId']) {
      await queryRunner.createForeignKey(
        'user_blocks',
        new TableForeignKey({
          name: `FK_user_blocks_${column}`,
          columnNames: [column],
          referencedTableName: 'users',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('user_blocks');
  }
}
