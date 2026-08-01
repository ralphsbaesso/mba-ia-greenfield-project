import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import { StorageModule } from '../storage/storage.module';
import { VideoDeliveryService } from './delivery/video-delivery.service';
import { Video } from './entities/video.entity';
import { VideoQueueModule } from './processing/video-queue.module';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  // Ownership resolves through the owner's channel, and the `sub` → `channel_id`
  // lookup lives in ChannelsService (video-authorization-and-metadata/TD-02).
  // StorageModule is what the delivery routes presign against, and
  // VideoQueueModule is what the reprocess path republishes onto.
  imports: [
    TypeOrmModule.forFeature([Video]),
    ChannelsModule,
    StorageModule,
    VideoQueueModule,
  ],
  controllers: [VideosController],
  providers: [VideosService, VideoDeliveryService],
  exports: [TypeOrmModule, VideosService],
})
export class VideosModule {}
