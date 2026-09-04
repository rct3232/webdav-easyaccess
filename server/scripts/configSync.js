'use strict';

/**
 * env↔DB config sync/alert CLI.
 *
 * Detects drift between the .env values and the metadata DB `settings` rows
 * for every non-T0 config-registry key, reports it (default `--check` mode,
 * exit 1 on drift), and optionally reconciles the DB rows to mirror .env
 * (`--apply --yes`). DB rows are plaintext (secret values included), so every
 * comparison is a plaintext string comparison. T0 keys are .env-owned and are
 * never reported or written; DB rows are never deleted.
 *
 * @see docs/features/config-sync.md
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const { resolveEnvPath } = require('../infrastructure/envPath');
const Settings = require('../models/Settings');
const { initMetadataSchema } = require('../store/bootstrap');
const {
  buildConfigSyncReport,
  syncConfigSyncEnv,
} = require('../domains/admin/services/configSyncService');

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
            .env so it mirrors .env (plaintext, secrets included); requires --yes
  --yes     confirm --apply writes; without it the run is a usage error (exit 2)

Scope and safety:
  - only non-T0 config-registry keys (server/infrastructure/configRegistry.js)
    are compared or written; T0 keys are .env-only and excluded from the report
  - .env always wins (D1): a DB row under an env-set key is a shadow copy
  - DB rows are never deleted; secrets are always masked (****) in output
  - every value comparison is plaintext string equality — DB rows are plaintext

Exit codes:
  0 no drift (or --apply completed with a clean post-apply check)
  1 drift found, or a write failed (apply aborted)
  2 usage error (unknown flag, --apply without --yes)
`;

class UsageError extends Error {}

function isTruthy(value) {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
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

// Boot subset of server/index.js runBoot: schema only (no default-admin
// seeding). Backend selection is presence-based and validated inside
// storage.getBackend (partial WEA_DB_* throws here).
async function bootStore() {
  await initMetadataSchema();
}

// The classification / reconcile algorithm lives in the shared core
// (../domains/admin/services/configSyncService). This CLI supplies the env
// source from its own process.env after loadDotenv() (the on-disk .env file)
// and renders the returned report — behavior is identical to the pre-split CLI.

function renderCheck(output, report, json) {
  if (json) {
    output.log(JSON.stringify({ findings: report.findings, summary: report.summary, exitCode: report.exitCode }, null, 2));
    return;
  }
  output.log('configSync: .env vs DB settings (non-T0 registry keys)');
  const groups = [
    ['DRIFT', ['differs']],
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
    `summary: drift: ${s.drift}, informational: ${s.shadowed + s.envOnly + s.dbOnly}`
  );
  output.log(`exit code: ${report.exitCode}`);
}

async function runCheck(output, json) {
  loadDotenv();
  try {
    await bootStore();
    const report = await buildConfigSyncReport({
      settings: Settings,
      envValueOf: (key) => process.env[key],
    });
    renderCheck(output, report, json);
    return report.exitCode;
  } catch (error) {
    output.error(`configSync --check failed: ${describeError(error)}`);
    return 1;
  }
}

/**
 * Reconcile DB rows to mirror the loaded env for every env-set non-T0 registry
 * key, then re-run the check in-process. The algorithm lives in the shared core
 * (../domains/admin/services/configSyncService); the CLI boots the store and
 * renders the returned writes + post-apply report.
 */
async function runApply(output, json) {
  loadDotenv();
  try {
    await bootStore();
  } catch (error) {
    output.error(`configSync --apply failed: ${describeError(error)}`);
    return 1;
  }

  const envValueOf = (key) => process.env[key];

  let writes;
  let report;
  try {
    ({ writes, report } = await syncConfigSyncEnv({
      settings: Settings,
      envValueOf,
    }));
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
  renderCheck(output, report, json);
  return report.exitCode;
}

/**
 * CLI entry point. Modes:
 *   --help: print the reference, exit 0 (no store boot).
 *   no flags / --check: read-only drift report; exit 1 on drift.
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
