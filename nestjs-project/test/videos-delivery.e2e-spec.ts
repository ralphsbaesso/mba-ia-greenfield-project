import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { MailService } from '../src/mail/mail.service';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { UPLOAD_PART_URL_TTL_SECONDS } from '../src/videos/uploads/video-uploads.constants';
import { generatePublicId } from '../src/videos/videos.id';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
}

const UNKNOWN_PUBLIC_ID = 'zzzzzzzzzzzz';
const VIDEO_FIXTURE = readFileSync(
  join(__dirname, 'fixtures', 'sample-with-audio.mp4'),
);
const THUMBNAIL_FIXTURE = Buffer.from(
  'not really a jpeg, and that is the point',
);
/** Deliberately not `image/jpeg`: the signed override is what must decide. */
const STORED_THUMBNAIL_CONTENT_TYPE = 'application/octet-stream';

const READY_METADATA = {
  duration_seconds: 12.345,
  width: 1920,
  height: 1080,
  video_codec: 'h264',
  audio_codec: 'aac',
  container_format: 'mov,mp4,m4a,3gp,3g2,mj2',
  bitrate_bps: 188_900,
  size_bytes: VIDEO_FIXTURE.length,
};

const routesOf = (publicId: string) => [
  `/videos/${publicId}/stream`,
  `/videos/${publicId}/download`,
  `/videos/${publicId}/thumbnail`,
];

