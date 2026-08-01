import { Module } from '@nestjs/common';
import { ChannelsModule } from '../../channels/channels.module';
import { StorageModule } from '../../storage/storage.module';
import { VideosModule } from '../videos.module';
import { VideoUploadsService } from './video-uploads.service';

@Module({
  imports: [VideosModule, ChannelsModule, StorageModule],
  providers: [VideoUploadsService],
  exports: [VideoUploadsService],
})
export class VideoUploadsModule {}
