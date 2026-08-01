import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT || 'http://minio:9000',
  region: process.env.STORAGE_REGION || 'us-east-1',
  accessKey: process.env.STORAGE_ACCESS_KEY || 'streamtube',
  secretKey: process.env.STORAGE_SECRET_KEY || 'streamtube',
  bucket: process.env.STORAGE_BUCKET || 'streamtube',
}));
