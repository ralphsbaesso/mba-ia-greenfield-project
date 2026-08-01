import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import storageConfig from '../../config/storage.config';
import { StorageService } from '../../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import { generatePublicId } from '../videos.id';
import {
  UPLOAD_PART_SIZE_BYTES,
  UPLOAD_PART_URL_TTL_SECONDS,
} from './video-uploads.constants';
import { VideoUploadsModule } from './video-uploads.module';
import { VideoUploadsService } from './video-uploads.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const CONTENT_TYPE = 'video/mp4';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('VideoUploadsService — initiate (integration)', () => {
  let module: TestingModule;
  let service: VideoUploadsService;
  let storage: StorageService;
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let userId: string;
  let channelId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        TypeOrmModule.forRoot({
          ...createTestDataSource(ALL_ENTITIES).options,
          synchronize: false,
        }),
        VideoUploadsModule,
      ],
    }).compile();

    service = module.get(VideoUploadsService);
    storage = module.get(StorageService);
    dataSource = module.get(DataSource);
    videos = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await cleanAllTables(dataSource);
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);

    const user = await dataSource.getRepository(User).save({
      email: `${generatePublicId()}@streamtube.test`,
      password: 'hashed',
    });
    const channel = await dataSource.getRepository(Channel).save({
      name: 'Uploader',
      nickname: generatePublicId(),
      user_id: user.id,
    });
    userId = user.id;
    channelId = channel.id;
  });

  describe('draft pre-registration', () => {
    it('should persist the draft row before any byte is transferred', async () => {
      const result = await service.initiate(userId, {
        contentType: CONTENT_TYPE,
        totalSizeBytes: 5 * 1024 * 1024,
      });

      const row = await videos.findOneByOrFail({ id: result.videoId });
      expect(row.status).toBe(VideoStatus.DRAFT);
      expect(row.channel_id).toBe(channelId);
      expect(row.public_id).toBe(result.publicId);
      expect(row.storage_key).toBe(`videos/${result.videoId}.mp4`);
      expect(row.upload_id).toBe(result.uploadId);
    });

    it('should leave the object absent from storage until parts are uploaded', async () => {
      const result = await service.initiate(userId, {
        contentType: CONTENT_TYPE,
        totalSizeBytes: 1024,
      });

      await expect(
        storage.headObject(`videos/${result.videoId}.mp4`),
      ).rejects.toBeDefined();
    });

    it('should cover the declared size with 64 MiB parts', async () => {
      const result = await service.initiate(userId, {
        contentType: CONTENT_TYPE,
        totalSizeBytes: UPLOAD_PART_SIZE_BYTES * 2 + 1,
      });

      expect(result.partSizeBytes).toBe(64 * 1024 * 1024);
      expect(result.parts).toHaveLength(3);
      expect(result.expiresInSeconds).toBe(UPLOAD_PART_URL_TTL_SECONDS);
    });
  });

  describe('presigned part grant', () => {
    it('should accept a direct PUT with no authentication header', async () => {
      const result = await service.initiate(userId, {
        contentType: CONTENT_TYPE,
        totalSizeBytes: 1024,
      });

      const response = await fetch(result.parts[0].url, {
        method: 'PUT',
        body: 'a-video-part',
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('etag')).toBeTruthy();
    });

    it('should refuse a part PUT once the grant has expired', async () => {
      const result = await service.initiate(userId, {
        contentType: CONTENT_TYPE,
        totalSizeBytes: 1024,
      });
      const shortLived = await storage.presignUploadPart(
        `videos/${result.videoId}.mp4`,
        { uploadId: result.uploadId, partNumber: 1, expiresIn: 1 },
      );

      await sleep(2500);
      const response = await fetch(shortLived, {
        method: 'PUT',
        body: 'a-video-part',
      });

      expect(response.status).toBe(403);
    }, 15000);
  });

  describe('missing channel', () => {
    it('should raise CHANNEL_MISSING_FOR_USER for a user with no channel', async () => {
      const orphan = await dataSource.getRepository(User).save({
        email: `${generatePublicId()}@streamtube.test`,
        password: 'hashed',
      });

      await expect(
        service.initiate(orphan.id, {
          contentType: CONTENT_TYPE,
          totalSizeBytes: 1024,
        }),
      ).rejects.toMatchObject({
        errorCode: 'CHANNEL_MISSING_FOR_USER',
        httpStatus: 500,
      });

      expect(await videos.count()).toBe(0);
    });
  });
});
