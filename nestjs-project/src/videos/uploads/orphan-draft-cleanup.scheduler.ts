import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  ORPHAN_DRAFT_CLEANUP_EVERY_MS,
  ORPHAN_DRAFT_CLEANUP_JOB,
  ORPHAN_DRAFT_CLEANUP_SCHEDULER_ID,
  VIDEO_MAINTENANCE_QUEUE,
} from './orphan-draft-cleanup.constants';

/**
 * The producer half: BullMQ's own scheduler is the infrastructure the phase
 * already runs, so the routine needs no second scheduling mechanism
 * (phase-03-videos/TD-15). `upsertJobScheduler` is keyed by id, so every worker
 * boot converges on one schedule instead of stacking a new one.
 */
@Injectable()
export class OrphanDraftCleanupScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(VIDEO_MAINTENANCE_QUEUE)
    private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      ORPHAN_DRAFT_CLEANUP_SCHEDULER_ID,
      { every: ORPHAN_DRAFT_CLEANUP_EVERY_MS },
      {
        name: ORPHAN_DRAFT_CLEANUP_JOB,
        // Housekeeping that keeps its own history forever is just a second thing
        // to clean up.
        opts: { removeOnComplete: true, removeOnFail: 50 },
      },
    );
  }
}
