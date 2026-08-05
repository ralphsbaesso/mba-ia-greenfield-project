import { randomBytes } from 'crypto';

/**
 * 9 random bytes render to exactly 12 base64url characters with no padding —
 * 72 bits of entropy in a short, URL-safe identifier. Node's built-in `crypto` is
 * used instead of `nanoid`, which is ESM-only and declares `engines` that exclude
 * this container's Node (phase-03-videos/TD-10).
 */
const PUBLIC_ID_BYTES = 9;

export const PUBLIC_ID_LENGTH = 12;

export function generatePublicId(): string {
  return randomBytes(PUBLIC_ID_BYTES).toString('base64url');
}

const VIDEO_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A malformed `videoId` must answer `404 VIDEO_NOT_FOUND` like any unknown id —
 * never a `400`, which would distinguish "malformed" from "unknown"
 * (`### API Contracts → Validation Rules`). Checking the shape here also keeps a
 * bad path parameter from reaching Postgres as an `invalid input syntax for uuid`.
 */
export function isVideoId(value: string): boolean {
  return VIDEO_ID_PATTERN.test(value);
}
