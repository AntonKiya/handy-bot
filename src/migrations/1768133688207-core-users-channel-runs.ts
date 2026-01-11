import { MigrationInterface, QueryRunner } from 'typeorm';

export class CoreUsersChannelRuns1768133688207 implements MigrationInterface {
  name = 'CoreUsersChannelRuns1768133688207';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."core_channel_users_runs_status_enum" AS ENUM('running', 'success', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "core_channel_users_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" bigint NOT NULL, "channel_telegram_chat_id" bigint NOT NULL, "channel_username" character varying(255) NOT NULL, "period" character varying(16) NOT NULL, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL, "status" "public"."core_channel_users_runs_status_enum" NOT NULL DEFAULT 'running', "error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7788c4d2bf48a4b9ab7cc83b650" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92ded43a9521e5f87957105ebe" ON "core_channel_users_runs" ("user_id", "started_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fbf86d650acd4e59f4a41c80da" ON "core_channel_users_runs" ("user_id", "status", "started_at") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fbf86d650acd4e59f4a41c80da"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_92ded43a9521e5f87957105ebe"`,
    );
    await queryRunner.query(`DROP TABLE "core_channel_users_runs"`);
    await queryRunner.query(
      `DROP TYPE "public"."core_channel_users_runs_status_enum"`,
    );
  }
}
