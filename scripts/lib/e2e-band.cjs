'use strict';

/**
 * Per-checkout E2E port-band allocator (single source of truth).
 *
 * Every E2E entry point that touches a host port resolves ports through this
 * module so the Docker stack, the API server, the client server, the scratch
 * suites and `playwright.config.ts` can never disagree:
 *
 *   1. A "band" is one offset applied to ALL base ports, so the relative
 *      layout of a checkout's stack is always the current fixed contract
 *      (offset 0 = today's numbers; single-checkout users see zero change).
 *   2. The band is persisted in `data/e2e-runtime.json` (git-ignored `data/`)
 *      per checkout and reused verbatim afterwards — never re-probed while
 *      the checkout's own stack may be holding its ports.
 *   3. On first use the band is auto-allocated: candidates are
 *      0, BAND_STEP, 2*BAND_STEP, …; a candidate is taken only when every
 *      port is free (spawned listener probe) AND the global band lock in
 *      `os.tmpdir()/webdav-e2e-ports/band-<offset>.lock` is claimable
 *      (new, owned by this checkout, or stale dead-owner — closes the
 *      TOCTOU window between concurrent cold starts of different checkouts).
 *   4. `E2E_PORT_OFFSET` pins the band exactly (parallel-run scheduling);
 *      per-port `E2E_*_PORT` env vars override the effective ports last.
 *
 * BAND_STEP (20) must exceed the span of the scratch base ports (5002..5021)
 * so two allocated bands can never overlap each other's slots.
 *
 * The module also regenerates `data/e2e-runtime.env` — a copy of the mode's
 * base `.env.e2e[.webdav]` with the band's ports written into PORT,
 * CORS_ORIGINS, WEBDAV_URL, WEBDAV_UPSTREAM_URL, S3_ENDPOINT and WEA_DB_PORT.
 * The `e2e:server*` npm scripts point DOTENV_CONFIG_PATH at it, so the API
 * server boots on exactly this checkout's band.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Base (offset-0) ports — the historical fixed E2E contract.
const PORT_BASES = {
  client: 3000,
  api: 5002,
  scratchWizard: 5003,
  scratchWizardMobile: 5004,
  scratchRegset: 5005,
  scratchRegsetMobile: 5006,
  scratchAdminConfig: 5010,
  scratchAdminConfigMobile: 5017,
  scratchMigration: 5011,
  scratchMigrationMobile: 5018,
  scratchTrashAdmin: 5012,
  scratchTrashAdminMobile: 5019,
  scratchCollections: 5013,
  scratchCollectionsMobile: 5014,
  scratchRetrieval: 5015,
  scratchRetrievalMobile: 5020,
  scratchAi: 5016,
  // API-only AI degradation-matrix slot (T4.3): no browser navigation, so the
  // band-40 mapping onto the Chromium/WebKit restricted 5061 is safe.
  scratchAiMatrix: 5021,
  webdav: 8090,
  pg: 5433,
  s3: 9010,
  s3Console: 9011,
};

const BAND_STEP = 20;
const MAX_BANDS = 25; // offsets 0..480

// Ports browsers refuse to navigate to (Chromium/WebKit "restricted" list).
// Auto-allocation never hands these out: offset 40 would map the
// scratchRetrievalMobile base (5020) onto SIP port 5060 and webkit silently
// refuses navigation (RCA 2026-10-27). A pinned band may still use them but
// gets a loud warning.
const BROWSER_RESTRICTED_PORTS = new Set([5060, 5061]);

const PORT_ENV_OVERRIDES = {
  client: 'E2E_CLIENT_PORT',
  api: 'E2E_API_PORT',
  scratchWizard: 'E2E_SCRATCH_WIZARD_PORT',
  scratchWizardMobile: 'E2E_SCRATCH_WIZARD_MOBILE_PORT',
  scratchRegset: 'E2E_SCRATCH_REGSET_PORT',
  scratchRegsetMobile: 'E2E_SCRATCH_REGSET_MOBILE_PORT',
  scratchAdminConfig: 'E2E_SCRATCH_ADMIN_CONFIG_PORT',
  scratchAdminConfigMobile: 'E2E_SCRATCH_ADMIN_CONFIG_MOBILE_PORT',
  scratchMigration: 'E2E_SCRATCH_MIGRATION_PORT',
  scratchMigrationMobile: 'E2E_SCRATCH_MIGRATION_MOBILE_PORT',
  scratchTrashAdmin: 'E2E_SCRATCH_TRASH_ADMIN_PORT',
  scratchTrashAdminMobile: 'E2E_SCRATCH_TRASH_ADMIN_MOBILE_PORT',
  scratchCollections: 'E2E_SCRATCH_COLLECTIONS_PORT',
  scratchCollectionsMobile: 'E2E_SCRATCH_COLLECTIONS_MOBILE_PORT',
  scratchRetrieval: 'E2E_SCRATCH_RETRIEVAL_PORT',
  scratchRetrievalMobile: 'E2E_SCRATCH_RETRIEVAL_MOBILE_PORT',
  scratchAi: 'E2E_SCRATCH_AI_PORT',
  scratchAiMatrix: 'E2E_SCRATCH_AI_MATRIX_PORT',
  webdav: 'E2E_WEBDAV_PORT',
  pg: 'E2E_PG_PORT',
  s3: 'E2E_S3_PORT',
  s3Console: 'E2E_S3_CONSOLE_PORT',
};

const RUNTIME_JSON_REL = path.join('data', 'e2e-runtime.json');
const RUNTIME_ENV_REL = path.join('data', 'e2e-runtime.env');

function runtimeJsonPath(rootDir) {
  return path.join(rootDir, RUNTIME_JSON_REL);
}

function runtimeEnvPath(rootDir) {
  return path.join(rootDir, RUNTIME_ENV_REL);
}

function portsForOffset(offset) {
  const ports = {};
  for (const [key, base] of Object.entries(PORT_BASES)) ports[key] = base + offset;
  return ports;
}

function readPersistedOffset(rootDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(runtimeJsonPath(rootDir), 'utf8'));
    if (Number.isInteger(parsed?.offset) && parsed.offset >= 0) return parsed.offset;
  } catch {
    /* absent/corrupt → not persisted */
  }
  return null;
}

