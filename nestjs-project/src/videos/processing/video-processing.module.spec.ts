import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { StorageService } from '../../storage/storage.service';
import { Video } from '../entities/video.entity';
import {
  VIDEO_PROCESSING_DLQ,
  VIDEO_PROCESSING_QUEUE,
} from './video-queue.constants';
import { VideoProcessingModule } from './video-processing.module';

describe('VideoProcessingModule', () => {
  it('should compile the worker root context with queue, storage and the shared Video repository', async () => {
    const module = await Test.createTestingModule({
      imports: [VideoProcessingModule],
    }).compile();

    expect(module.get(getQueueToken(VIDEO_PROCESSING_QUEUE))).toBeDefined();
    expect(module.get(getQueueToken(VIDEO_PROCESSING_DLQ))).toBeDefined();
    expect(module.get(StorageService)).toBeDefined();
    expect(module.get(getRepositoryToken(Video))).toBeDefined();

    // The worker reaches the same `videos` table the API writes — it shares the
    // entity and the TypeORM configuration instead of calling an internal API
    // (phase-03-videos/TD-06).
    const dataSource = module.get(DataSource);
    expect(dataSource.isInitialized).toBe(true);
    await expect(
      dataSource.getRepository(Video).count(),
    ).resolves.toBeGreaterThanOrEqual(0);

    await module.close();
  }, 30000);
});
