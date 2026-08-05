import { NestFactory } from '@nestjs/core';
import { VideoProcessingModule } from './videos/processing/video-processing.module';

async function bootstrap(): Promise<void> {
  // Same codebase as the API, separate entrypoint: a standalone context, with no
  // HTTP server and no port (phase-03-videos/TD-06).
  const app = await NestFactory.createApplicationContext(VideoProcessingModule);

  // Without this, SIGTERM kills the process without running onApplicationShutdown,
  // so BullMQ never closes its worker and an in-flight job is dropped instead of
  // being allowed to finish or fail cleanly (phase-03-videos/TD-13).
  app.enableShutdownHooks();
}

void bootstrap();
