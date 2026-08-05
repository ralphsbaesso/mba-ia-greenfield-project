import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Video, VideoStatus } from '../entities/video.entity';
import {
  FfprobeTimeoutError,
  FfprobeService,
  NoDecodableVideoStreamError,
} from './ffprobe.service';
import { SourceFileService } from './source-file.service';
import { ThumbnailService } from './thumbnail.service';
import {
  FAILURE_REASON_MAX_LENGTH,
  UNKNOWN_FAILURE_REASON,
  describeFailure,
  isLastAttempt,
  isPermanentFailure,
} from './video-processing.failure';
import {
  VideoProcessingJobData,
  VideoProcessingProcessor,
} from './video-processing.processor';
import {
  VIDEO_PROCESSING_DLQ,
  VIDEO_PROCESSING_JOB,
} from './video-queue.constants';

const VIDEO_ID = '44444444-4444-4444-8444-444444444444';
const STORAGE_KEY = `videos/${VIDEO_ID}.mp4`;
const ATTEMPTS = 3;

type UpdateCall = [
  { id: string; status: VideoStatus },
  Record<string, unknown>,
];

const job = (attemptsMade = 0): Job<VideoProcessingJobData> =>
  ({
    id: 'job-1',
    data: { videoId: VIDEO_ID },
    attemptsMade,
    opts: { attempts: ATTEMPTS },
  }) as Job<VideoProcessingJobData>;

describe('video processing failure classification', () => {
  describe('isPermanentFailure', () => {
    it('should classify ffprobe rejecting the input as permanent', () => {
      expect(
        isPermanentFailure(new NoDecodableVideoStreamError('garbage')),
      ).toBe(true);
    });

    it('should classify an error carrying only the name as permanent', () => {
      // `instanceof` does not survive duplicated module instances; the name does.
      const error = Object.assign(new Error('garbage'), {
        name: 'NoDecodableVideoStreamError',
      });

      expect(isPermanentFailure(error)).toBe(true);
    });

    it('should classify a probe timeout as transient', () => {
      expect(isPermanentFailure(new FfprobeTimeoutError(60_000))).toBe(false);
    });

    it('should classify an unknown infrastructure error as transient', () => {
      expect(isPermanentFailure(new Error('ECONNRESET'))).toBe(false);
    });
  });

  describe('describeFailure', () => {
    it('should use the error message', () => {
      expect(describeFailure(new Error('ffmpeg exited with code 1'))).toBe(
        'ffmpeg exited with code 1',
      );
    });

    it('should cap a runaway message', () => {
      const reason = describeFailure(new Error('x'.repeat(5_000)));

      expect(reason).toHaveLength(FAILURE_REASON_MAX_LENGTH);
      expect(reason.endsWith('…')).toBe(true);
    });

    it('should fall back when there is no message at all', () => {
      expect(describeFailure(new Error('   '))).toBe(UNKNOWN_FAILURE_REASON);
      expect(describeFailure(undefined)).toBe(UNKNOWN_FAILURE_REASON);
    });
  });

  describe('isLastAttempt', () => {
    it('should be false while attempts remain', () => {
      expect(isLastAttempt({ attemptsMade: 0, opts: { attempts: 3 } })).toBe(
        false,
      );
      expect(isLastAttempt({ attemptsMade: 1, opts: { attempts: 3 } })).toBe(
        false,
      );
    });

    it('should be true on the attempt that exhausts the policy', () => {
      expect(isLastAttempt({ attemptsMade: 2, opts: { attempts: 3 } })).toBe(
        true,
      );
    });

    it('should treat a job with no retry policy as single-attempt', () => {
      expect(isLastAttempt({ attemptsMade: 0, opts: {} })).toBe(true);
    });
  });
});

