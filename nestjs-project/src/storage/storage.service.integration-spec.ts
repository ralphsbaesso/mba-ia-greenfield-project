import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

// Fixed id so re-runs overwrite the same key instead of littering the bucket —
// the same overwrite-on-re-run property the key layout gives the worker.
const VIDEO_ID = '00000000-0000-4000-8000-00000000f001';
const CONTENT_TYPE = 'video/mp4';
const BODY = 'streamtube-storage-integration-probe';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('StorageService (integration)', () => {
  let module: TestingModule;
  let service: StorageService;
  let key: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();

    service = module.get(StorageService);
    key = service.resolveVideoKey(VIDEO_ID, CONTENT_TYPE);
    await service.putObject(key, BODY, CONTENT_TYPE);
  });

  afterAll(async () => {
    await module.close();
  });

  it('should read back the object under the key the service resolved', async () => {
    const output = await service.getObject(key);

    expect(await output.Body!.transformToString()).toBe(BODY);
  });

  it('should report the stored size and content type via head', async () => {
    const head = await service.headObject(key);

    expect(head.ContentLength).toBe(Buffer.byteLength(BODY));
    expect(head.ContentType).toBe(CONTENT_TYPE);
  });

  it('should fail head for a key that was never written', async () => {
    await expect(
      service.headObject(service.resolveVideoKey(VIDEO_ID, 'video/webm')),
    ).rejects.toBeDefined();
  });

  it('should hand out a presigned GET that resolves the object while valid', async () => {
    const url = await service.presignGetObject(key, { expiresIn: 900 });

    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(BODY);
  });

  it('should override the response content type through the presigned URL', async () => {
    const url = await service.presignGetObject(key, {
      expiresIn: 900,
      responseContentType: 'image/jpeg',
      responseContentDisposition: 'attachment; filename="probe.mp4"',
    });

    const response = await fetch(url);

    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="probe.mp4"',
    );
  });

  it('should refuse a presigned GET after its expiry', async () => {
    const url = await service.presignGetObject(key, { expiresIn: 1 });

    await sleep(2500);
    const response = await fetch(url);

    expect(response.status).toBe(403);
  }, 15000);

  it('should refuse an anonymous GET of the same object', async () => {
    const url = await service.presignGetObject(key, { expiresIn: 900 });
    const unsigned = new URL(url);
    unsigned.search = '';

    const response = await fetch(unsigned);

    expect(response.status).toBe(403);
  });

  it('should presign an upload part URL scoped to the multipart upload', async () => {
    const url = await service.presignUploadPart(key, {
      uploadId: 'fake-upload-id',
      partNumber: 1,
      expiresIn: 3600,
    });

    expect(url).toContain('uploadId=fake-upload-id');
    expect(url).toContain('partNumber=1');
    expect(url).toContain('X-Amz-Signature=');
  });
});
