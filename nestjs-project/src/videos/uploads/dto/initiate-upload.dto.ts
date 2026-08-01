import { Type } from 'class-transformer';
import { IsIn, IsInt, IsPositive } from 'class-validator';
import { SUPPORTED_VIDEO_CONTENT_TYPES } from '../../../storage/storage.constants';

export class InitiateUploadDto {
  /**
   * Declared MIME type of the video. The stored object's extension is derived
   * from it, never from a client-supplied filename.
   */
  @IsIn(SUPPORTED_VIDEO_CONTENT_TYPES)
  contentType: string;

  /**
   * Total size of the file in bytes. The number of presigned parts is computed
   * from it against the 64 MiB part size.
   */
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  sizeBytes: number;
}
