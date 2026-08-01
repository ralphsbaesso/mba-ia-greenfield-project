import { Injectable } from '@nestjs/common';
import { extname } from 'node:path';
import { THUMBNAIL_CONTENT_TYPE } from '../../storage/storage.constants';
import { StorageService } from '../../storage/storage.service';
import type { Video } from '../entities/video.entity';
import { VideosService } from '../videos.service';
import { DELIVERY_URL_TTL_SECONDS } from './video-delivery.constants';

/**
 * Resolves the three delivery routes to short-lived presigned URLs. Nothing here
 * touches the object's bytes — the API stays out of the data path and the storage
 * server keeps answering `Range` requests with `206` for free (phase-03-videos/TD-11).
 */
@Injectable()
export class VideoDeliveryService {
  constructor(
    private readonly videos: VideosService,
    private readonly storage: StorageService,
  ) {}

  async resolveStreamUrl(publicId: string): Promise<string> {
    const video = await this.videos.findReadyEntityByPublicId(publicId);

    return this.storage.presignGetObject(video.storage_key, {
      expiresIn: DELIVERY_URL_TTL_SECONDS,
    });
  }

  /**
   * The **same object** as the stream URL; the only difference is the disposition
   * carried into the signature, which is what makes one route play and the other
   * download without storing the file twice (phase-03-videos/TD-11).
   */
  async resolveDownloadUrl(publicId: string): Promise<string> {
    const video = await this.videos.findReadyEntityByPublicId(publicId);

    return this.storage.presignGetObject(video.storage_key, {
      expiresIn: DELIVERY_URL_TTL_SECONDS,
      responseContentDisposition: attachmentDisposition(video),
    });
  }

  /**
   * `responseContentType` becomes a **signed query parameter**, so the served
   * content type is pinned at signing time regardless of what the worker wrote on
   * the object, and the browser renders the thumbnail inline instead of
   * downloading it (thumbnail-delivery/TD-01).
   */
  async resolveThumbnailUrl(publicId: string): Promise<string> {
    const video = await this.videos.findReadyEntityByPublicId(publicId);

    if (!video.thumbnail_key) {
      // `CHK_videos_ready_requires_thumbnail` forbids this row, so reaching here
      // means the invariant was bypassed — there is deliberately no placeholder
      // image to fall back to (thumbnail-delivery/TD-02).
      throw new Error(`Ready video ${video.public_id} has no thumbnail key`);
    }

    return this.storage.presignGetObject(video.thumbnail_key, {
      expiresIn: DELIVERY_URL_TTL_SECONDS,
      responseContentType: THUMBNAIL_CONTENT_TYPE,
    });
  }
}

/**
 * The downloaded file is named after the public identifier, never after the
 * client-supplied filename the upload was initiated with (phase-03-videos/TD-03),
 * and keeps the extension the storage key already carries.
 */
function attachmentDisposition(video: Video): string {
  return `attachment; filename="${video.public_id}${extname(video.storage_key)}"`;
}
