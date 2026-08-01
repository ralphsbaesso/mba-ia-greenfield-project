import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Job, Queue } from 'bullmq';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { StorageService } from '../../storage/storage.service';
import { cleanAllTables } from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import { generatePublicId } from '../videos.id';
import { VideoProcessingModule } from './video-processing.module';
import {
  VideoProcessingDlqData,
  VideoProcessingJobData,
  VideoProcessingProcessor,
} from './video-processing.processor';
import {
  VIDEO_PROCESSING_DLQ,
  VIDEO_PROCESSING_JOB,
  VIDEO_PROCESSING_JOB_OPTIONS,
  VIDEO_PROCESSING_QUEUE,
} from './video-queue.constants';

const FIXTURES = join(__dirname, '../../../test/fixtures');

// Two attempts and a near-zero backoff: the policy under test is "what happens on
// exhaustion", not how long the real 5s exponential backoff takes.
const FAST_RETRY = {
  attempts: 2,
  backoff: { type: 'fixed', delay: 50 },
} as const;

const waitFor = async (
  predicate: () => Promise<boolean>,
  timeoutMs = 25_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
};

// Boots the worker's own root context, so the real BullMQ worker consumes these
// jobs. It spawns ffprobe and therefore only runs in the `video-worker` container.
describe('Video processing failures (integration)', () => {
  let app: TestingModule;
  let processor: VideoProcessingProcessor;
  let storage: StorageService;
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let queue: Queue<VideoProcessingJobData>;
  let deadLetters: Queue<VideoProcessingDlqData>;
  let videoBytes: Buffer;
  let notVideoBytes: Buffer;
  let channelId: string;

  beforeAll(async () => {
    videoBytes = await readFile(join(FIXTURES, 'sample-with-audio.mp4'));
    notVideoBytes = await readFile(join(FIXTURES, 'not-a-video.txt'));

    const module = await Test.createTestingModule({
      imports: [VideoProcessingModule],
    }).compile();

    app = await module.init();
    processor = app.get(VideoProcessingProcessor);
    storage = app.get(StorageService);
    dataSource = app.get(DataSource);
    videos = dataSource.getRepository(Video);
    queue = app.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
    deadLetters = app.get(getQueueToken(VIDEO_PROCESSING_DLQ));
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await deadLetters.obliterate({ force: true });
    await app.close();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await deadLetters.obliterate({ force: true });
    await cleanAllTables(dataSource);

    const user = await dataSource.getRepository(User).save({
      email: `${generatePublicId()}@streamtube.test`,
      password: 'hashed',
    });
    const channel = await dataSource.getRepository(Channel).save({
      name: 'Failures',
      nickname: generatePublicId(),
      user_id: user.id,
    });
    channelId = channel.id;
  });

  /** Seeds a `processing` row. `content: null` leaves the object missing. */
  const seedVideo = async (content: Buffer | null): Promise<Video> => {
    const video = await videos.save(
      videos.create({
        public_id: generatePublicId(),
        channel_id: channelId,
        status: VideoStatus.PROCESSING,
        storage_key: 'placeholder',
      }),
    );

    const storageKey = `videos/${video.id}.mp4`;
    if (content) {
      await storage.putObject(storageKey, content, 'video/mp4');
    }
    await videos.update({ id: video.id }, { storage_key: storageKey });
    video.storage_key = storageKey;

    return video;
  };

  const failedJobs = (): Promise<Job<VideoProcessingJobData>[]> =>
    queue.getFailed();

  describe('an input that is not a video', () => {
    it('should reach error with the reason persisted, on the first attempt', async () => {
      const video = await seedVideo(notVideoBytes);

      await queue.add(
        VIDEO_PROCESSING_JOB,
        { videoId: video.id },
        { jobId: video.id },
      );

      await waitFor(async () => (await queue.getFailedCount()) === 1);

      const row = await videos.findOneByOrFail({ id: video.id });
      expect(row.status).toBe(VideoStatus.ERROR);
      expect(row.failure_reason).toContain('no decodable video stream');
    }, 40_000);

    it('should not consume the remaining attempts', async () => {
      const video = await seedVideo(notVideoBytes);

      await queue.add(
        VIDEO_PROCESSING_JOB,
        { videoId: video.id },
        { jobId: video.id },
      );

      await waitFor(async () => (await queue.getFailedCount()) === 1);

      const [failed] = await failedJobs();
      expect(VIDEO_PROCESSING_JOB_OPTIONS.attempts).toBeGreaterThan(1);
      expect(failed.attemptsMade).toBe(1);
    }, 40_000);

    it('should not publish to the dead letter queue', async () => {
      const video = await seedVideo(notVideoBytes);

      await queue.add(
        VIDEO_PROCESSING_JOB,
        { videoId: video.id },
        { jobId: video.id },
      );

      await waitFor(async () => (await queue.getFailedCount()) === 1);

      // A permanent verdict is not "lost work" — the row carries the reason.
      expect(await deadLetters.getWaitingCount()).toBe(0);
    }, 40_000);

    it('should leave no thumbnail behind', async () => {
      const video = await seedVideo(notVideoBytes);

      await queue.add(
        VIDEO_PROCESSING_JOB,
        { videoId: video.id },
        { jobId: video.id },
      );

      await waitFor(async () => (await queue.getFailedCount()) === 1);

      await expect(
        storage.headObject(`thumbnails/${video.id}.jpg`),
      ).rejects.toBeDefined();
    }, 40_000);
  });

  describe('a transient failure that exhausts its attempts', () => {
    it('should retry before giving up', async () => {
      const video = await seedVideo(null);

      await queue.add(
        VIDEO_PROCESSING_JOB,
        { videoId: video.id },
        { jobId: video.id, ...FAST_RETRY },
      );

      await waitFor(async () => (await queue.getFailedCount()) === 1);

      const [failed] = await failedJobs();
      expect(failed.attemptsMade).toBe(FAST_RETRY.attempts);
    }, 40_000);

    it('should write error plus the reason on exhaustion', async () => {
      const video = await seedVideo(null);

      await queue.add(
        VIDEO_PROCESSING_JOB,
        { videoId: video.id },
        { jobId: video.id, ...FAST_RETRY },
      );

      await waitFor(async () => (await queue.getFailedCount()) === 1);

      const row = await videos.findOneByOrFail({ id: video.id });
      expect(row.status).toBe(VideoStatus.ERROR);
      expect(row.failure_reason).toBeTruthy();
    }, 40_000);

    it('should publish the exhausted job to the consumer-less dead letter queue', async () => {
      const video = await seedVideo(null);

      await queue.add(
        VIDEO_PROCESSING_JOB,
        { videoId: video.id },
        { jobId: video.id, ...FAST_RETRY },
      );

      await waitFor(async () => (await deadLetters.getWaitingCount()) === 1);

      const [dead] = await deadLetters.getJobs(['waiting']);
      expect(dead.data.videoId).toBe(video.id);
      expect(dead.data.attemptsMade).toBe(FAST_RETRY.attempts);
      expect(dead.data.failureReason).toBeTruthy();
      // Nothing consumes it: the job is still waiting, which is the retention.
      expect(await deadLetters.getActiveCount()).toBe(0);
      expect(await deadLetters.getCompletedCount()).toBe(0);
    }, 40_000);
  });

  describe('a transient failure with attempts left', () => {
    it('should leave the row in processing for the retry to pick up', async () => {
      const video = await seedVideo(null);

      const job = {
        id: 'job-with-attempts-left',
        data: { videoId: video.id },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as Job<VideoProcessingJobData>;

      await expect(processor.process(job)).rejects.toBeDefined();

      const row = await videos.findOneByOrFail({ id: video.id });
      expect(row.status).toBe(VideoStatus.PROCESSING);
      expect(row.failure_reason).toBeNull();
      expect(await deadLetters.getWaitingCount()).toBe(0);
    }, 30_000);
  });

  describe('the worker after a failure', () => {
    it('should keep consuming subsequent jobs', async () => {
      const broken = await seedVideo(notVideoBytes);
      const healthy = await seedVideo(videoBytes);

      await queue.add(
        VIDEO_PROCESSING_JOB,
        { videoId: broken.id },
        { jobId: broken.id },
      );
      await queue.add(
        VIDEO_PROCESSING_JOB,
        { videoId: healthy.id },
        { jobId: healthy.id },
      );

      await waitFor(async () => {
        const row = await videos.findOneByOrFail({ id: healthy.id });
        return row.status === VideoStatus.READY;
      });

      const brokenRow = await videos.findOneByOrFail({ id: broken.id });
      expect(brokenRow.status).toBe(VideoStatus.ERROR);
    }, 60_000);
  });
});
