import type { Job } from 'bullmq';
import { NoDecodableVideoStreamError } from './ffprobe.service';

/**
 * `failure_reason` is a `text` column, but it is read back by the owner route — a
 * multi-kilobyte driver dump there is noise, not diagnosis.
 */
export const FAILURE_REASON_MAX_LENGTH = 500;

export const UNKNOWN_FAILURE_REASON = 'Unknown processing failure';

/**
 * Permanent = ffprobe's own verdict that the input has no decodable video stream.
 * Nothing about retrying changes that answer, so it goes straight to `error`
 * without consuming the remaining attempts (phase-03-videos/TD-13).
 *
 * Everything else — a timeout, a storage hiccup, a missing binary — is treated as
 * transient and retried. Classifying conservatively is the point: guessing that an
 * infrastructure failure is permanent would strand a perfectly good video.
 */
export function isPermanentFailure(error: unknown): boolean {
  return (
    error instanceof NoDecodableVideoStreamError ||
    // Same escape hatch BullMQ uses for `UnrecoverableError`: `instanceof` fails
    // across duplicated module instances, the name does not.
    (error as Error | null)?.name === NoDecodableVideoStreamError.name
  );
}

export function describeFailure(error: unknown): string {
  // Anything thrown that is neither an Error nor a string carries no message worth
  // persisting — stringifying it would write `[object Object]` into the column.
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const trimmed = message.trim();

  if (!trimmed) {
    return UNKNOWN_FAILURE_REASON;
  }

  return trimmed.length > FAILURE_REASON_MAX_LENGTH
    ? `${trimmed.slice(0, FAILURE_REASON_MAX_LENGTH - 1)}…`
    : trimmed;
}

/**
 * Mirrors BullMQ's own retry condition (`attemptsMade + 1 < opts.attempts`).
 * Inside the handler `attemptsMade` counts the attempts that already *finished*,
 * so it is `0` on the first run — the increment on `moveToActive` lands in
 * `attemptsStarted`, a different field.
 */
export function isLastAttempt(
  job: Pick<Job, 'attemptsMade' | 'opts'>,
): boolean {
  const attempts = job.opts?.attempts ?? 1;
  return job.attemptsMade + 1 >= attempts;
}
