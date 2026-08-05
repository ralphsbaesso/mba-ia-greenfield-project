import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { VIDEO_MAINTENANCE_QUEUE } from './orphan-draft-cleanup.constants';
import type { OrphanDraftCleanupResult } from './orphan-draft-cleanup.service';
import { OrphanDraftCleanupService } from './orphan-draft-cleanup.service';

/** The consumer half of the scheduled routine; the work itself lives in the service. */
@Processor(VIDEO_MAINTENANCE_QUEUE)
export class OrphanDraftCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(OrphanDraftCleanupProcessor.name);

  constructor(private readonly cleanup: OrphanDraftCleanupService) {
    super();
  }

  async process(): Promise<OrphanDraftCleanupResult> {
    this.logger.debug('Running the orphan-draft cleanup');

    return this.cleanup.cleanupOrphanDrafts();
  }
}
