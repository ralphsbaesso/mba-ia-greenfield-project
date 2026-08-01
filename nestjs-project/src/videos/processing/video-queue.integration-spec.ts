import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import redisConfig from '../../config/redis.config';
import {
  VIDEO_PROCESSING_DLQ,
  VIDEO_PROCESSING_JOB,
  VIDEO_PROCESSING_QUEUE,
} from './video-queue.constants';
import { VideoQueueModule } from './video-queue.module';

const VIDEO_ID = '00000000-0000-4000-8000-00000000e001';

describe('video-processing queue (integration)', () => {
  let module: TestingModule;
  let queue: Queue;
  let dlq: Queue;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [redisConfig] }),
        VideoQueueModule,
      ],
    }).compile();

    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
    dlq = module.get(getQueueToken(VIDEO_PROCESSING_DLQ));
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await dlq.obliterate({ force: true });
  });

  it('should apply the root retry policy without the producer restating it', async () => {
    const job = await queue.add(VIDEO_PROCESSING_JOB, { videoId: VIDEO_ID });

    expect(job.opts.attempts).toBe(3);
    expect(job.opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });

  it('should read the enqueued job back with its payload intact', async () => {
    const added = await queue.add(
      VIDEO_PROCESSING_JOB,
      { videoId: VIDEO_ID },
      { jobId: VIDEO_ID },
    );

    const fetched = await queue.getJob(added.id!);

    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe(VIDEO_PROCESSING_JOB);
    expect(fetched!.data).toEqual({ videoId: VIDEO_ID });
    expect(fetched!.opts.attempts).toBe(3);
  });

  it('should treat a repeated deterministic jobId as a duplicate', async () => {
    await queue.add(
      VIDEO_PROCESSING_JOB,
      { videoId: VIDEO_ID },
      { jobId: VIDEO_ID },
    );
    await queue.add(
      VIDEO_PROCESSING_JOB,
      { videoId: VIDEO_ID },
      { jobId: VIDEO_ID },
    );

    expect(await queue.getWaitingCount()).toBe(1);
  });

  it('should accept publications to the consumer-less dead-letter queue', async () => {
    await dlq.add(VIDEO_PROCESSING_JOB, {
      videoId: VIDEO_ID,
      failedReason: 'attempts exhausted',
    });

    const waiting = await dlq.getWaiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].data).toEqual({
      videoId: VIDEO_ID,
      failedReason: 'attempts exhausted',
    });

    // Nothing consumes it: the job is still waiting a moment later.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await dlq.getWaitingCount()).toBe(1);
    expect(await dlq.getActiveCount()).toBe(0);
    expect(await dlq.getCompletedCount()).toBe(0);
  });
});
