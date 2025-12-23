import { MigrationInterface, QueryRunner } from 'typeorm';

export class ImproveImportantMessages1766484837267 implements MigrationInterface {
  name = 'ImproveImportantMessages1766484837267';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "channels" ADD "discussion_group_id" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "important_messages" ADD "replies_count" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "important_messages" ADD "reactions_count" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "important_messages" ADD "hype_notified_at" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "important_messages" DROP COLUMN "hype_notified_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "important_messages" DROP COLUMN "reactions_count"`,
    );
    await queryRunner.query(
      `ALTER TABLE "important_messages" DROP COLUMN "replies_count"`,
    );
    await queryRunner.query(
      `ALTER TABLE "channels" DROP COLUMN "discussion_group_id"`,
    );
  }
}
