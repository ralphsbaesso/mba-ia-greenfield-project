/**
 * A pathological input must not pin the worker forever, so every probe is bounded
 * (phase-03-videos/TD-07). Generous enough for a 10GB local file, short enough to
 * be a bound.
 */
export const FFPROBE_TIMEOUT_MS = 60_000;

/** ffprobe writes the whole JSON document to stdout; a long stream list is still tiny. */
export const FFPROBE_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