describe('Video delivery (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let storage: StorageService;
  let throttlerStorage: ThrottlerStorageService;
  let ready: Video;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    videos = dataSource.getRepository(Video);
    storage = moduleFixture.get(StorageService);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function registerConfirmAndLogin(email: string): Promise<void> {
    const password = 'password123';
    let capturedToken = '';
    jest
      .spyOn(app.get(MailService), 'sendConfirmationEmail')
      .mockImplementationOnce((_email, _name, token) => {
        capturedToken = token;
        return Promise.resolve();
      });

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: capturedToken });
  }

  async function seedChannel(): Promise<string> {
    const email = `${generatePublicId()}@streamtube.test`;
    await registerConfirmAndLogin(email);

    const channel = await dataSource
      .getRepository(Channel)
      .createQueryBuilder('channel')
      .innerJoin('users', 'user', 'user.id = channel.user_id')
      .where('user.email = :email', { email })
      .getOneOrFail();

    return channel.id;
  }

  async function seedVideo(
    channelId: string,
    status: VideoStatus,
  ): Promise<Video> {
    const publicId = generatePublicId();

    return videos.save(
      videos.create({
        public_id: publicId,
        channel_id: channelId,
        title: 'Delivery e2e seed',
        status,
        storage_key: `videos/e2e-${publicId}.mp4`,
        ...(status === VideoStatus.READY && {
          ...READY_METADATA,
          thumbnail_key: `thumbnails/e2e-${publicId}.jpg`,
        }),
      }),
    );
  }

  /** The row alone is not enough: the delivery routes hand out URLs to objects. */
  async function seedReadyVideoWithObjects(): Promise<Video> {
    const video = await seedVideo(await seedChannel(), VideoStatus.READY);

    await storage.putObject(video.storage_key, VIDEO_FIXTURE, 'video/mp4');
    await storage.putObject(
      video.thumbnail_key as string,
      THUMBNAIL_FIXTURE,
      STORED_THUMBNAIL_CONTENT_TYPE,
    );

    return video;
  }

  const locationOf = async (route: string): Promise<URL> => {
    const res = await request(app.getHttpServer()).get(route).expect(302);

    return new URL(res.headers['location']);
  };

  describe('Streaming — GET /videos/{publicId}/stream', () => {
    beforeEach(async () => {
      ready = await seedReadyVideoWithObjects();
    });

    it('redirects an anonymous caller to a signed URL that serves ranges', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${ready.public_id}/stream`)
        .expect(302);

      const location = new URL(res.headers['location']);
      expect(location.pathname).toContain(ready.storage_key);
      expect(location.searchParams.get('X-Amz-Signature')).toBeTruthy();
      expect(location.searchParams.get('X-Amz-Credential')).toBeTruthy();

      // Playback starts on the first range, without pulling the whole file.
      const partial = await fetch(location, {
        headers: { Range: 'bytes=0-1023' },
      });
      expect(partial.status).toBe(206);
      expect(partial.headers.get('content-range')).toBe(
        `bytes 0-1023/${VIDEO_FIXTURE.length}`,
      );
      const bytes = Buffer.from(await partial.arrayBuffer());
      expect(bytes).toHaveLength(1024);
      expect(bytes.equals(VIDEO_FIXTURE.subarray(0, 1024))).toBe(true);
    });

    it('never carries the video or image bytes through the API', async () => {
      for (const route of routesOf(ready.public_id)) {
        const res = await request(app.getHttpServer()).get(route).expect(302);

        expect(res.text).toBe('');
        expect(String(res.headers['content-type'] ?? '')).not.toMatch(
          /^(video|image)\//,
        );
        // Whatever the redirect weighs, it is not the object.
        expect(Number(res.headers['content-length'] ?? 0)).toBeLessThan(1024);
        expect(VIDEO_FIXTURE.length).toBeGreaterThan(1024);
      }
    });
  });

  describe('Download — GET /videos/{publicId}/download', () => {
    beforeEach(async () => {
      ready = await seedReadyVideoWithObjects();
    });

    it('serves the same object as an attachment', async () => {
      const stream = await locationOf(`/videos/${ready.public_id}/stream`);
      const download = await locationOf(`/videos/${ready.public_id}/download`);

      // One object, two dispositions — the download does not duplicate storage.
      expect(download.pathname).toBe(stream.pathname);
      expect(
        download.searchParams.get('response-content-disposition'),
      ).toContain('attachment');
      expect(
        stream.searchParams.get('response-content-disposition'),
      ).toBeNull();

      const served = await fetch(download);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-disposition')).toBe(
        `attachment; filename="${ready.public_id}.mp4"`,
      );
      const bytes = Buffer.from(await served.arrayBuffer());
      expect(bytes.equals(VIDEO_FIXTURE)).toBe(true);
    });
  });

  describe('Thumbnail — GET /videos/{publicId}/thumbnail', () => {
    beforeEach(async () => {
      ready = await seedReadyVideoWithObjects();
    });

    it('renders inline as image/jpeg regardless of the stored content type', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${ready.public_id}/thumbnail`)
        .expect(302);

      // The cache lives on the redirect: the signature rotates per request, so
      // the presigned image itself can never be cached.
      expect(res.headers['cache-control']).toMatch(/max-age=\d+/);

      const location = new URL(res.headers['location']);
      expect(location.pathname).toContain(ready.thumbnail_key as string);
      expect(location.searchParams.get('response-content-type')).toBe(
        'image/jpeg',
      );

      const served = await fetch(location);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toBe('image/jpeg');
      // Absent is the expected case here — only the download route signs a
      // disposition — and absent is just as inline as an explicit `inline`.
      expect(
        String(served.headers.get('content-disposition') ?? ''),
      ).not.toMatch(/attachment/);
    });
  });

  describe('Ready-only guard', () => {
    let channelId: string;

    beforeEach(async () => {
      channelId = await seedChannel();
      ready = await seedReadyVideoWithObjects();
    });

    it.each([VideoStatus.DRAFT, VideoStatus.PROCESSING, VideoStatus.ERROR])(
      'hides a %s video behind the same 404 on all three routes',
      async (status) => {
        const hidden = await seedVideo(channelId, status);

        for (const route of routesOf(hidden.public_id)) {
          // The global throttler allows 10 requests/min; clearing keeps this
          // test measuring the guard instead of the rate limiter.
          throttlerStorage.storage.clear();
          const res = await request(app.getHttpServer()).get(route);

          expect(res.status).toBe(404);
          expect(res.status).not.toBe(403);
          expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
        }
      },
    );

    it('answers a non-ready video exactly as an unknown identifier', async () => {
      const processing = await seedVideo(channelId, VideoStatus.PROCESSING);

      for (const suffix of ['stream', 'download', 'thumbnail']) {
        throttlerStorage.storage.clear();
        const existing = await request(app.getHttpServer()).get(
          `/videos/${processing.public_id}/${suffix}`,
        );
        const unknown = await request(app.getHttpServer()).get(
          `/videos/${UNKNOWN_PUBLIC_ID}/${suffix}`,
        );

        expect(existing.status).toBe(unknown.status);
        expect(existing.body).toEqual(unknown.body);
      }
    });
  });

  describe('Presigned URL lifetime', () => {
    beforeEach(async () => {
      ready = await seedReadyVideoWithObjects();
    });

    it('signs for minutes, and the storage refuses the URL once it expires', async () => {
      const location = await locationOf(`/videos/${ready.public_id}/stream`);
      const expiresIn = Number(location.searchParams.get('X-Amz-Expires'));

      expect(expiresIn).toBeGreaterThan(0);
      expect(expiresIn).toBeLessThanOrEqual(60 * 60);
      // Two orders of magnitude below the upload grant: delivery is a click, not
      // a transfer.
      expect(expiresIn).toBeLessThan(UPLOAD_PART_URL_TTL_SECONDS);

      // Signed the same way, only shorter-lived — so the refusal below can only
      // come from expiry, never from a malformed signature.
      const shortLived = await storage.presignGetObject(ready.storage_key, {
        expiresIn: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      expect((await fetch(shortLived)).status).toBe(403);

      // The URL the route handed out is still inside its own window.
      expect((await fetch(location)).status).toBe(200);
    }, 20000);
  });
});
