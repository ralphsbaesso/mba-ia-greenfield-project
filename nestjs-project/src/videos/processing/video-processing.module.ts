import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import databaseConfig from '../../config/database.config';
import { envValidationSchema } from '../../config/env.validation';
import redisConfig from '../../config/redis.config';
import storageConfig from '../../config/storage.config';
import { StorageModule } from '../../storage/storage.module';
import { User } from '../../users/entities/user.entity';
import { Video } from '../entities/video.entity';
import workerConfig from '../../config/worker.config';
import { VideosModule } from '../videos.module';
import { FfprobeService } from './ffprobe.service';
import { SourceFileService } from './source-file.service';
import { ThumbnailService } from './thumbnail.service';
import { VideoQueueModule } from './video-queue.module';

/**
 * The worker only ever writes `videos`, but TypeORM builds metadata over the whole
 * relation closure: `Video` → `Channel` → `User`. Listing them explicitly (instead
 * of `autoLoadEntities`, which would require importing the channels and users
 * modules the worker does not use) keeps the worker's data surface visible.
 */
const WORKER_ENTITIES = [User, Channel, Video];

/**
 * Root module of the worker process. It is a **standalone application context**,
 * not an HTTP app: the worker consumes jobs and writes to the same `videos` row
 * the API reads, sharing the entity and the TypeORM configuration rather than
 * going through an internal API (phase-03-videos/TD-06).
 *
 * GOTCHA for the processors added here from SI-03.11 on: `WorkerHost.worker`
 * throws `Worker has not yet been initialized` when touched before the
 * `onModuleInit` lifecycle hook — read it in `onApplicationBootstrap` or later,
 * never in a constructor.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, redisConfig, storageConfig, workerConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (dbConfig: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: dbConfig.host,
        port: dbConfig.port,
        username: dbConfig.username,
        password: dbConfig.password,
        database: dbConfig.name,
        entities: WORKER_ENTITIES,
        synchronize: false,
      }),
    }),
    VideoQueueModule,
    VideosModule,
    StorageModule,
  ],
  providers: [SourceFileService, FfprobeService, ThumbnailService],
  exports: [SourceFileService, FfprobeService, ThumbnailService],
})
export class VideoProcessingModule {}
