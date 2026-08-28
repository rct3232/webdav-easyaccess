'use strict';

const crypto = require('crypto');
const path = require('path');
const express = require('express');

const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { asyncHandler, createError } = require('../../utils/errorHandler');
const { encryptSecret, isEncryptedPayload, generateKey } = require('../../utils/configEncryption');
const { computeSetupStatus } = require('../../infrastructure/setupStatus');
const { resolveEnvPath } = require('../../infrastructure/envPath');
const { writeEnv } = require('../../infrastructure/envFileWriter');
const { isT0, isSecret, getDefault, TIER } = require('../../infrastructure/configRegistry');
const { getSharedResolver } = require('../../infrastructure/configResolver');
const { testConnection: webdavTestConnection } = require('../../infrastructure/webdavTest');
const S3BlobStore = require('../../infrastructure/adapters/blobstore/S3BlobStore');
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
const User = require('../../models/User');
const Settings = require('../../models/Settings');

// Mount base for the resolved env file must match server/index.js:10-12, which
// resolves against the server root (__dirname of index.js). The routes module
// lives at <server>/domains/setup, so the server root is two levels up.
const SERVER_ROOT = path.join(__dirname, '..', '..');

// Error codes for payload/validation and connection-test failures. The spec's
// official additions (setup.incomplete / setup.complete) live in
// shared/serverMessageCodes.js; these are module-local i18n keys in the same
// `ns.key` format so the client can translate them.
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

const METADATA_KEYS = ['backend', 'host', 'port', 'database', 'user', 'password', 'ssl', 'max'];
const S3_KEYS = [
  'backend',
  'bucket',
  'region',
  'accessKeyId',
  'secretAccessKey',
  'endpoint',
  'accessKey',
  'secretKey',
];
const WEBDAV_KEYS = ['backend', 'url', 'username', 'password', 'authType'];
const ADMIN_KEYS = ['password'];
const JWT_KEYS = ['secret', 'expiresIn'];
const SERVER_KEYS = ['port', 'corsOrigins'];
const EMAIL_KEYS = ['host', 'port', 'user', 'password', 'secure', 'fromName'];

const FILE_KEYS_UNION = [...new Set([...S3_KEYS, ...WEBDAV_KEYS])];
const TOP_LEVEL_KEYS = ['metadata', 'file', 'admin', 'jwt', 'server', 'email'];

// keep in sync with 001_initial_normalized_schema.sql
const SETTINGS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

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

function isBooleanish(value) {
  if (typeof value === 'boolean') return true;
  if (typeof value !== 'string') return false;
  return ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(value.trim().toLowerCase());
}

function booleanToString(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase()) ? 'true' : 'false';
}

function isPositiveInteger(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1;
  if (typeof value === 'string') return /^\d+$/.test(value.trim()) && Number(value.trim()) >= 1;
  return false;
}

