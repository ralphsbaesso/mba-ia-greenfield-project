import {
  THUMBNAIL_SEEK_MIN_SECONDS,
  THUMBNAIL_SEEK_RATIO,
} from './thumbnail.constants';
import { resolveSeekSeconds } from './thumbnail.service';

describe('resolveSeekSeconds', () => {
  describe('short clips', () => {
    it('should seek at 1s for a 5s video, not at the opening frame', () => {
      expect(resolveSeekSeconds(5)).toBe(THUMBNAIL_SEEK_MIN_SECONDS);
    });

    it('should never return zero for a clip that has a frame to show', () => {
      expect(resolveSeekSeconds(2)).toBeGreaterThan(0);
      expect(resolveSeekSeconds(5)).toBeGreaterThan(0);
    });

    it('should stay inside a sub-second clip instead of seeking past its end', () => {
      const seek = resolveSeekSeconds(0.5);

      expect(seek).toBeLessThan(0.5);
      expect(seek).toBeGreaterThan(0);
    });

    it('should not seek past the end of a clip shorter than the 1s floor', () => {
      expect(resolveSeekSeconds(0.8)).toBeLessThan(0.8);
    });
  });

  describe('long videos', () => {
    it('should seek at 10% of a 100s video', () => {
      expect(resolveSeekSeconds(100)).toBeCloseTo(
        100 * THUMBNAIL_SEEK_RATIO,
        5,
      );
    });

    it('should seek at 10% of a two-hour video', () => {
      expect(resolveSeekSeconds(7200)).toBeCloseTo(720, 5);
    });

    it('should scale with the duration once past the floor', () => {
      expect(resolveSeekSeconds(60)).toBeGreaterThan(resolveSeekSeconds(30));
    });
  });

  describe('the boundary between the floor and the ratio', () => {
    it('should still use the 1s floor at exactly 10s', () => {
      expect(resolveSeekSeconds(10)).toBe(1);
    });

    it('should follow the ratio just past 10s', () => {
      expect(resolveSeekSeconds(20)).toBeCloseTo(2, 5);
    });
  });
});
