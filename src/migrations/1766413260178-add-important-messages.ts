import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddImportantMessages1766413260178 implements MigrationInterface {
  name = 'AddImportantMessages1766413260178';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "important_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "telegram_message_id" bigint NOT NULL, "telegram_user_id" bigint NOT NULL, "text" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "notified_at" TIMESTAMP, "channel_id" uuid NOT NULL, CONSTRAINT "PK_e83452ec472c4cf16130bd0070d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "important_messages_channel_telegram_message" ON "important_messages" ("channel_id", "telegram_message_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "dictionary_words" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "category" character varying NOT NULL, "type" character varying NOT NULL, "words" jsonb NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "channel_id" uuid, CONSTRAINT "PK_e8207d01e9bf0399b5f18e6c180" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "important_messages" ADD CONSTRAINT "FK_692b454cac104aa9608550c68b8" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "dictionary_words" ADD CONSTRAINT "FK_8090fb71c0af183d6f18f0aa8f1" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "dictionary_words" DROP CONSTRAINT "FK_8090fb71c0af183d6f18f0aa8f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "important_messages" DROP CONSTRAINT "FK_692b454cac104aa9608550c68b8"`,
    );
    await queryRunner.query(`DROP TABLE "dictionary_words"`);
    await queryRunner.query(
      `DROP INDEX "public"."important_messages_channel_telegram_message"`,
    );
    await queryRunner.query(`DROP TABLE "important_messages"`);
  }
}
