import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import {
  THUMBNAIL_REDIRECT_CACHE_CONTROL,
  VIDEO_REDIRECT_CACHE_CONTROL,
} from './delivery/video-delivery.constants';
import { VideoDeliveryService } from './delivery/video-delivery.service';
import type {
  OwnerVideo,
  PublicVideo,
  ReprocessResult,
} from './videos.service';
import { VideosService } from './videos.service';

/** The probe-derived columns, documented once for both read responses. */
const METADATA_PROPERTIES = {
  duration_seconds: { type: 'number', nullable: true, example: 12.345 },
  width: { type: 'integer', nullable: true, example: 1920 },
  height: { type: 'integer', nullable: true, example: 1080 },
  video_codec: { type: 'string', nullable: true, example: 'h264' },
  audio_codec: { type: 'string', nullable: true, example: 'aac' },
  container_format: { type: 'string', nullable: true, example: 'mp4' },
  bitrate_bps: { type: 'integer', nullable: true, example: 4500000 },
  size_bytes: { type: 'integer', nullable: true, example: 47225 },
} as const;

/** The three delivery routes share one response shape, documented once. */
const REDIRECT_RESPONSE = {
  description:
    'Presigned URL in `Location`, valid for minutes. The response body is empty — the bytes come from the storage server.',
  headers: {
    Location: {
      description: 'Short-lived presigned `GET` URL',
      schema: { type: 'string', format: 'uri' },
    },
    'Cache-Control': {
      description:
        'Caches the redirect, never the presigned object — the signature rotates per request',
      schema: { type: 'string' },
    },
  },
} as const;

