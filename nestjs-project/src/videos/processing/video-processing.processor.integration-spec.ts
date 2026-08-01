import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue, Job } from 'bullmq';
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
  VideoProcessingJobData,
  VideoProcessingProcessor,
} from './video-processing.processor';
import {
  VIDEO_PROCESSING_JOB,
  VIDEO_PROCESSING_QUEUE,
} from './video-queue.constants';

const FIXTURE = join(__dirname, '../../../test/fixtures/sample-with-audio.mp4');

const job = (videoId: string): Job<VideoProcessingJobData> =>
  ({ data: { videoId } }) as Job<VideoProcessingJobData>;

const waitFor = async (
  predicate: () => Promise<boolean>,
  timeoutMs = 20_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
};

// Boots the worker's own root context, so the real BullMQ worker is running for
// the duration of this suite (phase-03-videos/TD-06). It spawns ffprobe/ffmpeg and
// therefore only runs in the `video-worker` container.
describe('VideoProcessingProcessor (integration)', () => {
  let app: TestingModule;
  let processor: VideoProcessingProcessor;
  let storage: StorageService;
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let queue: Queue;
  let fixtureBytes: Buffer;
  let channelId: string;

  beforeAll(async () => {
    fixtureBytes = await readFile(FIXTURE);

    const module = await Test.createTestingModule({
      imports: [VideoProcessingModule],
    }).compile();

    // `init()` runs the lifecycle hooks, which is what actually starts the BullMQ
    // worker — without it the queue-driven test would wait forever.
    app = await module.init();
    processor = app.get(VideoProcessingProcessor);
    storage = app.get(StorageService);
    dataSource = app.get(DataSource);
    videos = dataSource.getRepository(Video);
    queue = app.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  // Closing the context closes the BullMQ worker first and then the connections;
  // without it Jest hangs on open handles (phase-03-videos/TD-04 gotcha).
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await cleanAllTables(dataSource);

    const user = await dataSource.getRepository(User).save({
      email: `${generatePublicId()}@streamtube.test`,
      password: 'hashed',
    });
    const channel = await dataSource.getRepository(Channel).save({
      name: 'Processor',
      nickname: generatePublicId(),
      user_id: user.id,
    });
    channelId = channel.id;
  });

  const seedVideo = async (status: VideoStatus): Promise<Video> => {
    const video = await videos.save(
      videos.create({
        public_id: generatePublicId(),
        channel_id: channelId,
        status,
        storage_key: 'placeholder',
      }),
    );

    const storageKey = `videos/${video.id}.mp4`;
    await storage.putObject(storageKey, fixtureBytes, 'video/mp4');
    await videos.update({ id: video.id }, { storage_key: storageKey });
    video.storage_key = storageKey;

    return video;
  };

  describe('a valid video in processing', () => {
    it('should reach ready with every metadata column filled', async () => {
      const video = await seedVideo(VideoStatus.PROCESSING);

      await processor.process(job(video.id));

      const row = await videos.findOneByOrFail({ id: video.id });
      expect(row.status).toBe(VideoStatus.READY);
      expect(row.duration_seconds).toBeCloseTo(2, 1);
      expect(row.width).toBe(320);
      expect(row.height).toBe(240);
      expect(row.video_codec).toBe('h264');
      expect(row.audio_codec).toBe('aac');
      expect(row.container_format).toContain('mp4');
      expect(row.bitrate_bps).toBeGreaterThan(0);
      expect(row.thumbnail_key).toBe(`thumbnails/${video.id}.jpg`);
      expect(row.failure_reason).toBeNull();
    });

    it('should record the size of the storage object', async () => {
      const video = await seedVideo(VideoStatus.PROCESSING);

      await processor.process(job(video.id));

      const row = await videos.findOneByOrFail({ id: video.id });
      expect(row.size_bytes).toBe(fixtureBytes.length);
    });

    it('should leave the thumbnail object in storage', async () => {
      const video = await seedVideo(VideoStatus.PROCESSING);

      await processor.process(job(video.id));

      const head = await storage.headObject(`thumbnails/${video.id}.jpg`);
      expect(head.ContentType).toBe('image/jpeg');
      expect(head.ContentLength).toBeGreaterThan(0);
    });
  });

  describe('a repeated delivery of the same job', () => {
    it('should leave the row ready without writing it a second time', async () => {
      const video = await seedVideo(VideoStatus.PROCESSING);

      await processor.process(job(video.id));
      const afterFirst = await videos.findOneByOrFail({ id: video.id });

      await processor.process(job(video.id));
      const afterSecond = await videos.findOneByOrFail({ id: video.id });

      expect(afterSecond.status).toBe(VideoStatus.READY);
      // `updated_at` would move if the second run had written the row.
      expect(afterSecond.updated_at).toEqual(afterFirst.updated_at);
    });

    it('should keep a single thumbnail object, on the key derived from the id', async () => {
      const video = await seedVideo(VideoStatus.PROCESSING);

      await processor.process(job(video.id));
      await processor.process(job(video.id));

      const head = await storage.headObject(`thumbnails/${video.id}.jpg`);
      expect(head.ContentLength).toBeGreaterThan(0);
    });
  });

  describe('a video that is not in processing', () => {
    it('should leave a draft row untouched', async () => {
      const video = await seedVideo(VideoStatus.DRAFT);

      await processor.process(job(video.id));

      const row = await videos.findOneByOrFail({ id: video.id });
      expect(row.status).toBe(VideoStatus.DRAFT);
      expect(row.thumbnail_key).toBeNull();
      expect(row.duration_seconds).toBeNull();
    });

    it('should not write a thumbnail for a draft row', async () => {
      const video = await seedVideo(VideoStatus.DRAFT);

      await processor.process(job(video.id));

      await expect(
        storage.headObject(`thumbnails/${video.id}.jpg`),
      ).rejects.toBeDefined();
    });

    it('should ignore a job for a video that no longer exists', async () => {
      await expect(
        processor.process(job('55555555-5555-4555-8555-555555555555')),
      ).resolves.toBeUndefined();
    });
  });

  describe('driven through the real queue', () => {
    it('should take a published job all the way to ready', async () => {
      const video = await seedVideo(VideoStatus.PROCESSING);

      await queue.add(
        VIDEO_PROCESSING_JOB,
        { videoId: video.id },
        { jobId: video.id },
      );

      await waitFor(async () => {
        const row = await videos.findOneByOrFail({ id: video.id });
        return row.status === VideoStatus.READY;
      });

      const row = await videos.findOneByOrFail({ id: video.id });
      expect(row.thumbnail_key).toBe(`thumbnails/${video.id}.jpg`);
      expect(row.width).toBe(320);
    }, 30_000);
  });
});
