import { MigrationInterface, QueryRunner } from 'typeorm';

export class SummaryChannelHistoricalTables1767983628150 implements MigrationInterface {
  name = 'SummaryChannelHistoricalTables1767983628150';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "summary_channel_results" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "run_id" uuid NOT NULL, "telegram_post_id" integer NOT NULL, "original_text" text NOT NULL, "summary_text" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7b7cdf7c846b42524b85f4105ad" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_18b2750c181947089ad86d40b8" ON "summary_channel_results" ("run_id", "telegram_post_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_af508da7448511e401ca9bc144" ON "summary_channel_results" ("run_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."summary_channel_runs_status_enum" AS ENUM('running', 'success', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "summary_channel_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" bigint NOT NULL, "channel_telegram_chat_id" bigint NOT NULL, "is_immediate_run" boolean NOT NULL DEFAULT false, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL, "status" "public"."summary_channel_runs_status_enum" NOT NULL DEFAULT 'running', "error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7ac65a9bb8a2b7bca52a0128bf7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5a65c26319c76b73f45d35a279" ON "summary_channel_runs" ("user_id", "is_immediate_run", "status", "started_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "summary_channel_results" ADD CONSTRAINT "FK_af508da7448511e401ca9bc1444" FOREIGN KEY ("run_id") REFERENCES "summary_channel_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "summary_channel_results" DROP CONSTRAINT "FK_af508da7448511e401ca9bc1444"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5a65c26319c76b73f45d35a279"`,
    );
    await queryRunner.query(`DROP TABLE "summary_channel_runs"`);
    await queryRunner.query(
      `DROP TYPE "public"."summary_channel_runs_status_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_af508da7448511e401ca9bc144"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_18b2750c181947089ad86d40b8"`,
    );
    await queryRunner.query(`DROP TABLE "summary_channel_results"`);
  }
}
