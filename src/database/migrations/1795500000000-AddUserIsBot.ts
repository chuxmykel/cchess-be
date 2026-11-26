import {
  type MigrationInterface,
  type QueryRunner,
  TableColumn,
} from 'typeorm';

/** Whether an account is a computer opponent (User.isBot). */
export class AddUserIsBot1795500000000 implements MigrationInterface {
  name = 'AddUserIsBot1795500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({ name: 'isBot', type: 'boolean', default: false }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'isBot');
  }
}
