import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import redisConfig from '../../config/redis.config';
import {
  VIDEO_PROCESSING_DLQ,
  VIDEO_PROCESSING_JOB_OPTIONS,
  VIDEO_PROCESSING_QUEUE,
} from './video-queue.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [redisConfig.KEY],
      useFactory: (redis: ConfigType<typeof redisConfig>) => ({
        connection: { host: redis.host, port: redis.port },
        defaultJobOptions: { ...VIDEO_PROCESSING_JOB_OPTIONS },
      }),
    }),
    BullModule.registerQueue(
      { name: VIDEO_PROCESSING_QUEUE },
      { name: VIDEO_PROCESSING_DLQ },
    ),
  ],
  exports: [BullModule],
})
export class VideoQueueModule {}
