/**
 * Minutes, not hours (phase-03-videos/TD-11). A delivery URL only has to survive
 * the click that follows it, so it is two orders of magnitude shorter-lived than
 * `UPLOAD_PART_URL_TTL_SECONDS`. 900s is also `getSignedUrl`'s own default — kept
 * as an explicit value so the TTL is a documented decision rather than a default
 * nobody chose (thumbnail-delivery/TD-01).
 */
export const DELIVERY_URL_TTL_SECONDS = 15 * 60;

/**
 * The cacheable window of the **redirect**, never of the presigned image: the
 * signature rotates per request, so the browser's cache key for the image never
 * repeats and caching the bytes is the trap the decision discards explicitly
 * (thumbnail-delivery/TD-01). Deliberately shorter than `DELIVERY_URL_TTL_SECONDS`
 * so a cached `302` can never hand out an already-expired signature.
 */
export const THUMBNAIL_REDIRECT_MAX_AGE_SECONDS = 5 * 60;

export const THUMBNAIL_REDIRECT_CACHE_CONTROL = `public, max-age=${THUMBNAIL_REDIRECT_MAX_AGE_SECONDS}`;

/**
 * The video redirect is not cached: it is the authorization point, and Fase 04's
 * unlisted/private visibility must be able to tighten it without waiting out a
 * cached `302` (phase-03-videos/TD-11).
 */
export const VIDEO_REDIRECT_CACHE_CONTROL = 'no-store';
