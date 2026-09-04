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
 * DB settings rows hold plaintext strings (secret values included), so every
 * value comparison is a plaintext string comparison. T0 registry keys are
 * never reported or written; DB rows are never deleted.
 *
 * @see docs/features/config-sync.md
 */

const { getEntries, isT0 } = require('../../../infrastructure/configRegistry');

function isEnvSet(value) {
  return value !== undefined && value !== null && String(value) !== '';
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
function classifyEntry(entry, envValue, dbRow) {
  const envSet = isEnvSet(envValue);
  const dbUpdatedAt = dbRow ? toIsoTimestamp(dbRow.updated_at) : null;

  if (envSet && !dbRow) {
    return { status: 'env-only', dbUpdatedAt: null };
  }
  if (!envSet) {
    if (!dbRow) return undefined; // set in neither env nor DB: default-governed, silent
    return { status: 'db-only', dbUpdatedAt }; // D1: db-only is normal
  }
  // Secrets and plaintext keys are compared as plaintext strings.
  return { status: String(dbRow.value) === String(envValue) ? 'shadowed' : 'differs', dbUpdatedAt };
}

/**
 * Build the drift report over the non-T0 registry universe.
 *
 * @param {{ settings: { listRows: Function }, envValueOf: Function }} params
 *   - settings: a store exposing listRows() (the app's Settings model)
 *   - envValueOf: (key) => env value or undefined (the surface's env source)
 * @returns {Promise<{ findings: object[], summary: object, exitCode: number }>}
 */
async function buildConfigSyncReport({ settings, envValueOf }) {
  const rows = await settings.listRows();
  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  const findings = [];
  for (const entry of getEntries()) {
    if (isT0(entry.key)) continue;
    const result = classifyEntry(entry, envValueOf(entry.key), rowByKey.get(entry.key));
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
    shadowed: count('shadowed'),
    envOnly: count('env-only'),
    dbOnly: count('db-only'),
    total: findings.length,
  };
  const exitCode = summary.drift > 0 ? 1 : 0;
  return { findings, summary, exitCode };
}

/**
 * Reconcile DB rows to mirror the env source for every env-set non-T0 registry
 * key, then re-run the report in-process.
 *
 * Uses the same write path as the admin config route: every key — secret or
 * not — is written as plaintext via Settings.set(key, String(envValue)). Never
 * writes T0 keys and never deletes rows.
 *
 * @param {{ settings: { listRows: Function, set: Function }, envValueOf: Function }} params
 * @returns {Promise<{ writes: object[], report: object }>}
 */
async function syncConfigSyncEnv({ settings, envValueOf }) {
  const targets = getEntries().filter(
    (entry) => !isT0(entry.key) && isEnvSet(envValueOf(entry.key))
  );

  const rowByKey = new Map((await settings.listRows()).map((row) => [row.key, row]));
  const writes = [];

  for (const entry of targets) {
    const envValue = String(envValueOf(entry.key));
    const dbRow = rowByKey.get(entry.key);
    const same = dbRow && String(dbRow.value) === envValue;
    if (same) {
      writes.push({ key: entry.key, secret: Boolean(entry.secret), status: 'unchanged' });
      continue;
    }
    await settings.set(entry.key, envValue);
    writes.push({ key: entry.key, secret: Boolean(entry.secret), status: 'updated' });
  }

  const report = await buildConfigSyncReport({ settings, envValueOf });
  return { writes, report };
}

module.exports = {
  buildConfigSyncReport,
  syncConfigSyncEnv,
};
