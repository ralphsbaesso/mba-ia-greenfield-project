import { registerAs } from '@nestjs/config';
import { tmpdir } from 'os';

/**
 * The worker downloads each source object to a temp file before probing it, so it
 * gets a dedicated Compose volume (`worker-tmp`) rather than the container's
 * writable layer (phase-03-videos/TD-08). The default keeps the services that do
 * not mount that volume — the API and the test containers — working.
 */
export default registerAs('worker', () => ({
  tmpDir: process.env.WORKER_TMP_DIR || tmpdir(),
}));