function isValidPort(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1 && value <= 65535;
  if (typeof value === 'string') {
    return /^\d+$/.test(value.trim()) && Number(value.trim()) >= 1 && Number(value.trim()) <= 65535;
  }
  return false;
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

/**
 * Records unknown keys and validates that a block is a plain object.
 * @returns {boolean} true when the block is a usable object (caller may continue)
 */
function validateBlockObject(block, allowedKeys, prefix, fields) {
  if (block == null) {
    fields[prefix] = 'required';
    return false;
  }
  if (typeof block !== 'object' || Array.isArray(block)) {
    fields[prefix] = 'invalid';
    return false;
  }
  for (const key of Object.keys(block)) {
    if (!allowedKeys.includes(key)) fields[`${prefix}.${key}`] = 'unknown';
  }
  return true;
}

function validateMetadata(block, fields) {
  if (!validateBlockObject(block, METADATA_KEYS, 'metadata', fields)) return;
  if (isMissing(block.backend)) {
    fields['metadata.backend'] = 'required';
    return;
  }
  if (block.backend !== 'sqlite' && block.backend !== 'postgresql') {
    fields['metadata.backend'] = 'invalid';
    return;
  }
  if (block.backend === 'postgresql') {
    for (const key of ['host', 'port', 'database', 'user', 'password']) {
      if (isMissing(block[key])) fields[`metadata.${key}`] = 'required';
    }
  }
  if (block.ssl !== undefined && !isBooleanish(block.ssl)) fields['metadata.ssl'] = 'invalid';
  if (block.max !== undefined && !isPositiveInteger(block.max)) fields['metadata.max'] = 'invalid';
}

function validateFile(block, fields) {
  if (!validateBlockObject(block, FILE_KEYS_UNION, 'file', fields)) return;
  if (isMissing(block.backend)) {
    fields['file.backend'] = 'required';
    return;
  }
  if (block.backend === 's3') {
    for (const key of Object.keys(block)) {
      if (key !== 'backend' && !S3_KEYS.includes(key)) fields[`file.${key}`] = 'unknown';
    }
    if (isMissing(block.bucket)) fields['file.bucket'] = 'required';
    if (isMissing(block.region)) fields['file.region'] = 'required';
    if (isMissing(pickField(block, 'accessKeyId', ['accessKey'])))
      fields['file.accessKeyId'] = 'required';
    if (isMissing(pickField(block, 'secretAccessKey', ['secretKey'])))
      fields['file.secretAccessKey'] = 'required';
  } else if (block.backend === 'webdav') {
    for (const key of Object.keys(block)) {
      if (key !== 'backend' && !WEBDAV_KEYS.includes(key)) fields[`file.${key}`] = 'unknown';
    }
    for (const key of ['url', 'username', 'password']) {
      if (isMissing(block[key])) fields[`file.${key}`] = 'required';
    }
  } else {
    fields['file.backend'] = 'invalid';
  }
}

function validateAdmin(block, fields) {
  if (!validateBlockObject(block, ADMIN_KEYS, 'admin', fields)) return;
  if (isMissing(block.password)) fields['admin.password'] = 'required';
}

function validateJwt(block, fields) {
  if (!validateBlockObject(block, JWT_KEYS, 'jwt', fields)) return;
  if (isMissing(block.secret)) fields['jwt.secret'] = 'required';
}

function validateServer(block, fields) {
  if (block == null) return;
  if (!validateBlockObject(block, SERVER_KEYS, 'server', fields)) return;
  if (block.port !== undefined && String(block.port).trim() !== '' && !isValidPort(block.port))
    fields['server.port'] = 'invalid';
}

function validateEmail(block, fields) {
  if (block == null) return;
  if (!validateBlockObject(block, EMAIL_KEYS, 'email', fields)) return;
  if (block.port !== undefined && String(block.port).trim() !== '' && !isValidPort(block.port))
    fields['email.port'] = 'invalid';
  if (block.secure !== undefined && !isBooleanish(block.secure)) fields['email.secure'] = 'invalid';
}

function validateApplyPayload(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      errorCode: SETUP_INVALID_PAYLOAD_CODE,
      message: 'Invalid setup payload',
      fields: { body: 'invalid' },
    };
  }

  const fields = {};
  for (const key of Object.keys(body)) {
    if (!TOP_LEVEL_KEYS.includes(key)) fields[key] = 'unknown';
  }

  validateMetadata(body.metadata, fields);
  validateFile(body.file, fields);
  validateAdmin(body.admin, fields);
  validateJwt(body.jwt, fields);
  validateServer(body.server, fields);
  validateEmail(body.email, fields);

  if (Object.keys(fields).length === 0) return null;
  return {
    errorCode: SETUP_INVALID_PAYLOAD_CODE,
    message: 'Invalid setup payload',
    fields,
  };
}

