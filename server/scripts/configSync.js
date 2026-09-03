'use strict';

/**
 * env↔DB config sync/alert CLI.
 *
 * Detects drift between the .env values and the metadata DB `settings` rows
 * for every non-T0 config-registry key, reports it (default `--check` mode,
 * exit 1 on drift or key-loss alerts), and optionally reconciles the DB rows
 * to mirror .env (`--apply --yes`). T0 keys are .env-owned and are never
 * reported or written; DB rows are never deleted.
 *
 * @see docs/features/config-sync.md
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const { resolveEnvPath } = require('../infrastructure/envPath');
const { getEntries, isT0, isSecret } = require('../infrastructure/configRegistry');
const {
  encryptSecret,
  decryptSecret,
  isEncryptedPayload,
} = require('../utils/configEncryption');
const Settings = require('../models/Settings');
const { PG_REQUIRED_KEYS } = require('../infrastructure/setupStatus');
const { initMetadataSchema } = require('../store/bootstrap');

// This file lives in <server>/scripts, so the server root is one level up —
// must match server/index.js:10-12 for resolveEnvPath.
const SERVER_ROOT = path.join(__dirname, '..');

const SECRET_MASK = '****';

const BOOLEAN_FLAGS = new Set(['help', 'check', 'apply', 'yes', 'json']);

const USAGE = `
Usage:
  node server/scripts/configSync.js [--check] [--json]       drift report (read-only; default mode)
  node server/scripts/configSync.js --apply --yes [--json]   reconcile DB rows to mirror .env
  node server/scripts/configSync.js --help                   print this reference

Flags:
  --check   report .env vs DB settings drift (default mode, read-only)
  --json    emit a machine-readable JSON report instead of human-readable lines
  --apply   write mode: upsert a DB row for every non-T0 registry key set in
            .env so it mirrors .env (secrets re-encrypted under encrypt_secret_key);
            requires --yes
  --yes     confirm --apply writes; without it the run is a usage error (exit 2)

Scope and safety:
  - only non-T0 config-registry keys (server/infrastructure/configRegistry.js)
    are compared or written; T0 keys are .env-only and excluded from the report
  - .env always wins (D1): a DB row under an env-set key is a shadow copy
  - DB rows are never deleted; secrets are always masked (****) in output
  - encrypted DB rows without a usable encrypt_secret_key are reported as
    key-lost alerts (exit 1); their values are never shown

Exit codes:
  0 no drift and no alerts (or --apply completed with a clean post-apply check)
  1 drift or key-lost alert found, or apply aborted/failed
  2 usage error (unknown flag, --apply without --yes)
`;

class UsageError extends Error {}

function isTruthy(value) {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function isEnvSet(value) {
  return value !== undefined && value !== null && String(value) !== '';
}

function describeError(error) {
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return String(error);
}

function parseFlags(argv) {
  const bools = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const raw = eq === -1 ? true : arg.slice(eq + 1);
    if (!BOOLEAN_FLAGS.has(name)) {
      throw new UsageError(`Unknown flag: --${name}`);
    }
    bools[name] = raw === true ? true : isTruthy(raw);
  }
  return bools;
}

// Load the app's env file exactly like server/index.js — the CLI resolves the
// same DOTENV_CONFIG_PATH-aware path the server boot reads. Must run before
// any store call (backend selection reads process.env).
function loadDotenv() {
  const envPath = resolveEnvPath(SERVER_ROOT);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  } else {
    dotenv.config();
  }
}

// Boot subset of server/index.js runBoot: PG required-key pre-check, then the
// schema only (no default-admin seeding).
async function bootStore() {
  const { getBackend } = require('../store/storage');
  if (getBackend() === 'postgresql') {
    const missing = PG_REQUIRED_KEYS.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(
        `WEA_STORAGE_BACKEND=postgresql requires ${missing.join(', ')} in env/.env. Aborting.`
      );
    }
  }
  await initMetadataSchema();
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
 * Classify one non-T0 registry key against env and its DB row.
 * @returns {{ status: string, dbUpdatedAt: (string|null) }|undefined} undefined when set in neither env nor DB (silent)
 */
function classify(entry, dbRow) {
  const envValue = process.env[entry.key];
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
      const decrypted = decryptRow(dbRow.value, process.env.encrypt_secret_key);
      if (decrypted === null) return { status: 'key-lost', dbUpdatedAt };
    }
    return { status: 'db-only', dbUpdatedAt };
  }
  const masterKey = process.env.encrypt_secret_key;
  if (entry.secret) {
    if (isEncryptedRowValue(dbRow.value)) {
      const decrypted = decryptRow(dbRow.value, masterKey);
      if (decrypted === null) return { status: 'key-lost', dbUpdatedAt };
      return { status: decrypted === String(envValue) ? 'shadowed' : 'differs', dbUpdatedAt };
    }
  }
  return { status: String(dbRow.value) === String(envValue) ? 'shadowed' : 'differs', dbUpdatedAt };
}

