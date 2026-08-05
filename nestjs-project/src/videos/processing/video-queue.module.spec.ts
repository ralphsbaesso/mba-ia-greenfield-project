import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import redisConfig from '../../config/redis.config';
import {
  VIDEO_PROCESSING_DLQ,
  VIDEO_PROCESSING_QUEUE,
} from './video-queue.constants';
import { VideoQueueModule } from './video-queue.module';

describe('VideoQueueModule', () => {
  it('should compile with both queues registered', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [redisConfig] }),
        VideoQueueModule,
      ],
    }).compile();

    expect(module.get(getQueueToken(VIDEO_PROCESSING_QUEUE))).toBeDefined();
    expect(module.get(getQueueToken(VIDEO_PROCESSING_DLQ))).toBeDefined();

    await module.close();
  }, 30000);
});
