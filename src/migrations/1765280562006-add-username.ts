import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsername1765280562006 implements MigrationInterface {
  name = 'AddUsername1765280562006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "username" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "username"`);
  }
}
