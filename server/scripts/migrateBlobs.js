'use strict';

/**
 * Blob migration CLI — bidirectional physical-blob migration between the
 * WebDAV and S3 backends, driven by the DB metadata (file_nodes + object_map).
 *
 * This is a thin wrapper around the shared `migrationService`. The runnable
 * logic lives in the exported `runMigrationCli(argv, deps)` so tests can inject
 * a fake `migrationService` and `output` without touching the network or
 * spawning subprocesses.
 *
 * The source backend is auto-determined from the current app config
 * (WEA_FILE_STORAGE + its env vars); only the destination is user input.
 * Direction implies destination type: webdav-to-s3 → s3, s3-to-webdav → webdav.
 *
 * Usage:
 *   node server/scripts/migrateBlobs.js --direction=<dir> <mode> [options]
 *
 * Modes (exactly one required):
 *   --check-env     Validate config + snapshot + destination connectivity. No writes. Exit 0/1.
 *   --dry-run       Run the dry pass (validate config, snapshot, probe destination). No writes.
 *   --apply         Write mode; runs an internal dry-run pass first. Requires --yes.
 *
 * Options:
 *   --direction=webdav-to-s3|s3-to-webdav   Required. Direction implies the source backend.
 *   --phase=copy|finalize                   Default copy. finalize is only valid for s3-to-webdav.
 *   --resume                                Skip already-migrated nodes.
 *   --force                                 Re-copy even when a resume marker is present.
 *   --dest-webdav-url=URL                   WebDAV destination connection fields.
 *   --dest-webdav-username=USER
 *   --dest-webdav-password=PASSWORD
 *   --dest-webdav-auth-type=auto|basic|digest
 *   --dest-webdav-upstream-url=URL
 *   --dest-s3-bucket=BUCKET                 S3 destination connection fields.
 *   --dest-s3-access-key=KEY
 *   --dest-s3-secret-key=SECRET
 *   --dest-s3-endpoint=URL
 *   --dest-s3-region=REGION
 *
 * The destination may also be configured via the environment: DEST_WEBDAV_URL,
 * DEST_WEBDAV_USERNAME, DEST_WEBDAV_PASSWORD, DEST_WEBDAV_AUTH_TYPE,
 * DEST_WEBDAV_UPSTREAM_URL, DEST_S3_BUCKET, DEST_S3_ACCESS_KEY,
 * DEST_S3_SECRET_KEY, DEST_S3_ENDPOINT and DEST_S3_REGION. --dest-* flags take
 * precedence over the environment.
 *
 * Exit codes:
 *   0  Success (--check-env valid, --dry-run passed, or --apply completed).
 *   1  Runtime/config/snapshot/destination failure; nothing was written.
 *   2  Usage error (unknown flag, missing or invalid --direction, bad combination).
 *
 * Examples:
 *   node server/scripts/migrateBlobs.js --direction=webdav-to-s3 --check-env
 *   node server/scripts/migrateBlobs.js --direction=s3-to-webdav --dry-run --resume
 *   node server/scripts/migrateBlobs.js --direction=webdav-to-s3 --apply --yes \
 *     --dest-s3-bucket=target-bucket --dest-s3-access-key=AKIA... --dest-s3-secret-key=...
 *   node server/scripts/migrateBlobs.js --direction=s3-to-webdav --phase=finalize --apply --yes \
 *     --dest-webdav-url=https://dav.example.com --dest-webdav-username=user --dest-webdav-password=pass
 *
 * See docs/spec/server/tools/blob-migration.md for the full contract.
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const { getBackend, closePgPool, closeSqliteDb } = require('../store/storage');
const { initMetadataStore } = require('../store/bootstrap');
const { getComposition } = require('../service/composition');
const { buildDestBlobStore } = require('../infrastructure/adapters/blobstore/config');

const VALID_DIRECTIONS = ['webdav-to-s3', 's3-to-webdav'];
const VALID_PHASES = ['copy', 'finalize'];
const PROGRESS_INTERVAL = 100;

const BOOLEAN_FLAGS = new Set(['check-env', 'dry-run', 'apply', 'yes', 'resume', 'force']);

const VALUE_FLAGS = new Set([
  'direction',
  'phase',
  'dest-webdav-url',
  'dest-webdav-username',
  'dest-webdav-password',
  'dest-webdav-auth-type',
  'dest-webdav-upstream-url',
  'dest-s3-bucket',
  'dest-s3-access-key',
  'dest-s3-secret-key',
  'dest-s3-endpoint',
  'dest-s3-region',
]);

const USAGE = `
Usage:
  node server/scripts/migrateBlobs.js --direction=<dir> <mode> [options]

Modes (exactly one required):
  --check-env          Validate config + snapshot + destination connectivity. No writes. Exit 0/1.
  --dry-run            Run the dry pass (validate config, snapshot, probe destination). No writes.
  --apply              Write mode; runs an internal dry-run pass first. Requires --yes.

Options:
  --direction=webdav-to-s3|s3-to-webdav   Required. Direction implies the source backend.
  --phase=copy|finalize                   Default copy. finalize is only valid for s3-to-webdav.
  --resume                                Skip already-migrated nodes.
  --force                                 Re-copy even when a resume marker is present.
  --dest-webdav-url=URL                   WebDAV destination connection fields.
  --dest-webdav-username=USER
  --dest-webdav-password=PASSWORD
  --dest-webdav-auth-type=auto|basic|digest
  --dest-webdav-upstream-url=URL
  --dest-s3-bucket=BUCKET                 S3 destination connection fields.
  --dest-s3-access-key=KEY
  --dest-s3-secret-key=SECRET
  --dest-s3-endpoint=URL
  --dest-s3-region=REGION

Destination env fallbacks (--dest-* flags take precedence): DEST_WEBDAV_URL,
DEST_WEBDAV_USERNAME, DEST_WEBDAV_PASSWORD, DEST_WEBDAV_AUTH_TYPE,
DEST_WEBDAV_UPSTREAM_URL, DEST_S3_BUCKET, DEST_S3_ACCESS_KEY,
DEST_S3_SECRET_KEY, DEST_S3_ENDPOINT, DEST_S3_REGION.

Exit codes:
  0  Success (--check-env valid, --dry-run passed, or --apply completed).
  1  Runtime/config/snapshot/destination failure; nothing was written.
  2  Usage error (unknown flag, missing or invalid --direction, bad combination).
`;

class UsageError extends Error {}

function isTruthy(value) {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseArgs(argv) {
  const values = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const raw = eq === -1 ? true : arg.slice(eq + 1);
    if (BOOLEAN_FLAGS.has(name)) {
      values[name] = raw;
    } else if (VALUE_FLAGS.has(name)) {
      if (raw === true) {
        throw new UsageError(`Flag --${name} requires a value (--${name}=<value>)`);
      }
      values[name] = raw;
    } else {
      throw new UsageError(`Unknown flag: --${name}`);
    }
  }
  return values;
}

function buildDestConfig(direction, values, env) {
  const isWebdavDest = direction === 's3-to-webdav';
  const pairs = isWebdavDest
    ? [
        ['url', values['dest-webdav-url'], env.DEST_WEBDAV_URL],
        ['username', values['dest-webdav-username'], env.DEST_WEBDAV_USERNAME],
        ['password', values['dest-webdav-password'], env.DEST_WEBDAV_PASSWORD],
        ['authType', values['dest-webdav-auth-type'], env.DEST_WEBDAV_AUTH_TYPE],
        ['upstreamUrl', values['dest-webdav-upstream-url'], env.DEST_WEBDAV_UPSTREAM_URL],
      ]
    : [
        ['bucket', values['dest-s3-bucket'], env.DEST_S3_BUCKET],
        ['accessKey', values['dest-s3-access-key'], env.DEST_S3_ACCESS_KEY],
        ['secretKey', values['dest-s3-secret-key'], env.DEST_S3_SECRET_KEY],
        ['endpoint', values['dest-s3-endpoint'], env.DEST_S3_ENDPOINT],
        ['region', values['dest-s3-region'], env.DEST_S3_REGION],
      ];

  const config = { type: isWebdavDest ? 'webdav' : 's3' };
  for (const [key, flagValue, envValue] of pairs) {
    const value = flagValue !== undefined ? flagValue : envValue;
    if (value !== undefined && value !== '') {
      config[key] = String(value);
    }
  }
  return config;
}

function makeOnProgress(output) {
  let lastLogged = 0;
  return ({ total, done, current }) => {
    if (total === 0) return;
    const cur = current || {};
    if (done === total || done - lastLogged >= PROGRESS_INTERVAL) {
      lastLogged = done;
      const where = cur.path || (cur.nodeId != null ? `node ${cur.nodeId}` : '');
      output.log(`[progress] ${done}/${total} ... ${where}`);
    }
  };
}

async function runMigrationCli(argv, deps) {
  const output = deps.output || { log: () => {}, error: () => {} };
  const { migrationService, buildDestBlobStore: buildDest } = deps;

  let values;
  try {
    values = parseArgs(argv || []);
  } catch (error) {
    if (error instanceof UsageError) {
      output.error(error.message);
      output.error(USAGE);
      return 2;
    }
    throw error;
  }

  if (values.direction === undefined) {
    output.error('Missing required flag: --direction');
    output.error(USAGE);
    return 2;
  }
  const direction = String(values.direction);
  if (!VALID_DIRECTIONS.includes(direction)) {
    output.error(`Invalid --direction: ${direction}. Expected one of: ${VALID_DIRECTIONS.join(', ')}`);
    output.error(USAGE);
    return 2;
  }

  const phase = values.phase === undefined ? 'copy' : String(values.phase);
  if (!VALID_PHASES.includes(phase)) {
    output.error(`Invalid --phase: ${phase}. Expected one of: ${VALID_PHASES.join(', ')}`);
    output.error(USAGE);
    return 2;
  }

  const destConfig = buildDestConfig(direction, values, process.env);

  if (isTruthy(values['check-env'])) {
    try {
      const { summary } = buildDest(destConfig);
      output.log('check-env: destination configuration is valid');
      output.log(`destination: ${summary}`);
      return 0;
    } catch (error) {
      output.error(`check-env failed: ${error.message}`);
      return 1;
    }
  }

  let mode;
  if (isTruthy(values.apply)) {
    if (!isTruthy(values.yes)) {
      output.error('--apply requires --yes to confirm writes');
      output.error(USAGE);
      return 2;
    }
    mode = 'apply';
  } else if (isTruthy(values['dry-run'])) {
    mode = 'dry-run';
  } else {
    output.error('Exactly one of --check-env, --dry-run, or --apply is required');
    output.error(USAGE);
    return 2;
  }

  const resume = isTruthy(values.resume);
  const force = isTruthy(values.force);

  try {
    const result = await migrationService.run({
      direction,
      phase,
      destConfig,
      mode,
      resume,
      force,
      onProgress: makeOnProgress(output),
    });

    output.log(`summary: copied=${result.copied} skipped=${result.skipped} failed=${result.failed}`);
    for (const entry of result.errors || []) {
      output.error(`error: nodeId=${entry.nodeId} path=${entry.path} error=${entry.error}`);
    }
    return 0;
  } catch (error) {
    output.error(`migration failed: ${error.message}`);
    return 1;
  }
}

async function main() {
  const envPath = process.env.DOTENV_CONFIG_PATH
    ? path.resolve(__dirname, process.env.DOTENV_CONFIG_PATH)
    : path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  } else {
    dotenv.config();
  }

  await initMetadataStore();
  const composition = getComposition();

  const code = await runMigrationCli(process.argv.slice(2), {
    migrationService: composition.migrationService,
    buildDestBlobStore,
    output: console,
  });

  const backend = getBackend();
  if (backend === 'postgresql') {
    await closePgPool();
  } else {
    await closeSqliteDb();
  }
  process.exit(code);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('migrateBlobs: fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = { runMigrationCli };
