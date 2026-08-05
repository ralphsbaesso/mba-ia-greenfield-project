import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { StorageService } from '../../storage/storage.service';
import { Video, VideoStatus } from '../entities/video.entity';
import { ORPHAN_DRAFT_MAX_AGE_MS } from './orphan-draft-cleanup.constants';

export interface OrphanDraftCleanupResult {
  scanned: number;
  aborted: number;
  failed: number;
}

/**
 * Storage hygiene for uploads that were started and never finished. It reclaims
 * the accumulated parts — the costly half of an abandoned upload — and
 * deliberately **keeps the row**: Fase 04 owns draft management, this phase owns
 * storage (phase-03-videos/TD-15).
 */
@Injectable()
export class OrphanDraftCleanupService {
  private readonly logger = new Logger(OrphanDraftCleanupService.name);

  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly storage: StorageService,
  ) {}

  async cleanupOrphanDrafts(): Promise<OrphanDraftCleanupResult> {
    const cutoff = new Date(Date.now() - ORPHAN_DRAFT_MAX_AGE_MS);

    // `draft` is the only state with an open multipart upload, and a null
    // `upload_id` means it was already aborted — re-aborting would fail with
    // `NoSuchUpload` on every run, so the routine filters it out instead.
    const stale = await this.videos.find({
      where: {
        status: VideoStatus.DRAFT,
        upload_id: Not(IsNull()),
        created_at: LessThan(cutoff),
      },
    });

    const result: OrphanDraftCleanupResult = {
      scanned: stale.length,
      aborted: 0,
      failed: 0,
    };

    for (const video of stale) {
      try {
        await this.storage.abortMultipartUpload(
          video.storage_key,
          video.upload_id as string,
        );
        await this.videos.update({ id: video.id }, { upload_id: null });
        result.aborted += 1;
      } catch (error) {
        // A scheduled routine that rethrows takes the whole batch down with the
        // first unreachable object; the row keeps its `upload_id`, so the next
        // run retries exactly this video.
        result.failed += 1;
        this.logger.error(
          `Failed to abort the abandoned upload of video ${video.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    if (result.scanned > 0) {
      this.logger.log(
        `Orphan-draft cleanup: ${result.aborted} upload(s) aborted, ${result.failed} failed, out of ${result.scanned} scanned`,
      );
    }

    return result;
  }
}
