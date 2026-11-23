import {
  type MigrationInterface,
  type QueryRunner,
  TableColumn,
} from 'typeorm';

/** When an account was deleted - its row stays, anonymised. */
export class AddAccountDeletion1795400100000 implements MigrationInterface {
  name = 'AddAccountDeletion1795400100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'accountDeletedAt',
        type: 'timestamptz',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'accountDeletedAt');
  }
}
