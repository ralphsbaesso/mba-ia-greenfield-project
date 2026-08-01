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
