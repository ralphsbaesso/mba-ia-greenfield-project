import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChannelsService } from '../../channels/channels.service';
import {
  ChannelMissingForUserException,
  InvalidVideoStateException,
  VideoNotFoundException,
} from '../../common/exceptions/domain.exception';
import { StorageService } from '../../storage/storage.service';
import { Video, VideoStatus } from '../entities/video.entity';
import {
  VIDEO_PROCESSING_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../processing/video-queue.constants';
import {
  UPLOAD_PART_SIZE_BYTES,
  UPLOAD_PART_URL_TTL_SECONDS,
} from './video-uploads.constants';
import { VideoUploadsService } from './video-uploads.service';

type PresignPartCall = [
  string,
  { uploadId: string; partNumber: number; expiresIn: number },
];
type SaveCall = [Partial<Video>];

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
const UPLOAD_ID = 'multipart-upload-id';

describe('VideoUploadsService — initiate', () => {
  let service: VideoUploadsService;
  let channels: { findIdByUserId: jest.Mock };
  let storage: {
    resolveVideoKey: jest.Mock;
    createMultipartUpload: jest.Mock;
    presignUploadPart: jest.Mock;
  };
  let videos: { create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    channels = { findIdByUserId: jest.fn().mockResolvedValue(CHANNEL_ID) };
    storage = {
      resolveVideoKey: jest
        .fn()
        .mockImplementation((id: string) => `videos/${id}.mp4`),
      createMultipartUpload: jest.fn().mockResolvedValue(UPLOAD_ID),
      presignUploadPart: jest
        .fn()
        .mockImplementation((key: string, opts: { partNumber: number }) =>
          Promise.resolve(
            `https://storage.test/${key}?partNumber=${opts.partNumber}`,
          ),
        ),
    };
    videos = {
      create: jest.fn().mockImplementation((row: Partial<Video>) => row),
      save: jest.fn().mockImplementation((row: Partial<Video>) => row),
    };

    const module = await Test.createTestingModule({
      providers: [
        VideoUploadsService,
        { provide: getRepositoryToken(Video), useValue: videos },
        { provide: ChannelsService, useValue: channels },
        { provide: StorageService, useValue: storage },
        {
          provide: getQueueToken(VIDEO_PROCESSING_QUEUE),
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(VideoUploadsService);
  });

  const initiate = (totalSizeBytes: number) =>
    service.initiate(USER_ID, {
      title: TITLE,
      contentType: 'video/mp4',
      totalSizeBytes,
    });

  describe('part partitioning', () => {
    it('should presign a single part for a file smaller than the part size', async () => {
      const result = await initiate(1024);

      expect(result.parts).toHaveLength(1);
      expect(result.parts[0].partNumber).toBe(1);
      expect(result.partSizeBytes).toBe(UPLOAD_PART_SIZE_BYTES);
    });

    it('should presign exactly one part when the size matches the part size', async () => {
      const result = await initiate(UPLOAD_PART_SIZE_BYTES);

      expect(result.parts).toHaveLength(1);
    });

    it('should round the trailing partial part up', async () => {
      const result = await initiate(UPLOAD_PART_SIZE_BYTES + 1);

      expect(result.parts).toHaveLength(2);
      expect(result.parts.map((p) => p.partNumber)).toEqual([1, 2]);
    });

    it('should cover a 10GB file with 160 parts, under the 10000-part ceiling', async () => {
      const result = await initiate(10 * 1024 * 1024 * 1024);

      expect(result.parts).toHaveLength(160);
      expect(result.parts.length).toBeLessThan(10_000);
      expect(result.parts[159].partNumber).toBe(160);
    });

    it('should still presign one part for a declared size of zero', async () => {
      const result = await initiate(0);

      expect(result.parts).toHaveLength(1);
    });
  });

  describe('presigned grant', () => {
    it('should presign every part against the same key and uploadId', async () => {
      await initiate(UPLOAD_PART_SIZE_BYTES * 3);

      expect(storage.presignUploadPart).toHaveBeenCalledTimes(3);
      const calls = storage.presignUploadPart.mock.calls as PresignPartCall[];
      expect(new Set(calls.map(([key]) => key)).size).toBe(1);
      for (const [, options] of calls) {
        expect(options).toMatchObject({
          uploadId: UPLOAD_ID,
          expiresIn: UPLOAD_PART_URL_TTL_SECONDS,
        });
      }
    });

    it('should expose a TTL on the order of hours, not the 7-day maximum', async () => {
      const result = await initiate(1024);

      expect(result.expiresInSeconds).toBe(UPLOAD_PART_URL_TTL_SECONDS);
      expect(result.expiresInSeconds).toBeGreaterThanOrEqual(3600);
      expect(result.expiresInSeconds).toBeLessThan(7 * 24 * 60 * 60);
    });
  });

  describe('draft row', () => {
    it('should persist the draft with channel, key and uploadId before any byte', async () => {
      const result = await initiate(1024);

      expect(videos.save).toHaveBeenCalledTimes(1);
      const [[saved]] = videos.save.mock.calls as SaveCall[];
      expect(saved.channel_id).toBe(CHANNEL_ID);
      expect(saved.upload_id).toBe(UPLOAD_ID);
      expect(saved.storage_key).toBe(`videos/${saved.id}.mp4`);
      expect(saved.public_id).toEqual(expect.any(String));
      expect(result.videoId).toBe(saved.id);
      expect(result.uploadId).toBe(UPLOAD_ID);
    });

    it('should derive the storage key from the video id, not from the public id', async () => {
      await initiate(1024);

      const [[saved]] = videos.save.mock.calls as SaveCall[];
      expect(storage.resolveVideoKey).toHaveBeenCalledWith(
        saved.id,
        'video/mp4',
      );
    });

    it('should open the multipart upload before persisting the row', async () => {
      const order: string[] = [];
      storage.createMultipartUpload.mockImplementation(() => {
        order.push('multipart');
        return Promise.resolve(UPLOAD_ID);
      });
      videos.save.mockImplementation((row: Partial<Video>) => {
        order.push('save');
        return row;
      });

      await initiate(1024);

      expect(order).toEqual(['multipart', 'save']);
    });
  });

  describe('missing channel', () => {
    it('should raise CHANNEL_MISSING_FOR_USER when the user has no channel', async () => {
      channels.findIdByUserId.mockResolvedValue(null);

      await expect(initiate(1024)).rejects.toBeInstanceOf(
        ChannelMissingForUserException,
      );
    });

    it('should classify the missing channel as a 500 invariant violation', async () => {
      channels.findIdByUserId.mockResolvedValue(null);

      await expect(initiate(1024)).rejects.toMatchObject({
        errorCode: 'CHANNEL_MISSING_FOR_USER',
        httpStatus: 500,
      });
    });

    it('should not touch storage or the database when the channel is missing', async () => {
      channels.findIdByUserId.mockResolvedValue(null);

      await expect(initiate(1024)).rejects.toBeDefined();
      expect(storage.createMultipartUpload).not.toHaveBeenCalled();
      expect(videos.save).not.toHaveBeenCalled();
    });
  });
});

const VIDEO_ID = '33333333-3333-4333-8333-333333333333';
const PUBLIC_ID = 'aBcDeFgHiJkL';
const TITLE = 'A video with a title';
const STORAGE_KEY = `videos/${VIDEO_ID}.mp4`;
const ETAGS = [
  { partNumber: 1, etag: '"etag-1"' },
  { partNumber: 2, etag: '"etag-2"' },
];

type AddCall = [string, { videoId: string }, { jobId: string }];

describe('VideoUploadsService — complete', () => {
  let service: VideoUploadsService;
  let channels: { findIdByUserId: jest.Mock };
  let storage: { completeMultipartUpload: jest.Mock };
  let videos: { findOne: jest.Mock; update: jest.Mock };
  let queue: { add: jest.Mock };

  const draftRow = (overrides: Partial<Video> = {}): Video =>
    ({
      id: VIDEO_ID,
      public_id: PUBLIC_ID,
      channel_id: CHANNEL_ID,
      title: TITLE,
      status: VideoStatus.DRAFT,
      storage_key: STORAGE_KEY,
      upload_id: UPLOAD_ID,
      ...overrides,
    }) as Video;

  beforeEach(async () => {
    channels = { findIdByUserId: jest.fn().mockResolvedValue(CHANNEL_ID) };
    storage = {
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
    };
    videos = {
      findOne: jest.fn().mockResolvedValue(draftRow()),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    queue = { add: jest.fn().mockResolvedValue({ id: VIDEO_ID }) };

    const module = await Test.createTestingModule({
      providers: [
        VideoUploadsService,
        { provide: getRepositoryToken(Video), useValue: videos },
        { provide: ChannelsService, useValue: channels },
        { provide: StorageService, useValue: storage },
        { provide: getQueueToken(VIDEO_PROCESSING_QUEUE), useValue: queue },
      ],
    }).compile();

    service = module.get(VideoUploadsService);
  });

  const complete = (videoId: string = VIDEO_ID) =>
    service.complete(USER_ID, videoId, ETAGS);

  describe('guarded transition', () => {
    it('should consolidate the object and answer with the processing status', async () => {
      const result = await complete();

      expect(storage.completeMultipartUpload).toHaveBeenCalledWith(
        STORAGE_KEY,
        UPLOAD_ID,
        ETAGS,
      );
      expect(result).toEqual({
        publicId: PUBLIC_ID,
        status: VideoStatus.PROCESSING,
      });
    });

    it('should advance the row only from draft, in a conditional update', async () => {
      await complete();

      expect(videos.update).toHaveBeenCalledWith(
        { id: VIDEO_ID, status: VideoStatus.DRAFT },
        { status: VideoStatus.PROCESSING },
      );
    });

    it.each([VideoStatus.PROCESSING, VideoStatus.READY, VideoStatus.ERROR])(
      'should refuse a video in %s with INVALID_VIDEO_STATE',
      async (status) => {
        videos.findOne.mockResolvedValue(draftRow({ status }));

        await expect(complete()).rejects.toBeInstanceOf(
          InvalidVideoStateException,
        );
        await expect(complete()).rejects.toMatchObject({
          errorCode: 'INVALID_VIDEO_STATE',
          httpStatus: 409,
        });
      },
    );

    it('should neither consolidate nor publish when the state is refused', async () => {
      videos.findOne.mockResolvedValue(draftRow({ status: VideoStatus.READY }));

      await expect(complete()).rejects.toBeDefined();
      expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
      expect(videos.update).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('should not publish when a concurrent complete already won the transition', async () => {
      videos.update.mockResolvedValue({ affected: 0 });

      await expect(complete()).rejects.toBeInstanceOf(
        InvalidVideoStateException,
      );
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('should leave the row untouched when the storage consolidation fails', async () => {
      storage.completeMultipartUpload.mockRejectedValue(
        new Error('InvalidPart'),
      );

      await expect(complete()).rejects.toThrow('InvalidPart');
      expect(videos.update).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('job publication', () => {
    it('should publish with a jobId derived from the videoId', async () => {
      await complete();

      expect(queue.add).toHaveBeenCalledTimes(1);
      const [[name, payload, options]] = queue.add.mock.calls as AddCall[];
      expect(name).toBe(VIDEO_PROCESSING_JOB);
      expect(payload).toEqual({ videoId: VIDEO_ID });
      expect(options.jobId).toBe(VIDEO_ID);
    });

    it('should carry only the videoId, leaving every other field to the row', async () => {
      await complete();

      const [[, payload]] = queue.add.mock.calls as AddCall[];
      expect(Object.keys(payload)).toEqual(['videoId']);
    });

    it('should publish only after the row is in processing', async () => {
      const order: string[] = [];
      videos.update.mockImplementation(() => {
        order.push('update');
        return Promise.resolve({ affected: 1 });
      });
      queue.add.mockImplementation(() => {
        order.push('publish');
        return Promise.resolve({ id: VIDEO_ID });
      });

      await complete();

      expect(order).toEqual(['update', 'publish']);
    });
  });

  describe('ownership', () => {
    it('should answer VIDEO_NOT_FOUND when no owned video matches', async () => {
      videos.findOne.mockResolvedValue(null);

      await expect(complete()).rejects.toBeInstanceOf(VideoNotFoundException);
      await expect(complete()).rejects.toMatchObject({
        errorCode: 'VIDEO_NOT_FOUND',
        httpStatus: 404,
      });
    });

    it('should scope the lookup to the caller channel instead of filtering after', async () => {
      await complete();

      expect(videos.findOne).toHaveBeenCalledWith({
        where: { id: VIDEO_ID, channel_id: CHANNEL_ID },
      });
    });

    it('should answer VIDEO_NOT_FOUND, never a 403, for a caller with no channel', async () => {
      channels.findIdByUserId.mockResolvedValue(null);

      await expect(complete()).rejects.toMatchObject({
        errorCode: 'VIDEO_NOT_FOUND',
        httpStatus: 404,
      });
      expect(videos.findOne).not.toHaveBeenCalled();
    });

    it('should answer VIDEO_NOT_FOUND for a malformed videoId, not a validation error', async () => {
      await expect(complete('not-a-uuid')).rejects.toBeInstanceOf(
        VideoNotFoundException,
      );
      expect(videos.findOne).not.toHaveBeenCalled();
    });
  });
});
