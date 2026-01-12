import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropOldTableChannelPosts1768236626751 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "channel_posts" DROP CONSTRAINT "FK_30d7192754afe5d475ed53e1cc2"`,
    );

    await queryRunner.query(`DROP TABLE "channel_posts"`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    void _queryRunner;
  }
}