function buildEnvEntries(body) {
  const entries = {};
  const { metadata, file, jwt } = body;

  entries.WEA_STORAGE_BACKEND = String(metadata.backend);
  if (metadata.backend === 'postgresql') {
    entries.WEA_PG_HOST = String(metadata.host);
    entries.WEA_PG_PORT = String(metadata.port);
    entries.WEA_PG_DATABASE = String(metadata.database);
    entries.WEA_PG_USER = String(metadata.user);
    entries.WEA_PG_PASSWORD = String(metadata.password);
    if (metadata.ssl !== undefined) entries.WEA_PG_SSL = booleanToString(metadata.ssl);
    if (metadata.max !== undefined) entries.WEA_PG_MAX = String(metadata.max);
  }

  entries.WEA_FILE_STORAGE = String(file.backend);
  if (file.backend === 's3') {
    entries.S3_BUCKET = String(file.bucket);
    entries.AWS_REGION = String(file.region);
    entries.AWS_ACCESS_KEY_ID = String(pickField(file, 'accessKeyId', ['accessKey']));
    entries.AWS_SECRET_ACCESS_KEY = String(pickField(file, 'secretAccessKey', ['secretKey']));
    if (!isMissing(file.endpoint)) entries.S3_ENDPOINT = String(file.endpoint);
  } else {
    entries.WEBDAV_URL = String(file.url);
    entries.WEBDAV_USERNAME = String(file.username);
    entries.WEBDAV_PASSWORD = String(file.password);
    if (!isMissing(file.authType)) entries.WEBDAV_AUTH_TYPE = String(file.authType);
  }

  entries.JWT_SECRET = String(jwt.secret);
  if (!isMissing(jwt.expiresIn)) entries.JWT_EXPIRES_IN = String(jwt.expiresIn);

  if (body.server != null) {
    if (body.server.port !== undefined && String(body.server.port).trim() !== '') {
      entries.PORT = String(body.server.port);
    }
    if (!isMissing(body.server.corsOrigins)) entries.CORS_ORIGINS = String(body.server.corsOrigins);
  }

  if (body.email != null) {
    const { email } = body;
    if (!isMissing(email.host)) entries.EMAIL_HOST = String(email.host);
    if (!isMissing(email.port)) entries.EMAIL_PORT = String(email.port);
    if (!isMissing(email.user)) entries.EMAIL_USER = String(email.user);
    if (!isMissing(email.password)) entries.EMAIL_PASSWORD = String(email.password);
    if (email.secure !== undefined) entries.EMAIL_SECURE = booleanToString(email.secure);
    if (!isMissing(email.fromName)) entries.EMAIL_FROM_NAME = String(email.fromName);
  }

  return entries;
}

/**
 * Split the full entries map into the T0 subset that must be written to .env
 * (PLAN §2 D2/D3/D4/D7 — startup-critical, .env-only) and everything else,
 * which is upserted into the metadata DB `settings` table (D11; row key = the
 * raw env var name). Classification comes from the config registry, never a
 * local allowlist, so the wizard cannot drift from the tier model.
 */
function partitionEntries(entries) {
  const envEntries = {};
  const dbEntries = {};
  for (const [key, value] of Object.entries(entries)) {
    if (isT0(key)) envEntries[key] = value;
    else dbEntries[key] = value;
  }
  return { envEntries, dbEntries };
}

function encryptSecretValue(value, masterKey) {
  return JSON.stringify(encryptSecret(String(value), masterKey));
}

const EFFECTIVE_SECRET_MASK = '****';

/**
 * getEffectiveConfig() masks every secret as '****' — even one that resolves to
 * nothing (no env value, no DB row, no built-in default; configResolver spec
 * §2.6). setupStatus's presence checks run on the merged view, so an absent
 * required secret would be treated as present and dropped from `missing`.
 * Drop the mask for secrets that are genuinely unset — a T0 secret with no env
 * value (env-only source), or a DB-fallback secret with no env/DB/default — so
 * the effective view drives `missing` / `setup_complete` / `current` correctly
 * (Q1b).
 */
function normalizeEffectiveForStatus(effective) {
  const out = { ...effective };
  for (const [key, meta] of Object.entries(effective)) {
    if (!meta.secret || meta.value !== EFFECTIVE_SECRET_MASK) continue;
    const t0Unset = meta.tier === TIER.T0 && !process.env[key];
    const dbUnset = meta.source === 'default' && getDefault(key) === undefined;
    if (t0Unset || dbUnset) out[key] = { ...meta, value: undefined };
  }
  return out;
}

/**
 * Upsert non-T0 wizard values into the metadata DB.
 *
 * - sqlite: write through the app's own Settings model (plaintext config as-is;
 *   the store JSON-stringifies on PG / stores raw TEXT on sqlite; a secret is
 *   the JSON string of the encrypted payload).
 * - postgresql: connect DIRECTLY to the target PG with the entered credentials
 *   (the app's pool does not exist yet), ensure the `settings` table via the
 *   same idempotent DDL as 001_initial_normalized_schema.sql, and upsert each
 *   row. Plaintext rows store `JSON.stringify(String(value))` (e.g.
 *   `"smtp.gmail.com"`); secret rows store the encrypted payload object as JSON
 *   — both mirroring settingsStore.set so the resolver reads them identically.
 */
