import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

/**
 * Postgres returns `numeric` and `bigint` as strings to avoid float drift. The
 * stored precision is what matters, so the column keeps its exact type and the
 * transformer hands JavaScript a number on read — safe here because durations,
 * bitrates and byte counts of a 10GB ceiling stay far below Number.MAX_SAFE_INTEGER.
 */
const numericTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null ? null : Number(value),
};

// Both invariants are state-scoped: they hold for `ready` rows and must not block
// the initiate INSERT, which creates the row before a single byte is uploaded
// (video-authorization-and-metadata/TD-04 § Revisions, thumbnail-delivery/TD-02).
@Check(
  'CHK_videos_ready_requires_metadata',
  `"status" <> 'ready' OR ("duration_seconds" IS NOT NULL AND "width" IS NOT NULL AND "height" IS NOT NULL AND "video_codec" IS NOT NULL AND "container_format" IS NOT NULL AND "size_bytes" IS NOT NULL)`,
)
@Check(
  'CHK_videos_ready_requires_thumbnail',
  `"status" <> 'ready' OR "thumbnail_key" IS NOT NULL`,
)
@Entity('videos')
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The only identifier exposed in public routes and payloads (TD-10). */
  @Column({ type: 'varchar', length: 32, unique: true })
  public_id: string;

  @Index()
  @Column({ type: 'uuid' })
  channel_id: string;

  /** Supplied at initiate — a draft exists with its title from the first request. */
  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({
    type: 'enum',
    enum: VideoStatus,
    default: VideoStatus.DRAFT,
  })
  status: VideoStatus;

  /** Resolved at initiate and persisted, not recomputed from the convention (TD-03). */
  @Column({ type: 'varchar' })
  storage_key: string;

  @Column({ type: 'varchar', nullable: true })
  thumbnail_key: string | null;

  /** The S3 multipart uploadId, persisted so the upload can always be aborted (TD-15). */
  @Column({ type: 'varchar', nullable: true })
  upload_id: string | null;

  @Column({ type: 'text', nullable: true })
  failure_reason: string | null;

  @Column({
    type: 'numeric',
    precision: 10,
    scale: 3,
    nullable: true,
    transformer: numericTransformer,
  })
  duration_seconds: number | null;

  @Column({ type: 'integer', nullable: true })
  width: number | null;

  @Column({ type: 'integer', nullable: true })
  height: number | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  video_codec: string | null;

  /** Stays nullable even for `ready` rows — a file may have no audio track. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  audio_codec: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  container_format: string | null;

  /** Stays nullable even for `ready` rows — some containers report no bitrate. */
  @Column({
    type: 'bigint',
    nullable: true,
    transformer: numericTransformer,
  })
  bitrate_bps: number | null;

  /** From the storage object's HeadObject, not from ffprobe (va/TD-04). */
  @Column({
    type: 'bigint',
    nullable: true,
    transformer: numericTransformer,
  })
  size_bytes: number | null;

  /** The age reference the orphan-draft cleanup reads (TD-15). */
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => Channel, (channel) => channel.videos)
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
