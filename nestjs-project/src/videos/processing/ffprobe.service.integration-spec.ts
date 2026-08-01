import { join } from 'path';
import {
  FfprobeService,
  FfprobeTimeoutError,
  NoDecodableVideoStreamError,
} from './ffprobe.service';

// The fixtures were produced by ffmpeg's `testsrc`/`sine` generators: 2s, 320x240,
// h264 in mp4 — one with an aac track, one without.
const FIXTURES = join(__dirname, '../../../test/fixtures');
const WITH_AUDIO = join(FIXTURES, 'sample-with-audio.mp4');
const NO_AUDIO = join(FIXTURES, 'sample-no-audio.mp4');
const NOT_A_VIDEO = join(FIXTURES, 'not-a-video.txt');

// This suite spawns the real `ffprobe`, which only exists in the `video-worker`
// image — the API image deliberately does not carry it (phase-03-videos/TD-07).
describe('FfprobeService (integration)', () => {
  const service = new FfprobeService();

  it('should probe a video with audio into every metadata column', async () => {
    const probe = await service.probe(WITH_AUDIO);

    expect(probe.durationSeconds).toBeCloseTo(2, 1);
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(240);
    expect(probe.videoCodec).toBe('h264');
    expect(probe.audioCodec).toBe('aac');
    expect(probe.containerFormat).toContain('mp4');
    expect(probe.bitrateBps).toBeGreaterThan(0);
  });

  it('should probe a video with no audio track without failing', async () => {
    const probe = await service.probe(NO_AUDIO);

    expect(probe.audioCodec).toBeNull();
    expect(probe.videoCodec).toBe('h264');
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(240);
    expect(probe.durationSeconds).toBeCloseTo(2, 1);
  });

  it('should report a non-video file as having no decodable video stream', async () => {
    await expect(service.probe(NOT_A_VIDEO)).rejects.toBeInstanceOf(
      NoDecodableVideoStreamError,
    );
  });

  it('should report a missing file as having no decodable video stream', async () => {
    await expect(
      service.probe(join(FIXTURES, 'does-not-exist.mp4')),
    ).rejects.toBeInstanceOf(NoDecodableVideoStreamError);
  });

  it('should kill the subprocess when the probe exceeds its timeout', async () => {
    // 1ms cannot complete: the timeout fires and the error is a timeout, not a
    // verdict about the input.
    await expect(service.probe(WITH_AUDIO, 1)).rejects.toBeInstanceOf(
      FfprobeTimeoutError,
    );
  });

  it('should not report a timeout as a permanently undecodable input', async () => {
    await expect(service.probe(WITH_AUDIO, 1)).rejects.not.toBeInstanceOf(
      NoDecodableVideoStreamError,
    );
  });

  describe('when the binary is missing from the image', () => {
    class MissingBinaryFfprobeService extends FfprobeService {
      protected readonly binary = 'ffprobe-not-installed';
    }

    it('should surface a broken image instead of blaming the input', async () => {
      const broken = new MissingBinaryFfprobeService();

      // Classified as undecodable, this would mark every video permanently failed
      // on a misconfigured worker instead of raising the alarm.
      await expect(broken.probe(WITH_AUDIO)).rejects.not.toBeInstanceOf(
        NoDecodableVideoStreamError,
      );
      await expect(broken.probe(WITH_AUDIO)).rejects.toThrow(
        /ffprobe binary not found/,
      );
    });
  });
});
