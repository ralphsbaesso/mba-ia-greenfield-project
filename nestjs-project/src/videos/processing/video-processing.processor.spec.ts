import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Video, VideoStatus } from '../entities/video.entity';
import { FfprobeService } from './ffprobe.service';
import { SourceFileService } from './source-file.service';
import { ThumbnailService } from './thumbnail.service';
import {
  VideoProcessingJobData,
  VideoProcessingProcessor,
} from './video-processing.processor';

const VIDEO_ID = '44444444-4444-4444-8444-444444444444';
const STORAGE_KEY = `videos/${VIDEO_ID}.mp4`;
const THUMBNAIL_KEY = `thumbnails/${VIDEO_ID}.jpg`;
const TEMP_PATH = '/var/tmp/streamtube/downloaded.mp4';
const SIZE_BYTES = 47_225;

const PROBE = {
  durationSeconds: 12.345,
  width: 1920,
  height: 1080,
  videoCodec: 'h264',
  audioCodec: 'aac',
  containerFormat: 'mov,mp4,m4a,3gp,3g2,mj2',
  bitrateBps: 188_900,
};

type UpdateCall = [
  { id: string; status: VideoStatus },
  Record<string, unknown>,
];

const job = (videoId: string = VIDEO_ID): Job<VideoProcessingJobData> =>
  ({ data: { videoId } }) as Job<VideoProcessingJobData>;

describe('VideoProcessingProcessor', () => {
  let processor: VideoProcessingProcessor;
  let videos: { findOne: jest.Mock; update: jest.Mock };
  let sourceFiles: { withDownloadedObject: jest.Mock; sizeOf: jest.Mock };
  let ffprobe: { probe: jest.Mock };
  let thumbnails: { generate: jest.Mock };
  let order: string[];

  beforeEach(async () => {
    order = [];

    videos = {
      findOne: jest.fn().mockResolvedValue({
        id: VIDEO_ID,
        storage_key: STORAGE_KEY,
        status: VideoStatus.PROCESSING,
      }),
      update: jest.fn().mockImplementation(() => {
        order.push('persist');
        return Promise.resolve({ affected: 1 });
      }),
    };
    sourceFiles = {
      withDownloadedObject: jest
        .fn()
        .mockImplementation(
          async (_key: string, use: (path: string) => Promise<unknown>) => {
            order.push('download');
            return use(TEMP_PATH);
          },
        ),
      sizeOf: jest.fn().mockImplementation(() => {
        order.push('size');
        return Promise.resolve(SIZE_BYTES);
      }),
    };
    ffprobe = {
      probe: jest.fn().mockImplementation(() => {
        order.push('probe');
        return Promise.resolve(PROBE);
      }),
    };
    thumbnails = {
      generate: jest.fn().mockImplementation(() => {
        order.push('thumbnail');
        return Promise.resolve(THUMBNAIL_KEY);
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        VideoProcessingProcessor,
        { provide: getRepositoryToken(Video), useValue: videos },
        { provide: SourceFileService, useValue: sourceFiles },
        { provide: FfprobeService, useValue: ffprobe },
        { provide: ThumbnailService, useValue: thumbnails },
      ],
    }).compile();

    processor = module.get(VideoProcessingProcessor);
  });

  describe('pipeline order', () => {
    it('should download, probe, size, extract the thumbnail and only then persist', async () => {
      await processor.process(job());

      expect(order).toEqual([
        'download',
        'probe',
        'size',
        'thumbnail',
        'persist',
      ]);
    });

    it('should probe and extract from the same downloaded file', async () => {
      await processor.process(job());

      expect(ffprobe.probe).toHaveBeenCalledWith(TEMP_PATH);
      expect(thumbnails.generate).toHaveBeenCalledWith(
        VIDEO_ID,
        TEMP_PATH,
        PROBE.durationSeconds,
      );
      expect(sourceFiles.withDownloadedObject).toHaveBeenCalledTimes(1);
    });

    it('should read the size from the storage object, not from the temp file', async () => {
      await processor.process(job());

      expect(sourceFiles.sizeOf).toHaveBeenCalledWith(STORAGE_KEY);
    });
  });

  describe('the write boundary', () => {
    it('should write metadata, thumbnail key and the ready transition in one statement', async () => {
      await processor.process(job());

      expect(videos.update).toHaveBeenCalledTimes(1);
      const [[, values]] = videos.update.mock.calls as UpdateCall[];
      expect(values).toEqual({
        status: VideoStatus.READY,
        duration_seconds: PROBE.durationSeconds,
        width: PROBE.width,
        height: PROBE.height,
        video_codec: PROBE.videoCodec,
        audio_codec: PROBE.audioCodec,
        container_format: PROBE.containerFormat,
        bitrate_bps: PROBE.bitrateBps,
        size_bytes: SIZE_BYTES,
        thumbnail_key: THUMBNAIL_KEY,
        failure_reason: null,
      });
    });

    it('should guard the transition on the row still being in processing', async () => {
      await processor.process(job());

      const [[criteria]] = videos.update.mock.calls as UpdateCall[];
      expect(criteria).toEqual({
        id: VIDEO_ID,
        status: VideoStatus.PROCESSING,
      });
    });

    it('should never advance to ready without a thumbnail key', async () => {
      await processor.process(job());

      const [[, values]] = videos.update.mock.calls as UpdateCall[];
      expect(values.thumbnail_key).toBe(THUMBNAIL_KEY);
      expect(values.status).toBe(VideoStatus.READY);
    });

    it('should clear a previous failure reason when the run succeeds', async () => {
      await processor.process(job());

      const [[, values]] = videos.update.mock.calls as UpdateCall[];
      expect(values.failure_reason).toBeNull();
    });
  });

  describe('a video that is not in processing', () => {
    beforeEach(() => {
      videos.findOne.mockResolvedValue(null);
    });

    it('should finish without touching the row', async () => {
      await processor.process(job());

      expect(videos.update).not.toHaveBeenCalled();
    });

    it('should do no storage work at all', async () => {
      await processor.process(job());

      expect(sourceFiles.withDownloadedObject).not.toHaveBeenCalled();
      expect(ffprobe.probe).not.toHaveBeenCalled();
      expect(thumbnails.generate).not.toHaveBeenCalled();
    });

    it('should scope the lookup to the processing state', async () => {
      await processor.process(job());

      expect(videos.findOne).toHaveBeenCalledWith({
        where: { id: VIDEO_ID, status: VideoStatus.PROCESSING },
      });
    });

    it('should resolve instead of failing the job', async () => {
      await expect(processor.process(job())).resolves.toBeUndefined();
    });
  });

  describe('a failing step', () => {
    it('should not persist anything when the probe fails', async () => {
      ffprobe.probe.mockRejectedValue(new Error('undecodable'));

      await expect(processor.process(job())).rejects.toThrow('undecodable');
      expect(videos.update).not.toHaveBeenCalled();
    });

    it('should not persist anything when the thumbnail extraction fails', async () => {
      thumbnails.generate.mockRejectedValue(new Error('no frame'));

      await expect(processor.process(job())).rejects.toThrow('no frame');
      expect(videos.update).not.toHaveBeenCalled();
    });
  });
});
