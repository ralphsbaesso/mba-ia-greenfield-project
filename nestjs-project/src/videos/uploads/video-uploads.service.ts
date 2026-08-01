import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { ChannelsService } from '../../channels/channels.service';
import { ChannelMissingForUserException } from '../../common/exceptions/domain.exception';
import { StorageService } from '../../storage/storage.service';
import { Video } from '../entities/video.entity';
import { generatePublicId } from '../videos.id';
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

@Injectable()
export class VideoUploadsService {
  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly channels: ChannelsService,
    private readonly storage: StorageService,
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
