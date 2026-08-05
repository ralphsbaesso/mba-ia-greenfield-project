/**
 * Single private bucket, one prefix per kind of object (phase-03-videos/TD-03).
 * Both keys derive from the video's `id`, so the worker and the delivery paths
 * resolve them without an extra lookup, and a re-run overwrites instead of
 * duplicating.
 */
export const STORAGE_PREFIXES = {
  VIDEO: 'videos',
  THUMBNAIL: 'thumbnails',
} as const;

/**
 * The video object's extension comes from the content type declared at initiate,
 * never from the client-supplied filename (phase-03-videos/TD-03). This map is
 * therefore also the allow-list the initiate DTO validates against — a content
 * type absent from here has no extension to derive and no fallback.
 */
export const VIDEO_CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
  'video/x-msvideo': 'avi',
  'video/mpeg': 'mpeg',
  'video/x-ms-wmv': 'wmv',
  'video/3gpp': '3gp',
  'video/x-flv': 'flv',
  'video/ogg': 'ogv',
};

export const SUPPORTED_VIDEO_CONTENT_TYPES = Object.keys(
  VIDEO_CONTENT_TYPE_EXTENSIONS,
);

export const THUMBNAIL_EXTENSION = 'jpg';
export const THUMBNAIL_CONTENT_TYPE = 'image/jpeg';
