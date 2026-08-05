import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { MailService } from '../src/mail/mail.service';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { VIDEO_PROCESSING_QUEUE } from '../src/videos/processing/video-queue.constants';
import { generatePublicId } from '../src/videos/videos.id';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
}
interface InitiateBody {
  videoId: string;
  uploadId: string;
  parts: { partNumber: number; url: string }[];
}

const UNKNOWN_VIDEO_ID = '99999999-9999-4999-8999-999999999999';
const PART_BYTES = readFileSync(
  join(__dirname, 'fixtures', 'sample-with-audio.mp4'),
);

const TITLE = 'Upload e2e seed';

describe('Upload cancel (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let storage: StorageService;
  let queue: Queue;
  let throttlerStorage: ThrottlerStorageService;

  let ownerToken: string;
  let strangerToken: string;
  let videoId: string;
  let uploadId: string;
  let partEtag: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    videos = dataSource.getRepository(Video);
    storage = moduleFixture.get(StorageService);
    queue = moduleFixture.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
  });

  /** The refusal tests deliberately leave an upload open; the bucket should not. */
  afterEach(async () => {
    for (const upload of await storage.listMultipartUploads('videos/')) {
      await storage.abortMultipartUpload(upload.key, upload.uploadId);
    }
  });

  async function registerConfirmAndLogin(email: string): Promise<string> {
    const password = 'password123';
    let capturedToken = '';
    jest
      .spyOn(app.get(MailService), 'sendConfirmationEmail')
      .mockImplementationOnce((_email, _name, token) => {
        capturedToken = token;
        return Promise.resolve();
      });

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: capturedToken });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });

    return (res.body as { access_token: string }).access_token;
  }

  const openUploads = async (): Promise<string[]> =>
    (await storage.listMultipartUploads('videos/')).map(
      (upload) => upload.uploadId,
    );

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    // The conflict test completes an upload, which publishes a processing job.
    await queue.obliterate({ force: true });
    throttlerStorage.storage.clear();

    ownerToken = await registerConfirmAndLogin(
      `${generatePublicId()}@streamtube.test`,
    );
    strangerToken = await registerConfirmAndLogin(
      `${generatePublicId()}@streamtube.test`,
    );

    const initiated = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: TITLE,
        contentType: 'video/mp4',
        sizeBytes: PART_BYTES.length,
      })
      .expect(201);

    const body = initiated.body as InitiateBody;
    videoId = body.videoId;
    uploadId = body.uploadId;

    // A real part, so the abort has something to reclaim rather than an empty
    // upload that would prove nothing about the accumulated storage.
    const uploaded = await fetch(body.parts[0].url, {
      method: 'PUT',
      body: new Uint8Array(PART_BYTES),
    });
    expect(uploaded.status).toBe(200);
    partEtag = uploaded.headers.get('etag') as string;

    // Six auth calls plus the initiate already spent most of the 10/min budget.
    throttlerStorage.storage.clear();
  });

  describe('Owner cancel — DELETE /videos/{videoId}/uploads', () => {
    it('aborts the multipart upload and reclaims the parts already sent', async () => {
      await expect(openUploads()).resolves.toContain(uploadId);

      const res = await request(app.getHttpServer())
        .delete(`/videos/${videoId}/uploads`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      expect(res.text).toBe('');
      await expect(openUploads()).resolves.not.toContain(uploadId);

      // The grant is gone, not merely hidden from the listing.
      const video = await videos.findOneByOrFail({ id: videoId });
      await expect(
        storage.completeMultipartUpload(video.storage_key, uploadId, [
          { partNumber: 1, etag: partEtag },
        ]),
      ).rejects.toThrow();
    });

    it('refuses an anonymous caller and a non-owner without aborting anything', async () => {
      await request(app.getHttpServer())
        .delete(`/videos/${videoId}/uploads`)
        .expect(401);

      const notMine = await request(app.getHttpServer())
        .delete(`/videos/${videoId}/uploads`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
      expect(notMine.status).not.toBe(403);
      expect((notMine.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');

      const unknown = await request(app.getHttpServer())
        .delete(`/videos/${UNKNOWN_VIDEO_ID}/uploads`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
      // "not yours" and "does not exist" must be the same answer.
      expect(unknown.body).toEqual(notMine.body);

      await expect(openUploads()).resolves.toContain(uploadId);
    });

    it('answers 409 outside draft and leaves the consolidated video alone', async () => {
      await request(app.getHttpServer())
        .post(`/videos/${videoId}/uploads/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ parts: [{ partNumber: 1, etag: partEtag }] })
        .expect(200);

      const res = await request(app.getHttpServer())
        .delete(`/videos/${videoId}/uploads`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);

      expect((res.body as ErrorBody).error).toBe('INVALID_VIDEO_STATE');

      const video = await videos.findOneByOrFail({ id: videoId });
      expect(video.status).toBe(VideoStatus.PROCESSING);
      // The object stayed consolidated: the refused call touched nothing.
      await expect(
        storage.headObject(video.storage_key),
      ).resolves.toBeDefined();
    });
  });
});
