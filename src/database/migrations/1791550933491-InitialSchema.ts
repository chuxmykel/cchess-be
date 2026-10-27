import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class InitialSchema1791550933491 implements MigrationInterface {
  name = 'InitialSchema1791550933491';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          { name: 'username', type: 'varchar', length: '32' },
          { name: 'email', type: 'varchar', length: '255', isNullable: true },
          { name: 'passwordHash', type: 'varchar', isNullable: true },
          { name: 'displayName', type: 'varchar', length: '64' },
          { name: 'isGuest', type: 'boolean', default: false },
          { name: 'bio', type: 'varchar', length: '280', isNullable: true },
          { name: 'avatarColor', type: 'varchar', length: '7' },
          { name: 'lastSeenAt', type: 'timestamptz', isNullable: true },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          { name: 'deletedAt', type: 'timestamptz', isNullable: true },
        ],
      }),
    );
    await queryRunner.createIndex(
      'users',
      new TableIndex({
        name: 'IDX_users_username',
        columnNames: ['username'],
        isUnique: true,
      }),
    );
    await queryRunner.createIndex(
      'users',
      new TableIndex({
        name: 'IDX_users_email',
        columnNames: ['email'],
        isUnique: true,
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'ratings',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid' },
          { name: 'category', type: 'varchar', length: '16' },
          { name: 'rating', type: 'int', default: 1200 },
          { name: 'gamesPlayed', type: 'int', default: 0 },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          { name: 'deletedAt', type: 'timestamptz', isNullable: true },
        ],
      }),
    );
    await queryRunner.createIndex(
      'ratings',
      new TableIndex({
        name: 'IDX_ratings_user_category',
        columnNames: ['userId', 'category'],
        isUnique: true,
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'refresh_tokens',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid' },
          { name: 'tokenHash', type: 'varchar' },
          { name: 'expiresAt', type: 'timestamptz' },
          { name: 'revoked', type: 'boolean', default: false },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          { name: 'deletedAt', type: 'timestamptz', isNullable: true },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'challenges',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          { name: 'challengerId', type: 'uuid' },
          { name: 'opponentId', type: 'uuid' },
          { name: 'minutes', type: 'double precision' },
          { name: 'incrementSeconds', type: 'int' },
          {
            name: 'challengerColor',
            type: 'varchar',
            length: '8',
            default: "'random'",
          },
          {
            name: 'status',
            type: 'varchar',
            length: '16',
            default: "'pending'",
          },
          { name: 'gameId', type: 'varchar', isNullable: true },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          { name: 'respondedAt', type: 'timestamptz', isNullable: true },
          { name: 'deletedAt', type: 'timestamptz', isNullable: true },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'friendships',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          { name: 'requesterId', type: 'uuid' },
          { name: 'addresseeId', type: 'uuid' },
          {
            name: 'status',
            type: 'varchar',
            length: '16',
            default: "'pending'",
          },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          { name: 'respondedAt', type: 'timestamptz', isNullable: true },
          { name: 'deletedAt', type: 'timestamptz', isNullable: true },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'games',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          { name: 'whiteId', type: 'uuid' },
          { name: 'blackId', type: 'uuid' },
          { name: 'minutes', type: 'double precision' },
          { name: 'incrementSeconds', type: 'int' },
          { name: 'gameType', type: 'varchar', length: '16' },
          { name: 'rated', type: 'boolean', default: true },
          { name: 'whiteRatingAtStart', type: 'int', isNullable: true },
          { name: 'blackRatingAtStart', type: 'int', isNullable: true },
          { name: 'whiteRatingDiff', type: 'int', isNullable: true },
          { name: 'blackRatingDiff', type: 'int', isNullable: true },
          {
            name: 'status',
            type: 'varchar',
            length: '16',
            default: "'active'",
          },
          { name: 'result', type: 'varchar', length: '8', isNullable: true },
          {
            name: 'resultReason',
            type: 'varchar',
            length: '32',
            isNullable: true,
          },
          { name: 'fen', type: 'varchar' },
          { name: 'pgn', type: 'text', default: "''" },
          { name: 'whiteTimeRemainingMs', type: 'int' },
          { name: 'blackTimeRemainingMs', type: 'int' },
          { name: 'turn', type: 'varchar', length: '1', default: "'w'" },
          { name: 'lastMoveAt', type: 'timestamptz', isNullable: true },
          {
            name: 'drawOfferedBy',
            type: 'varchar',
            length: '8',
            isNullable: true,
          },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          { name: 'endedAt', type: 'timestamptz', isNullable: true },
          { name: 'deletedAt', type: 'timestamptz', isNullable: true },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'moves',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          { name: 'gameId', type: 'uuid' },
          { name: 'ply', type: 'int' },
          { name: 'from', type: 'varchar', length: '2' },
          { name: 'to', type: 'varchar', length: '2' },
          { name: 'piece', type: 'varchar', length: '1' },
          { name: 'color', type: 'varchar', length: '1' },
          { name: 'san', type: 'varchar', length: '16' },
          { name: 'captured', type: 'varchar', length: '1', isNullable: true },
          { name: 'promotion', type: 'varchar', length: '1', isNullable: true },
          { name: 'fenAfter', type: 'varchar' },
          { name: 'clockAfterMs', type: 'int' },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          { name: 'deletedAt', type: 'timestamptz', isNullable: true },
        ],
      }),
    );
    await queryRunner.createIndex(
      'moves',
      new TableIndex({
        name: 'IDX_moves_game_ply',
        columnNames: ['gameId', 'ply'],
        isUnique: true,
      }),
    );

    await queryRunner.createForeignKey(
      'ratings',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'refresh_tokens',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'challenges',
      new TableForeignKey({
        columnNames: ['challengerId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'challenges',
      new TableForeignKey({
        columnNames: ['opponentId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'friendships',
      new TableForeignKey({
        columnNames: ['requesterId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'friendships',
      new TableForeignKey({
        columnNames: ['addresseeId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'games',
      new TableForeignKey({
        columnNames: ['whiteId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'games',
      new TableForeignKey({
        columnNames: ['blackId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'moves',
      new TableForeignKey({
        columnNames: ['gameId'],
        referencedTableName: 'games',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('moves', true, true, true);
    await queryRunner.dropTable('games', true, true, true);
    await queryRunner.dropTable('friendships', true, true, true);
    await queryRunner.dropTable('challenges', true, true, true);
    await queryRunner.dropTable('refresh_tokens', true, true, true);
    await queryRunner.dropTable('ratings', true, true, true);
    await queryRunner.dropTable('users', true, true, true);
  }
}
