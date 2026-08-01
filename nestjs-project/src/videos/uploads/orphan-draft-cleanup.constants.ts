/**
 * Maintenance is its own queue rather than a second job name on `video-processing`:
 * that queue's processor dispatches on nothing but the payload, and its
 * concurrency of 1 exists to bound scratch disk for transcoding — a cleanup job
 * has no business competing for that slot.
 */
export const VIDEO_MAINTENANCE_QUEUE = 'video-maintenance';

export const ORPHAN_DRAFT_CLEANUP_JOB = 'orphan-draft-cleanup';

/** Stable id, so re-bootstrapping the worker updates the schedule instead of adding one. */
export const ORPHAN_DRAFT_CLEANUP_SCHEDULER_ID = 'orphan-draft-cleanup';

/**
 * Generous on purpose: 24h comfortably exceeds any realistic transfer of the 10GB
 * ceiling, so the routine can never abort an upload that is merely slow
 * (phase-03-videos/TD-15).
 */
export const ORPHAN_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Hourly — two orders of magnitude below the age threshold, so an abandoned upload
 * is reclaimed shortly after it qualifies, and cheap enough to be irrelevant.
 */
export const ORPHAN_DRAFT_CLEANUP_EVERY_MS = 60 * 60 * 1000;
