import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  InvalidVideoStateException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import { Video, VideoStatus } from './entities/video.entity';
import {
  VIDEO_PROCESSING_JOB,
  VIDEO_PROCESSING_QUEUE,
} from './processing/video-queue.constants';
import { isVideoId } from './videos.id';

/**
 * The probe-derived columns, shared by both views. The field names are the ones
 * `### API Contracts` lists for both read endpoints — the column names verbatim,
 * unlike the camelCase upload responses. Kept as the contract states them rather
 * than normalized, so the wire shape has a single source of truth.
 */
export interface VideoMetadata {
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  container_format: string | null;
  bitrate_bps: number | null;
  size_bytes: number | null;
}

/**
 * Carries `publicId` and never `id`: the internal uuid stays on the FKs and the
 * owner routes (phase-03-videos/TD-10). `status` is absent because it is `ready`
 * by construction on this view.
 */
export interface PublicVideo extends VideoMetadata {
  publicId: string;
  title: string;
}

export interface ReprocessResult {
  publicId: string;
  status: VideoStatus;
}

/** The owner's status poll — any state, plus the reason when it failed. */
export interface OwnerVideo extends VideoMetadata {
  publicId: string;
  title: string;
  status: VideoStatus;
  failure_reason: string | null;
}

function toMetadata(video: Video): VideoMetadata {
  return {
    duration_seconds: video.duration_seconds,
    width: video.width,
    height: video.height,
    video_codec: video.video_codec,
    audio_codec: video.audio_codec,
    container_format: video.container_format,
    bitrate_bps: video.bitrate_bps,
    size_bytes: video.size_bytes,
  };
}

export function toPublicVideo(video: Video): PublicVideo {
  return {
    publicId: video.public_id,
    title: video.title,
    ...toMetadata(video),
  };
}

export function toOwnerVideo(video: Video): OwnerVideo {
  return {
    publicId: video.public_id,
    title: video.title,
    status: video.status,
    failure_reason: video.failure_reason,
    ...toMetadata(video),
  };
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly channels: ChannelsService,
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly queue: Queue,
  ) {}

  /**
   * The explicit recovery path: a fixed environment republishes the job of a
   * video that failed, with no new upload. Deliberately **not** an automatic
   * retry loop — the owner decides when the environment is worth retrying
   * (phase-03-videos/TD-13).
   */
  async reprocess(userId: string, videoId: string): Promise<ReprocessResult> {
    const video = await this.findOwnedEntity(userId, videoId);

    // Conditional update rather than read-then-write: the `error` guard and the
    // write are one statement, so two concurrent reprocesses cannot both
    // republish, and the reason is cleared in the very operation that requeues
    // (phase-03-videos/TD-12, TD-14).
    const { affected } = await this.videos.update(
      { id: video.id, status: VideoStatus.ERROR },
      { status: VideoStatus.PROCESSING, failure_reason: null },
    );

    if (!affected) {
      throw new InvalidVideoStateException();
    }

    // The previous attempt left a record under the same deterministic id, and
    // BullMQ ignores an `add` whose jobId already exists — so the spent record
    // goes first, and the job keeps the id derived from the video (TD-14).
    await this.queue.remove(video.id);
    await this.queue.add(
      VIDEO_PROCESSING_JOB,
      { videoId: video.id },
      { jobId: video.id },
    );

    return { publicId: video.public_id, status: VideoStatus.PROCESSING };
  }

  /**
   * Public resolution. `status = 'ready'` sits in the **same** query that resolves
   * the `publicId` — a fetch-then-check would leave a window where the row changes
   * between the two, and would answer differently for "exists but not ready" than
   * for "does not exist" (video-authorization-and-metadata/TD-03).
   */
  async findPublicByPublicId(publicId: string): Promise<PublicVideo> {
    return toPublicVideo(await this.findReadyEntityByPublicId(publicId));
  }

  /**
   * The entity behind the public view, for the delivery routes that need the
   * storage keys. Sharing this method with `findPublicByPublicId` is what keeps
   * the `ready` filter identical across metadata, stream, download and thumbnail:
   * a delivery route that resolved a video the metadata route refuses would be an
   * existence oracle (thumbnail-delivery/TD-01).
   */
  async findReadyEntityByPublicId(publicId: string): Promise<Video> {
    const video = await this.videos.findOne({
      where: { public_id: publicId, status: VideoStatus.READY },
    });

    if (!video) {
      throw new VideoNotFoundException();
    }

    return video;
  }

  /**
   * Owner resolution by internal id, in **any** state — including `error` with its
   * persisted reason, which is what makes a failed upload diagnosable by its owner
   * instead of silently absent (video-authorization-and-metadata/TD-03, TD-13).
   */
  async findOwnedById(userId: string, videoId: string): Promise<OwnerVideo> {
    return toOwnerVideo(await this.findOwnedEntity(userId, videoId));
  }

  /**
   * Every miss — malformed id, unknown id, someone else's video — answers the same
   * `VIDEO_NOT_FOUND`. Never a `403`: a `403` confirms the video exists, and that
   * is the leak Fase 04's `unlisted` rule must not have
   * (video-authorization-and-metadata/TD-03).
   */
  async findOwnedEntity(userId: string, videoId: string): Promise<Video> {
    // Checked before the query so a malformed path parameter cannot reach Postgres
    // as an `invalid input syntax for uuid`.
    if (!isVideoId(videoId)) {
      throw new VideoNotFoundException();
    }

    const channelId = await this.channels.findIdByUserId(userId);
    if (!channelId) {
      throw new VideoNotFoundException();
    }

    const video = await this.videos.findOne({
      where: { id: videoId, channel_id: channelId },
    });

    if (!video) {
      throw new VideoNotFoundException();
    }

    return video;
  }
}
