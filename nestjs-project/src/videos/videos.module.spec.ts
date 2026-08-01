import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import storageConfig from '../config/storage.config';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { createTestDataSource } from '../test/create-test-data-source';
import { VideoDeliveryService } from './delivery/video-delivery.service';
import { Video } from './entities/video.entity';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideosModule', () => {
  it('should compile with TypeOrmModule.forFeature([Video]) and provide VideosService', async () => {
    const module = await Test.createTestingModule({
      imports: [
        // The delivery routes presign through StorageService, which reads the
        // storage config — hence the global ConfigModule.
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        TypeOrmModule.forRoot({
          ...createTestDataSource(ALL_ENTITIES).options,
          synchronize: false,
        }),
        VideosModule,
      ],
    }).compile();

    expect(module.get(getRepositoryToken(Video))).toBeDefined();
    // VideosService depends on ChannelsService, which the module must import.
    expect(module.get(VideosService)).toBeDefined();
    expect(module.get(VideoDeliveryService)).toBeDefined();
    await module.close();
  }, 30000);
});
