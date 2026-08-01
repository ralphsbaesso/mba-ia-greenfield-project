import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { Video, VideoStatus } from '../entities/video.entity';
import { FfprobeService } from './ffprobe.service';
import { SourceFileService } from './source-file.service';
import { ThumbnailService } from './thumbnail.service';
import {
  VIDEO_PROCESSING_CONCURRENCY,
  VIDEO_PROCESSING_QUEUE,
} from './video-queue.constants';

/** The job carries only the id; every other field is read from the row (TD-06). */
export interface VideoProcessingJobData {
  videoId: string;
}

@Processor(VIDEO_PROCESSING_QUEUE, {
  concurrency: VIDEO_PROCESSING_CONCURRENCY,
})
export class VideoProcessingProcessor extends WorkerHost {
  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly sourceFiles: SourceFileService,
    private readonly ffprobe: FfprobeService,
    private readonly thumbnails: ThumbnailService,
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
}
