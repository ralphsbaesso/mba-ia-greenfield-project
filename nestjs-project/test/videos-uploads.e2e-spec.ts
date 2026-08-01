import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { MailService } from '../src/mail/mail.service';
import { buildSwaggerDocument } from '../src/swagger/swagger-document';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { VIDEO_PROCESSING_QUEUE } from '../src/videos/processing/video-queue.constants';

// supertest types `body` as `any`; these describe the shapes the endpoints return
// so assertions run against a real contract instead of an untyped bag.
interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
}
interface InitiateBody {
  videoId: string;
  publicId: string;
  uploadId: string;
  partSizeBytes: number;
  parts: { partNumber: number; url: string }[];
  expiresInSeconds: number;
}
interface CompleteBody {
  publicId: string;
  status: string;
}
type OpenApiOperation = {
  responses: Record<string, { content?: Record<string, { schema?: unknown }> }>;
  parameters?: { name: string; in: string }[];
  requestBody?: { required?: boolean; content: Record<string, unknown> };
};

const PART_SIZE_BYTES = 64 * 1024 * 1024;
const PART_BODY = 'streamtube-e2e-part';
const ERROR_ENVELOPE_REF = '#/components/schemas/ApiErrorEnvelope';

describe('Video uploads (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let queue: Queue;
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
    queue = moduleFixture.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await queue.obliterate({ force: true });
    throttlerStorage.storage.clear();
  });

  // Phase 02 creates the channel at signup, so a confirmed user is a user with a
  // channel — which is what initiate resolves the owner against.
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

  async function initiateOnePartUpload(accessToken: string): Promise<{
    body: InitiateBody;
    parts: { partNumber: number; etag: string }[];
  }> {
    const res = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ contentType: 'video/mp4', sizeBytes: PART_BODY.length })
      .expect(201);

    const body = res.body as InitiateBody;
    const put = await fetch(body.parts[0].url, {
      method: 'PUT',
      body: PART_BODY,
    });

    return {
      body,
      parts: [{ partNumber: 1, etag: put.headers.get('etag') as string }],
    };
  }

  describe('POST /videos/uploads', () => {
    it('rejects an anonymous initiate with 401 and creates no draft', async () => {
      await request(app.getHttpServer())
        .post('/videos/uploads')
        .send({ contentType: 'video/mp4', sizeBytes: 1024 })
        .expect(401);

      expect(await videos.count()).toBe(0);
    });

    it('returns 201 with the draft identifiers and the full presigned grant', async () => {
      const accessToken = await registerConfirmAndLogin('uploader@example.com');

      const res = await request(app.getHttpServer())
        .post('/videos/uploads')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ contentType: 'video/mp4', sizeBytes: PART_SIZE_BYTES * 2 + 1 })
        .expect(201);

      const body = res.body as InitiateBody;
      expect(body.videoId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(body.publicId).toEqual(expect.any(String));
      expect(body.uploadId).toEqual(expect.any(String));
      expect(body.partSizeBytes).toBe(PART_SIZE_BYTES);
      expect(body.parts.map((part) => part.partNumber)).toEqual([1, 2, 3]);

      // Hours, not the 7-day maximum — asserted on the grant itself, not only on
      // the advertised value.
      expect(body.expiresInSeconds).toBeGreaterThanOrEqual(3600);
      expect(body.expiresInSeconds).toBeLessThan(7 * 24 * 60 * 60);
      for (const part of body.parts) {
        const expires = Number(
          new URL(part.url).searchParams.get('X-Amz-Expires'),
        );
        expect(expires).toBe(body.expiresInSeconds);
      }
    });

    it('persists the draft row the response describes', async () => {
      const accessToken = await registerConfirmAndLogin('drafter@example.com');

      const res = await request(app.getHttpServer())
        .post('/videos/uploads')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ contentType: 'video/mp4', sizeBytes: 1024 })
        .expect(201);

      const body = res.body as InitiateBody;
      const row = await videos.findOneByOrFail({ id: body.videoId });
      expect(row.status).toBe(VideoStatus.DRAFT);
      expect(row.channel_id).toEqual(expect.any(String));
      expect(row.public_id).toBe(body.publicId);
      expect(row.storage_key).toBe(`videos/${body.videoId}.mp4`);
      expect(row.upload_id).toBe(body.uploadId);

      // The payload exposes no further internal columns — no storage_key, no
      // channel_id, no timestamps.
      expect(Object.keys(body).sort()).toEqual([
        'expiresInSeconds',
        'partSizeBytes',
        'parts',
        'publicId',
        'uploadId',
        'videoId',
      ]);
    });

    it('rejects an initiate without the declared content type with 400', async () => {
      const accessToken = await registerConfirmAndLogin(
        'nocontent@example.com',
      );

      const res = await request(app.getHttpServer())
        .post('/videos/uploads')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ sizeBytes: 1024 })
        .expect(400);

      const body = res.body as ErrorBody;
      expect(body.statusCode).toBe(400);
      expect(body.error).toBe('VALIDATION_ERROR');
      expect(body.message).toEqual(
        expect.arrayContaining([expect.any(String)]),
      );
      expect(await videos.count()).toBe(0);
    });

    it('rejects an unsupported content type with 400', async () => {
      const accessToken = await registerConfirmAndLogin('zip@example.com');

      await request(app.getHttpServer())
        .post('/videos/uploads')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ contentType: 'application/zip', sizeBytes: 1024 })
        .expect(400);

      expect(await videos.count()).toBe(0);
    });
  });

  describe('POST /videos/:videoId/uploads/complete', () => {
    it('answers 404 VIDEO_NOT_FOUND to a non-owner, identically to an unknown id', async () => {
      const ownerToken = await registerConfirmAndLogin('owner@example.com');
      const intruderToken = await registerConfirmAndLogin(
        'intruder@example.com',
      );
      const upload = await initiateOnePartUpload(ownerToken);

      const nonOwner = await request(app.getHttpServer())
        .post(`/videos/${upload.body.videoId}/uploads/complete`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({ parts: upload.parts })
        .expect(404);

      const unknown = await request(app.getHttpServer())
        .post('/videos/99999999-9999-4999-8999-999999999999/uploads/complete')
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({ parts: upload.parts })
        .expect(404);

      expect((nonOwner.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
      expect(nonOwner.body).toEqual(unknown.body);

      const row = await videos.findOneByOrFail({ id: upload.body.videoId });
      expect(row.status).toBe(VideoStatus.DRAFT);
    });

    it('answers 200 then 409 INVALID_VIDEO_STATE, leaving one job on the queue', async () => {
      const ownerToken = await registerConfirmAndLogin('twice@example.com');
      const upload = await initiateOnePartUpload(ownerToken);

      const first = await request(app.getHttpServer())
        .post(`/videos/${upload.body.videoId}/uploads/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ parts: upload.parts })
        .expect(200);

      expect(first.body as CompleteBody).toEqual({
        publicId: upload.body.publicId,
        status: VideoStatus.PROCESSING,
      });

      const second = await request(app.getHttpServer())
        .post(`/videos/${upload.body.videoId}/uploads/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ parts: upload.parts })
        .expect(409);

      expect((second.body as ErrorBody).error).toBe('INVALID_VIDEO_STATE');

      const row = await videos.findOneByOrFail({ id: upload.body.videoId });
      expect(row.status).toBe(VideoStatus.PROCESSING);
      expect(await queue.getWaitingCount()).toBe(1);
    });

    it('rejects an anonymous complete with 401', async () => {
      const ownerToken = await registerConfirmAndLogin('anon@example.com');
      const upload = await initiateOnePartUpload(ownerToken);

      await request(app.getHttpServer())
        .post(`/videos/${upload.body.videoId}/uploads/complete`)
        .send({ parts: upload.parts })
        .expect(401);

      const row = await videos.findOneByOrFail({ id: upload.body.videoId });
      expect(row.status).toBe(VideoStatus.DRAFT);
    });

    it('rejects an empty ETag list with 400', async () => {
      const ownerToken = await registerConfirmAndLogin('emptylist@example.com');
      const upload = await initiateOnePartUpload(ownerToken);

      await request(app.getHttpServer())
        .post(`/videos/${upload.body.videoId}/uploads/complete`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ parts: [] })
        .expect(400);

      const row = await videos.findOneByOrFail({ id: upload.body.videoId });
      expect(row.status).toBe(VideoStatus.DRAFT);
      expect(await queue.getWaitingCount()).toBe(0);
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

    it('documents POST /videos/uploads with a typed response per status code', () => {
      const operation = paths['/videos/uploads'].post;

      expect(Object.keys(operation.responses).sort()).toEqual([
        '201',
        '400',
        '401',
        '500',
      ]);
      expect(schemaRefOf(operation, '500')).toBe(ERROR_ENVELOPE_REF);
      expect(schemaRefOf(operation, '400')).toBe(ERROR_ENVELOPE_REF);
      expect(schemaRefOf(operation, '401')).toBe(ERROR_ENVELOPE_REF);
      expect(operation.requestBody?.content['application/json']).toBeDefined();
    });

    it('documents POST /videos/{videoId}/uploads/complete with its path param and error envelopes', () => {
      const operation = paths['/videos/{videoId}/uploads/complete'].post;

      expect(Object.keys(operation.responses).sort()).toEqual([
        '200',
        '400',
        '401',
        '404',
        '409',
      ]);
      expect(schemaRefOf(operation, '404')).toBe(ERROR_ENVELOPE_REF);
      expect(schemaRefOf(operation, '409')).toBe(ERROR_ENVELOPE_REF);
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'videoId', in: 'path' }),
        ]),
      );
      expect(operation.requestBody?.content['application/json']).toBeDefined();
    });

    it('marks both upload endpoints as requiring the access token', () => {
      const operations = [
        paths['/videos/uploads'].post,
        paths['/videos/{videoId}/uploads/complete'].post,
      ] as unknown as { security: Record<string, unknown>[] }[];

      for (const operation of operations) {
        expect(
          operation.security.some((scheme) => 'access-token' in scheme),
        ).toBe(true);
      }
    });
  });
});