async function writeSettings(metadata, dbEntries, masterKey) {
  if (metadata.backend === 'postgresql') {
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
      host: metadata.host,
      port: Number(metadata.port) || 5432,
      database: metadata.database,
      user: metadata.user,
      password: metadata.password,
      ssl: metadata.ssl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 5000,
    });

    try {
      await client.connect();
      await client.query(SETTINGS_TABLE_DDL);
      for (const [key, value] of Object.entries(dbEntries)) {
        const stored = isSecret(key)
          ? encryptSecretValue(value, masterKey)
          : JSON.stringify(String(value));
        await client.query(
          `INSERT INTO settings (key, value, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (key)
           DO UPDATE
             SET value = EXCLUDED.value,
                 updated_at = NOW()`,
          [key, stored]
        );
      }
    } finally {
      await client.end().catch(() => {});
    }
    return;
  }

  for (const [key, value] of Object.entries(dbEntries)) {
    if (isSecret(key)) await Settings.set(key, encryptSecretValue(value, masterKey));
    else await Settings.set(key, value);
  }
}

async function updateAdminPassword(password) {
  const admin = await User.findByUsername('admin');
  if (!admin) {
    console.warn(
      '[setup] admin user not found; skipping direct password update (default credential applies on next boot)'
    );
    return;
  }
  await User.updatePassword(admin.id, password);
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
    password: payload.password,
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

async function requireSetupIncomplete(req, res, next) {
  try {
    const effective = await getSharedResolver().getEffectiveConfig();
    const { setup_complete } = computeSetupStatus(process.env, {
      effectiveConfig: normalizeEffectiveForStatus(effective),
    });
    if (setup_complete) {
      return next(createError(SERVER_ERROR_CODES.setup.complete, HTTP_STATUS.FORBIDDEN));
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

const router = express.Router();

// GET /api/setup/status — public, always available.
router.get('/status', asyncHandler(async (req, res) => {
  const effective = await getSharedResolver().getEffectiveConfig();
  const status = computeSetupStatus(process.env, {
    effectiveConfig: normalizeEffectiveForStatus(effective),
  });

  // key-lost warning (PLAN §7): an encrypted DB secret row cannot be
  // decrypted/prefilled without the master key. Detection is shape-only — this
  // path never decrypts, so prefill cannot leak plaintext.
  const all = await Settings.getAll();
  const hasEncryptedRows = Object.values(all).some((raw) => {
    let parsed = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    }
    return isEncryptedPayload(parsed);
  });

  res.json({
    ...status,
    key_lost_warning: Boolean(hasEncryptedRows && !process.env.encrypt_secret_key),
  });
}));

// POST /api/setup/test — public; 403 setup.complete when already complete.
router.post(
  '/test',
  requireSetupIncomplete,
  asyncHandler(async (req, res) => {
    try {
      const body = req.body || {};
      const result = await runProbe(body.target, body);
      res.json(result);
    } catch (error) {
      const status = error.status || error.statusCode || HTTP_STATUS.BAD_REQUEST;
      const message =
        error.message && error.message !== error.errorCode
          ? error.message
          : 'Connection test failed';
      const reason = toShortReason(error.reason || (error.params && error.params.reason));
      res.status(status).json({
        ok: false,
        errorCode: error.errorCode || SETUP_TEST_FAILED_CODE,
        message,
        ...(reason ? { reason } : {}),
      });
    }
  })
);

// POST /api/setup/apply — public; 403 when already complete.
router.post(
  '/apply',
  requireSetupIncomplete,
  asyncHandler(async (req, res) => {
    const validation = validateApplyPayload(req.body);
    if (validation) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json(validation);
    }

    const body = req.body;
    const entries = buildEnvEntries(body);
    const { envEntries, dbEntries } = partitionEntries(entries);

    // encrypt_secret_key lifecycle (PLAN §7): keep an existing key — never
    // regenerate it and never write it to .env. Only auto-generate when none
    // exists; the generated key is T0 / .env-only and used to encrypt this
    // apply's DB secrets.
    const masterKey = process.env.encrypt_secret_key || generateKey();
    if (!process.env.encrypt_secret_key) envEntries.encrypt_secret_key = masterKey;

    if (body.metadata.backend === 'postgresql') {
      dbEntries.ADMIN_DEFAULT_PASSWORD = String(body.admin.password);
    } else {
      await updateAdminPassword(String(body.admin.password));
    }

    await writeSettings(body.metadata, dbEntries, masterKey);

    const envPath = resolveEnvPath(SERVER_ROOT);
    writeEnv(envPath, envEntries);

    // Clear the shared T2 cache so the DB writes are visible to restart-free
    // (T2) reads immediately after this apply.
    getSharedResolver().invalidateCache();

    res.json({ restart_required: true });
  })
);

module.exports = router;
