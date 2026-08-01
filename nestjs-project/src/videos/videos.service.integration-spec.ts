import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import storageConfig from '../config/storage.config';
import { VideoNotFoundException } from '../common/exceptions/domain.exception';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video, VideoStatus } from './entities/video.entity';
import { generatePublicId } from './videos.id';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

const UNKNOWN_PUBLIC_ID = 'zzzzzzzzzzzz';
const UNKNOWN_VIDEO_ID = '99999999-9999-4999-8999-999999999999';

/** Every column a `ready` row needs to satisfy the state-scoped CHECKs. */
const READY_METADATA = {
  duration_seconds: 12.345,
  width: 1920,
  height: 1080,
  video_codec: 'h264',
  audio_codec: 'aac',
  container_format: 'mov,mp4,m4a,3gp,3g2,mj2',
  bitrate_bps: 188_900,
  size_bytes: 47_225,
};

describe('VideosService (integration)', () => {
  let module: TestingModule;
  let service: VideosService;
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let ownerId: string;
  let ownerChannelId: string;
  let strangerId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        // VideosModule now pulls StorageModule in for the delivery routes.
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        TypeOrmModule.forRoot({
          ...createTestDataSource(ALL_ENTITIES).options,
          synchronize: false,
        }),
        VideosModule,
      ],
    }).compile();

    service = module.get(VideosService);
    dataSource = module.get(DataSource);
    videos = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await cleanAllTables(dataSource);
    await module.close();
  });

  const seedUserWithChannel = async (
    name: string,
  ): Promise<{ userId: string; channelId: string }> => {
    const user = await dataSource.getRepository(User).save({
      email: `${generatePublicId()}@streamtube.test`,
      password: 'hashed',
    });
    const channel = await dataSource.getRepository(Channel).save({
      name,
      nickname: generatePublicId(),
      user_id: user.id,
    });

    return { userId: user.id, channelId: channel.id };
  };

  beforeEach(async () => {
    await cleanAllTables(dataSource);

    const owner = await seedUserWithChannel('Owner');
    ownerId = owner.userId;
    ownerChannelId = owner.channelId;

    strangerId = (await seedUserWithChannel('Stranger')).userId;
  });

  const seedVideo = async (
    status: VideoStatus,
    overrides: Partial<Video> = {},
  ): Promise<Video> => {
    const isReady = status === VideoStatus.READY;
    const video = await videos.save(
      videos.create({
        public_id: generatePublicId(),
        channel_id: ownerChannelId,
        status,
        storage_key: 'videos/seed.mp4',
        ...(isReady && {
          ...READY_METADATA,
          thumbnail_key: 'thumbnails/seed.jpg',
        }),
        ...overrides,
      }),
    );

    return video;
  };

  const errorOf = async (
    call: Promise<unknown>,
  ): Promise<VideoNotFoundException> =>
    call.then(
      () => {
        throw new Error('Expected the call to reject');
      },
      (error: VideoNotFoundException) => error,
    );

  describe('the public resolution', () => {
    it('should return the metadata of a ready video', async () => {
      const video = await seedVideo(VideoStatus.READY);

      const result = await service.findPublicByPublicId(video.public_id);

      expect(result).toEqual({
        publicId: video.public_id,
        ...READY_METADATA,
      });
    });

    it('should read the numeric columns back as numbers', async () => {
      const video = await seedVideo(VideoStatus.READY);

      const result = await service.findPublicByPublicId(video.public_id);

      expect(typeof result.duration_seconds).toBe('number');
      expect(typeof result.bitrate_bps).toBe('number');
      expect(typeof result.size_bytes).toBe('number');
    });

    it.each([VideoStatus.DRAFT, VideoStatus.PROCESSING, VideoStatus.ERROR])(
      'should be indistinguishable from an unknown id for a %s video',
      async (status) => {
        const video = await seedVideo(status);

        const existing = await errorOf(
          service.findPublicByPublicId(video.public_id),
        );
        const unknown = await errorOf(
          service.findPublicByPublicId(UNKNOWN_PUBLIC_ID),
        );

        expect(existing.errorCode).toBe('VIDEO_NOT_FOUND');
        expect(existing.httpStatus).toBe(404);
        expect(existing.message).toBe(unknown.message);
      },
    );

    it('should stop resolving a video the moment it leaves ready', async () => {
      const video = await seedVideo(VideoStatus.READY);
      await expect(
        service.findPublicByPublicId(video.public_id),
      ).resolves.toBeDefined();

      // The filter is in the query, so no cached decision survives the change.
      await videos.update({ id: video.id }, { status: VideoStatus.ERROR });

      await expect(
        service.findPublicByPublicId(video.public_id),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('should expose no internal identifier at all', async () => {
      const video = await seedVideo(VideoStatus.READY);

      const result = await service.findPublicByPublicId(video.public_id);

      expect(JSON.stringify(result)).not.toContain(video.id);
      expect(JSON.stringify(result)).not.toContain('videos/seed.mp4');
    });
  });

  describe('the owner resolution', () => {
    it.each([
      VideoStatus.DRAFT,
      VideoStatus.PROCESSING,
      VideoStatus.READY,
      VideoStatus.ERROR,
    ])('should return the owner a %s video', async (status) => {
      const video = await seedVideo(status);

      const result = await service.findOwnedById(ownerId, video.id);

      expect(result.publicId).toBe(video.public_id);
      expect(result.status).toBe(status);
    });

    it('should carry the persisted failure reason of a failed video', async () => {
      const reason = 'Input has no decodable video stream: moov atom not found';
      const video = await seedVideo(VideoStatus.ERROR, {
        failure_reason: reason,
      });

      const result = await service.findOwnedById(ownerId, video.id);

      expect(result.status).toBe(VideoStatus.ERROR);
      expect(result.failure_reason).toBe(reason);
    });

    it('should give a non-owner the same answer as an unknown id', async () => {
      const video = await seedVideo(VideoStatus.READY);

      const notMine = await errorOf(
        service.findOwnedById(strangerId, video.id),
      );
      const unknown = await errorOf(
        service.findOwnedById(strangerId, UNKNOWN_VIDEO_ID),
      );

      expect(notMine.errorCode).toBe('VIDEO_NOT_FOUND');
      expect(notMine.httpStatus).toBe(404);
      expect(notMine.message).toBe(unknown.message);
    });

    it('should not let a malformed id reach Postgres', async () => {
      // An unguarded uuid column would answer `invalid input syntax for uuid`,
      // which is a 500 and a different answer than "unknown".
      const malformed = await errorOf(
        service.findOwnedById(ownerId, 'not-a-uuid'),
      );

      expect(malformed.errorCode).toBe('VIDEO_NOT_FOUND');
    });

    it('should return the entity itself for the guarded transitions', async () => {
      const video = await seedVideo(VideoStatus.DRAFT, {
        upload_id: 'multipart-upload-id',
      });

      const entity = await service.findOwnedEntity(ownerId, video.id);

      expect(entity.id).toBe(video.id);
      expect(entity.upload_id).toBe('multipart-upload-id');
    });
  });
});
