'use strict';

/**
 * Shared env↔DB config-sync algorithm core.
 *
 * Implements the classification / reconcile algorithm described in
 * docs/features/config-sync.md. The callers supply the env source, so the same
 * code drives both operator surfaces:
 *
 *   - CLI (server/scripts/configSync.js): envValueOf = process.env after the
 *     on-disk .env file was loaded (loadDotenv), matching the old inline logic;
 *   - admin web action (server/domains/admin/routes/config.js): envValueOf built
 *     from the config resolver's `source: 'env'` classification over the running
 *     process.env (never reads the .env file on disk).
 *
 * T0 registry keys are never reported or written; DB rows are never deleted.
 * Secrets are encrypted under the caller-supplied master key
 * (process.env.encrypt_secret_key on both surfaces).
 *
 * @see docs/features/config-sync.md
 */

const { getEntries, isT0 } = require('../../../infrastructure/configRegistry');
const {
  encryptSecret,
  decryptSecret,
  isEncryptedPayload,
} = require('../../../utils/configEncryption');

/**
 * Thrown by syncConfigSyncEnv when a write would be required for an env-set
 * secret target while the master key is absent. Nothing is written.
 */
class ConfigSyncAbortError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigSyncAbortError';
    this.code = 'CONFIG_SYNC_NO_MASTER_KEY';
  }
}

function isEnvSet(value) {
  return value !== undefined && value !== null && String(value) !== '';
}

function tryJsonParse(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function isEncryptedRowValue(raw) {
  return isEncryptedPayload(tryJsonParse(raw));
}

function decryptRow(raw, masterKey) {
  if (!masterKey) return null;
  const parsed = tryJsonParse(raw);
  if (!isEncryptedPayload(parsed)) return null;
  try {
    return decryptSecret(parsed, masterKey);
  } catch {
    return null;
  }
}

// Normalize updated_at (pg Date object or sqlite 'YYYY-MM-DD HH:MM:SS' UTC
// string) to an ISO string for the report.
function toIsoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const str = String(value);
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    return new Date(
      Date.UTC(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6])
      )
    ).toISOString();
  }
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? str : parsed.toISOString();
}

/**
 * Classify one non-T0 registry key against its env value and DB row.
 * @returns {{ status: string, dbUpdatedAt: (string|null) }|undefined}
 *   undefined when set in neither env nor DB (silent)
 */
function classifyEntry(entry, envValue, dbRow, masterKey) {
  const envSet = isEnvSet(envValue);
  const dbUpdatedAt = dbRow ? toIsoTimestamp(dbRow.updated_at) : null;

  if (envSet && !dbRow) {
    return { status: 'env-only', dbUpdatedAt: null };
  }
  if (!envSet) {
    if (!dbRow) return undefined; // set in neither env nor DB: default-governed, silent
    // D1: db-only is normal; but an encrypted row that cannot be decrypted is
    // a key-lost alert regardless of env presence.
    if (isEncryptedRowValue(dbRow.value)) {
      const decrypted = decryptRow(dbRow.value, masterKey);
      if (decrypted === null) return { status: 'key-lost', dbUpdatedAt };
    }
    return { status: 'db-only', dbUpdatedAt };
  }
  if (entry.secret) {
    if (isEncryptedRowValue(dbRow.value)) {
      const decrypted = decryptRow(dbRow.value, masterKey);
      if (decrypted === null) return { status: 'key-lost', dbUpdatedAt };
      return { status: decrypted === String(envValue) ? 'shadowed' : 'differs', dbUpdatedAt };
    }
  }
  return { status: String(dbRow.value) === String(envValue) ? 'shadowed' : 'differs', dbUpdatedAt };
}

/**
 * Build the drift report over the non-T0 registry universe.
 *
 * @param {{ settings: { listRows: Function }, envValueOf: Function, masterKey: (string|null|undefined) }} params
 *   - settings: a store exposing listRows() (the app's Settings model)
 *   - envValueOf: (key) => env value or undefined (the surface's env source)
 *   - masterKey: process.env.encrypt_secret_key of the surface (may be absent)
 * @returns {Promise<{ findings: object[], summary: object, exitCode: number }>}
 */
async function buildConfigSyncReport({ settings, envValueOf, masterKey }) {
  const rows = await settings.listRows();
  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  const findings = [];
  for (const entry of getEntries()) {
    if (isT0(entry.key)) continue;
    const result = classifyEntry(entry, envValueOf(entry.key), rowByKey.get(entry.key), masterKey);
    if (!result) continue; // set in neither env nor DB: silent
    findings.push({
      key: entry.key,
      status: result.status,
      secret: Boolean(entry.secret),
      dbUpdatedAt: result.dbUpdatedAt,
    });
  }
  const count = (target) => findings.filter((f) => f.status === target).length;
  const summary = {
    drift: count('differs'),
    alerts: count('key-lost'),
    shadowed: count('shadowed'),
    envOnly: count('env-only'),
    dbOnly: count('db-only'),
    total: findings.length,
  };
  const exitCode = summary.drift + summary.alerts > 0 ? 1 : 0;
  return { findings, summary, exitCode };
}

/**
 * Reconcile DB rows to mirror the env source for every env-set non-T0 registry
 * key, then re-run the report in-process.
 *
 * Uses the same write path as the admin config route (plaintext via
 * Settings.set(key, String(value)); secrets via Settings.set(key,
 * JSON.stringify(encryptSecret(value, masterKey)))). Never writes T0 keys and
 * never deletes rows. Aborts with ConfigSyncAbortError before any write when an
 * env-set secret target exists but the master key is absent.
 *
 * @param {{ settings: { listRows: Function, set: Function }, envValueOf: Function, masterKey: (string|null|undefined) }} params
 * @returns {Promise<{ writes: object[], report: object }>}
 */
async function syncConfigSyncEnv({ settings, envValueOf, masterKey }) {
  const targets = getEntries().filter(
    (entry) => !isT0(entry.key) && isEnvSet(envValueOf(entry.key))
  );
  if (targets.some((entry) => entry.secret) && !isEnvSet(masterKey)) {
    throw new ConfigSyncAbortError(
      'a secret key is set in .env but encrypt_secret_key is absent; refusing to write ' +
        'unencrypted or without a master key (DB unchanged).'
    );
  }

  const rowByKey = new Map((await settings.listRows()).map((row) => [row.key, row]));
  const writes = [];

  for (const entry of targets) {
    const envValue = String(envValueOf(entry.key));
    const dbRow = rowByKey.get(entry.key);
    let same = false;
    if (dbRow) {
      if (entry.secret && isEncryptedRowValue(dbRow.value)) {
        same = decryptRow(dbRow.value, masterKey) === envValue;
      } else {
        same = String(dbRow.value) === envValue;
      }
    }
    if (same) {
      writes.push({ key: entry.key, secret: Boolean(entry.secret), status: 'unchanged' });
      continue;
    }
    if (entry.secret) {
      await settings.set(entry.key, JSON.stringify(encryptSecret(envValue, masterKey)));
    } else {
      await settings.set(entry.key, envValue);
    }
    writes.push({ key: entry.key, secret: Boolean(entry.secret), status: 'updated' });
  }

  const report = await buildConfigSyncReport({ settings, envValueOf, masterKey });
  return { writes, report };
}

module.exports = {
  buildConfigSyncReport,
  syncConfigSyncEnv,
  ConfigSyncAbortError,
};
