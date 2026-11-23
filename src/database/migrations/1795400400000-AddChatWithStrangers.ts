import {
  type MigrationInterface,
  type QueryRunner,
  TableColumn,
} from 'typeorm';

/** Whether a player chats in games with players who aren't friends - off
 * until they turn it on. */
export class AddChatWithStrangers1795400400000 implements MigrationInterface {
  name = 'AddChatWithStrangers1795400400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'chatWithStrangers',
        type: 'boolean',
        default: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'chatWithStrangers');
  }
}
