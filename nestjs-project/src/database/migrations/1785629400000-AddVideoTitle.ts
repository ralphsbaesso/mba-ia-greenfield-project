import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVideoTitle1785629400000 implements MigrationInterface {
  name = 'AddVideoTitle1785629400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Added with a default and then stripped of it: the column is `NOT NULL`, and
    // `videos` may already hold rows from before this migration, which a bare
    // `ADD COLUMN ... NOT NULL` would reject. The default exists only for the
    // duration of the backfill — after the DROP, every insert must state a title.
    await queryRunner.query(
      `ALTER TABLE "videos" ADD "title" character varying(200) NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ALTER COLUMN "title" DROP DEFAULT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "videos" DROP COLUMN "title"`);
  }
}
