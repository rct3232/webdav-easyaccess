'use strict';

/**
 * Backend connection-probe machinery shared by the setup wizard and the admin
 * config editor (POST /api/admin/config/test). Extracted from
 * server/domains/setup/routes.js so the classification + probes are reusable
 * without a setup-route dependency.
 *
 * Probe i18n codes are string literals in `serverErrors.setup.test.*` format
 * (NOT in shared/serverMessageCodes.js) so the client can translate them.
 */

const crypto = require('crypto');

const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { createError } = require('../utils/errorHandler');
const S3BlobStore = require('../infrastructure/adapters/blobstore/S3BlobStore');
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { testConnection: webdavTestConnection } = require('../infrastructure/webdavTest');

const SETUP_INVALID_PAYLOAD_CODE = 'serverErrors.setup.invalidPayload';
const SETUP_TEST_FAILED_CODE = 'serverErrors.setup.testFailed';
const SETUP_TEST_GENERIC_FAILED_CODE = 'serverErrors.setup.test.failed';
const SETUP_TEST_PG_UNREACHABLE_CODE = 'serverErrors.setup.test.pg.unreachable';
const SETUP_TEST_PG_AUTH_FAILED_CODE = 'serverErrors.setup.test.pg.authFailed';
const SETUP_TEST_PG_DATABASE_MISSING_CODE = 'serverErrors.setup.test.pg.databaseMissing';
const SETUP_TEST_S3_ACCESS_DENIED_CODE = 'serverErrors.setup.test.s3.accessDenied';
const SETUP_TEST_S3_BUCKET_MISSING_CODE = 'serverErrors.setup.test.s3.bucketMissing';
const SETUP_TEST_S3_UNREACHABLE_CODE = 'serverErrors.setup.test.s3.unreachable';

const PG_UNREACHABLE_CODES = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET'];
const S3_UNREACHABLE_CODES = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'];

const SECRET_MASK = '****';

function isMissing(value) {
  return value == null || String(value).trim() === '';
}

function pickField(payload, primary, aliases) {
  if (!isMissing(payload[primary])) return payload[primary];
  for (const alias of aliases) {
    if (!isMissing(payload[alias])) return payload[alias];
  }
  return undefined;
}

/**
 * The PG password may arrive masked ('****') when prefilled; a direct PG
 * connection then falls back to the app's process.env.WEA_PG_PASSWORD. A typed
 * (non-masked) password is always used verbatim.
 */
function resolvePgPassword(password) {
  return password === SECRET_MASK || isMissing(password) ? process.env.WEA_PG_PASSWORD : password;
}

function toShortReason(value) {
  if (value == null) return undefined;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > 200 ? text.slice(0, 200) : text;
}

function deriveReason(error) {
  if (!error) return undefined;
  const code = typeof error.code === 'string' && error.code ? error.code : '';
  if (code && error.address && error.port)
    return toShortReason(`${code} ${error.address}:${error.port}`);
  if (code) return toShortReason(code);
  if (typeof error.name === 'string' && error.name && error.name !== 'Error')
    return toShortReason(error.name);
  return toShortReason(error.message);
}

function isProbeSuccessError(error) {
  // Expected success path for the probe: the random probe key is absent, so the
  // API returns 404 (AWS/MinIO `NotFound`, or `NoSuchKey`). A 404 that names a
  // missing bucket (`NoSuchBucket`) is a real failure, not a successful probe.
  if (!error) return false;
  const status =
    Number(error.$metadata && error.$metadata.httpStatusCode) || error.status || error.statusCode;
  const name = `${error.name || ''} ${error.code || ''} ${error.message || ''}`;
  if (/nosuchbucket/i.test(name)) return false;
  if (status === 404) return true;
  return /(^|\s)(nosuchkey|notfound)(\s|$)/i.test(name);
}

function classifyPgError(error) {
  const code = String((error && (error.code || error.errno)) || '').toUpperCase();
  if (PG_UNREACHABLE_CODES.includes(code)) return SETUP_TEST_PG_UNREACHABLE_CODE;
  if (code === '28P01' || code === '28000') return SETUP_TEST_PG_AUTH_FAILED_CODE;
  if (code === '3D000') return SETUP_TEST_PG_DATABASE_MISSING_CODE;
  return SETUP_TEST_GENERIC_FAILED_CODE;
}

