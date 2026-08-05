import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { mkdtemp, readdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Readable } from 'stream';
import storageConfig from '../../config/storage.config';
import workerConfig from '../../config/worker.config';
import { StorageModule } from '../../storage/storage.module';
import { StorageService } from '../../storage/storage.service';
import { FfprobeService } from './ffprobe.service';
import { ThumbnailService } from './thumbnail.service';

const FIXTURES = join(__dirname, '../../../test/fixtures');
const WITH_AUDIO = join(FIXTURES, 'sample-with-audio.mp4');
const NOT_A_VIDEO = join(FIXTURES, 'not-a-video.txt');

// The fixture is 320x240, so a 640-wide thumbnail must come out 480 tall.
const FIXTURE_DURATION_SECONDS = 2;
const EXPECTED_WIDTH = 640;
const EXPECTED_HEIGHT = 480;

// This suite spawns the real `ffmpeg`, which only exists in the `video-worker`
// image (phase-03-videos/TD-07).
describe('ThumbnailService (integration)', () => {
  let module: TestingModule;
  let service: ThumbnailService;
  let storage: StorageService;
  let ffprobe: FfprobeService;
  let scratchDir: string;
  // Kept apart from scratchDir so the "no leftovers" assertion sees only files the
  // service itself created.
  let downloadDir: string;
  let videoId: string;

  const readObject = async (key: string): Promise<Buffer> => {
    const object = await storage.getObject(key);
    const chunks: Buffer[] = [];
    for await (const chunk of object.Body as Readable) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    return Buffer.concat(chunks);
  };

  beforeAll(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), 'thumbnail-spec-'));
    downloadDir = await mkdtemp(join(tmpdir(), 'thumbnail-spec-downloads-'));
    process.env.WORKER_TMP_DIR = scratchDir;

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, workerConfig],
        }),
        StorageModule,
      ],
      providers: [ThumbnailService, FfprobeService],
    }).compile();

    service = module.get(ThumbnailService);
    storage = module.get(StorageService);
    ffprobe = module.get(FfprobeService);
  });

  afterAll(async () => {
    delete process.env.WORKER_TMP_DIR;
    await module.close();
  });

  beforeEach(() => {
    videoId = randomUUID();
  });

  describe('the generated object', () => {
    it('should store a JPEG under the key derived from the video id', async () => {
      const key = await service.generate(
        videoId,
        WITH_AUDIO,
        FIXTURE_DURATION_SECONDS,
      );

      expect(key).toBe(`thumbnails/${videoId}.jpg`);
      const head = await storage.headObject(key);
      expect(head.ContentType).toBe('image/jpeg');

      // JPEG magic bytes — the content type header alone proves nothing.
      const body = await readObject(key);
      expect(body.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    });

    it('should preserve the aspect ratio and keep the height even', async () => {
      const key = await service.generate(
        videoId,
        WITH_AUDIO,
        FIXTURE_DURATION_SECONDS,
      );
      const localCopy = join(downloadDir, 'downloaded.jpg');
      await writeFile(localCopy, await readObject(key));

      const probe = await ffprobe.probe(localCopy);
      expect(probe.width).toBe(EXPECTED_WIDTH);
      expect(probe.height).toBe(EXPECTED_HEIGHT);
      expect(probe.height % 2).toBe(0);
      expect(probe.width / probe.height).toBeCloseTo(320 / 240, 5);
    });

    it('should hold exactly one frame', async () => {
      const key = await service.generate(
        videoId,
        WITH_AUDIO,
        FIXTURE_DURATION_SECONDS,
      );
      const localCopy = join(downloadDir, 'single-frame.jpg');
      await writeFile(localCopy, await readObject(key));

      const probe = await ffprobe.probe(localCopy);
      expect(probe.videoCodec).toBe('mjpeg');
    });
  });

  describe('re-running the extraction', () => {
    it('should overwrite the existing thumbnail instead of adding a second', async () => {
      const key = `thumbnails/${videoId}.jpg`;
      // A decoy at the very key the extraction will use: if the run appended
      // instead of overwriting, this content would survive.
      await storage.putObject(
        key,
        Buffer.from('stale thumbnail'),
        'image/jpeg',
      );

      const first = await service.generate(
        videoId,
        WITH_AUDIO,
        FIXTURE_DURATION_SECONDS,
      );
      const second = await service.generate(
        videoId,
        WITH_AUDIO,
        FIXTURE_DURATION_SECONDS,
      );

      expect(first).toBe(key);
      expect(second).toBe(key);
      const body = await readObject(key);
      expect(body.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      expect(body.length).toBeGreaterThan('stale thumbnail'.length);
    });
  });

  describe('cleanup and failure', () => {
    it('should leave no frame file behind in the scratch directory', async () => {
      await service.generate(videoId, WITH_AUDIO, FIXTURE_DURATION_SECONDS);

      expect(await readdir(scratchDir)).toEqual(
        expect.not.arrayContaining([expect.stringMatching(/\.jpg$/)]),
      );
    });

    it('should fail without storing anything when the input is not a video', async () => {
      await expect(
        service.generate(videoId, NOT_A_VIDEO, FIXTURE_DURATION_SECONDS),
      ).rejects.toBeDefined();

      await expect(
        storage.headObject(`thumbnails/${videoId}.jpg`),
      ).rejects.toBeDefined();
    });
  });
});
