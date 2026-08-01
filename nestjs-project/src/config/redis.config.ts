import { registerAs } from '@nestjs/config';

export default registerAs('redis', () => ({
  // Compose service name — never localhost, which inside a container is the
  // container itself.
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
}));
