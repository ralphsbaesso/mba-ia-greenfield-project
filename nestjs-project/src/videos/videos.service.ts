import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import { VideoNotFoundException } from '../common/exceptions/domain.exception';
import { Video, VideoStatus } from './entities/video.entity';
import { isVideoId } from './videos.id';

/** The probe-derived columns, shared by both views (Data Model → Video). */
export interface VideoMetadata {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  containerFormat: string | null;
  bitrateBps: number | null;
  sizeBytes: number | null;
}

/**
 * Carries `publicId` and never `id`: the internal uuid stays on the FKs and the
 * owner routes (phase-03-videos/TD-10). `status` is absent because it is `ready`
 * by construction on this view.
 */
export interface PublicVideo extends VideoMetadata {
  publicId: string;
}

/** The owner's status poll — any state, plus the reason when it failed. */
export interface OwnerVideo extends VideoMetadata {
  publicId: string;
  status: VideoStatus;
  failureReason: string | null;
}

function toMetadata(video: Video): VideoMetadata {
  return {
    durationSeconds: video.duration_seconds,
    width: video.width,
    height: video.height,
    videoCodec: video.video_codec,
    audioCodec: video.audio_codec,
    containerFormat: video.container_format,
    bitrateBps: video.bitrate_bps,
    sizeBytes: video.size_bytes,
  };
}

export function toPublicVideo(video: Video): PublicVideo {
  return { publicId: video.public_id, ...toMetadata(video) };
}

export function toOwnerVideo(video: Video): OwnerVideo {
  return {
    publicId: video.public_id,
    status: video.status,
    failureReason: video.failure_reason,
    ...toMetadata(video),
  };
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly channels: ChannelsService,
  ) {}

  /**
   * Public resolution. `status = 'ready'` sits in the **same** query that resolves
   * the `publicId` — a fetch-then-check would leave a window where the row changes
   * between the two, and would answer differently for "exists but not ready" than
   * for "does not exist" (video-authorization-and-metadata/TD-03).
   */
  async findPublicByPublicId(publicId: string): Promise<PublicVideo> {
    const video = await this.videos.findOne({
      where: { public_id: publicId, status: VideoStatus.READY },
    });

    if (!video) {
      throw new VideoNotFoundException();
    }

    return toPublicVideo(video);
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
