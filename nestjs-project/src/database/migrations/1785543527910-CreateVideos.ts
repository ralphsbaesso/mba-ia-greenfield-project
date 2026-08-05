import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1785543527910 implements MigrationInterface {
  name = 'CreateVideos1785543527910';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."videos_status_enum" AS ENUM('draft', 'processing', 'ready', 'error')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "public_id" character varying(32) NOT NULL, "channel_id" uuid NOT NULL, "status" "public"."videos_status_enum" NOT NULL DEFAULT 'draft', "storage_key" character varying NOT NULL, "thumbnail_key" character varying, "upload_id" character varying, "failure_reason" text, "duration_seconds" numeric(10,3), "width" integer, "height" integer, "video_codec" character varying(32), "audio_codec" character varying(32), "container_format" character varying(64), "bitrate_bps" bigint, "size_bytes" bigint, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_39a1f0fe7991162aace659078ec" UNIQUE ("public_id"), CONSTRAINT "CHK_videos_ready_requires_thumbnail" CHECK ("status" <> 'ready' OR "thumbnail_key" IS NOT NULL), CONSTRAINT "CHK_videos_ready_requires_metadata" CHECK ("status" <> 'ready' OR ("duration_seconds" IS NOT NULL AND "width" IS NOT NULL AND "height" IS NOT NULL AND "video_codec" IS NOT NULL AND "container_format" IS NOT NULL AND "size_bytes" IS NOT NULL)), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_023a8e4f3f1a34ff3d8ca04a4c" ON "videos" ("channel_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_023a8e4f3f1a34ff3d8ca04a4c"`,
    );
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."videos_status_enum"`);
  }
}
