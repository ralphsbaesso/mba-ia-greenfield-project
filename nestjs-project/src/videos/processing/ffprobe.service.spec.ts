import {
  FfprobeOutput,
  mapFfprobeOutput,
  NoDecodableVideoStreamError,
} from './ffprobe.service';

const withAudio: FfprobeOutput = {
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: {
    duration: '12.345',
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    bit_rate: '188900',
  },
};

describe('mapFfprobeOutput', () => {
  describe('a video with an audio track', () => {
    it('should map every column the data model declares', () => {
      expect(mapFfprobeOutput(withAudio)).toEqual({
        durationSeconds: 12.345,
        width: 1920,
        height: 1080,
        videoCodec: 'h264',
        audioCodec: 'aac',
        containerFormat: 'mov,mp4,m4a,3gp,3g2,mj2',
        bitrateBps: 188900,
      });
    });

    it('should keep the duration fractional instead of truncating it', () => {
      const probe = mapFfprobeOutput(withAudio);

      expect(probe.durationSeconds).toBe(12.345);
      expect(Number.isInteger(probe.durationSeconds)).toBe(false);
    });

    it('should expose no size — the storage object is authoritative for that', () => {
      expect(Object.keys(mapFfprobeOutput(withAudio))).not.toContain(
        'sizeBytes',
      );
    });
  });

  describe('a video with no audio track', () => {
    it('should map the remaining columns with a null audio codec', () => {
      const probe = mapFfprobeOutput({
        ...withAudio,
        streams: [withAudio.streams![0]],
      });

      expect(probe.audioCodec).toBeNull();
      expect(probe.videoCodec).toBe('h264');
      expect(probe.width).toBe(1920);
    });
  });

  describe('a container with no overall bitrate', () => {
    it('should map a missing bit_rate to null', () => {
      const probe = mapFfprobeOutput({
        ...withAudio,
        format: { duration: '12.345', format_name: 'matroska,webm' },
      });

      expect(probe.bitrateBps).toBeNull();
    });

    it('should map an unparseable bit_rate to null rather than NaN', () => {
      const probe = mapFfprobeOutput({
        ...withAudio,
        format: { ...withAudio.format, bit_rate: 'N/A' },
      });

      expect(probe.bitrateBps).toBeNull();
    });
  });

  describe('input that is not a decodable video', () => {
    it('should reject output with no video stream', () => {
      expect(() =>
        mapFfprobeOutput({
          streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
          format: { duration: '12.345', format_name: 'mp3' },
        }),
      ).toThrow(NoDecodableVideoStreamError);
    });

    it('should reject output with no streams at all', () => {
      expect(() => mapFfprobeOutput({ format: { duration: '1' } })).toThrow(
        NoDecodableVideoStreamError,
      );
    });

    it('should reject a video stream with no dimensions', () => {
      expect(() =>
        mapFfprobeOutput({
          streams: [{ codec_type: 'video', codec_name: 'h264' }],
          format: { duration: '12.345', format_name: 'mp4' },
        }),
      ).toThrow(NoDecodableVideoStreamError);
    });

    it('should reject output with no duration', () => {
      expect(() =>
        mapFfprobeOutput({ ...withAudio, format: { format_name: 'mp4' } }),
      ).toThrow(NoDecodableVideoStreamError);
    });
  });

  describe('an unnamed container', () => {
    it('should fall back to a placeholder rather than dropping the column', () => {
      const probe = mapFfprobeOutput({
        ...withAudio,
        format: { duration: '12.345', bit_rate: '188900' },
      });

      expect(probe.containerFormat).toBe('unknown');
    });
  });
});
