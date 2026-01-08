import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSoftDeleteFieldToFeatureChannelUser1767876422215 implements MigrationInterface {
  name = 'AddSoftDeleteFieldToFeatureChannelUser1767876422215';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_channels" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_channels" DROP COLUMN "deleted_at"`,
    );
  }
}
