import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { rm } from 'fs/promises';
import { extname, join } from 'path';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import workerConfig from '../../config/worker.config';
import { StorageService } from '../../storage/storage.service';

@Injectable()
export class SourceFileService {
  private readonly tmpDir: string;

  constructor(
    private readonly storage: StorageService,
    @Inject(workerConfig.KEY) worker: ConfigType<typeof workerConfig>,
  ) {
    this.tmpDir = worker.tmpDir;
  }

  /**
   * Downloads the object to a temp file and hands the path to `use`. Callback form
   * on purpose: it is what makes "cleanup always runs" a property of the API
   * rather than of every caller remembering a `finally` (phase-03-videos/TD-08).
   */
  async withDownloadedObject<T>(
    key: string,
    use: (filePath: string) => Promise<T>,
  ): Promise<T> {
    const filePath = join(this.tmpDir, `${randomUUID()}${extname(key)}`);

    try {
      const object = await this.storage.getObject(key);
      await pipeline(object.Body as Readable, createWriteStream(filePath));
      return await use(filePath);
    } finally {
      // `force` so a download that failed before creating the file is not a second
      // error on the way out.
      await rm(filePath, { force: true });
    }
  }

  /**
   * The storage object is authoritative for `size_bytes`
   * (video-authorization-and-metadata/TD-04).
   */
  async sizeOf(key: string): Promise<number> {
    const head = await this.storage.headObject(key);

    if (typeof head.ContentLength !== 'number') {
      throw new Error(`Storage returned no ContentLength for key ${key}`);
    }

    return head.ContentLength;
  }
}
