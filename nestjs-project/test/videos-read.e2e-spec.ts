import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { MailService } from '../src/mail/mail.service';
import { buildSwaggerDocument } from '../src/swagger/swagger-document';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { generatePublicId } from '../src/videos/videos.id';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
}
interface PublicVideoBody {
  publicId: string;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  container_format: string | null;
  bitrate_bps: number | null;
  size_bytes: number | null;
}
interface OwnerVideoBody extends PublicVideoBody {
  status: string;
  failure_reason: string | null;
}
type OpenApiOperation = {
  responses: Record<string, { content?: Record<string, { schema?: unknown }> }>;
  parameters?: { name: string; in: string }[];
  security?: Record<string, unknown>[];
};

const ERROR_ENVELOPE_REF = '#/components/schemas/ApiErrorEnvelope';
const OWNER_ROUTE = '/videos/me';
const UNKNOWN_PUBLIC_ID = 'zzzzzzzzzzzz';

/** Everything a `ready` row needs to satisfy the state-scoped CHECKs. */
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

describe('Video reads (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let throttlerStorage: ThrottlerStorageService;

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

  // Phase 02 creates the channel at signup, so a confirmed user is a user with a
  // channel — which is what ownership resolves against.
  async function registerConfirmAndLogin(email: string): Promise<string> {
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
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });

    return (res.body as { access_token: string }).access_token;
  }

  async function channelIdOf(email: string): Promise<string> {
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
    overrides: Partial<Video> = {},
  ): Promise<Video> {
    return videos.save(
      videos.create({
        public_id: generatePublicId(),
        channel_id: channelId,
        status,
        storage_key: 'videos/seed.mp4',
        ...(status === VideoStatus.READY && {
          ...READY_METADATA,
          thumbnail_key: 'thumbnails/seed.jpg',
        }),
        ...overrides,
      }),
    );
  }

  describe('Public metadata — GET /videos/{publicId}', () => {
    let ready: Video;

    beforeEach(async () => {
      const email = `${generatePublicId()}@streamtube.test`;
      await registerConfirmAndLogin(email);
      ready = await seedVideo(await channelIdOf(email), VideoStatus.READY);
    });

    it('returns the metadata of a ready video without any Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${ready.public_id}`)
        .expect(200);

      const body = res.body as PublicVideoBody;
      expect(body).toEqual({
        publicId: ready.public_id,
        ...READY_METADATA,
      });
    });

    it('leaks neither the internal id nor the channel id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${ready.public_id}`)
        .expect(200);

      expect(res.text).not.toContain(ready.id);
      expect(res.text).not.toContain(ready.channel_id);
    });

    it('answers 404, never 403, for a video that is still processing', async () => {
      const email = `${generatePublicId()}@streamtube.test`;
      await registerConfirmAndLogin(email);
      const processing = await seedVideo(
        await channelIdOf(email),
        VideoStatus.PROCESSING,
      );

      const res = await request(app.getHttpServer())
        .get(`/videos/${processing.public_id}`)
        .expect(404);

      expect(res.status).not.toBe(403);
      expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
    });

    it('answers a non-ready video exactly as it answers an unknown identifier', async () => {
      const email = `${generatePublicId()}@streamtube.test`;
      await registerConfirmAndLogin(email);
      const processing = await seedVideo(
        await channelIdOf(email),
        VideoStatus.PROCESSING,
      );

      const existing = await request(app.getHttpServer()).get(
        `/videos/${processing.public_id}`,
      );
      const unknown = await request(app.getHttpServer()).get(
        `/videos/${UNKNOWN_PUBLIC_ID}`,
      );

      // Identical down to the message: the route must be no existence oracle.
      expect(existing.status).toBe(unknown.status);
      expect(existing.body).toEqual(unknown.body);
    });
  });

  describe('Owner view — GET /videos/me/{videoId}', () => {
    let ownerToken: string;
    let strangerToken: string;
    let draft: Video;
    let failed: Video;

    const FAILURE_REASON =
      'Input has no decodable video stream: moov atom not found';

    beforeEach(async () => {
      const ownerEmail = `${generatePublicId()}@streamtube.test`;
      const strangerEmail = `${generatePublicId()}@streamtube.test`;
      ownerToken = await registerConfirmAndLogin(ownerEmail);
      strangerToken = await registerConfirmAndLogin(strangerEmail);

      const channelId = await channelIdOf(ownerEmail);
      draft = await seedVideo(channelId, VideoStatus.DRAFT);
      failed = await seedVideo(channelId, VideoStatus.ERROR, {
        failure_reason: FAILURE_REASON,
      });
    });

    it('answers 401 without a token, revealing nothing about the video', async () => {
      const res = await request(app.getHttpServer())
        .get(`${OWNER_ROUTE}/${failed.id}`)
        .expect(401);

      // The global guard answers before the handler ever runs.
      expect(res.text).not.toContain(failed.public_id);
      expect(res.text).not.toContain(FAILURE_REASON);
    });

    it('returns a draft with its metadata columns still null', async () => {
      const res = await request(app.getHttpServer())
        .get(`${OWNER_ROUTE}/${draft.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = res.body as OwnerVideoBody;
      expect(body.status).toBe('draft');
      expect(body.publicId).toBe(draft.public_id);
      expect(body.duration_seconds).toBeNull();
      expect(body.width).toBeNull();
      expect(body.size_bytes).toBeNull();
      expect(body.failure_reason).toBeNull();
    });

    it('returns a failed video with its persisted failure reason', async () => {
      const res = await request(app.getHttpServer())
        .get(`${OWNER_ROUTE}/${failed.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = res.body as OwnerVideoBody;
      expect(body.status).toBe('error');
      expect(body.failure_reason).toBe(FAILURE_REASON);
    });

    it('answers 404, not 403, when the caller is not the owner', async () => {
      const res = await request(app.getHttpServer())
        .get(`${OWNER_ROUTE}/${failed.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);

      expect(res.status).not.toBe(403);
      expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
      expect(res.text).not.toContain(FAILURE_REASON);
    });
  });

  describe('Route disambiguation', () => {
    let ownerToken: string;
    let ready: Video;

    beforeEach(async () => {
      const email = `${generatePublicId()}@streamtube.test`;
      ownerToken = await registerConfirmAndLogin(email);
      ready = await seedVideo(await channelIdOf(email), VideoStatus.READY);
    });

    it('never resolves an internal id on the public route', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${ready.id}`)
        .expect(404);

      expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
    });

    it('never serves the owner route with a public identifier', async () => {
      const res = await request(app.getHttpServer())
        .get(`${OWNER_ROUTE}/${ready.public_id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      // A 200 here would mean the public handler answered an owner-route request.
      expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
    });

    it('serves the two families with distinct handlers', async () => {
      const anonymous = await request(app.getHttpServer())
        .get(`/videos/${ready.public_id}`)
        .expect(200);
      const owner = await request(app.getHttpServer())
        .get(`${OWNER_ROUTE}/${ready.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(anonymous.body).not.toHaveProperty('status');
      expect((owner.body as OwnerVideoBody).status).toBe('ready');
    });
  });

  describe('OpenAPI contract', () => {
    let paths: Record<string, Record<string, OpenApiOperation>>;

    beforeAll(() => {
      const document = buildSwaggerDocument(app);
      paths = document.paths as unknown as Record<
        string,
        Record<string, OpenApiOperation>
      >;
    });

    const schemaRefOf = (
      operation: OpenApiOperation,
      status: string,
    ): unknown =>
      (
        operation.responses[status]?.content?.['application/json']?.schema as
          | { $ref?: string }
          | undefined
      )?.$ref;

    it('documents the public read route as unauthenticated', () => {
      const operation = paths['/videos/{publicId}'].get;

      expect(Object.keys(operation.responses).sort()).toEqual(['200', '404']);
      expect(schemaRefOf(operation, '404')).toBe(ERROR_ENVELOPE_REF);
      expect(operation.security).toBeUndefined();
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'publicId', in: 'path' }),
        ]),
      );
    });

    it('documents the owner read route with the bearer requirement', () => {
      const operation = paths['/videos/me/{videoId}'].get;

      expect(Object.keys(operation.responses).sort()).toEqual([
        '200',
        '401',
        '404',
      ]);
      expect(schemaRefOf(operation, '401')).toBe(ERROR_ENVELOPE_REF);
      expect(schemaRefOf(operation, '404')).toBe(ERROR_ENVELOPE_REF);
      expect(operation.security).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ 'access-token': [] }),
        ]),
      );
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'videoId', in: 'path' }),
        ]),
      );
    });

    it('documents status and failure reason only on the owner response', () => {
      const ownerSchema = (
        paths['/videos/me/{videoId}'].get.responses['200']?.content?.[
          'application/json'
        ]?.schema as { properties?: Record<string, unknown> }
      )?.properties;
      const publicSchema = (
        paths['/videos/{publicId}'].get.responses['200']?.content?.[
          'application/json'
        ]?.schema as { properties?: Record<string, unknown> }
      )?.properties;

      expect(Object.keys(ownerSchema ?? {})).toEqual(
        expect.arrayContaining(['status', 'failure_reason']),
      );
      expect(Object.keys(publicSchema ?? {})).not.toContain('status');
    });
  });
});
