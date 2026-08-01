import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChannelsService } from '../channels/channels.service';
import { VideoNotFoundException } from '../common/exceptions/domain.exception';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';

type FindOneCall = [{ where: Record<string, unknown> }];

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '22222222-2222-4222-8222-222222222222';
const VIDEO_ID = '33333333-3333-4333-8333-333333333333';
const PUBLIC_ID = 'aBcDeFgHiJkL';

const errorOf = async (
  call: Promise<unknown>,
): Promise<VideoNotFoundException> =>
  call.then(
    () => {
      throw new Error('Expected the call to reject');
    },
    (error: VideoNotFoundException) => error,
  );

const row = (overrides: Partial<Video> = {}): Video =>
  ({
    id: VIDEO_ID,
    public_id: PUBLIC_ID,
    channel_id: CHANNEL_ID,
    status: VideoStatus.READY,
    storage_key: `videos/${VIDEO_ID}.mp4`,
    thumbnail_key: `thumbnails/${VIDEO_ID}.jpg`,
    upload_id: 'multipart-upload-id',
    failure_reason: null,
    duration_seconds: 12.345,
    width: 1920,
    height: 1080,
    video_codec: 'h264',
    audio_codec: 'aac',
    container_format: 'mov,mp4,m4a,3gp,3g2,mj2',
    bitrate_bps: 188_900,
    size_bytes: 47_225,
    ...overrides,
  }) as Video;

describe('VideosService', () => {
  let service: VideosService;
  let videos: { findOne: jest.Mock };
  let channels: { findIdByUserId: jest.Mock };

  beforeEach(async () => {
    videos = { findOne: jest.fn().mockResolvedValue(row()) };
    channels = { findIdByUserId: jest.fn().mockResolvedValue(CHANNEL_ID) };

    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videos },
        { provide: ChannelsService, useValue: channels },
      ],
    }).compile();

    service = module.get(VideosService);
  });

  describe('the public resolution', () => {
    it('should filter on ready in the same query that resolves the publicId', async () => {
      await service.findPublicByPublicId(PUBLIC_ID);

      const [[options]] = videos.findOne.mock.calls as FindOneCall[];
      expect(options.where).toEqual({
        public_id: PUBLIC_ID,
        status: VideoStatus.READY,
      });
      // One query, not fetch-then-check: no window where the two disagree.
      expect(videos.findOne).toHaveBeenCalledTimes(1);
    });

    it('should return the metadata of a ready video', async () => {
      const result = await service.findPublicByPublicId(PUBLIC_ID);

      expect(result).toEqual({
        publicId: PUBLIC_ID,
        durationSeconds: 12.345,
        width: 1920,
        height: 1080,
        videoCodec: 'h264',
        audioCodec: 'aac',
        containerFormat: 'mov,mp4,m4a,3gp,3g2,mj2',
        bitrateBps: 188_900,
        sizeBytes: 47_225,
      });
    });

    it('should never expose the internal id or the storage keys', async () => {
      const result = await service.findPublicByPublicId(PUBLIC_ID);

      expect(Object.keys(result)).not.toContain('id');
      expect(JSON.stringify(result)).not.toContain(VIDEO_ID);
    });

    it('should not expose the status, which is ready by construction', async () => {
      const result = await service.findPublicByPublicId(PUBLIC_ID);

      expect(Object.keys(result)).not.toContain('status');
    });

    it('should answer not-found when the query matches nothing', async () => {
      videos.findOne.mockResolvedValue(null);

      await expect(service.findPublicByPublicId(PUBLIC_ID)).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('should answer not-found with the 404 contract, never a 403', async () => {
      videos.findOne.mockResolvedValue(null);

      await expect(
        service.findPublicByPublicId(PUBLIC_ID),
      ).rejects.toMatchObject({
        errorCode: 'VIDEO_NOT_FOUND',
        httpStatus: 404,
      });
    });
  });

  describe('the owner resolution', () => {
    it('should scope the query to the caller channel', async () => {
      await service.findOwnedById(USER_ID, VIDEO_ID);

      const [[options]] = videos.findOne.mock.calls as FindOneCall[];
      expect(options.where).toEqual({
        id: VIDEO_ID,
        channel_id: CHANNEL_ID,
      });
      expect(channels.findIdByUserId).toHaveBeenCalledWith(USER_ID);
    });

    it('should return a draft video, which the public route cannot see', async () => {
      videos.findOne.mockResolvedValue(
        row({
          status: VideoStatus.DRAFT,
          duration_seconds: null,
          width: null,
          height: null,
          video_codec: null,
          audio_codec: null,
          container_format: null,
          bitrate_bps: null,
          size_bytes: null,
          thumbnail_key: null,
        }),
      );

      const result = await service.findOwnedById(USER_ID, VIDEO_ID);

      expect(result.status).toBe(VideoStatus.DRAFT);
      expect(result.durationSeconds).toBeNull();
      expect(result.failureReason).toBeNull();
    });

    it('should return a failed video with its persisted reason', async () => {
      videos.findOne.mockResolvedValue(
        row({
          status: VideoStatus.ERROR,
          failure_reason:
            'Input has no decodable video stream: moov atom not found',
        }),
      );

      const result = await service.findOwnedById(USER_ID, VIDEO_ID);

      expect(result.status).toBe(VideoStatus.ERROR);
      expect(result.failureReason).toBe(
        'Input has no decodable video stream: moov atom not found',
      );
    });

    it('should answer not-found for a video owned by someone else', async () => {
      // The channel scope is in the WHERE, so someone else's video simply misses.
      videos.findOne.mockResolvedValue(null);

      await expect(service.findOwnedById(USER_ID, VIDEO_ID)).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('should answer not-found for a malformed id without querying', async () => {
      await expect(
        service.findOwnedById(USER_ID, 'not-a-uuid'),
      ).rejects.toThrow(VideoNotFoundException);

      expect(videos.findOne).not.toHaveBeenCalled();
    });

    it('should answer not-found when the caller has no channel', async () => {
      channels.findIdByUserId.mockResolvedValue(null);

      await expect(service.findOwnedById(USER_ID, VIDEO_ID)).rejects.toThrow(
        VideoNotFoundException,
      );
      expect(videos.findOne).not.toHaveBeenCalled();
    });

    it('should answer every miss with the same error', async () => {
      videos.findOne.mockResolvedValue(null);

      const unknownId = await errorOf(service.findOwnedById(USER_ID, VIDEO_ID));
      const malformedId = await errorOf(
        service.findOwnedById(USER_ID, 'not-a-uuid'),
      );

      // Indistinguishable on purpose: the response must not confirm existence.
      expect(unknownId.errorCode).toBe(malformedId.errorCode);
      expect(unknownId.httpStatus).toBe(malformedId.httpStatus);
      expect(unknownId.message).toBe(malformedId.message);
    });
  });

  describe('findOwnedEntity', () => {
    it('should hand back the row itself for the guarded transitions to use', async () => {
      const entity = await service.findOwnedEntity(USER_ID, VIDEO_ID);

      expect(entity.id).toBe(VIDEO_ID);
      expect(entity.storage_key).toBe(`videos/${VIDEO_ID}.mp4`);
    });
  });
});
