/**
 * Shared constants for server and client.
 */

const PERMISSIONS = {
  READ: 'read',
  WRITE: 'write',
  ADMIN: 'admin',
  ALL: ['read', 'write', 'admin'],
  isValid: (permission) => ['read', 'write', 'admin'].includes(permission),
};

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
};

const USER_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ALL: ['pending', 'approved', 'rejected'],
  isValid: (status) => ['pending', 'approved', 'rejected'].includes(status),
};

const PERMISSION_REQUEST_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  ALL: ['pending', 'approved', 'rejected', 'cancelled'],
  isValid: (status) => ['pending', 'approved', 'rejected', 'cancelled'].includes(status),
};

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'];
const TEXT_EXTENSIONS = [
  'txt',
  'md',
  'json',
  'xml',
  'csv',
  'log',
  'js',
  'jsx',
  'ts',
  'tsx',
  'css',
  'html',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'sh',
];

const USAGE_ACTION = {
  OPEN: 'open',
  DOWNLOAD: 'download',
  PREVIEW: 'preview',
  SEARCH_HIT: 'search_hit',
  LIKE: 'like',
  ALL: ['open', 'download', 'preview', 'search_hit', 'like'],
};

/**
 * `ai_jobs.kind` CHECK enum — the runtime source for every enqueue site and
 * the park&drain `claimNext({ excludeKinds })` filter. The DDL CHECK in
 * `001_initial_normalized_schema.sql` is the persistence source of truth; the
 * pair is pinned by a parity test (a new kind is a DDL edit + this row).
 */
const AI_JOB_KIND = {
  EMBED: 'embed',
  FEATURES: 'features',
  CAPTION: 'caption',
  ASR: 'asr',
  BACKFILL: 'backfill',
  ALL: ['embed', 'features', 'caption', 'asr', 'backfill'],
};

/**
 * AI-platform enums — the code mirrors of the `001_initial_normalized_schema.sql`
 * TEXT CHECK constraints. Each keeps the `ALL`/`isValid` idiom of the status
 * enums above so callers validate with the same shape as `USER_STATUS`.
 */
const COLLECTION_ORIGIN = {
  SYSTEM: 'system',
  USER: 'user',
  SEED: 'seed',
  SEARCH: 'search',
  ALL: ['system', 'user', 'seed', 'search'],
  isValid: (origin) => ['system', 'user', 'seed', 'search'].includes(origin),
};

const COLLECTION_STATUS = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  ALL: ['active', 'archived'],
  isValid: (status) => ['active', 'archived'].includes(status),
};

const PUBLISH_MODE = {
  ASK: 'ask',
  OFF: 'off',
  AUTO: 'auto',
  ALL: ['ask', 'off', 'auto'],
  isValid: (mode) => ['ask', 'off', 'auto'].includes(mode),
};

/** Collection grant role — a separate channel from the file `PERMISSIONS` enum. */
const GRANT_ROLE = {
  VIEWER: 'viewer',
  EDITOR: 'editor',
  ALL: ['viewer', 'editor'],
  isValid: (role) => ['viewer', 'editor'].includes(role),
};

const JOURNAL_DOMAIN = {
  COLLECTION: 'collection',
  BATCH: 'batch',
  SETTINGS: 'settings',
  PERMISSIONS: 'permissions',
  TAGS: 'tags',
  FILE: 'file',
  SHARING: 'sharing',
  ALL: ['collection', 'batch', 'settings', 'permissions', 'tags', 'file', 'sharing'],
  isValid: (domain) =>
    ['collection', 'batch', 'settings', 'permissions', 'tags', 'file', 'sharing'].includes(domain),
};

const LLM_ROLE = {
  EMBED: 'embed',
  CHAT: 'chat',
  VISION: 'vision',
  ASR: 'asr',
  ALL: ['embed', 'chat', 'vision', 'asr'],
  isValid: (role) => ['embed', 'chat', 'vision', 'asr'].includes(role),
};

const MERGE_SUGGESTION_STATE = {
  PENDING: 'pending',
  MERGED: 'merged',
  DISMISSED: 'dismissed',
  REJECTED: 'rejected',
  ALL: ['pending', 'merged', 'dismissed', 'rejected'],
  isValid: (state) => ['pending', 'merged', 'dismissed', 'rejected'].includes(state),
};

/**
 * `file_suggestions.state` — deliberately NOT merged with
 * `MERGE_SUGGESTION_STATE`: the two tables share only `pending`/`dismissed`,
 * and `accepted`/`expired` are file-only while `merged`/`rejected` are merge-only.
 */
const FILE_SUGGESTION_STATE = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DISMISSED: 'dismissed',
  EXPIRED: 'expired',
  ALL: ['pending', 'accepted', 'dismissed', 'expired'],
  isValid: (state) => ['pending', 'accepted', 'dismissed', 'expired'].includes(state),
};

module.exports = {
  PERMISSIONS,
  HTTP_STATUS,
  USER_STATUS,
  PERMISSION_REQUEST_STATUS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  TEXT_EXTENSIONS,
  USAGE_ACTION,
  AI_JOB_KIND,
  COLLECTION_ORIGIN,
  COLLECTION_STATUS,
  PUBLISH_MODE,
  GRANT_ROLE,
  JOURNAL_DOMAIN,
  LLM_ROLE,
  MERGE_SUGGESTION_STATE,
  FILE_SUGGESTION_STATE,
};
