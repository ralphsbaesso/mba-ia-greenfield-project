import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import type { OwnerVideo, PublicVideo } from './videos.service';
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

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

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
}
