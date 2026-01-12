import { MigrationInterface, QueryRunner } from 'typeorm';

export class SummaryChannelPostUrl1768248646448 implements MigrationInterface {
  name = 'SummaryChannelPostUrl1768248646448';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "summary_channel_results" ADD "post_url" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "summary_channel_results" DROP COLUMN "post_url"`,
    );
  }
}
