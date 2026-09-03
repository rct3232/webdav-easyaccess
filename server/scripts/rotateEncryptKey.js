'use strict';

/**
 * encrypt_secret_key rotation CLI.
 *
 * Re-encrypts every DB-stored encrypted `settings` row from the current
 * (old) `encrypt_secret_key` to a new key. The default mode is a read-only
 * dry-run that verifies the old key can decrypt every row and reports counts;
 * `--apply --yes` re-encrypts all rows (DB-first) and writes the new key to
 * `.env` last via the atomic, backed-up env writer. Key material is never
 * printed. Refuses (exit 1) when the old key is absent.
 *
 * @see docs/features/encrypt-key-rotation.md
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const { resolveEnvPath } = require('../infrastructure/envPath');
const { writeEnv } = require('../infrastructure/envFileWriter');
const { isSecret } = require('../infrastructure/configRegistry');
const {
  encryptSecret,
  decryptSecret,
  generateKey,
  isEncryptedPayload,
} = require('../utils/configEncryption');
const Settings = require('../models/Settings');
const { PG_REQUIRED_KEYS } = require('../infrastructure/setupStatus');
const { initMetadataSchema } = require('../store/bootstrap');

// This file lives in <server>/scripts, so the server root is one level up —
// must match server/index.js:10-12 for resolveEnvPath.
const SERVER_ROOT = path.join(__dirname, '..');

const KEY_LOST_MESSAGE =
  'rotateEncryptKey: encrypt_secret_key is absent from the environment (after the .env load). ' +
  'Refusing to run — DB secrets encrypted under a lost key cannot be decrypted or rotated. ' +
  'Restore a previous key to .env (see the .env.bak-* backups) and re-run.';

const BOOLEAN_FLAGS = new Set(['help', 'dry-run', 'apply', 'yes', 'generate']);
const VALUE_FLAGS = new Set(['new-key']);

const USAGE = `
Usage:
  node server/scripts/rotateEncryptKey.js [--dry-run] [--new-key=<passphrase>|--generate]
      verify every encrypted row decrypts under the current encrypt_secret_key (read-only; default mode)
  node server/scripts/rotateEncryptKey.js --apply --yes (--generate|--new-key=<passphrase>)
      re-encrypt all rows under a new key, then write the new key to .env last
  node server/scripts/rotateEncryptKey.js --help
      print this reference

Flags:
  --dry-run         verify mode (default). Decrypts every encrypted row under the old key and
                    reports ok/failed per key plus counts; performs no writes
  --new-key=<val>   new key supplied by the operator (free-length passphrase). Mutually exclusive
                    with --generate. Required for --apply; optional for dry-run (verifies round-trip)
  --generate        new key produced by generateKey() (64-hex). Mutually exclusive with --new-key.
                    Required for --apply; optional for dry-run. The value is never printed
  --apply           write mode. Requires --yes and exactly one of --generate / --new-key; otherwise
                    a usage error (exit 2)
  --yes             confirm --apply writes

Key handling and safety:
  - old key = encrypt_secret_key from the environment after the .env load; if absent, the tool
    refuses (exit 1) without reading or writing the DB or .env
  - candidates = every settings row whose value is an encrypted payload (registry membership is
    irrelevant); plaintext rows are never rewritten
  - legacy plaintext secret rows are reported (legacy-plaintext) but not rotated
  - apply is DB-first: decrypt all rows first (any failure -> zero writes), re-encrypt all rows,
    then write the new key to .env last via the atomic writer (0600, .env.bak-* backup)
  - key material is never printed (old key, generated key, or --new-key value)

Exit codes:
  0 dry-run with zero decrypt failures (incl. zero candidates), or apply completed
  1 a row failed to decrypt (dry-run), old key absent, or apply aborted
  2 usage error (unknown flag, --apply without --yes, no new key, conflicting flags)
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
  const result = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const hasValue = eq !== -1;
    const raw = hasValue ? arg.slice(eq + 1) : undefined;
    if (BOOLEAN_FLAGS.has(name)) {
      result[name] = hasValue ? isTruthy(raw) : true;
    } else if (VALUE_FLAGS.has(name)) {
      if (!hasValue) throw new UsageError(`--${name} requires a value (e.g. --${name}=abc123)`);
      if (raw === '') throw new UsageError(`--${name} must not be empty`);
      result[name] = raw;
    } else {
      throw new UsageError(`Unknown flag: --${name}`);
    }
  }
  return result;
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

// Split rows into rotation candidates (every encrypted-payload row) and legacy
// plaintext secret rows (registry secret key holding a non-encrypted value).
function classifyRows(rows) {
  const candidates = [];
  const legacyPlaintext = [];
  for (const row of rows) {
    const parsed = tryJsonParse(row.value);
    if (isEncryptedPayload(parsed)) {
      candidates.push({ key: row.key, payload: parsed, isRegistrySecret: isSecret(row.key) });
    } else if (isSecret(row.key)) {
      legacyPlaintext.push(row.key);
    }
  }
  return { candidates, legacyPlaintext };
}

async function runDryRun(output, newKeyOpt) {
  loadDotenv();
  const oldKey = process.env.encrypt_secret_key;
  if (!oldKey || String(oldKey).trim() === '') {
    output.error(KEY_LOST_MESSAGE);
    return 1;
  }
  try {
    await bootStore();
  } catch (error) {
    output.error(`rotateEncryptKey: failed to boot metadata store: ${describeError(error)}`);
    return 1;
  }
  let rows;
  try {
    rows = await Settings.listRows();
  } catch (error) {
    output.error(`rotateEncryptKey: failed to read settings rows: ${describeError(error)}`);
    return 1;
  }

  const { candidates, legacyPlaintext } = classifyRows(rows);

  // Optional: verify the row set also round-trips under the supplied new key.
  let verifyKey = null;
  let verifySource = null;
  if (newKeyOpt.hasGenerate) {
    verifyKey = generateKey(); // throwaway; never printed
    verifySource = 'generated';
  } else if (newKeyOpt.newKey) {
    verifyKey = newKeyOpt.newKey;
    verifySource = 'provided';
  }

  const results = [];
  let okCount = 0;
  let failedCount = 0;
  for (const c of candidates) {
    let status = 'ok';
    let reason = null;
    let plaintext = null;
    try {
      plaintext = decryptSecret(c.payload, oldKey);
      if (verifyKey) {
        const roundTrip = decryptSecret(encryptSecret(plaintext, verifyKey), verifyKey);
        if (roundTrip !== plaintext) throw new Error('round-trip mismatch under the new key');
      }
    } catch (error) {
      status = 'failed';
      reason = verifyKey ? `new-key verification: ${describeError(error)}` : describeError(error);
    }
    if (status === 'ok') okCount += 1;
    else failedCount += 1;
    results.push({ key: c.key, status, reason });
  }

  const nonSecretEncrypted = candidates.filter((c) => !c.isRegistrySecret).length;

  output.log('rotateEncryptKey: dry-run (decrypt-verify under old key, read-only)');
  if (candidates.length === 0) {
    output.log('no encrypted settings rows found; nothing to rotate.');
  }
  for (const r of results) {
    let line = `  ${r.status.padEnd(10)} ${r.key}`;
    if (r.reason) line += ` ${r.reason}`;
    output.log(line);
  }
  for (const key of legacyPlaintext) {
    output.log(`  legacy-plaintext ${key} (plaintext secret, not rotated by this tool)`);
  }
  if (verifyKey) {
    output.log(`new key: ${verifySource} (round-trip verified, not printed)`);
  }
  output.log(
    `summary: candidates: ${candidates.length}, ok: ${okCount}, failed: ${failedCount}, ` +
      `legacy-plaintext: ${legacyPlaintext.length}, non-secret-encrypted: ${nonSecretEncrypted}`
  );
  return failedCount > 0 ? 1 : 0;
}

async function runApply(output, newKeyOpt) {
  loadDotenv();
  const oldKey = process.env.encrypt_secret_key;
  if (!oldKey || String(oldKey).trim() === '') {
    output.error(KEY_LOST_MESSAGE);
    return 1;
  }
  const newKey = newKeyOpt.hasGenerate ? generateKey() : newKeyOpt.newKey;
  const newKeySource = newKeyOpt.hasGenerate ? 'generated' : 'provided';

  try {
    await bootStore();
  } catch (error) {
    output.error(`rotateEncryptKey: failed to boot metadata store: ${describeError(error)}`);
    return 1;
  }
  let rows;
  try {
    rows = await Settings.listRows();
  } catch (error) {
    output.error(`rotateEncryptKey: failed to read settings rows: ${describeError(error)}`);
    return 1;
  }

  const { candidates } = classifyRows(rows);

  output.log('rotateEncryptKey: apply (decrypt all, re-encrypt, then write new key to .env last)');

  // 1. Decrypt every candidate with the old key BEFORE any write. Any failure
  //    aborts with zero writes, so the system stays a consistent old-key system.
  const decrypted = [];
  for (const c of candidates) {
    try {
      decrypted.push({ key: c.key, plaintext: decryptSecret(c.payload, oldKey) });
    } catch (error) {
      output.error(
        `apply aborted: ${c.key} could not be decrypted under the old key ` +
          `(${describeError(error)}). No rows were written.`
      );
      return 1;
    }
  }

  // 2. Re-encrypt and write every row under the new key (same write path as
  //    configSync / the admin config route).
  try {
    for (const d of decrypted) {
      await Settings.set(d.key, JSON.stringify(encryptSecret(d.plaintext, newKey)));
    }
  } catch (error) {
    output.error(`apply failed while writing re-encrypted rows: ${describeError(error)}`);
    output.error(
      'Recoverable: .env still holds the old key and a .env.bak-* backup of it; the run is ' +
        'idempotent, so re-run with the intended new key to finish the rotation.'
    );
    return 1;
  }

  // 3. Write the new key to .env LAST, after the DB is fully re-encrypted.
  const envPath = resolveEnvPath(SERVER_ROOT);
  let backupPath;
  try {
    backupPath = writeEnv(envPath, { encrypt_secret_key: newKey }, { backup: true });
  } catch (error) {
    output.error(`apply: DB rows re-encrypted but writing the new key to .env failed: ${describeError(error)}`);
    output.error(
      'CRITICAL: the DB now holds new-key ciphertext while .env still holds the old key. ' +
        'Persist the new key to .env or restore the .env.bak-* backup.'
    );
    return 1;
  }

  // 4. Report.
  for (const d of decrypted) {
    output.log(`  re-encrypted ${d.key}`);
  }
  output.log(
    `apply complete: ${decrypted.length} row(s) re-encrypted under new key (new key: ${newKeySource}).`
  );
  if (backupPath) {
    output.log(`.env backup: ${backupPath}`);
  } else {
    output.log('.env: no backup created (the file did not previously exist).');
  }
  output.log(
    'A mid-sequence failure is recoverable by re-running with the previous key from the .env.bak-* file.'
  );
  return 0;
}

/**
 * CLI entry point. Modes:
 *   --help: print the reference, exit 0 (no store boot).
 *   no flags / --dry-run: read-only decrypt-verify; exit 1 on any failed row.
 *   --apply --yes (+ --generate or --new-key): DB-first rotation, .env written last.
 *
 * @param {string[]} argv process.argv.slice(2)
 * @param {{ output?: {log:Function,error:Function,warn:Function}, input?: object }} [deps]
 * @returns {Promise<number>} process exit code
 */
