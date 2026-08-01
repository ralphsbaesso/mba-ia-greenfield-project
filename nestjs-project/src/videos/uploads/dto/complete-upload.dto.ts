import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';

export class UploadedPartDto {
  /** 1-based index of the part, as presigned at initiate. */
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  partNumber: number;

  /** ETag returned by storage in the response to that part's PUT. */
  @IsString()
  @IsNotEmpty()
  etag: string;
}

export class CompleteUploadDto {
  /**
   * One entry per uploaded part. The API cannot close the multipart upload
   * without the full ETag list.
   */
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => UploadedPartDto)
  parts: UploadedPartDto[];
}
