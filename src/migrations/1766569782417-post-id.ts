import { MigrationInterface, QueryRunner } from 'typeorm';

export class PostId1766569782417 implements MigrationInterface {
  name = 'PostId1766569782417';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "important_messages" ADD "post_message_id" bigint`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "important_messages" DROP COLUMN "post_message_id"`,
    );
  }
}
