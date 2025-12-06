import { MigrationInterface, QueryRunner } from 'typeorm';

export class CoreUsersFeature1765048617411 implements MigrationInterface {
  name = 'CoreUsersFeature1765048617411';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "channel_posts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "telegram_post_id" bigint NOT NULL, "published_at" TIMESTAMP NOT NULL, "channel_id" uuid NOT NULL, CONSTRAINT "PK_3828b5a0009aa8e269d945ec423" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_250e8088b227dc7e63d4f5b2de" ON "channel_posts" ("channel_id", "telegram_post_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "core_channel_users_post_comments_sync" ("post_id" uuid NOT NULL, "last_synced_at" TIMESTAMP NOT NULL, CONSTRAINT "PK_f14d9719b4fc899d1bda56ccb67" PRIMARY KEY ("post_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "core_channel_users_comments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "commented_at" TIMESTAMP NOT NULL, "post_id" uuid NOT NULL, "user_id" uuid NOT NULL, CONSTRAINT "PK_ff60d2f1fa2bc6fc1a2d91eba3b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_posts" ADD CONSTRAINT "FK_30d7192754afe5d475ed53e1cc2" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "core_channel_users_post_comments_sync" ADD CONSTRAINT "FK_f14d9719b4fc899d1bda56ccb67" FOREIGN KEY ("post_id") REFERENCES "channel_posts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "core_channel_users_comments" ADD CONSTRAINT "FK_9148b587cb23fad7672f6971c1f" FOREIGN KEY ("post_id") REFERENCES "channel_posts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "core_channel_users_comments" ADD CONSTRAINT "FK_81270c52deb78ef1f49ed94ceee" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "core_channel_users_comments" DROP CONSTRAINT "FK_81270c52deb78ef1f49ed94ceee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "core_channel_users_comments" DROP CONSTRAINT "FK_9148b587cb23fad7672f6971c1f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "core_channel_users_post_comments_sync" DROP CONSTRAINT "FK_f14d9719b4fc899d1bda56ccb67"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channel_posts" DROP CONSTRAINT "FK_30d7192754afe5d475ed53e1cc2"`,
    );
    await queryRunner.query(`DROP TABLE "core_channel_users_comments"`);
    await queryRunner.query(
      `DROP TABLE "core_channel_users_post_comments_sync"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_250e8088b227dc7e63d4f5b2de"`,
    );
    await queryRunner.query(`DROP TABLE "channel_posts"`);
  }
}
