import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { ChannelsService } from '../../channels/channels.service';
import {
  ChannelMissingForUserException,
  InvalidVideoStateException,
  VideoNotFoundException,
} from '../../common/exceptions/domain.exception';
import type { CompletedPart } from '../../storage/storage.service';
import { StorageService } from '../../storage/storage.service';
import { Video, VideoStatus } from '../entities/video.entity';
import {
  VIDEO_PROCESSING_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../processing/video-queue.constants';
import { generatePublicId, isVideoId } from '../videos.id';
import {
  UPLOAD_PART_SIZE_BYTES,
  UPLOAD_PART_URL_TTL_SECONDS,
} from './video-uploads.constants';

export interface InitiateUploadInput {
  contentType: string;
  totalSizeBytes: number;
}

export interface PresignedPart {
  partNumber: number;
  url: string;
}

export interface InitiateUploadResult {
  videoId: string;
  publicId: string;
  uploadId: string;
  partSizeBytes: number;
  parts: PresignedPart[];
  expiresInSeconds: number;
}

export interface CompleteUploadResult {
  publicId: string;
  status: VideoStatus;
}

@Injectable()
export class VideoUploadsService {
  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly channels: ChannelsService,
    private readonly storage: StorageService,
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly queue: Queue,
  ) {}

  async initiate(
    userId: string,
    input: InitiateUploadInput,
  ): Promise<InitiateUploadResult> {
    const channelId = await this.channels.findIdByUserId(userId);
    if (!channelId) {
      throw new ChannelMissingForUserException();
    }

    // The id is minted here rather than by the database because the object key
    // derives from it and the multipart upload has to be opened before the row
    // can persist its uploadId (phase-03-videos/TD-03, TD-05, TD-15).
    const videoId = randomUUID();
    const storageKey = this.storage.resolveVideoKey(videoId, input.contentType);
    const uploadId = await this.storage.createMultipartUpload(
      storageKey,
      input.contentType,
    );

    const video = await this.videos.save(
      this.videos.create({
        id: videoId,
        public_id: generatePublicId(),
        channel_id: channelId,
        storage_key: storageKey,
        upload_id: uploadId,
      }),
    );

    const parts = await this.presignParts(
      storageKey,
      uploadId,
      this.countParts(input.totalSizeBytes),
    );

    return {
      videoId: video.id,
      publicId: video.public_id,
      uploadId,
      partSizeBytes: UPLOAD_PART_SIZE_BYTES,
      parts,
      expiresInSeconds: UPLOAD_PART_URL_TTL_SECONDS,
    };
  }

  async complete(
    userId: string,
    videoId: string,
    parts: CompletedPart[],
  ): Promise<CompleteUploadResult> {
    const video = await this.findOwnedVideo(userId, videoId);

    // Guarded transition: `complete` only accepts a draft (TD-12). Checked here so
    // a wrong state is refused before the object is consolidated.
    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new InvalidVideoStateException();
    }

    // The object has to exist before the row advances, so the storage call comes
    // first — an incomplete ETag list fails here and leaves the video in `draft`.
    await this.storage.completeMultipartUpload(
      video.storage_key,
      video.upload_id,
      parts,
    );

    // Conditional update rather than read-then-write: two concurrent completes
    // cannot both advance the row, and only the winner publishes (TD-14).
    const { affected } = await this.videos.update(
      { id: video.id, status: VideoStatus.DRAFT },
      { status: VideoStatus.PROCESSING },
    );

    if (!affected) {
      throw new InvalidVideoStateException();
    }

    // Deterministic jobId — the queue-level dedup that absorbs a client calling
    // complete twice (TD-14). The payload carries only the id; the worker reads
    // the rest from the row (TD-06).
    await this.queue.add(
      VIDEO_PROCESSING_JOB,
      { videoId: video.id },
      { jobId: video.id },
    );

    return { publicId: video.public_id, status: VideoStatus.PROCESSING };
  }

  /**
   * Every miss — malformed id, unknown id, someone else's video — answers the same
   * `VIDEO_NOT_FOUND`, so the route never confirms existence
   * (video-authorization-and-metadata/TD-03).
   */
  private async findOwnedVideo(
    userId: string,
    videoId: string,
  ): Promise<Video> {
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

  private countParts(totalSizeBytes: number): number {
    return Math.max(1, Math.ceil(totalSizeBytes / UPLOAD_PART_SIZE_BYTES));
  }

  private async presignParts(
    storageKey: string,
    uploadId: string,
    partCount: number,
  ): Promise<PresignedPart[]> {
    const partNumbers = Array.from({ length: partCount }, (_, i) => i + 1);

    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.storage.presignUploadPart(storageKey, {
          uploadId,
          partNumber,
          expiresIn: UPLOAD_PART_URL_TTL_SECONDS,
        }),
      })),
    );
  }
}
