import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { SUPPORTED_VIDEO_CONTENT_TYPES } from '../../../storage/storage.constants';

export const VIDEO_TITLE_MAX_LENGTH = 200;

export class InitiateUploadDto {
  /**
   * Title of the video. Required here so the draft is never a nameless row: the
   * pre-registration that initiate performs already carries what the video is.
   */
  // Trimmed before validating, so a whitespace-only title fails `IsNotEmpty`
  // instead of being stored as a blank-looking name.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(VIDEO_TITLE_MAX_LENGTH)
  title: string;

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
