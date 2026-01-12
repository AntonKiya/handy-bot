import { MigrationInterface, QueryRunner } from 'typeorm';

export class SummaryAdditionalFields1768221414726 implements MigrationInterface {
  name = 'SummaryAdditionalFields1768221414726';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."summary_channel_results_status_enum" AS ENUM('ok', 'skipped', 'error')`,
    );
    await queryRunner.query(
      `ALTER TABLE "summary_channel_results" ADD "status" "public"."summary_channel_results_status_enum" NOT NULL DEFAULT 'ok'`,
    );
    await queryRunner.query(
      `ALTER TABLE "summary_channel_results" ADD "reason" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "summary_channel_results" DROP COLUMN "reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "summary_channel_results" DROP COLUMN "status"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."summary_channel_results_status_enum"`,
    );
  }
}
