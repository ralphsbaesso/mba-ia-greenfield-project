import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { readFile, readdir, writeFile, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import storageConfig from '../../config/storage.config';
import workerConfig from '../../config/worker.config';
import { StorageModule } from '../../storage/storage.module';
import { StorageService } from '../../storage/storage.service';
import { generatePublicId } from '../videos.id';
import { SourceFileService } from './source-file.service';

const CONTENT = Buffer.from('streamtube-source-object-bytes');

describe('SourceFileService (integration)', () => {
  let module: TestingModule;
  let service: SourceFileService;
  let storage: StorageService;
  let scratchDir: string;
  let key: string;

  beforeAll(async () => {
    // A private scratch dir so the leftover assertions see only this suite's files;
    // in the worker container the same role is played by the `worker-tmp` volume.
    scratchDir = await mkdtemp(join(tmpdir(), 'source-file-spec-'));
    process.env.WORKER_TMP_DIR = scratchDir;

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, workerConfig],
        }),
        StorageModule,
      ],
      providers: [SourceFileService],
    }).compile();

    service = module.get(SourceFileService);
    storage = module.get(StorageService);
  });

  afterAll(async () => {
    delete process.env.WORKER_TMP_DIR;
    await module.close();
  });

  beforeEach(async () => {
    key = `videos/${generatePublicId()}.mp4`;
    await storage.putObject(key, CONTENT, 'video/mp4');
  });

  describe('download to a temp file', () => {
    it('should hand the callback a file holding the object bytes', async () => {
      const seen = await service.withDownloadedObject(key, async (filePath) => {
        const contents = await readFile(filePath);
        return { path: filePath, contents };
      });

      expect(seen.contents.equals(CONTENT)).toBe(true);
      expect(seen.path.startsWith(scratchDir)).toBe(true);
      expect(seen.path.endsWith('.mp4')).toBe(true);
    });

    it('should remove the temp file once the callback resolves', async () => {
      const filePath = await service.withDownloadedObject(key, (path) =>
        Promise.resolve(path),
      );

      await expect(readFile(filePath)).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await readdir(scratchDir)).toEqual([]);
    });

    it('should remove the temp file when the callback throws', async () => {
      await expect(
        service.withDownloadedObject(key, () => {
          throw new Error('probe blew up');
        }),
      ).rejects.toThrow('probe blew up');

      expect(await readdir(scratchDir)).toEqual([]);
    });

    it('should leave no file behind when the object does not exist', async () => {
      await expect(
        service.withDownloadedObject('videos/missing.mp4', () =>
          Promise.resolve('never'),
        ),
      ).rejects.toBeDefined();

      expect(await readdir(scratchDir)).toEqual([]);
    });

    it('should give concurrent downloads of the same key distinct temp files', async () => {
      const paths = await Promise.all([
        service.withDownloadedObject(key, (path) => Promise.resolve(path)),
        service.withDownloadedObject(key, (path) => Promise.resolve(path)),
      ]);

      expect(paths[0]).not.toBe(paths[1]);
      expect(await readdir(scratchDir)).toEqual([]);
    });
  });

  describe('authoritative size', () => {
    it('should read the size from the storage object', async () => {
      expect(await service.sizeOf(key)).toBe(CONTENT.length);
    });

    it('should not be affected by what a local file of the same name reports', async () => {
      // A divergent local file cannot influence the recorded size: it is read from
      // the object, never from the downloaded copy or from ffprobe's format.size
      // (video-authorization-and-metadata/TD-04).
      const decoy = join(scratchDir, 'decoy.mp4');
      await writeFile(decoy, Buffer.alloc(CONTENT.length * 10));

      expect(await service.sizeOf(key)).toBe(CONTENT.length);
    });
  });
});
