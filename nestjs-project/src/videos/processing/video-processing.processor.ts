import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import { Repository } from 'typeorm';
import { Video, VideoStatus } from '../entities/video.entity';
import { FfprobeService } from './ffprobe.service';
import { SourceFileService } from './source-file.service';
import { ThumbnailService } from './thumbnail.service';
import {
  describeFailure,
  isLastAttempt,
  isPermanentFailure,
} from './video-processing.failure';
import {
  VIDEO_PROCESSING_CONCURRENCY,
  VIDEO_PROCESSING_DLQ,
  VIDEO_PROCESSING_JOB,
  VIDEO_PROCESSING_QUEUE,
} from './video-queue.constants';

/** The job carries only the id; every other field is read from the row (TD-06). */
export interface VideoProcessingJobData {
  videoId: string;
}

/** What the consumer-less DLQ retains about an exhausted job (TD-13). */
export interface VideoProcessingDlqData extends VideoProcessingJobData {
  originalJobId: string | undefined;
  attemptsMade: number;
  failureReason: string;
}

@Processor(VIDEO_PROCESSING_QUEUE, {
  concurrency: VIDEO_PROCESSING_CONCURRENCY,
})
export class VideoProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly sourceFiles: SourceFileService,
    private readonly ffprobe: FfprobeService,
    private readonly thumbnails: ThumbnailService,
    @InjectQueue(VIDEO_PROCESSING_DLQ)
    private readonly deadLetters: Queue<VideoProcessingDlqData>,
  ) {
    super();
  }

  async process(job: Job<VideoProcessingJobData>): Promise<void> {
    const { videoId } = job.data;

    const video = await this.videos.findOne({
      where: { id: videoId, status: VideoStatus.PROCESSING },
    });

    // A duplicate delivery, or a job for a video someone else already took: there
    // is nothing to do and nothing to change (phase-03-videos/TD-14).
    if (!video) {
      return;
    }

    try {
      await this.transcode(video);
    } catch (error) {
      // Every processing failure is handled here: recorded on the row and handed
      // back to BullMQ as a job outcome. What must never happen is an unhandled
      // rejection escaping and taking the worker process down (TD-13).
      await this.handleFailure(job, video.id, error);
    }
  }

  private async transcode(video: Video): Promise<void> {
    const { probe, sizeBytes, thumbnailKey } =
      await this.sourceFiles.withDownloadedObject(
        video.storage_key,
        async (filePath) => {
          const probe = await this.ffprobe.probe(filePath);
          // The storage object is authoritative for the size
          // (video-authorization-and-metadata/TD-04).
          const sizeBytes = await this.sourceFiles.sizeOf(video.storage_key);
          const thumbnailKey = await this.thumbnails.generate(
            video.id,
            filePath,
            probe.durationSeconds,
          );

          return { probe, sizeBytes, thumbnailKey };
        },
      );

    // One statement, so metadata, thumbnail key and the `ready` transition share a
    // single row-write boundary — a partial `ready` is what would break the clean
    // re-run of a repeated job (thumbnail-delivery/TD-02, phase-03-videos/TD-14).
    // Conditional on `processing` rather than read-then-write, so two workers
    // cannot both proceed.
    await this.videos.update(
      { id: video.id, status: VideoStatus.PROCESSING },
      {
        status: VideoStatus.READY,
        duration_seconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        video_codec: probe.videoCodec,
        audio_codec: probe.audioCodec,
        container_format: probe.containerFormat,
        bitrate_bps: probe.bitrateBps,
        size_bytes: sizeBytes,
        thumbnail_key: thumbnailKey,
        failure_reason: null,
      },
    );
  }

  private async handleFailure(
    job: Job<VideoProcessingJobData>,
    videoId: string,
    error: unknown,
  ): Promise<void> {
    const reason = describeFailure(error);

    if (isPermanentFailure(error)) {
      this.logger.error(
        `Video ${videoId} failed permanently: ${reason}`,
        (error as Error)?.stack,
      );
      await this.markFailed(videoId, reason);
      // Tells BullMQ to fail the job without burning the remaining attempts —
      // retrying cannot change ffprobe's verdict (TD-13).
      throw new UnrecoverableError(reason);
    }

    if (!isLastAttempt(job)) {
      this.logger.warn(
        `Video ${videoId} failed on attempt ${job.attemptsMade + 1}, retrying: ${reason}`,
      );
      // The row stays in `processing` so the retry finds it in a state that
      // permits a clean re-run.
      throw error;
    }

    this.logger.error(
      `Video ${videoId} exhausted its attempts: ${reason}`,
      (error as Error)?.stack,
    );
    await this.markFailed(videoId, reason);
    await this.publishToDeadLetterQueue(job, reason);
    throw error;
  }

  private async markFailed(videoId: string, reason: string): Promise<void> {
    // Guarded on `processing` for the same reason the `ready` transition is: the
    // failure of a job that no longer owns the row must not overwrite it.
    await this.videos.update(
      { id: videoId, status: VideoStatus.PROCESSING },
      { status: VideoStatus.ERROR, failure_reason: reason },
    );
  }

  private async publishToDeadLetterQueue(
    job: Job<VideoProcessingJobData>,
    reason: string,
  ): Promise<void> {
    // No deterministic `jobId` here on purpose: the DLQ has no consumer, so a
    // reused id would silently drop the second failure of a video that was
    // reprocessed (SI-03.17) and failed again. Retention beats dedup.
    await this.deadLetters.add(VIDEO_PROCESSING_JOB, {
      videoId: job.data.videoId,
      originalJobId: job.id,
      attemptsMade: job.attemptsMade + 1,
      failureReason: reason,
    });
  }

  /**
   * BullMQ surfaces internal worker problems (a dropped Redis connection, a lock
   * renewal that failed) as `error`. An `error` event with no listener is what
   * actually kills a Node process, so this listener is the difference between a
   * logged blip and a dead worker.
   */
  @OnWorkerEvent('error')
  onWorkerError(error: Error): void {
    this.logger.error(`Worker error: ${error.message}`, error.stack);
  }
}
