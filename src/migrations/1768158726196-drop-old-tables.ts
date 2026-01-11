import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropOldTables1768158726196 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "core_channel_users_comments" DROP CONSTRAINT "FK_81270c52deb78ef1f49ed94ceee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "core_channel_users_comments" DROP CONSTRAINT "FK_9148b587cb23fad7672f6971c1f"`,
    );
    await queryRunner.query(`DROP TABLE "core_channel_users_comments"`);
    await queryRunner.query(
      `ALTER TABLE "core_channel_users_post_comments_sync" DROP CONSTRAINT "FK_f14d9719b4fc899d1bda56ccb67"`,
    );
    await queryRunner.query(
      `DROP TABLE "core_channel_users_post_comments_sync"`,
    );
    await queryRunner.query(
      `ALTER TABLE "core_channel_users_channel_sync" DROP CONSTRAINT "FK_41494b555ab182fcc6e02d0df1c"`,
    );
    await queryRunner.query(`DROP TABLE "core_channel_users_channel_sync"`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    void _queryRunner;
  }
}
