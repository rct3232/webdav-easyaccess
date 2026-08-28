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
      current[key] = value || '';
    }
  }
  return current;
}

function computeSetupStatus(env = {}) {
  const missingMetadata = metadataMissing(env);
  const missingFile = fileMissing(env);
  const missingJwt = jwtMissing(env);
  return {
    setup_complete:
      missingMetadata.length === 0 && missingFile.length === 0 && missingJwt.length === 0,
    missing: [...missingMetadata, ...missingFile, ...missingJwt],
    current: buildCurrent(env),
  };
}

module.exports = { computeSetupStatus };
