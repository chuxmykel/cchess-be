import {
  type MigrationInterface,
  type QueryRunner,
  TableColumn,
} from 'typeorm';

/** Which version of the terms each player accepted, and when. */
export class AddTermsAcceptance1795400500000 implements MigrationInterface {
  name = 'AddTermsAcceptance1795400500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('users', [
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('users', ['termsVersion', 'termsAcceptedAt']);
  }
}