function applyEnvOverrides(ports) {
  const effective = { ...ports };
  for (const [key, envName] of Object.entries(PORT_ENV_OVERRIDES)) {
    const raw = process.env[envName];
    if (raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 65_535) {
      throw new Error(`[e2e-band] Invalid ${envName}="${raw}" (expected a port number).`);
    }
    effective[key] = value;
  }
  return effective;
}

/**
 * Effective ports for this checkout: persisted band (or offset 0 when no
 * band was generated yet) + per-port env overrides. Always derive from the
 * offset so removing an env override can never leave a stale pin behind.
 */
function effectivePorts(rootDir) {
  const offset = readPersistedOffset(rootDir) ?? 0;
  return applyEnvOverrides(portsForOffset(offset));
}

// Probe every port of a candidate band with a real listener in a throwaway
// child process (synchronous for our callers: config load / wait-healthy).
function bandPortsFree(ports) {
  const probe = `
    const net = require('net');
    const ports = process.argv.slice(1).map(Number);
    let pending = ports.length;
    let free = true;
    const finish = () => { if (--pending === 0) process.exit(free ? 0 : 1); };
    for (const port of ports) {
      const server = net.createServer();
      server.once('error', () => { free = false; finish(); });
      server.listen(port, '127.0.0.1', () => server.close(finish));
    }
  `;
  const result = spawnSync(process.execPath, ['-e', probe, ...Object.values(ports).map(String)], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return result.status === 0;
}

function bandLockPath(offset) {
  return path.join(os.tmpdir(), 'webdav-e2e-ports', `band-${offset}.lock`);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists, other owner — still "alive"
  }
}

/**
 * Globally claim a band offset via an O_EXCL lock file. Claimable when the
 * lock is absent, owned by this checkout, or stale (dead owner pid /
 * unreadable garbage). Unreadable-but-present locks owned by another user
 * are treated as taken (conservative).
 */
function claimBandLock(offset, rootDir) {
  const file = bandLockPath(offset);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const write = () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ rootDir, pid: process.pid, claimedAt: new Date().toISOString() })
    );
  };
  try {
    fs.closeSync(fs.openSync(file, 'wx'));
    write();
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  let owner = null;
  try {
    owner = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* unreadable → treat as claimable */
  }
  if (!owner || owner.rootDir === rootDir || !pidAlive(Number(owner.pid))) {
    write();
    return true;
  }
  return false;
}

function releaseBandLock(rootDir) {
  const offset = readPersistedOffset(rootDir);
  if (offset === null) return;
  const file = bandLockPath(offset);
  try {
    const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (owner?.rootDir === rootDir) fs.rmSync(file, { force: true });
  } catch {
    /* best-effort */
  }
}

// `data/` is where the band files live, but Docker creates it root-owned on
// a fresh checkout (bind-mount parent). Make it writable for the current
// user via the same docker-helper pattern `e2e/helpers/seedDb.ts#cleanDir`
// uses — scoped to the CURRENT checkout's data dir only.
function ensureWritableDataDir(rootDir) {
  const dir = path.join(rootDir, 'data');
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return dir;
  } catch {
    process.stdout.write(
      '[e2e-band] data/ is not writable (docker-created) — fixing ownership via docker helper…\n'
    );
    const uid = process.getuid ? process.getuid() : 0;
    const gid = process.getgid ? process.getgid() : 0;
    const result = spawnSync(
      'docker',
      ['run', '--rm', '-v', `${rootDir}:/w`, 'alpine', 'sh', '-c', `chown ${uid}:${gid} /w/data`],
      { stdio: 'inherit' }
    );
    if (result.status !== 0) {
      throw new Error('[e2e-band] Could not make data/ writable for the E2E band files.');
    }
    fs.accessSync(dir, fs.constants.W_OK);
    return dir;
  }
}

