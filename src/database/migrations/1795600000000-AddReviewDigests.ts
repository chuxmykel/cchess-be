import {
  type MigrationInterface,
  type QueryRunner,
  TableColumn,
} from 'typeorm';

/** Each side's review boiled down, kept with the review (GameReview.digests). */
export class AddReviewDigests1795600000000 implements MigrationInterface {
  name = 'AddReviewDigests1795600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'game_reviews',
      new TableColumn({ name: 'digests', type: 'jsonb', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('game_reviews', 'digests');
  }
}
