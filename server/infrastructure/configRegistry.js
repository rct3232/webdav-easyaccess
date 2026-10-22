'use strict';

/**
 * Authoritative catalog of every process.env config key the server reads,
 * classified per docs/features/config-source-resolution.md.
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
  // T1.3 AI jobs worker test seam (aiJobService spec §2) — same idiom as
  // WEA_SKIP_BULK_WORKER: T2, env-allowed so test setup can set it directly.
  { key: 'WEA_SKIP_AI_WORKER', tier: TIER.T2, secret: false },
  // AI jobs worker knobs (aiJobService.md §3 — T2 dbOnly, hot; the worker
  // reads them per iteration). AI_WORKER_CONCURRENCY's shipped default is 1
  // and the worker loop implements single-concurrency only.
  { key: 'AI_WORKER_POLL_MS', tier: TIER.T2, secret: false, default: 5000, dbOnly: true },
  { key: 'AI_WORKER_CONCURRENCY', tier: TIER.T2, secret: false, default: 1, dbOnly: true },
  { key: 'AI_JOB_STALE_MS', tier: TIER.T2, secret: false, default: 900000, dbOnly: true },
  { key: 'AI_JOB_TIMEOUT_MS', tier: TIER.T2, secret: false, default: 120000, dbOnly: true },

  // ── AI / LLM (T2 dbOnly — fully hot; PLAN §6) ──────────────────────────
  // Per-call resolver, re-probe on change, no restart (llmAdapter §1/§2).
  // Presence decides candidacy, probes decide truth (§4.23); there is no
  // LLM_ENABLED flag. Keys are registered before any read site exists (T1.1)
  // so the admin config surface can manage them from day one. API keys are
  // secret (presentation masking only; plaintext at rest).
  { key: 'LLM_EMBED_BASE_URL', tier: TIER.T2, secret: false, dbOnly: true },
  { key: 'LLM_EMBED_API_KEY', tier: TIER.T2, secret: true, dbOnly: true },
  { key: 'LLM_EMBED_MODEL', tier: TIER.T2, secret: false, dbOnly: true },
  { key: 'LLM_CHAT_BASE_URL', tier: TIER.T2, secret: false, dbOnly: true },
  { key: 'LLM_CHAT_API_KEY', tier: TIER.T2, secret: true, dbOnly: true },
  { key: 'LLM_CHAT_MODEL', tier: TIER.T2, secret: false, dbOnly: true },
  { key: 'LLM_VISION_BASE_URL', tier: TIER.T2, secret: false, dbOnly: true },
  { key: 'LLM_VISION_API_KEY', tier: TIER.T2, secret: true, dbOnly: true },
  { key: 'LLM_VISION_MODEL', tier: TIER.T2, secret: false, dbOnly: true },
  { key: 'LLM_ASR_BASE_URL', tier: TIER.T2, secret: false, dbOnly: true },
  { key: 'LLM_ASR_API_KEY', tier: TIER.T2, secret: true, dbOnly: true },
  { key: 'LLM_ASR_MODEL', tier: TIER.T2, secret: false, dbOnly: true },
  { key: 'LLM_MAX_INPUT_CHARS', tier: TIER.T2, secret: false, dbOnly: true },
  { key: 'LLM_CHUNK_BUDGET', tier: TIER.T2, secret: false, default: 4, dbOnly: true },
  {
    key: 'LLM_OVERLENGTH_POLICY',
    tier: TIER.T2,
    secret: false,
    default: 'chunk-pool',
    dbOnly: true,
  },
  { key: 'LLM_DAILY_CALL_CAP', tier: TIER.T2, secret: false, default: 0, dbOnly: true },
  { key: 'LLM_DAILY_TOKEN_CAP', tier: TIER.T2, secret: false, default: 0, dbOnly: true },
  { key: 'LLM_REPROBE_DEBOUNCE_S', tier: TIER.T2, secret: false, default: 60, dbOnly: true },
  { key: 'LLM_BREAKER_THRESHOLD', tier: TIER.T2, secret: false, default: 5, dbOnly: true },
  { key: 'LLM_BREAKER_COOLDOWN_S', tier: TIER.T2, secret: false, default: 300, dbOnly: true },
  { key: 'AI_SEMANTIC_SEARCH_ENABLED', tier: TIER.T2, secret: false, default: true, dbOnly: true },

  // ── Search knobs (searchService.md §3; T2 hot/dbOnly) ───────────────────
  // Name-section hard cap (the §2.4 `counts.name_truncated` flag flips when
  // the cap cuts the set). The semantic-leg caps ride the T1.5 semantic
  // branch: SEARCH_SEMANTIC_LIMIT caps the deduped semantic display and
  // BASELINE_SAMPLE_DOCS sizes the per-query dynamic-baseline sample.
  { key: 'SEARCH_NAME_LIMIT', tier: TIER.T2, secret: false, default: 200, dbOnly: true },
  { key: 'SEARCH_SEMANTIC_LIMIT', tier: TIER.T2, secret: false, default: 50, dbOnly: true },
  { key: 'BASELINE_SAMPLE_DOCS', tier: TIER.T2, secret: false, default: 500, dbOnly: true },

  // ── Activity constants (§3.4 — T2 dbOnly product constants; PLAN §6) ────
  // T0.6 usage/activity rollup: weights + half-life feed the nightly item
  // accumulator (S_k, H=30d); retention governs the raw-event roll-off; the
  // anchor hour arms the nightly schedulers; ARCHIVE_RETENTION_DAYS is the
  // purge horizon shared with evolution pass 4 (collectionsService.md §3).
  // Shipped defaults are the single semantic source's registry mirror
  // (infrastructure/usage/activityScore.js — parity kept by test). The
  // rollup scheduler test seam follows the WEA_SKIP_AI_WORKER idiom
  // (env-allowed, NOT dbOnly).
  { key: 'AI_USAGE_W_OPEN', tier: TIER.T2, secret: false, default: 1, dbOnly: true },
  { key: 'AI_USAGE_W_PREVIEW', tier: TIER.T2, secret: false, default: 2, dbOnly: true },
  { key: 'AI_USAGE_W_DOWNLOAD', tier: TIER.T2, secret: false, default: 3, dbOnly: true },
  { key: 'AI_USAGE_W_SEARCH_HIT', tier: TIER.T2, secret: false, default: 1, dbOnly: true },
  { key: 'AI_USAGE_W_LIKE', tier: TIER.T2, secret: false, default: 5, dbOnly: true },
  { key: 'AI_ACTIVITY_HALF_LIFE_DAYS', tier: TIER.T2, secret: false, default: 30, dbOnly: true },
  {
    key: 'AI_USAGE_EVENT_RETENTION_DAYS',
    tier: TIER.T2,
    secret: false,
    default: 90,
    dbOnly: true,
  },
  { key: 'AI_NIGHTLY_ANCHOR_HOUR_UTC', tier: TIER.T2, secret: false, default: 3, dbOnly: true },
  { key: 'ARCHIVE_RETENTION_DAYS', tier: TIER.T2, secret: false, default: 30, dbOnly: true },
  {
    key: 'ADMIN_REPORTS_RETENTION_DAYS',
    tier: TIER.T2,
    secret: false,
    default: 30,
    dbOnly: true,
  },
  { key: 'WEA_SKIP_ROLLUP_SCHEDULER', tier: TIER.T2, secret: false },
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
