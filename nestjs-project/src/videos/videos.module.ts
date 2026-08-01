import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import { Video } from './entities/video.entity';
import { VideosService } from './videos.service';

@Module({
  // Ownership resolves through the owner's channel, and the `sub` → `channel_id`
  // lookup lives in ChannelsService (video-authorization-and-metadata/TD-02).
  imports: [TypeOrmModule.forFeature([Video]), ChannelsModule],
  providers: [VideosService],
  exports: [TypeOrmModule, VideosService],
})
export class VideosModule {}