function writeBandJson(rootDir, offset) {
  ensureWritableDataDir(rootDir);
  fs.writeFileSync(
    runtimeJsonPath(rootDir),
    JSON.stringify(
      {
        offset,
        ports: portsForOffset(offset),
        checkout: rootDir,
        generatedBy: process.pid,
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

// Regenerate the server dotenv file for the current checkout/mode. Base
// comments and unknown keys are preserved; only the port-bearing keys are
// rewritten (and appended when a base file lacks one).
function writeRuntimeEnv(rootDir, ports) {
  const mode = process.env.E2E_BACKEND_MODE === 'webdav' ? 'webdav' : 's3';
  const baseFile = path.join(rootDir, mode === 'webdav' ? '.env.e2e.webdav' : '.env.e2e');
  const overrides = {
    PORT: String(ports.api),
    CORS_ORIGINS: `http://127.0.0.1:${ports.client},http://localhost:${ports.client}`,
    WEBDAV_URL: `http://127.0.0.1:${ports.webdav}`,
    WEBDAV_UPSTREAM_URL: `http://127.0.0.1:${ports.webdav}`,
    S3_ENDPOINT: `http://127.0.0.1:${ports.s3}`,
    WEA_DB_PORT: String(ports.pg),
  };
  let lines;
  try {
    lines = fs.readFileSync(baseFile, 'utf8').split(/\r?\n/);
  } catch {
    throw new Error(`[e2e-band] E2E env base file not found: ${baseFile}`);
  }
  const applied = new Set();
  const out = lines.map((line) => {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=/.exec(line);
    const key = match && overrides[match[1]];
    if (!key) return line;
    applied.add(match[1]);
    return `${match[1]}=${overrides[match[1]]}`;
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (!applied.has(key)) out.push(`${key}=${value}`);
  }
  ensureWritableDataDir(rootDir);
  fs.writeFileSync(runtimeEnvPath(rootDir), out.join('\n'));
}

/**
 * Ensure this checkout has a persisted, globally-claimed band and return the
 * offset. Reuse the persisted band verbatim (never re-probe — the checkout's
 * own stack may legitimately hold its ports). `E2E_PORT_OFFSET` pins the
 * band exactly and re-probes/re-claims it on every call.
 */
function ensureBand(rootDir) {
  const forcedRaw = process.env.E2E_PORT_OFFSET;
  const forced = forcedRaw === undefined || forcedRaw === '' ? null : Number(forcedRaw);
  if (forced !== null && (!Number.isInteger(forced) || forced < 0 || forced % BAND_STEP !== 0)) {
    throw new Error(
      `[e2e-band] E2E_PORT_OFFSET=${forcedRaw} must be a multiple of ${BAND_STEP} (0 = default band).`
    );
  }

  const persisted = readPersistedOffset(rootDir);
  if (persisted !== null && (forced === null || forced === persisted)) {
    // Re-assert ownership of the lock (survives /tmp sweeps + dead owners);
    // if another live checkout claimed our band meanwhile (e.g. after a /tmp
    // clean raced us), self-heal by allocating a fresh band.
    if (claimBandLock(persisted, rootDir)) return persisted;
    process.stdout.write(
      `[e2e-band] Band offset ${persisted} was claimed by another checkout — reallocating.\n`
    );
  }

  const candidates =
    forced !== null ? [forced] : Array.from({ length: MAX_BANDS }, (_, i) => i * BAND_STEP);
  for (const offset of candidates) {
    if (offset === persisted) continue;
    const ports = portsForOffset(offset);
    const restricted = Object.values(ports).filter((p) => BROWSER_RESTRICTED_PORTS.has(p));
    if (restricted.length > 0) {
      if (forced === offset) {
        process.stdout.write(
          `[e2e-band] Warning: pinned band ${offset} maps ${restricted.join(', ')} — browsers refuse ` +
            `navigation to these ports; override the slot via its E2E_*_PORT or pick another band.\n`
        );
      } else {
        continue;
      }
    }
    if (!bandPortsFree(ports)) continue;
    if (!claimBandLock(offset, rootDir)) continue;
    writeBandJson(rootDir, offset);
    writeRuntimeEnv(rootDir, effectivePorts(rootDir));
    return offset;
  }
  throw new Error(
    `[e2e-band] No free port band found (tried offsets ${candidates.join(', ')}). ` +
      `Free host ports or pin a band via E2E_PORT_OFFSET.`
  );
}

/** Compose project per band: containers/volumes never cross bands. */
function composeProjectName(offset) {
  return `webdav-easyaccess-${Number(offset) || 0}`;
}

module.exports = {
  PORT_BASES,
  BAND_STEP,
  portsForOffset,
  readPersistedOffset,
  effectivePorts,
  composeProjectName,
  ensureBand,
  writeRuntimeEnv,
  releaseBandLock,
  runtimeEnvPath,
};
