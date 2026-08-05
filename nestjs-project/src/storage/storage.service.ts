import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import {
  STORAGE_PREFIXES,
  THUMBNAIL_EXTENSION,
  VIDEO_CONTENT_TYPE_EXTENSIONS,
} from './storage.constants';

export interface PresignGetOptions {
  expiresIn: number;
  responseContentType?: string;
  responseContentDisposition?: string;
}

export interface PendingUpload {
  key: string;
  uploadId: string;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface PresignUploadPartOptions {
  uploadId: string;
  partNumber: number;
  expiresIn: number;
}

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(
    @Inject(storageConfig.KEY) storage: ConfigType<typeof storageConfig>,
  ) {
    this.bucket = storage.bucket;
    // `endpoint` + `forcePathStyle` are what make MinIO-in-dev and S3-in-prod a
    // configuration difference instead of a code difference (phase-03-videos/TD-01).
    this.client = new S3Client({
      endpoint: storage.endpoint,
      region: storage.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: storage.accessKey,
        secretAccessKey: storage.secretKey,
      },
    });
  }

  resolveVideoKey(videoId: string, declaredContentType: string): string {
    const extension = this.resolveVideoExtension(declaredContentType);
    return `${STORAGE_PREFIXES.VIDEO}/${videoId}.${extension}`;
  }

  resolveThumbnailKey(videoId: string): string {
    return `${STORAGE_PREFIXES.THUMBNAIL}/${videoId}.${THUMBNAIL_EXTENSION}`;
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const { UploadId } = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );

    if (!UploadId) {
      throw new Error(`Storage returned no UploadId for key ${key}`);
    }

    return UploadId;
  }

  /**
   * S3 requires the part list in ascending `PartNumber` order; the client sends
   * whatever order its uploads finished in, so it is sorted here rather than
   * trusted (phase-03-videos/TD-05).
   */
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    const orderedParts = [...parts]
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag }));

    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: orderedParts },
      }),
    );
  }

  /**
   * The only way to reclaim the parts of an upload that was never completed —
   * S3 keeps them, and charges for them, until the upload is aborted
   * (phase-03-videos/TD-15).
   */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  /**
   * The observable side of the abort: what is still open and still costing.
   *
   * The prefix is applied here rather than sent as `Prefix`: the pinned MinIO
   * release answers an empty list to a prefixed `ListMultipartUploads` while
   * returning every upload when the parameter is omitted. Filtering client-side
   * is the behaviour that holds on both MinIO and S3. It does not paginate —
   * one page is enough for the hygiene checks that use it.
   */
  async listMultipartUploads(prefix?: string): Promise<PendingUpload[]> {
    const { Uploads } = await this.client.send(
      new ListMultipartUploadsCommand({ Bucket: this.bucket }),
    );

    return (Uploads ?? [])
      .filter((upload) => upload.Key && upload.UploadId)
      .map((upload) => ({
        key: upload.Key as string,
        uploadId: upload.UploadId as string,
      }))
      .filter((upload) => !prefix || upload.key.startsWith(prefix));
  }

  async putObject(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async headObject(key: string): Promise<HeadObjectCommandOutput> {
    return this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async getObject(key: string): Promise<GetObjectCommandOutput> {
    return this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /**
   * `expiresIn` is required rather than defaulted: delivery wants minutes and the
   * multipart upload wants hours, so each caller states its own TTL
   * (phase-03-videos/TD-01, phase-03-videos/TD-05).
   */
  async presignGetObject(
    key: string,
    options: PresignGetOptions,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentType: options.responseContentType,
      ResponseContentDisposition: options.responseContentDisposition,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn,
    });
  }

  async presignUploadPart(
    key: string,
    options: PresignUploadPartOptions,
  ): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: options.uploadId,
      PartNumber: options.partNumber,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: options.expiresIn,
    });
  }

  private resolveVideoExtension(declaredContentType: string): string {
    // Parameters (`video/mp4; codecs=…`) are stripped before lookup.
    const mediaType = (declaredContentType ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const extension = VIDEO_CONTENT_TYPE_EXTENSIONS[mediaType];

    if (!extension) {
      // The initiate DTO validates against the same allow-list, so reaching this
      // means an invariant was bypassed — there is deliberately no fallback
      // extension (phase-03-videos/TD-03).
      throw new Error(
        `Unsupported video content type: ${declaredContentType || '(empty)'}`,
      );
    }

    return extension;
  }
}
