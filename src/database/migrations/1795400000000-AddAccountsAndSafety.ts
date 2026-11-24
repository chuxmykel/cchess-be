import {
  type MigrationInterface,
  type QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

/** What the app stores need of accounts and their safety, at once:
 * verified emails and the single-use links that verify, change or reset
 * (email_tokens); deleted and suspended accounts; players blocking players
 * (user_blocks) and reporting them (reports); whether a player chats with
 * strangers; and which terms each accepted. See docs/features.md,
 * "Accounts and safety". */
export class AddAccountsAndSafety1795400000000 implements MigrationInterface {
  name = 'AddAccountsAndSafety1795400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('users', [
      new TableColumn({
        name: 'emailVerifiedAt',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'accountDeletedAt',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'suspendedAt',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'chatWithStrangers',
        type: 'boolean',
        default: false,
      }),
      new TableColumn({
        name: 'termsVersion',
        type: 'varchar',
        length: '32',
        isNullable: true,
      }),
      new TableColumn({
        name: 'termsAcceptedAt',
        type: 'timestamptz',
        isNullable: true,
      }),
    ]);

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

    // Every one of them on a user, deleted with it.
    for (const [table, column] of [
      ['email_tokens', 'userId'],
      ['user_blocks', 'blockerId'],
      ['user_blocks', 'blockedId'],
      ['reports', 'reporterId'],
      ['reports', 'reportedUserId'],
    ]) {
      await queryRunner.createForeignKey(
        table,
        new TableForeignKey({
          name: `FK_${table}_${column}`,
          columnNames: [column],
          referencedTableName: 'users',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('reports');
    await queryRunner.dropTable('user_blocks');
    await queryRunner.dropTable('email_tokens');
    await queryRunner.dropColumns('users', [
      'emailVerifiedAt',
      'accountDeletedAt',
      'suspendedAt',
      'chatWithStrangers',
      'termsVersion',
      'termsAcceptedAt',
    ]);
  }
}
