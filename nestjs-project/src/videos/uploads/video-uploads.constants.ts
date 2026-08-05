/**
 * 64 MiB — ≈160 parts for a 10GB file, comfortably under the 10,000-part ceiling
 * and few enough that presigning them all at initiate is cheap
 * (phase-03-videos/TD-05).
 */
export const UPLOAD_PART_SIZE_BYTES = 64 * 1024 * 1024;

/**
 * Hours, not the 7-day maximum: a 10GB transfer over a 10 Mbps link takes ≈2.2h,
 * so 6h leaves headroom without turning the grant into a long-lived capability
 * (phase-03-videos/TD-05).
 */
export const UPLOAD_PART_URL_TTL_SECONDS = 6 * 60 * 60;
