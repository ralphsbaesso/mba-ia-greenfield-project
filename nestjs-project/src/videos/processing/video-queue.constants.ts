export const VIDEO_PROCESSING_QUEUE = 'video-processing';

/**
 * Deliberately consumer-less. BullMQ has no native dead-letter queue, so this is
 * the explicit pattern that keeps exhausted jobs instead of dropping them
 * (phase-03-videos/TD-04, phase-03-videos/TD-13).
 */
export const VIDEO_PROCESSING_DLQ = 'video-processing-dlq';

export const VIDEO_PROCESSING_JOB = 'process-video';

/**
 * One job at a time, so peak scratch disk is a single downloaded file rather than
 * one per concurrent job (phase-03-videos/TD-08). It matches BullMQ's default, and
 * is stated explicitly so raising it is a decision instead of an accident.
 */
export const VIDEO_PROCESSING_CONCURRENCY = 1;

/**
 * TD-13's transient-retry policy. Lives on the root `defaultJobOptions` so every
 * producer inherits it and no `add()` call has to restate it.
 */
export const VIDEO_PROCESSING_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
} as const;
