/**
 * Width of the generated thumbnail. The height is left to `-2` so ffmpeg derives
 * it from the source aspect ratio and rounds it to an even number, which the JPEG
 * encoder's chroma subsampling requires (phase-03-videos/TD-09). 640 is a choice
 * made here — the plan fixes the scale expression, not the width.
 */
export const THUMBNAIL_WIDTH = 640;

/**
 * Seek to 10% of the duration, never before 1s: the opening frame of a video is
 * very often black, and the duration is already known from the same job, so
 * seeking costs nothing extra (phase-03-videos/TD-09).
 */
export const THUMBNAIL_SEEK_RATIO = 0.1;
export const THUMBNAIL_SEEK_MIN_SECONDS = 1;

/** Margin kept before the end of the file so the seek always lands on a frame. */
export const THUMBNAIL_SEEK_TAIL_MARGIN_SECONDS = 0.1;

/** Same bound as the probe: a pathological input must not pin the worker (TD-07). */
export const FFMPEG_TIMEOUT_MS = 60_000;
