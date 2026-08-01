import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { MailService } from '../src/mail/mail.service';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { VideoProcessingModule } from '../src/videos/processing/video-processing.module';
import { VIDEO_PROCESSING_QUEUE } from '../src/videos/processing/video-queue.constants';
import { generatePublicId } from '../src/videos/videos.id';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
}
interface ReprocessBody {
  publicId: string;
  status: string;
}
interface OwnerVideoBody {
  status: string;
  failure_reason: string | null;
  duration_seconds: number | null;
  width: number | null;
}

const OWNER_ROUTE = '/videos/me';
const UNKNOWN_VIDEO_ID = '99999999-9999-4999-8999-999999999999';
const FAILURE_REASON =
  'Input has no decodable video stream: moov atom not found';
const VIDEO_FIXTURE = readFileSync(
  join(__dirname, 'fixtures', 'sample-with-audio.mp4'),
);

/** Everything a `ready` row needs to satisfy the state-scoped CHECKs. */
const READY_METADATA = {
  duration_seconds: 12.345,
  width: 1920,
  height: 1080,
  video_codec: 'h264',
  audio_codec: 'aac',
  container_format: 'mov,mp4,m4a,3gp,3g2,mj2',
  bitrate_bps: 188_900,
  size_bytes: VIDEO_FIXTURE.length,
};

/**
 * This suite drives the real processing pipeline, so it must run in the
 * `video-worker` container — `ffprobe`/`ffmpeg` are not in the API image.
 */
describe('Video reprocess (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let storage: StorageService;
  let queue: Queue;
  let throttlerStorage: ThrottlerStorageService;

  let ownerToken: string;
  let strangerToken: string;
  let channelId: string;
  let failed: Video;

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

  async function channelIdOf(email: string): Promise<string> {
    const channel = await dataSource
      .getRepository(Channel)
      .createQueryBuilder('channel')
      .innerJoin('users', 'user', 'user.id = channel.user_id')
      .where('user.email = :email', { email })
      .getOneOrFail();

    return channel.id;
  }

  async function seedVideo(status: VideoStatus): Promise<Video> {
    const publicId = generatePublicId();

    return videos.save(
      videos.create({
        public_id: publicId,
        channel_id: channelId,
        status,
        storage_key: `videos/reprocess-${publicId}.mp4`,
        ...(status === VideoStatus.ERROR && {
          failure_reason: FAILURE_REASON,
        }),
        ...(status === VideoStatus.READY && {
          ...READY_METADATA,
          thumbnail_key: `thumbnails/reprocess-${publicId}.jpg`,
        }),
      }),
    );
  }

  /**
   * The worker as a second Nest context, started only for the tests that need
   * the job consumed — a worker running for the whole suite would drain the
   * queue the other tests assert on.
   */
  async function drainWithWorker(videoId: string): Promise<Video> {
    const worker: TestingModule = await Test.createTestingModule({
      imports: [VideoProcessingModule],
    }).compile();
    await worker.init();

    try {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const row = await videos.findOneByOrFail({ id: videoId });
        if (row.status !== VideoStatus.PROCESSING) {
          return row;
        }
        if (Date.now() > deadline) {
          throw new Error(`Video ${videoId} never left processing`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } finally {
      await worker.close();
    }
  }

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await queue.obliterate({ force: true });
    throttlerStorage.storage.clear();

    const ownerEmail = `${generatePublicId()}@streamtube.test`;
    const strangerEmail = `${generatePublicId()}@streamtube.test`;
    ownerToken = await registerConfirmAndLogin(ownerEmail);
    strangerToken = await registerConfirmAndLogin(strangerEmail);
    channelId = await channelIdOf(ownerEmail);

    failed = await seedVideo(VideoStatus.ERROR);
    // The object survived the failed run; that is the whole point of not
    // requiring a new upload.
    await storage.putObject(failed.storage_key, VIDEO_FIXTURE, 'video/mp4');

    throttlerStorage.storage.clear();
  });

  describe('Guarded reprocess — POST /videos/{videoId}/reprocess', () => {
    it('requeues a failed video under its deterministic job id and reaches ready', async () => {
      const res = await request(app.getHttpServer())
        .post(`/videos/${failed.id}/reprocess`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body as ReprocessBody).toEqual({
        publicId: failed.public_id,
        status: 'processing',
      });

      expect(await queue.getWaitingCount()).toBe(1);
      const job = await queue.getJob(failed.id);
      // The id of the original send, not a new one — the queue-level dedup of
      // TD-14 only holds while the id keeps deriving from the video.
      expect(job?.id).toBe(failed.id);
      expect(job?.data).toEqual({ videoId: failed.id });

      const processed = await drainWithWorker(failed.id);
      expect(processed.status).toBe(VideoStatus.READY);
      expect(processed.duration_seconds).toBeGreaterThan(0);
      expect(processed.width).toBeGreaterThan(0);
      expect(processed.height).toBeGreaterThan(0);
      expect(processed.video_codec).toBeTruthy();
      expect(processed.container_format).toBeTruthy();
      expect(processed.size_bytes).toBe(VIDEO_FIXTURE.length);
      expect(processed.thumbnail_key).toBeTruthy();
    }, 120_000);

    it.each([VideoStatus.READY, VideoStatus.DRAFT, VideoStatus.PROCESSING])(
      'answers 409 for a %s video, publishing nothing',
      async (status) => {
        const video = await seedVideo(status);

        const res = await request(app.getHttpServer())
          .post(`/videos/${video.id}/reprocess`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(409);

        expect((res.body as ErrorBody).error).toBe('INVALID_VIDEO_STATE');
        expect((await videos.findOneByOrFail({ id: video.id })).status).toBe(
          status,
        );
        expect(await queue.getWaitingCount()).toBe(0);
      },
    );

    it('refuses an anonymous caller and a non-owner, leaving the row in error', async () => {
      await request(app.getHttpServer())
        .post(`/videos/${failed.id}/reprocess`)
        .expect(401);

      const notMine = await request(app.getHttpServer())
        .post(`/videos/${failed.id}/reprocess`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
      expect(notMine.status).not.toBe(403);
      expect((notMine.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');

      const unknown = await request(app.getHttpServer())
        .post(`/videos/${UNKNOWN_VIDEO_ID}/reprocess`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
      // Same answer for "not yours" and "does not exist".
      expect(unknown.body).toEqual(notMine.body);

      const row = await videos.findOneByOrFail({ id: failed.id });
      expect(row.status).toBe(VideoStatus.ERROR);
      expect(row.failure_reason).toBe(FAILURE_REASON);
      expect(await queue.getWaitingCount()).toBe(0);
    });

    it('clears the failure reason the owner could see before', async () => {
      const before = await request(app.getHttpServer())
        .get(`${OWNER_ROUTE}/${failed.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect((before.body as OwnerVideoBody).status).toBe('error');
      expect((before.body as OwnerVideoBody).failure_reason).toBe(
        FAILURE_REASON,
      );

      await request(app.getHttpServer())
        .post(`/videos/${failed.id}/reprocess`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect((await drainWithWorker(failed.id)).status).toBe(VideoStatus.READY);

      const after = await request(app.getHttpServer())
        .get(`${OWNER_ROUTE}/${failed.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = after.body as OwnerVideoBody;
      expect(body.status).toBe('ready');
      expect(body.failure_reason).toBeNull();
      expect(after.text).not.toContain(FAILURE_REASON);
    }, 120_000);
  });
});
