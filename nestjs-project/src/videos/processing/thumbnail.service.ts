import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { readFile, rm } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import workerConfig from '../../config/worker.config';
import {
  THUMBNAIL_CONTENT_TYPE,
  THUMBNAIL_EXTENSION,
} from '../../storage/storage.constants';
import { StorageService } from '../../storage/storage.service';
import {
  FFMPEG_TIMEOUT_MS,
  THUMBNAIL_SEEK_MIN_SECONDS,
  THUMBNAIL_SEEK_RATIO,
  THUMBNAIL_SEEK_TAIL_MARGIN_SECONDS,
  THUMBNAIL_WIDTH,
} from './thumbnail.constants';

const execFileAsync = promisify(execFile);

/** The extraction produced no frame — the input decoded, the seek found nothing. */
export class ThumbnailExtractionError extends Error {
  constructor(reason: string) {
    super(`Thumbnail extraction failed: ${reason}`);
    this.name = 'ThumbnailExtractionError';
  }
}

/**
 * `max(1s, duration * 10%)`, clamped so it never lands past the end of the file.
 * The clamp is not in the plan's formula: without it a sub-second clip would seek
 * beyond EOF and decode no frame at all, failing the whole job over a legitimate
 * input.
 */
export function resolveSeekSeconds(durationSeconds: number): number {
  const preferred = Math.max(
    THUMBNAIL_SEEK_MIN_SECONDS,
    durationSeconds * THUMBNAIL_SEEK_RATIO,
  );
  const lastSafe = Math.max(
    0,
    durationSeconds - THUMBNAIL_SEEK_TAIL_MARGIN_SECONDS,
  );

  return Math.min(preferred, lastSafe);
}

@Injectable()
export class ThumbnailService {
  private readonly tmpDir: string;

  /** Overridable so a test can exercise the "binary is missing" path. */
  protected readonly binary: string = 'ffmpeg';

  constructor(
    private readonly storage: StorageService,
    @Inject(workerConfig.KEY) worker: ConfigType<typeof workerConfig>,
  ) {
    this.tmpDir = worker.tmpDir;
  }

  /**
   * Extracts exactly one frame and stores it under the key derived from the video
   * id, so a re-run overwrites instead of duplicating (phase-03-videos/TD-03,
   * TD-14). Returns the stored key.
   */
  async generate(
    videoId: string,
    sourcePath: string,
    durationSeconds: number,
  ): Promise<string> {
    const framePath = join(
      this.tmpDir,
      `${randomUUID()}.${THUMBNAIL_EXTENSION}`,
    );

    try {
      await this.extractFrame(
        sourcePath,
        framePath,
        resolveSeekSeconds(durationSeconds),
      );

      const key = this.storage.resolveThumbnailKey(videoId);
      await this.storage.putObject(
        key,
        await readFile(framePath),
        THUMBNAIL_CONTENT_TYPE,
      );

      return key;
    } finally {
      await rm(framePath, { force: true });
    }
  }

  private async extractFrame(
    sourcePath: string,
    framePath: string,
    seekSeconds: number,
  ): Promise<void> {
    try {
      // Argument array, never a shell string, and an explicit timeout — same
      // contract as the probe (phase-03-videos/TD-07).
      await execFileAsync(
        this.binary,
        [
          '-y',
          '-v',
          'error',
          // Before `-i`: ffmpeg seeks the input rather than decoding up to the mark.
          '-ss',
          seekSeconds.toFixed(3),
          '-i',
          sourcePath,
          '-frames:v',
          '1',
          '-vf',
          `scale=${THUMBNAIL_WIDTH}:-2`,
          '-f',
          'image2',
          framePath,
        ],
        { timeout: FFMPEG_TIMEOUT_MS },
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        throw new Error(
          `ffmpeg binary not found (${this.binary}) — is this running in the worker image?`,
        );
      }
      throw new ThumbnailExtractionError(
        (error as Error).message || 'ffmpeg exited with an error',
      );
    }
  }
}