async function buildReport() {
  const rows = await Settings.listRows();
  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  const findings = [];
  for (const entry of getEntries()) {
    if (isT0(entry.key)) continue;
    const result = classify(entry, rowByKey.get(entry.key));
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

function renderCheck(output, report, json) {
  if (json) {
    output.log(JSON.stringify({ findings: report.findings, summary: report.summary, exitCode: report.exitCode }, null, 2));
    return;
  }
  output.log('configSync: .env vs DB settings (non-T0 registry keys)');
  const groups = [
    ['DRIFT', ['differs']],
    ['ALERTS', ['key-lost']],
    ['INFORMATIONAL', ['shadowed', 'env-only', 'db-only']],
  ];
  for (const [label, statuses] of groups) {
    const items = report.findings.filter((f) => statuses.includes(f.status));
    if (items.length === 0) continue;
    output.log(`${label}:`);
    for (const f of items) {
      let line = `  ${f.status.padEnd(10)} ${f.key}`;
      if (f.secret) line += ` (secret: ${SECRET_MASK})`;
      if (f.dbUpdatedAt) line += ` db_updated_at=${f.dbUpdatedAt}`;
      output.log(line);
    }
  }
  const s = report.summary;
  output.log(
    `summary: drift: ${s.drift}, alerts: ${s.alerts}, informational: ${
      s.shadowed + s.envOnly + s.dbOnly
    }`
  );
  output.log(`exit code: ${report.exitCode}`);
}

async function runCheck(output, json) {
  loadDotenv();
  try {
    await bootStore();
    const report = await buildReport();
    renderCheck(output, report, json);
    return report.exitCode;
  } catch (error) {
    output.error(`configSync --check failed: ${describeError(error)}`);
    return 1;
  }
}

/**
 * Reconcile DB rows to mirror .env for every env-set non-T0 registry key,
 * using the same write path as the admin config route (plaintext via
 * Settings.set(key, String(value)); secrets via Settings.set(key,
 * JSON.stringify(encryptSecret(value, masterKey)))). Then re-run the check
 * in-process and return its exit code.
 */
async function runApply(output, json) {
  loadDotenv();
  try {
    await bootStore();
  } catch (error) {
    output.error(`configSync --apply failed: ${describeError(error)}`);
    return 1;
  }

  const masterKey = process.env.encrypt_secret_key;
  const targets = getEntries().filter((entry) => !isT0(entry.key) && isEnvSet(process.env[entry.key]));
  if (targets.some((entry) => entry.secret) && !isEnvSet(masterKey)) {
    output.error(
      'configSync --apply aborted: a secret key is set in .env but encrypt_secret_key is ' +
        'absent; refusing to write unencrypted or without a master key (DB unchanged).'
    );
    return 1;
  }

  let rowByKey;
  try {
    rowByKey = new Map((await Settings.listRows()).map((row) => [row.key, row]));
  } catch (error) {
    output.error(`configSync --apply failed: ${describeError(error)}`);
    return 1;
  }

  const writes = [];
  try {
    for (const entry of targets) {
      const envValue = String(process.env[entry.key]);
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
        await Settings.set(entry.key, JSON.stringify(encryptSecret(envValue, masterKey)));
      } else {
        await Settings.set(entry.key, envValue);
      }
      writes.push({ key: entry.key, secret: Boolean(entry.secret), status: 'updated' });
    }
  } catch (error) {
    output.error(`configSync --apply failed: ${describeError(error)}`);
    return 1;
  }

  if (json) {
    output.log(JSON.stringify({ writes }, null, 2));
  } else {
    output.log(`apply: ${writes.length} key(s) processed`);
    for (const w of writes) {
      let line = `  ${w.status.padEnd(10)} ${w.key}`;
      if (w.secret) line += ` (secret: ${SECRET_MASK})`;
      output.log(line);
    }
    output.log('post-apply check:');
  }

  let report;
  try {
    report = await buildReport();
  } catch (error) {
    output.error(`configSync --apply post-check failed: ${describeError(error)}`);
    return 1;
  }
  renderCheck(output, report, json);
  return report.exitCode;
}

/**
 * CLI entry point. Modes:
 *   --help: print the reference, exit 0 (no store boot).
 *   no flags / --check: read-only drift report; exit 1 on drift or key-lost.
 *   --apply --yes: reconcile DB rows to mirror .env, then re-run the check.
 *
 * @param {string[]} argv process.argv.slice(2)
 * @param {{ output?: {log:Function,error:Function,warn:Function}, input?: object }} [deps]
 * @returns {Promise<number>} process exit code
 */
async function main(argv = [], deps = {}) {
  const output = deps.output || console;

  if (argv.some((arg) => arg === '--help' || arg.startsWith('--help='))) {
    output.log(USAGE);
    return 0;
  }

  let bools;
  try {
    bools = parseFlags(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      output.error(error.message);
      output.error(USAGE);
      return 2;
    }
    throw error;
  }

  if (bools.apply) {
    if (!bools.yes) {
      output.error('--apply requires --yes to confirm writes.');
      output.error(USAGE);
      return 2;
    }
    return runApply(output, Boolean(bools.json));
  }
  return runCheck(output, Boolean(bools.json));
}

async function runAsScript() {
  const code = await main(process.argv.slice(2));
  const { getBackend, closePgPool, closeSqliteDb } = require('../store/storage');
  try {
    if (getBackend() === 'postgresql') {
      await closePgPool();
    } else {
      await closeSqliteDb();
    }
  } catch {
    // best-effort cleanup; the exit code already reflects the result
  }
  process.exit(code);
}

if (require.main === module) {
  runAsScript().catch((error) => {
    console.error('configSync: fatal error:', describeError(error));
    process.exit(1);
  });
}

module.exports = { main, parseFlags };
