import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateUserChannelEntityAddFeatureField1767640762203 implements MigrationInterface {
    name = 'UpdateUserChannelEntityAddFeatureField1767640762203'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_channels" DROP CONSTRAINT "UQ_user_channels_user_id_channel_id"`);
        await queryRunner.query(`CREATE TYPE "public"."user_channels_feature_enum" AS ENUM('summary-channel', 'core-channel-users', 'important-messages')`);
        await queryRunner.query(`ALTER TABLE "user_channels" ADD "feature" "public"."user_channels_feature_enum" NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user_channels" ADD CONSTRAINT "UQ_user_channels_user_id_channel_id_feature" UNIQUE ("user_id", "channel_id", "feature")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_channels" DROP CONSTRAINT "UQ_user_channels_user_id_channel_id_feature"`);
        await queryRunner.query(`ALTER TABLE "user_channels" DROP COLUMN "feature"`);
        await queryRunner.query(`DROP TYPE "public"."user_channels_feature_enum"`);
        await queryRunner.query(`ALTER TABLE "user_channels" ADD CONSTRAINT "UQ_user_channels_user_id_channel_id" UNIQUE ("user_id", "channel_id")`);
    }

}