async function main(argv = [], deps = {}) {
  const output = deps.output || console;

  if (argv.includes('--help') || argv.some((arg) => arg.startsWith('--help='))) {
    output.log(USAGE);
    return 0;
  }

  let parsed;
  try {
    parsed = parseFlags(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      output.error(error.message);
      output.error(USAGE);
      return 2;
    }
    throw error;
  }

  const hasGenerate = Boolean(parsed['generate']);
  const hasNewKey = Object.prototype.hasOwnProperty.call(parsed, 'new-key');

  if (hasGenerate && hasNewKey) {
    output.error('--generate and --new-key are mutually exclusive; provide exactly one.');
    output.error(USAGE);
    return 2;
  }
  if (parsed['apply'] && parsed['dry-run']) {
    output.error('--apply and --dry-run are mutually exclusive.');
    output.error(USAGE);
    return 2;
  }

  const newKeyOpt = { hasGenerate, newKey: hasNewKey ? parsed['new-key'] : undefined };

  if (parsed['apply']) {
    if (!parsed['yes']) {
      output.error('--apply requires --yes to confirm writes.');
      output.error(USAGE);
      return 2;
    }
    if (!hasGenerate && !hasNewKey) {
      output.error('--apply requires exactly one of --generate or --new-key=<passphrase>.');
      output.error(USAGE);
      return 2;
    }
    return runApply(output, newKeyOpt);
  }

  return runDryRun(output, newKeyOpt);
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
    console.error('rotateEncryptKey: fatal error:', describeError(error));
    process.exit(1);
  });
}

module.exports = { main, parseFlags };
