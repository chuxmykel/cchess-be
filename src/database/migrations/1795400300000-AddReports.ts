import {
  type MigrationInterface,
  type QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
} from 'typeorm';

/** Players' reports of each other, and suspended accounts. */
export class AddReports1795400300000 implements MigrationInterface {
  name = 'AddReports1795400300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'reports',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          { name: 'reporterId', type: 'uuid' },
          { name: 'reportedUserId', type: 'uuid' },
          { name: 'reason', type: 'varchar', length: '16' },
          { name: 'details', type: 'varchar', length: '500', isNullable: true },
          { name: 'gameId', type: 'uuid', isNullable: true },
          { name: 'messageId', type: 'uuid', isNullable: true },
          {
            name: 'messageText',
            type: 'varchar',
            length: '1000',
            isNullable: true,
          },
          { name: 'status', type: 'varchar', length: '16', default: "'open'" },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          { name: 'deletedAt', type: 'timestamptz', isNullable: true },
        ],
      }),
    );
    for (const column of ['reporterId', 'reportedUserId']) {
      await queryRunner.createForeignKey(
        'reports',
        new TableForeignKey({
          name: `FK_reports_${column}`,
          columnNames: [column],
          referencedTableName: 'users',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
    }
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'suspendedAt',
        type: 'timestamptz',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'suspendedAt');
    await queryRunner.dropTable('reports');
  }
}
