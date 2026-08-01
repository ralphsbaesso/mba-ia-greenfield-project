import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import storageConfig from '../../config/storage.config';
import { StorageModule } from '../../storage/storage.module';
import { StorageService } from '../../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import { generatePublicId } from '../videos.id';
import { OrphanDraftCleanupService } from './orphan-draft-cleanup.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

const HOUR_MS = 60 * 60 * 1000;

/** Everything the state-scoped CHECKs demand of a `ready` row. */
const READY_COLUMNS = {
  duration_seconds: 12.345,
  width: 1920,
  height: 1080,
  video_codec: 'h264',
  container_format: 'mp4',
  size_bytes: 47_225,
  thumbnail_key: 'thumbnails/cleanup.jpg',
};

describe('OrphanDraftCleanupService (integration)', () => {
  let module: TestingModule;
  let service: OrphanDraftCleanupService;
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let storage: StorageService;
  let channelId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        TypeOrmModule.forRoot({
          ...createTestDataSource(ALL_ENTITIES).options,
          synchronize: false,
        }),
        TypeOrmModule.forFeature([Video]),
        StorageModule,
      ],
      providers: [OrphanDraftCleanupService],
    }).compile();

    service = module.get(OrphanDraftCleanupService);
    dataSource = module.get(DataSource);
    videos = dataSource.getRepository(Video);
    storage = module.get(StorageService);
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
      name: 'Owner',
      nickname: generatePublicId(),
      user_id: user.id,
    });
    channelId = channel.id;
  });

  /** A real open multipart upload, because an abort against a fake id proves nothing. */
  async function seedVideoWithOpenUpload(
    status: VideoStatus,
    ageHours: number,
  ): Promise<Video> {
    const publicId = generatePublicId();
    const storageKey = `videos/cleanup-${publicId}.mp4`;
    const uploadId = await storage.createMultipartUpload(
      storageKey,
      'video/mp4',
    );

    const video = await videos.save(
      videos.create({
        public_id: publicId,
        channel_id: channelId,
        status,
        storage_key: storageKey,
        upload_id: uploadId,
        ...(status === VideoStatus.READY && READY_COLUMNS),
      }),
    );

    // `created_at` is a @CreateDateColumn, so ageing the row is a direct write.
    await dataSource.query('UPDATE videos SET created_at = $1 WHERE id = $2', [
      new Date(Date.now() - ageHours * HOUR_MS),
      video.id,
    ]);

    return videos.findOneByOrFail({ id: video.id });
  }

  const isUploadOpen = async (uploadId: string): Promise<boolean> => {
    const uploads = await storage.listMultipartUploads('videos/cleanup-');

    return uploads.some((upload) => upload.uploadId === uploadId);
  };

  it('should abort the multipart upload of a draft older than 24h', async () => {
    const orphan = await seedVideoWithOpenUpload(VideoStatus.DRAFT, 25);
    await expect(isUploadOpen(orphan.upload_id as string)).resolves.toBe(true);

    const result = await service.cleanupOrphanDrafts();

    expect(result).toEqual({ scanned: 1, aborted: 1, failed: 0 });
    await expect(isUploadOpen(orphan.upload_id as string)).resolves.toBe(false);
  });

  it('should keep the row, dropping only the spent upload id', async () => {
    const orphan = await seedVideoWithOpenUpload(VideoStatus.DRAFT, 25);

    await service.cleanupOrphanDrafts();

    // The row survives for Fase 04's panel — this phase reclaims storage only.
    const row = await videos.findOneByOrFail({ id: orphan.id });
    expect(row.status).toBe(VideoStatus.DRAFT);
    expect(row.upload_id).toBeNull();
    expect(row.storage_key).toBe(orphan.storage_key);
  });

  it('should refuse to complete an upload it aborted', async () => {
    const orphan = await seedVideoWithOpenUpload(VideoStatus.DRAFT, 25);

    await service.cleanupOrphanDrafts();

    await expect(
      storage.completeMultipartUpload(
        orphan.storage_key,
        orphan.upload_id as string,
        [{ partNumber: 1, etag: '"whatever"' }],
      ),
    ).rejects.toThrow();
  });

  it('should not touch a draft still inside the 24h window', async () => {
    const recent = await seedVideoWithOpenUpload(VideoStatus.DRAFT, 23);

    const result = await service.cleanupOrphanDrafts();

    // 23h of transfer is a slow upload, not an abandoned one.
    expect(result.scanned).toBe(0);
    await expect(isUploadOpen(recent.upload_id as string)).resolves.toBe(true);
    expect((await videos.findOneByOrFail({ id: recent.id })).upload_id).toBe(
      recent.upload_id,
    );
  });

  it.each([VideoStatus.PROCESSING, VideoStatus.READY, VideoStatus.ERROR])(
    'should not touch an old %s video',
    async (status) => {
      const video = await seedVideoWithOpenUpload(status, 48);

      const result = await service.cleanupOrphanDrafts();

      expect(result.scanned).toBe(0);
      expect((await videos.findOneByOrFail({ id: video.id })).upload_id).toBe(
        video.upload_id,
      );
      await storage.abortMultipartUpload(video.storage_key, video.upload_id!);
    },
  );

  it('should be idempotent across runs', async () => {
    await seedVideoWithOpenUpload(VideoStatus.DRAFT, 25);

    await service.cleanupOrphanDrafts();
    const second = await service.cleanupOrphanDrafts();

    // The cleared `upload_id` is what keeps the second run from re-aborting and
    // logging a `NoSuchUpload` failure forever.
    expect(second).toEqual({ scanned: 0, aborted: 0, failed: 0 });
  });
});
