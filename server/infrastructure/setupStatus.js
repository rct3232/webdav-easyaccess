'use strict';

const SECRET_MASK = '****';

const SECRET_KEYS = new Set([
  'AWS_SECRET_ACCESS_KEY',
  'WEBDAV_PASSWORD',
  'JWT_SECRET',
  'ADMIN_DEFAULT_PASSWORD',
  'EMAIL_PASSWORD',
  'WEA_DB_PASSWORD',
]);

const WIZARD_WRITABLE_KEYS = [
  'WEA_FILE_STORAGE',
  'PORT',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'S3_BUCKET',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'S3_ENDPOINT',
  'WEBDAV_URL',
  'WEBDAV_USERNAME',
  'WEBDAV_PASSWORD',
  'WEBDAV_AUTH_TYPE',
  'CORS_ORIGINS',
  'ADMIN_DEFAULT_PASSWORD',
  'EMAIL_HOST',
  'EMAIL_PORT',
  'EMAIL_USER',
  'EMAIL_PASSWORD',
  'EMAIL_SECURE',
  'EMAIL_FROM_NAME',
];

// The four identity keys that decide whether a remote database is configured.
// Presence-based metadata-backend selection (docs/spec/server/store/storage.md
// §2.4): any of them set → remote PostgreSQL (partial set = missing keys), none
// set → sqlite (default).
const DB_REQUIRED_KEYS = ['WEA_DB_HOST', 'WEA_DB_DATABASE', 'WEA_DB_USER', 'WEA_DB_PASSWORD'];

const S3_REQUIRED_KEYS = ['S3_BUCKET', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];

const WEBDAV_REQUIRED_KEYS = ['WEBDAV_URL', 'WEBDAV_USERNAME', 'WEBDAV_PASSWORD'];

function metadataMissing(env) {
  if (DB_REQUIRED_KEYS.some((key) => env[key])) {
    return DB_REQUIRED_KEYS.filter((key) => !env[key]);
  }
  return [];
}

function fileMissing(env) {
  if (env.WEA_FILE_STORAGE === 'webdav') {
    return WEBDAV_REQUIRED_KEYS.filter((key) => !env[key]);
  }
  return S3_REQUIRED_KEYS.filter((key) => !env[key]);
}

function buildCurrent(env) {
  const current = {};
  for (const key of WIZARD_WRITABLE_KEYS) {
    const value = env[key];
    if (SECRET_KEYS.has(key)) {
      if (value) current[key] = SECRET_MASK;
    } else {
      current[key] = value == null ? '' : String(value);
    }
  }
  return current;
}

/**
 * Merge an effective-config map (from configResolver.getEffectiveConfig(),
 * `{ key: { value, source, tier, secret } }`) into the given env object so the
 * pure-env required-key logic runs against the resolved view. Keys whose
 * effective value is undefined (e.g. unset T0) keep the env value. Secrets
 * arrive masked ('****'); truthy masking is sufficient for presence checks.
 */
function mergeEffective(env, effectiveConfig) {
  const out = { ...env };
  for (const [key, meta] of Object.entries(effectiveConfig)) {
    if (meta && meta.value !== undefined) out[key] = meta.value;
  }
  return out;
}

/**
 * Compute derived setup state.
 * @param {object} [env] process.env-like view (pure env when no options given)
 * @param {{ effectiveConfig?: Record<string,{value:*, source:string, tier:string, secret:boolean}> }} [options]
 *   when `effectiveConfig` is provided the required-key checks run against the
 *   resolved (env-first over DB) values instead of raw env.
 */
function computeSetupStatus(env = {}, options = {}) {
  const view = options.effectiveConfig ? mergeEffective(env, options.effectiveConfig) : env;
  const missingMetadata = metadataMissing(view);
  const missingFile = fileMissing(view);
  // JWT_SECRET is optional (docs/features/config-source-resolution.md): it is
  // never a completeness condition — an unset secret falls back to an ephemeral
  // per-boot random in server/utils/auth.js.
  return {
    setup_complete: missingMetadata.length === 0 && missingFile.length === 0,
    missing: [...missingMetadata, ...missingFile],
    current: buildCurrent(view),
  };
}

module.exports = { computeSetupStatus, DB_REQUIRED_KEYS };