describe('VideoProcessingProcessor failure handling', () => {
  let processor: VideoProcessingProcessor;
  let videos: { findOne: jest.Mock; update: jest.Mock };
  let sourceFiles: { withDownloadedObject: jest.Mock; sizeOf: jest.Mock };
  let ffprobe: { probe: jest.Mock };
  let thumbnails: { generate: jest.Mock };
  let deadLetters: { add: jest.Mock };

  beforeEach(async () => {
    videos = {
      findOne: jest.fn().mockResolvedValue({
        id: VIDEO_ID,
        storage_key: STORAGE_KEY,
        status: VideoStatus.PROCESSING,
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    sourceFiles = {
      withDownloadedObject: jest
        .fn()
        .mockImplementation(
          async (_key: string, use: (path: string) => Promise<unknown>) =>
            use('/var/tmp/streamtube/downloaded.mp4'),
        ),
      sizeOf: jest.fn().mockResolvedValue(1_024),
    };
    ffprobe = { probe: jest.fn() };
    thumbnails = { generate: jest.fn() };
    deadLetters = { add: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        VideoProcessingProcessor,
        { provide: getRepositoryToken(Video), useValue: videos },
        { provide: SourceFileService, useValue: sourceFiles },
        { provide: FfprobeService, useValue: ffprobe },
        { provide: ThumbnailService, useValue: thumbnails },
        { provide: getQueueToken(VIDEO_PROCESSING_DLQ), useValue: deadLetters },
      ],
    }).compile();

    processor = module.get(VideoProcessingProcessor);
  });

  describe('an input ffprobe cannot decode', () => {
    beforeEach(() => {
      ffprobe.probe.mockRejectedValue(
        new NoDecodableVideoStreamError('no video stream in ffprobe output'),
      );
    });

    it('should mark the video as error on the very first attempt', async () => {
      await expect(processor.process(job(0))).rejects.toBeDefined();

      const [[criteria, values]] = videos.update.mock.calls as UpdateCall[];
      expect(criteria).toEqual({
        id: VIDEO_ID,
        status: VideoStatus.PROCESSING,
      });
      expect(values).toEqual({
        status: VideoStatus.ERROR,
        failure_reason:
          'Input has no decodable video stream: no video stream in ffprobe output',
      });
    });

    it('should not consume the remaining attempts', async () => {
      // BullMQ skips retries for this error class and this error class only.
      await expect(processor.process(job(0))).rejects.toMatchObject({
        name: 'UnrecoverableError',
      });
    });

    it('should not publish to the dead letter queue', async () => {
      await expect(processor.process(job(0))).rejects.toBeDefined();

      expect(deadLetters.add).not.toHaveBeenCalled();
    });

    it('should never produce a thumbnail for it', async () => {
      await expect(processor.process(job(0))).rejects.toBeDefined();

      expect(thumbnails.generate).not.toHaveBeenCalled();
    });
  });

  describe('a transient failure with attempts left', () => {
    beforeEach(() => {
      ffprobe.probe.mockRejectedValue(new FfprobeTimeoutError(60_000));
    });

    it('should rethrow the original error so BullMQ retries it', async () => {
      await expect(processor.process(job(0))).rejects.toThrow(
        FfprobeTimeoutError,
      );
    });

    it('should leave the row in processing, untouched', async () => {
      await expect(processor.process(job(1))).rejects.toBeDefined();

      expect(videos.update).not.toHaveBeenCalled();
    });

    it('should not publish to the dead letter queue yet', async () => {
      await expect(processor.process(job(1))).rejects.toBeDefined();

      expect(deadLetters.add).not.toHaveBeenCalled();
    });
  });

  describe('a transient failure on the last attempt', () => {
    beforeEach(() => {
      thumbnails.generate.mockRejectedValue(new Error('ffmpeg wrote no frame'));
      ffprobe.probe.mockResolvedValue({
        durationSeconds: 2,
        width: 320,
        height: 240,
        videoCodec: 'h264',
        audioCodec: 'aac',
        containerFormat: 'mp4',
        bitrateBps: 1_000,
      });
    });

    it('should persist the error status and the reason', async () => {
      await expect(processor.process(job(ATTEMPTS - 1))).rejects.toBeDefined();

      const [[criteria, values]] = videos.update.mock.calls as UpdateCall[];
      expect(criteria).toEqual({
        id: VIDEO_ID,
        status: VideoStatus.PROCESSING,
      });
      expect(values).toEqual({
        status: VideoStatus.ERROR,
        failure_reason: 'ffmpeg wrote no frame',
      });
    });

    it('should publish the exhausted job to the dead letter queue', async () => {
      await expect(processor.process(job(ATTEMPTS - 1))).rejects.toBeDefined();

      expect(deadLetters.add).toHaveBeenCalledWith(VIDEO_PROCESSING_JOB, {
        videoId: VIDEO_ID,
        originalJobId: 'job-1',
        attemptsMade: ATTEMPTS,
        failureReason: 'ffmpeg wrote no frame',
      });
    });

    it('should record the row before publishing to the dead letter queue', async () => {
      await expect(processor.process(job(ATTEMPTS - 1))).rejects.toBeDefined();

      // The row is what the owner reads back; the DLQ is retention. Recording
      // first means a DLQ outage cannot cost the diagnosable state.
      expect(videos.update.mock.invocationCallOrder[0]).toBeLessThan(
        deadLetters.add.mock.invocationCallOrder[0],
      );
    });

    it('should still surface the failure to BullMQ', async () => {
      await expect(processor.process(job(ATTEMPTS - 1))).rejects.toThrow(
        'ffmpeg wrote no frame',
      );
    });
  });

  describe('a job whose video is no longer in processing', () => {
    it('should not be treated as a failure', async () => {
      videos.findOne.mockResolvedValue(null);

      await expect(
        processor.process(job(ATTEMPTS - 1)),
      ).resolves.toBeUndefined();
      expect(videos.update).not.toHaveBeenCalled();
      expect(deadLetters.add).not.toHaveBeenCalled();
    });
  });
});
