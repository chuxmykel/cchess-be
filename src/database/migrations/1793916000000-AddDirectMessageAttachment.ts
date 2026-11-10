import {
  type MigrationInterface,
  type QueryRunner,
  TableColumn,
} from 'typeorm';

/** A game or position sent with a direct message (see MessageAttachment). */
export class AddDirectMessageAttachment1793916000000 implements MigrationInterface {
  name = 'AddDirectMessageAttachment1793916000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'direct_messages',
      new TableColumn({ name: 'attachment', type: 'jsonb', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('direct_messages', 'attachment');
  }
}
