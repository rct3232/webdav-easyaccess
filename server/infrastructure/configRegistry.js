'use strict';

/**
 * Authoritative catalog of every process.env config key the server reads,
 * classified per PLAN.md §3/§4 and docs/features/config-source-resolution.md.
 *
 * Ordering is significant: T0 metadata first, then file storage, then
 * server/security, then email, then runtime — the UI groups by this order.
 * Within a group, variables classified in PLAN §4 mirror its order; variables
 * absent from PLAN §4 are appended at the end of their group.
 *
 * default = the in-code default observed at the read site (exact type). When
 * the code has no default the field is omitted.
 */

const TIER = Object.freeze({
  T0: 'T0',
  T1: 'T1',
  T2: 'T2',
});

const CONFIG_ENTRIES = Object.freeze([
  // ── T0 — .env only (metadata / startup) ────────────────────────────────
  // Metadata backend selection is presence-based (docs/spec/server/store/
  // storage.md §2.4): any of WEA_DB_HOST/DATABASE/USER/PASSWORD set → remote
  // PostgreSQL; none set → sqlite.
  { key: 'WEA_SQLITE_PATH', tier: TIER.T0, secret: false },
  { key: 'WEA_DB_HOST', tier: TIER.T0, secret: false },
  { key: 'WEA_DB_PORT', tier: TIER.T0, secret: false, default: 5432 },
  { key: 'WEA_DB_DATABASE', tier: TIER.T0, secret: false },
  { key: 'WEA_DB_USER', tier: TIER.T0, secret: false },
  { key: 'WEA_DB_PASSWORD', tier: TIER.T0, secret: true },
  { key: 'WEA_DB_SSL', tier: TIER.T0, secret: false, default: false },
  { key: 'WEA_DB_MAX', tier: TIER.T0, secret: false, default: 10 },
  { key: 'WEA_DB_IDLE_TIMEOUT_MS', tier: TIER.T0, secret: false, default: 30000 },
  { key: 'WEA_DB_CONNECTION_TIMEOUT_MS', tier: TIER.T0, secret: false, default: 10000 },
  { key: 'WEA_DB_QUERY_TIMEOUT_MS', tier: TIER.T0, secret: false, default: 60000 },
  { key: 'NODE_ENV', tier: TIER.T0, secret: false },
  { key: 'DOTENV_CONFIG_PATH', tier: TIER.T0, secret: false },
  // No `default`: JWT_SECRET is optional — when unset/empty the server signs
  // with an ephemeral per-boot random secret (see server/utils/auth.js).
  { key: 'JWT_SECRET', tier: TIER.T0, secret: true },

  // ── File storage ───────────────────────────────────────────────────────
  { key: 'WEA_FILE_STORAGE', tier: TIER.T1, secret: false, default: 's3' },
  { key: 'S3_BUCKET', tier: TIER.T1, secret: false },
  { key: 'AWS_REGION', tier: TIER.T1, secret: false },
  { key: 'AWS_ACCESS_KEY_ID', tier: TIER.T1, secret: false },
  { key: 'AWS_SECRET_ACCESS_KEY', tier: TIER.T1, secret: true },
  { key: 'S3_ENDPOINT', tier: TIER.T1, secret: false },
  { key: 'WEBDAV_URL', tier: TIER.T1, secret: false },
  { key: 'WEBDAV_USERNAME', tier: TIER.T1, secret: false },
  { key: 'WEBDAV_PASSWORD', tier: TIER.T1, secret: true },
  { key: 'WEBDAV_AUTH_TYPE', tier: TIER.T1, secret: false, default: 'auto' },
  { key: 'WEBDAV_UPSTREAM_URL', tier: TIER.T2, secret: false },
  { key: 'MAX_THUMBNAIL_SIZE', tier: TIER.T2, secret: false, default: 300, dbOnly: true },
  { key: 'THUMBNAIL_CONCURRENCY_LIMIT', tier: TIER.T1, secret: false, default: 10, dbOnly: true },
  {
    key: 'THUMBNAIL_TOKEN_SECRET',
    tier: TIER.T2,
    secret: true,
    default: 'thumbnail-secret',
    dbOnly: true,
  },
  { key: 'THUMBNAIL_TOKEN_EXPIRY', tier: TIER.T2, secret: false, default: '15m', dbOnly: true },
  { key: 'FFMPEG_PATH', tier: TIER.T1, secret: false },
  { key: 'FFMPEG_INIT_TIMEOUT_MS', tier: TIER.T2, secret: false, default: 2000, dbOnly: true },
  { key: 'WEA_PREVIEW_TICKET_TTL_MS', tier: TIER.T2, secret: false, default: 120000, dbOnly: true },

  // ── Server & security ──────────────────────────────────────────────────
  { key: 'PORT', tier: TIER.T1, secret: false, default: 5001 },
  { key: 'CORS_ORIGINS', tier: TIER.T2, secret: false, default: '' },
  { key: 'LOGIN_RATE_LIMIT_MAX', tier: TIER.T2, secret: false, default: 20, dbOnly: true },
  {
    key: 'LOGIN_RATE_LIMIT_WINDOW_MS',
    tier: TIER.T2,
    secret: false,
    default: 900000,
    dbOnly: true,
  },
  { key: 'JWT_EXPIRES_IN', tier: TIER.T2, secret: false, default: '30m', dbOnly: true },
  { key: 'ADMIN_DEFAULT_PASSWORD', tier: TIER.T1, secret: true, default: 'admin' },
  { key: 'WEA_DISABLE_DEFAULT_ADMIN', tier: TIER.T1, secret: false },
  { key: 'HOSTNAME', tier: TIER.T2, secret: false, dbOnly: true },

  // ── Email ──────────────────────────────────────────────────────────────
  // EMAIL_* are T1: the nodemailer transporter is a process singleton built
  // once per boot, so edits only take effect after a restart (honest tier).
  { key: 'EMAIL_HOST', tier: TIER.T1, secret: false },
  { key: 'EMAIL_PORT', tier: TIER.T1, secret: false, default: 587 },
  { key: 'EMAIL_USER', tier: TIER.T1, secret: false },
  { key: 'EMAIL_PASSWORD', tier: TIER.T1, secret: true },
  { key: 'EMAIL_SECURE', tier: TIER.T1, secret: false, default: false },
  { key: 'EMAIL_FROM_NAME', tier: TIER.T1, secret: false, default: 'WebDAV EasyAccess' },

  // ── Runtime ────────────────────────────────────────────────────────────
  { key: 'registration_enabled', tier: TIER.T2, secret: false },
  { key: 'GC_INTERVAL_MS', tier: TIER.T1, secret: false, default: 0, dbOnly: true },
  { key: 'GC_ORPHAN_TTL_DAYS', tier: TIER.T2, secret: false, default: 1, dbOnly: true },
  { key: 'GC_VERSION_TTL_DAYS', tier: TIER.T2, secret: false, default: 1, dbOnly: true },
  { key: 'GC_PENDING_STALE_DAYS', tier: TIER.T2, secret: false, default: 3, dbOnly: true },
  // DEF-11 per-node version cap. 0 = unbounded (inverted 0-semantics vs the
  // *_DAYS keys above, which treat 0 as "disabled").
  { key: 'GC_VERSION_MAX_PER_NODE', tier: TIER.T2, secret: false, default: 10, dbOnly: true },
  // DEF-16 trash retention (GC Tier 3). 0 = retention off (trash purging skipped).
  { key: 'TRASH_RETENTION_DAYS', tier: TIER.T2, secret: false, default: 30, dbOnly: true },
  { key: 'REFRESH_TOKEN_EXPIRES_IN_DAYS', tier: TIER.T1, secret: false, default: 7, dbOnly: true },
  { key: 'USER_CACHE_TTL_MS', tier: TIER.T2, secret: false, default: 3000, dbOnly: true },
  { key: 'PERMISSION_CACHE_TTL_MS', tier: TIER.T2, secret: false, default: 5000, dbOnly: true },
  {
    key: 'PERMISSIONS_EXISTENCE_INDEX_TTL_MS',
    tier: TIER.T2,
    secret: false,
    default: 30000,
    dbOnly: true,
  },
  {
    key: 'PERMISSIONS_EXISTENCE_RECONCILE_BATCH_SIZE',
    tier: TIER.T2,
    secret: false,
    default: 100,
    dbOnly: true,
  },
  {
    key: 'PERMISSIONS_EXISTENCE_RECONCILE_CONCURRENCY',
    tier: TIER.T2,
    secret: false,
    default: 4,
    dbOnly: true,
  },
  { key: 'WEA_SKIP_MIGRATION_WORKER', tier: TIER.T2, secret: false },
  { key: 'WEA_SKIP_BULK_WORKER', tier: TIER.T2, secret: false },
  { key: 'WEA_SKIP_GC_SCHEDULER', tier: TIER.T1, secret: false },
]);

const FROZEN_ENTRIES = Object.freeze(CONFIG_ENTRIES.map((entry) => Object.freeze(entry)));

const ENTRY_BY_KEY = new Map(FROZEN_ENTRIES.map((entry) => [entry.key, entry]));

function getEntries() {
  return FROZEN_ENTRIES;
}

function getEntry(key) {
  return ENTRY_BY_KEY.get(key);
}

function isT0(key) {
  const entry = getEntry(key);
  return Boolean(entry && entry.tier === TIER.T0);
}

function isTier(key, tier) {
  const entry = getEntry(key);
  return Boolean(entry && entry.tier === tier);
}

function isSecret(key) {
  const entry = getEntry(key);
  return Boolean(entry && entry.secret);
}

function getDefault(key) {
  const entry = getEntry(key);
  return entry ? entry.default : undefined;
}

module.exports = {
  TIER,
  CONFIG_ENTRIES: FROZEN_ENTRIES,
  getEntries,
  getEntry,
  isT0,
  isTier,
  isSecret,
  getDefault,
};
