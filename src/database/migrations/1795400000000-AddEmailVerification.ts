import {
  type MigrationInterface,
  type QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

/** Verified emails, and the single-use links that verify an address,
 * change it, or reset a password. */
export class AddEmailVerification1795400000000 implements MigrationInterface {
  name = 'AddEmailVerification1795400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'emailVerifiedAt',
        type: 'timestamptz',
        isNullable: true,
      }),
    );
    await queryRunner.createTable(
      new Table({
        name: 'email_tokens',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid' },
          { name: 'purpose', type: 'varchar', length: '16' },
          { name: 'tokenHash', type: 'varchar', length: '64' },
          { name: 'email', type: 'varchar', length: '255' },
          { name: 'expiresAt', type: 'timestamptz' },
          { name: 'usedAt', type: 'timestamptz', isNullable: true },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          { name: 'deletedAt', type: 'timestamptz', isNullable: true },
        ],
      }),
    );
    await queryRunner.createIndex(
      'email_tokens',
      new TableIndex({
        name: 'IDX_email_tokens_tokenHash',
        columnNames: ['tokenHash'],
        isUnique: true,
      }),
    );
    await queryRunner.createForeignKey(
      'email_tokens',
      new TableForeignKey({
        name: 'FK_email_tokens_userId',
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('email_tokens');
    await queryRunner.dropColumn('users', 'emailVerifiedAt');
  }
}
