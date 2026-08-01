import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../../common/openapi/api-error-envelope.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import type {
  CompleteUploadResult,
  InitiateUploadResult,
} from './video-uploads.service';
import { VideoUploadsService } from './video-uploads.service';

@ApiTags('videos')
@Controller('videos')
export class VideoUploadsController {
  constructor(private readonly uploads: VideoUploadsService) {}

  @Post('uploads')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Initiate a video upload',
    description:
      'Opens a multipart upload, pre-registers the video as a draft before any byte is transferred, and returns the presigned URL for every part.',
  })
  @ApiBody({ type: InitiateUploadDto })
  @ApiResponse({
    status: 201,
    description: 'Upload initiated; the draft row exists and the grant is open',
    schema: {
      properties: {
        videoId: { type: 'string', format: 'uuid' },
        publicId: { type: 'string' },
        uploadId: { type: 'string' },
        partSizeBytes: { type: 'integer', example: 67108864 },
        parts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              partNumber: { type: 'integer' },
              url: { type: 'string' },
            },
          },
        },
        expiresInSeconds: { type: 'integer', example: 21600 },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 500,
    description:
      'CHANNEL_MISSING_FOR_USER — the authenticated user has no channel, which is an invariant violation rather than a client error',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async initiate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateUploadDto,
  ): Promise<InitiateUploadResult> {
    return this.uploads.initiate(user.sub, {
      contentType: dto.contentType,
      totalSizeBytes: dto.sizeBytes,
    });
  }

  @Post(':videoId/uploads/complete')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete a video upload',
    description:
      'Closes the multipart upload with the ETag list, moves the video to processing and publishes the processing job in the same operation.',
  })
  @ApiParam({
    name: 'videoId',
    format: 'uuid',
    description: 'Internal video id returned by the initiate call',
  })
  @ApiBody({ type: CompleteUploadDto })
  @ApiResponse({
    status: 200,
    description: 'Upload completed; the video is queued for processing',
    schema: {
      properties: {
        publicId: { type: 'string' },
        status: { type: 'string', example: 'processing' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
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
    description: 'INVALID_VIDEO_STATE — the video is no longer a draft',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async complete(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<CompleteUploadResult> {
    return this.uploads.complete(user.sub, videoId, dto.parts);
  }

  @Delete(':videoId/uploads')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Cancel a video upload',
    description:
      'Aborts the multipart upload, reclaiming the parts already transferred — the costly part of an abandoned upload. The draft row is kept; only the storage grant goes away.',
  })
  @ApiParam({
    name: 'videoId',
    format: 'uuid',
    description: 'Internal video id returned by the initiate call',
  })
  @ApiResponse({
    status: 204,
    description: 'Upload aborted; the accumulated parts were reclaimed',
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
      'INVALID_VIDEO_STATE — the video is not a draft, so there is no multipart upload left to abort',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('videoId') videoId: string,
  ): Promise<void> {
    await this.uploads.abortUpload(user.sub, videoId);
  }
}