function classifyS3Error(error) {
  if (!error) return SETUP_TEST_GENERIC_FAILED_CODE;
  const status = Number(error.$metadata && error.$metadata.httpStatusCode);
  const name = String(error.name || error.code || '');
  const code = String(error.code || error.errno || '');
  if (status === 403 || /accessdenied/i.test(name)) return SETUP_TEST_S3_ACCESS_DENIED_CODE;
  if (/nosuchbucket/i.test(name)) return SETUP_TEST_S3_BUCKET_MISSING_CODE;
  if (S3_UNREACHABLE_CODES.includes(code)) return SETUP_TEST_S3_UNREACHABLE_CODE;
  return SETUP_TEST_GENERIC_FAILED_CODE;
}

function classifyS3BucketError(error) {
  // On ListObjectsV2 a 404 unambiguously means the bucket does not exist
  // (HeadObject's 404 is ambiguous on MinIO/S3), so both NotFound and
  // NoSuchBucket map to bucketMissing here.
  if (!error) return SETUP_TEST_GENERIC_FAILED_CODE;
  const status = Number(error.$metadata && error.$metadata.httpStatusCode);
  const name = String(error.name || error.code || '');
  const code = String(error.code || error.errno || '');
  if (status === 403 || /accessdenied/i.test(name)) return SETUP_TEST_S3_ACCESS_DENIED_CODE;
  if (status === 404 || /(nosuchbucket|notfound)/i.test(name))
    return SETUP_TEST_S3_BUCKET_MISSING_CODE;
  if (S3_UNREACHABLE_CODES.includes(code)) return SETUP_TEST_S3_UNREACHABLE_CODE;
  return SETUP_TEST_GENERIC_FAILED_CODE;
}

function probeError(errorCode, status, message, reason) {
  const err = createError(errorCode, status);
  err.message = message;
  if (reason) err.reason = reason;
  return err;
}

