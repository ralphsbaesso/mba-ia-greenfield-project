import { ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { StorageService } from './storage.service';

// registerAs factories are typed as ConfigType<typeof factory>; build the literal
// once so the specs read the same shape the DI container injects.
const config: ConfigType<typeof storageConfig> = {
  endpoint: 'http://minio:9000',
  region: 'us-east-1',
  accessKey: 'streamtube',
  secretKey: 'streamtube',
  bucket: 'streamtube',
};

describe('StorageService — key resolution', () => {
  let service: StorageService;

  beforeEach(() => {
    service = new StorageService(config);
  });

  const videoId = '2f1c9a54-2b1e-4d3f-9a10-6c4b8e0a7d21';

  it('should derive the video key from the id under the video prefix', () => {
    expect(service.resolveVideoKey(videoId, 'video/mp4')).toBe(
      `videos/${videoId}.mp4`,
    );
  });

  it('should derive the thumbnail key from the id under the thumbnail prefix', () => {
    expect(service.resolveThumbnailKey(videoId)).toBe(
      `thumbnails/${videoId}.jpg`,
    );
  });

  it('should resolve the same key twice for the same id and content type', () => {
    expect(service.resolveVideoKey(videoId, 'video/mp4')).toBe(
      service.resolveVideoKey(videoId, 'video/mp4'),
    );
  });

  it('should take the extension from the declared content type, not from a filename', () => {
    // A client claiming "holiday.mp4" while declaring quicktime gets .mov.
    expect(service.resolveVideoKey(videoId, 'video/quicktime')).toBe(
      `videos/${videoId}.mov`,
    );
    expect(service.resolveVideoKey(videoId, 'video/x-matroska')).toBe(
      `videos/${videoId}.mkv`,
    );
  });

  it('should ignore content type parameters and casing', () => {
    expect(
      service.resolveVideoKey(videoId, ' VIDEO/MP4; codecs="avc1.640028" '),
    ).toBe(`videos/${videoId}.mp4`);
  });

  it('should reject an unsupported content type instead of falling back', () => {
    expect(() => service.resolveVideoKey(videoId, 'application/zip')).toThrow(
      /Unsupported video content type/,
    );
  });

  it('should reject an absent content type instead of producing an extensionless key', () => {
    expect(() => service.resolveVideoKey(videoId, '')).toThrow(
      /Unsupported video content type/,
    );
  });
});
