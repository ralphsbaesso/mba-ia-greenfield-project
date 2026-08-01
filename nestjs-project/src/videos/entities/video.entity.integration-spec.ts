import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { generatePublicId } from '../videos.id';
import { Video, VideoStatus } from './video.entity';

const READY_METADATA = {
  duration_seconds: 12.345,
  width: 1920,
  height: 1080,
  video_codec: 'h264',
  container_format: 'mov,mp4,m4a,3gp,3g2,mj2',
  size_bytes: 104_857_600,
  thumbnail_key: 'thumbnails/probe.jpg',
};

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let channelId: string;

  const draftRow = (overrides: Partial<Video> = {}): Partial<Video> => ({
    channel_id: channelId,
    public_id: generatePublicId(),
    storage_key: `videos/${generatePublicId()}.mp4`,
    ...overrides,
  });

  beforeAll(async () => {
    dataSource = createTestDataSource(
      [User, Channel, RefreshToken, VerificationToken, Video],
      { synchronize: false },
    );
    await dataSource.initialize();
    videos = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await cleanAllTables(dataSource);
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);

    const user = await dataSource.getRepository(User).save({
      email: `${generatePublicId()}@streamtube.test`,
      password: 'hashed',
    });
    const channel = await dataSource.getRepository(Channel).save({
      name: 'Probe Channel',
      nickname: generatePublicId(),
      user_id: user.id,
    });
    channelId = channel.id;
  });

  describe('draft insertion', () => {
    it('should accept a row carrying only channel_id, public_id and storage_key', async () => {
      const saved = await videos.save(draftRow());

      const found = await videos.findOneByOrFail({ id: saved.id });
      expect(found.status).toBe(VideoStatus.DRAFT);
      expect(found.thumbnail_key).toBeNull();
      expect(found.upload_id).toBeNull();
      expect(found.duration_seconds).toBeNull();
      expect(found.created_at).toBeInstanceOf(Date);
    });

    it('should reject a row whose channel_id points at no channel', async () => {
      await expect(
        videos.save(
          draftRow({ channel_id: '00000000-0000-4000-8000-000000000000' }),
        ),
      ).rejects.toBeInstanceOf(QueryFailedError);
    });

    it('should reject a second row with the same public_id', async () => {
      const public_id = generatePublicId();
      await videos.save(draftRow({ public_id }));

      await expect(videos.save(draftRow({ public_id }))).rejects.toBeInstanceOf(
        QueryFailedError,
      );
    });
  });

  describe('ready-state CHECK constraints', () => {
    it('should accept a ready row carrying the full metadata set', async () => {
      const saved = await videos.save(
        draftRow({ status: VideoStatus.READY, ...READY_METADATA }),
      );

      const found = await videos.findOneByOrFail({ id: saved.id });
      expect(found.status).toBe(VideoStatus.READY);
      expect(found.duration_seconds).toBe(12.345);
      expect(found.size_bytes).toBe(104_857_600);
    });

    it.each([
      'duration_seconds',
      'width',
      'height',
      'video_codec',
      'container_format',
      'size_bytes',
    ])('should refuse promoting to ready without %s', async (field) => {
      const metadata: Record<string, unknown> = { ...READY_METADATA };
      metadata[field] = null;

      await expect(
        videos.save(draftRow({ status: VideoStatus.READY, ...metadata })),
      ).rejects.toBeInstanceOf(QueryFailedError);
    });

    it('should refuse promoting to ready without thumbnail_key', async () => {
      await expect(
        videos.save(
          draftRow({
            status: VideoStatus.READY,
            ...READY_METADATA,
            thumbnail_key: null,
          }),
        ),
      ).rejects.toBeInstanceOf(QueryFailedError);
    });

    it('should accept a ready row with no audio_codec and no bitrate_bps', async () => {
      const saved = await videos.save(
        draftRow({
          status: VideoStatus.READY,
          ...READY_METADATA,
          audio_codec: null,
          bitrate_bps: null,
        }),
      );

      const found = await videos.findOneByOrFail({ id: saved.id });
      expect(found.audio_codec).toBeNull();
      expect(found.bitrate_bps).toBeNull();
    });

    it.each([VideoStatus.DRAFT, VideoStatus.PROCESSING, VideoStatus.ERROR])(
      'should leave a %s row free of the ready metadata requirements',
      async (status) => {
        const saved = await videos.save(draftRow({ status }));

        const found = await videos.findOneByOrFail({ id: saved.id });
        expect(found.status).toBe(status);
        expect(found.thumbnail_key).toBeNull();
      },
    );
  });

  describe('numeric columns', () => {
    it('should preserve millisecond precision on duration_seconds', async () => {
      const saved = await videos.save(
        draftRow({
          status: VideoStatus.READY,
          ...READY_METADATA,
          duration_seconds: 3661.007,
        }),
      );

      const found = await videos.findOneByOrFail({ id: saved.id });
      expect(found.duration_seconds).toBe(3661.007);
    });

    it('should read bigint columns back as numbers', async () => {
      const saved = await videos.save(
        draftRow({
          status: VideoStatus.READY,
          ...READY_METADATA,
          size_bytes: 10_737_418_240,
          bitrate_bps: 8_000_000,
        }),
      );

      const found = await videos.findOneByOrFail({ id: saved.id });
      expect(found.size_bytes).toBe(10_737_418_240);
      expect(found.bitrate_bps).toBe(8_000_000);
    });
  });

  describe('channel relation', () => {
    it('should load the owning channel through the relation', async () => {
      const saved = await videos.save(draftRow());

      const found = await videos.findOneOrFail({
        where: { id: saved.id },
        relations: { channel: true },
      });
      expect(found.channel.id).toBe(channelId);
    });
  });
});