async function probePostgresql(payload) {
  const required = ['host', 'port', 'database', 'user', 'password'];
  const missing = required.filter((key) => isMissing(payload[key]));
  if (missing.length > 0) {
    throw probeError(
      SETUP_TEST_FAILED_CODE,
      HTTP_STATUS.BAD_REQUEST,
      `Missing required fields: ${missing.join(', ')}`
    );
  }

  let Client;
  try {
    ({ Client } = require('pg'));
  } catch (error) {
    throw probeError(
      SETUP_TEST_FAILED_CODE,
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      'pg module unavailable'
    );
  }

  const client = new Client({
    host: payload.host,
    port: Number(payload.port) || 5432,
    database: payload.database,
    user: payload.user,
    password: resolvePgPassword(payload.password),
    ssl: payload.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (error) {
    throw probeError(
      classifyPgError(error),
      HTTP_STATUS.BAD_REQUEST,
      'Connection test failed',
      deriveReason(error)
    );
  } finally {
    await client.end().catch(() => {});
  }

  return { ok: true };
}

async function probeS3(payload) {
  const accessKeyId = pickField(payload, 'accessKeyId', ['accessKey']);
  const secretAccessKey = pickField(payload, 'secretAccessKey', ['secretKey']);
  const missing = [];
  if (isMissing(payload.bucket)) missing.push('bucket');
  if (isMissing(payload.region)) missing.push('region');
  if (isMissing(accessKeyId)) missing.push('accessKeyId');
  if (isMissing(secretAccessKey)) missing.push('secretAccessKey');
  if (missing.length > 0) {
    throw probeError(
      SETUP_TEST_FAILED_CODE,
      HTTP_STATUS.BAD_REQUEST,
      `Missing required fields: ${missing.join(', ')}`
    );
  }

  const config = {
    bucket: payload.bucket,
    region: payload.region || 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
  };
  if (!isMissing(payload.endpoint)) config.endpoint = payload.endpoint;

  const store = new S3BlobStore(config);
  try {
    // Bucket existence + credentials: a ListObjectsV2 404 unambiguously means
    // the bucket is missing (HeadObject's 404 is ambiguous on MinIO/S3).
    await store.client.send(new ListObjectsV2Command({ Bucket: config.bucket, MaxKeys: 1 }));
  } catch (error) {
    throw probeError(
      classifyS3BucketError(error),
      HTTP_STATUS.BAD_REQUEST,
      'Connection test failed',
      deriveReason(error)
    );
  }
  try {
    // Object read path: the random probe key is absent, so a 404 is success.
    await store.headBlob(`__wea_setup_probe_${crypto.randomUUID()}`);
  } catch (error) {
    if (isProbeSuccessError(error)) return { ok: true };
    throw probeError(
      classifyS3Error(error),
      HTTP_STATUS.BAD_REQUEST,
      'Connection test failed',
      deriveReason(error)
    );
  }
  return { ok: true };
}

async function probeWebdav(payload) {
  const required = ['url', 'username', 'password'];
  const missing = required.filter((key) => isMissing(payload[key]));
  if (missing.length > 0) {
    throw probeError(
      SETUP_TEST_FAILED_CODE,
      HTTP_STATUS.BAD_REQUEST,
      `Missing required fields: ${missing.join(', ')}`
    );
  }

  const previous = {
    WEBDAV_URL: process.env.WEBDAV_URL,
    WEBDAV_USERNAME: process.env.WEBDAV_USERNAME,
    WEBDAV_PASSWORD: process.env.WEBDAV_PASSWORD,
    WEBDAV_AUTH_TYPE: process.env.WEBDAV_AUTH_TYPE,
  };
  process.env.WEBDAV_URL = String(payload.url);
  process.env.WEBDAV_USERNAME = String(payload.username);
  process.env.WEBDAV_PASSWORD = String(payload.password);
  if (!isMissing(payload.authType)) process.env.WEBDAV_AUTH_TYPE = String(payload.authType);

  try {
    await webdavTestConnection();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  return { ok: true };
}

async function runProbe(target, body) {
  if (target === 'postgresql') return probePostgresql(body);
  if (target === 's3') return probeS3(body);
  if (target === 'webdav') return probeWebdav(body);
  throw probeError(
    SETUP_TEST_FAILED_CODE,
    HTTP_STATUS.BAD_REQUEST,
    `Unsupported target: ${String(target)}`
  );
}

/**
 * Map a probe/error i18n code (or a shared server-error code) to the stable
 * health category used by the backend-health tracker.
 *
 * @param {'postgresql'|'s3'|'webdav'} backend
 * @param {string} [i18nCode]
 * @returns {'unreachable'|'auth'|'missing_resource'|'unknown'}
 */
function classifyToHealthCode(backend, i18nCode) {
  if (!i18nCode) return 'unknown';
  if (backend === 'postgresql') {
    if (i18nCode === SETUP_TEST_PG_UNREACHABLE_CODE) return 'unreachable';
    if (i18nCode === SETUP_TEST_PG_AUTH_FAILED_CODE) return 'auth';
    if (i18nCode === SETUP_TEST_PG_DATABASE_MISSING_CODE) return 'missing_resource';
    return 'unknown';
  }
  if (backend === 's3') {
    if (i18nCode === SETUP_TEST_S3_UNREACHABLE_CODE) return 'unreachable';
    if (i18nCode === SETUP_TEST_S3_ACCESS_DENIED_CODE) return 'auth';
    if (i18nCode === SETUP_TEST_S3_BUCKET_MISSING_CODE) return 'missing_resource';
    return 'unknown';
  }
  if (backend === 'webdav') {
    const code = i18nCode.split('.').pop();
    if (
      code === 'connectionRefused' ||
      code === 'serverNotResponding' ||
      code === 'cannotConnect' ||
      code === 'allConnectionAttemptsFailed'
    ) {
      return 'unreachable';
    }
    if (code === 'credentialsNotConfigured') return 'auth';
    if (code === 'pathNotFound' || code === 'sourceNotFound' || code === 'fileOrFolderNotFound') {
      return 'missing_resource';
    }
    return 'unknown';
  }
  return 'unknown';
}

module.exports = {
  SETUP_INVALID_PAYLOAD_CODE,
  SETUP_TEST_FAILED_CODE,
  SETUP_TEST_GENERIC_FAILED_CODE,
  SETUP_TEST_PG_UNREACHABLE_CODE,
  SETUP_TEST_PG_AUTH_FAILED_CODE,
  SETUP_TEST_PG_DATABASE_MISSING_CODE,
  SETUP_TEST_S3_ACCESS_DENIED_CODE,
  SETUP_TEST_S3_BUCKET_MISSING_CODE,
  SETUP_TEST_S3_UNREACHABLE_CODE,
  isMissing,
  pickField,
  resolvePgPassword,
  toShortReason,
  deriveReason,
  probeError,
  classifyPgError,
  classifyS3Error,
  classifyS3BucketError,
  classifyToHealthCode,
  runProbe,
};