const DELIVERY_NOT_FOUND_RESPONSE = {
  description:
    'VIDEO_NOT_FOUND — unknown identifier or a video that is not ready; the three delivery routes inherit the metadata route’s `ready`-only filter verbatim, so none of them is an existence oracle',
  schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
} as const;

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly videos: VideosService,
    private readonly delivery: VideoDeliveryService,
  ) {}

  /**
   * The owner family gets its own path segment so the two read routes are
   * disjoint at the router. `video-authorization-and-metadata/TD-01` maps by role
   * rather than by literal path and asks for "two disjoint route families" —
   * `GET /videos/{videoId}` and `GET /videos/{publicId}` are indistinguishable to
   * Express, and the Authorization Matrix is what binds (`### API Contracts`
   * → Routing note).
   */
  @Get('me/:videoId')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: "Read one of the caller's own videos, in any state",
    description:
      'The owner status poll. Returns the row in any state, including `error` with its persisted failure reason, which is what makes a failed upload diagnosable by its owner instead of silently absent.',
  })
  @ApiParam({
    name: 'videoId',
    format: 'uuid',
    description: 'Internal video id returned by the initiate call',
  })
  @ApiResponse({
    status: 200,
    description: 'The video, in whatever state it currently is',
    schema: {
      properties: {
        publicId: { type: 'string' },
        title: { type: 'string' },
        status: {
          type: 'string',
          enum: ['draft', 'processing', 'ready', 'error'],
        },
        failure_reason: {
          type: 'string',
          nullable: true,
          description: 'Populated when `status` is `error`',
        },
        ...METADATA_PROPERTIES,
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description:
      'VIDEO_NOT_FOUND — unknown video or a caller who does not own it; the two are deliberately indistinguishable, and a 403 would confirm existence',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async findOwned(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
  ): Promise<OwnerVideo> {
    return this.videos.findOwnedById(user.sub, videoId);
  }

  /**
   * The sole opt-out of the inherited global guard — anonymous readers are the
   * point of this route (video-authorization-and-metadata/TD-01).
   */
  @Public()
  @Get(':publicId')
  @ApiOperation({
    summary: 'Read the public metadata of a ready video',
    description:
      'Anonymous route. Resolves the public identifier filtering on `status = ready` in the same query, so a video that is not ready is indistinguishable from one that does not exist.',
  })
  @ApiParam({
    name: 'publicId',
    description: 'Short public identifier of the video',
  })
  @ApiResponse({
    status: 200,
    description: 'Metadata of a ready video; `status` is ready by construction',
    schema: {
      properties: {
        publicId: { type: 'string' },
        title: { type: 'string' },
        ...METADATA_PROPERTIES,
      },
    },
  })
  @ApiResponse({
    status: 404,
    description:
      'VIDEO_NOT_FOUND — unknown identifier or a video that is not ready; the two answer identically so the route is no existence oracle',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async findPublic(@Param('publicId') publicId: string): Promise<PublicVideo> {
    return this.videos.findPublicByPublicId(publicId);
  }

  @Post(':videoId/reprocess')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Reprocess a video that failed',
    description:
      'Republishes the processing job of a video in `error`, clearing the persisted failure reason in the same operation. Guarded to `error` on purpose: this is a recovery path a fixed environment takes explicitly, not an automatic retry loop.',
  })
  @ApiParam({
    name: 'videoId',
    format: 'uuid',
    description: 'Internal video id returned by the initiate call',
  })
  @ApiResponse({
    status: 200,
    description: 'The video is queued for processing again',
    schema: {
      properties: {
        publicId: { type: 'string' },
        status: { type: 'string', example: 'processing' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description:
      'VIDEO_NOT_FOUND — unknown video or a caller who does not own it; the two are deliberately indistinguishable',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description:
      'INVALID_VIDEO_STATE — the video is not in `error`, so there is nothing to recover',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async reprocess(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
  ): Promise<ReprocessResult> {
    return this.videos.reprocess(user.sub, videoId);
  }

  @Public()
  @Get(':publicId/stream')
  @ApiOperation({
    summary: 'Redirect to a short-lived presigned URL for playback',
    description:
      'The API never carries the video bytes: it answers `302` and the player talks to the storage server directly, which is also what gets `Range`/`206` semantics for free instead of hand-rolling partial content.',
  })
  @ApiParam({ name: 'publicId', description: 'Short public identifier' })
  @ApiResponse({ status: 302, ...REDIRECT_RESPONSE })
  @ApiResponse({ status: 404, ...DELIVERY_NOT_FOUND_RESPONSE })
  async stream(
    @Param('publicId') publicId: string,
    @Res() res: Response,
  ): Promise<void> {
    redirectTo(
      res,
      await this.delivery.resolveStreamUrl(publicId),
      VIDEO_REDIRECT_CACHE_CONTROL,
    );
  }

  @Public()
  @Get(':publicId/download')
  @ApiOperation({
    summary: 'Redirect to the same object, signed as an attachment',
    description:
      'Same object as `/stream`; the difference is the `response-content-disposition` carried into the signature.',
  })
  @ApiParam({ name: 'publicId', description: 'Short public identifier' })
  @ApiResponse({ status: 302, ...REDIRECT_RESPONSE })
  @ApiResponse({ status: 404, ...DELIVERY_NOT_FOUND_RESPONSE })
  async download(
    @Param('publicId') publicId: string,
    @Res() res: Response,
  ): Promise<void> {
    redirectTo(
      res,
      await this.delivery.resolveDownloadUrl(publicId),
      VIDEO_REDIRECT_CACHE_CONTROL,
    );
  }

  @Public()
  @Get(':publicId/thumbnail')
  @ApiOperation({
    summary: 'Redirect to a presigned thumbnail URL pinned to `image/jpeg`',
    description:
      'The content type is fixed at signing time, so the browser renders the image inline whatever the worker wrote on the object. The `Cache-Control` sits on this `302`, never on the image: the signature rotates per request, so the image itself can never be cached.',
  })
  @ApiParam({ name: 'publicId', description: 'Short public identifier' })
  @ApiResponse({ status: 302, ...REDIRECT_RESPONSE })
  @ApiResponse({ status: 404, ...DELIVERY_NOT_FOUND_RESPONSE })
  async thumbnail(
    @Param('publicId') publicId: string,
    @Res() res: Response,
  ): Promise<void> {
    redirectTo(
      res,
      await this.delivery.resolveThumbnailUrl(publicId),
      THUMBNAIL_REDIRECT_CACHE_CONTROL,
    );
  }
}

/**
 * Answers with no body at all. `res.redirect` would append Express's courtesy
 * HTML page, which is bytes an API whose whole point is to stay out of the data
 * path has no reason to send.
 */
function redirectTo(res: Response, url: string, cacheControl: string): void {
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('Location', url);
  res.status(HttpStatus.FOUND).end();
}
