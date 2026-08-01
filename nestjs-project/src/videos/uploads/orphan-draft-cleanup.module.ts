import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { VideoQueueModule } from '../processing/video-queue.module';
import { VideosModule } from '../videos.module';
import { VIDEO_MAINTENANCE_QUEUE } from './orphan-draft-cleanup.constants';
import { OrphanDraftCleanupProcessor } from './orphan-draft-cleanup.processor';
import { OrphanDraftCleanupScheduler } from './orphan-draft-cleanup.scheduler';
import { OrphanDraftCleanupService } from './orphan-draft-cleanup.service';

/**
 * Wired into the **worker** runtime only: the API has no reason to run
 * housekeeping, and one scheduler is easier to reason about than one per replica
 * of two different processes (`### Events/Messages` → Orphan-draft cleanup).
 */
@Module({
  imports: [
    VideoQueueModule,
    BullModule.registerQueue({ name: VIDEO_MAINTENANCE_QUEUE }),
    VideosModule,
    StorageModule,
  ],
  providers: [
    OrphanDraftCleanupService,
    OrphanDraftCleanupProcessor,
    OrphanDraftCleanupScheduler,
  ],
  exports: [OrphanDraftCleanupService],
})
export class OrphanDraftCleanupModule {}
