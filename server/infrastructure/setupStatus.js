'use strict';

// Mirrors server/utils/auth.js:5 (JWT_SECRET fallback). Duplicated locally on
// purpose so this module stays dependency-free — importing auth.js would create
// a require cycle, since auth.js consumes computeSetupStatus (see §5.2.1).
const DEFAULT_JWT_SECRET = 'your-secret-key-change-in-production';

const SECRET_MASK = '****';

const SECRET_KEYS = new Set([
  'AWS_SECRET_ACCESS_KEY',
  'WEBDAV_PASSWORD',
  'JWT_SECRET',
  'ADMIN_DEFAULT_PASSWORD',
  'EMAIL_PASSWORD',
  'WEA_PG_PASSWORD',
]);

const WIZARD_WRITABLE_KEYS = [
  'WEA_STORAGE_BACKEND',
  'WEA_FILE_STORAGE',
  'PORT',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'WEA_PG_HOST',
  'WEA_PG_PORT',
  'WEA_PG_DATABASE',
  'WEA_PG_USER',
  'WEA_PG_PASSWORD',
  'WEA_PG_SSL',
  'WEA_PG_MAX',
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

const PG_REQUIRED_KEYS = [
  'WEA_PG_HOST',
  'WEA_PG_PORT',
  'WEA_PG_DATABASE',
  'WEA_PG_USER',
  'WEA_PG_PASSWORD',
];

const S3_REQUIRED_KEYS = ['S3_BUCKET', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];

const WEBDAV_REQUIRED_KEYS = ['WEBDAV_URL', 'WEBDAV_USERNAME', 'WEBDAV_PASSWORD'];

function metadataMissing(env) {
  if (env.WEA_STORAGE_BACKEND === 'postgresql') {
    return PG_REQUIRED_KEYS.filter((key) => !env[key]);
  }
  return [];
}

function fileMissing(env) {
  if (env.WEA_FILE_STORAGE === 'webdav') {
    return WEBDAV_REQUIRED_KEYS.filter((key) => !env[key]);
  }
  return S3_REQUIRED_KEYS.filter((key) => !env[key]);
}

function jwtMissing(env) {
  if (env.NODE_ENV !== 'production') return [];
  if (env.JWT_SECRET && env.JWT_SECRET !== DEFAULT_JWT_SECRET) return [];
  return ['JWT_SECRET'];
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
  const missingJwt = jwtMissing(view);
  return {
    setup_complete:
      missingMetadata.length === 0 && missingFile.length === 0 && missingJwt.length === 0,
    missing: [...missingMetadata, ...missingFile, ...missingJwt],
    current: buildCurrent(view),
  };
}

module.exports = { computeSetupStatus };
