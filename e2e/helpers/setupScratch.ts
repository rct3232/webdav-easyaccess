import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync, execFileSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * Hermetic scratch-instance helpers for the first-run setup-wizard E2E spec
 * (PLAN.md §7). The shared E2E infrastructure (`:5002` server, `:3000` client,
 * `webdav_e2e` PG database) is unusable for the setup spec because the wizard
 * configures-and-restarts a fresh server — restart is the behavior under test.
 *
 * Every helper here is scratch-owned: own port (:5003), own `.env` via
 * `DOTENV_CONFIG_PATH`, own sqlite path, own scratch PG database
 * (`webdav_e2e_setup`, separate from the read-only `webdav_e2e` used by
 * `e2e/helpers/pg.ts`). `pg` is required via `createRequire` (ships no types;
 * the local structural type keeps the surface typed without a new dependency).
 */

const require = createRequire(__filename);

const rootDir = process.cwd();
const SCRATCH_ROOT = path.join(rootDir, 'e2e-data', 'setup-wizard');
const SCRATCH_PORT = 5003;
const SCRATCH_BASE = `http://127.0.0.1:${SCRATCH_PORT}`;

/** The scratch server port (mirrors playwright.config.ts setup-wizard baseURL). */
export const scratchPort = SCRATCH_PORT;

// The wizard is the only writer of the keys below. Stripping them from the
// spawned child's env (plus the scratch isolation keys, which we set ourselves)
// guarantees a developer's shell can never leak real config into the scratch
// instance — real process env always wins over dotenv (override: false).
const CONFIG_ENV_KEYS = [
  'DOTENV_CONFIG_PATH',
  'WEA_SQLITE_PATH',
  'WEA_STORAGE_BACKEND',
  'WEA_PG_HOST',
  'WEA_PG_PORT',
  'WEA_PG_DATABASE',
  'WEA_PG_USER',
  'WEA_PG_PASSWORD',
  'WEA_PG_SSL',
  'WEA_PG_MAX',
  'WEA_FILE_STORAGE',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ENDPOINT',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'WEBDAV_URL',
  'WEBDAV_UPSTREAM_URL',
  'WEBDAV_USERNAME',
  'WEBDAV_PASSWORD',
  'WEBDAV_AUTH_TYPE',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'PORT',
  'CORS_ORIGINS',
  'CORS_ORIGIN',
  'ADMIN_DEFAULT_PASSWORD',
  'EMAIL_HOST',
  'EMAIL_PORT',
  'EMAIL_USER',
  'EMAIL_PASSWORD',
  'EMAIL_SECURE',
  'EMAIL_FROM_NAME',
  'WEA_DISABLE_DEFAULT_ADMIN',
  'GC_ORPHAN_TTL_DAYS',
];

// Docker-compose defaults (mirror e2e/global-setup.ts). The scratch PG helpers
// connect to the e2e Postgres superuser on the host-exposed :5433.
const PG_HOST = '127.0.0.1';
const PG_PORT = 5433;
const PG_USER = process.env.WEA_PG_USER || 'e2etest';
const PG_PASSWORD = process.env.WEA_PG_PASSWORD || 'e2etest';

// bytemark/webdav container defaults (mirror e2e/global-setup.ts).
const WEBDAV_BASE = 'http://127.0.0.1:8090';
const WEBDAV_AUTH = Buffer.from('e2etest:e2etest123').toString('base64');

type PgPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  end: () => Promise<void>;
};

type PgPoolFactory = new (config: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}) => PgPool;

function getPg() {
  const { Pool } = require('pg') as { Pool: PgPoolFactory };
  return Pool;
}

/** Absolute path to a case's scratch directory (`e2e-data/setup-wizard/<case>/`). */
export function scratchDirFor(caseId: string): string {
  return path.join(SCRATCH_ROOT, caseId);
}

/**
 * Ensure `client/build` exists (PLAN.md D4: the scratch server serves the SPA
 * statically, same-origin `/api`). No-op when the build is already present.
 */
export function ensureClientBuild(): void {
  const buildIndex = path.join(rootDir, 'client', 'build', 'index.html');
  if (fs.existsSync(buildIndex)) return;
  console.log('[setup-scratch] client/build missing — building client...');
  const result = spawnSync('npm', ['run', 'build', '--workspace', 'client'], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (result.status !== 0 || !fs.existsSync(buildIndex)) {
    throw new Error('client build did not produce client/build/index.html');
  }
}

/**
 * Spawn the scratch server (boot 1 or boot 2) with hermetic isolation:
 * cwd=scratch (so the bare dotenv fallback reads `<scratch>/.env`, never a
 * developer's root `.env`), own port, own env file path, own sqlite path.
 */
export function spawnScratchServer(
  scratchDir: string,
  extraEnv: NodeJS.ProcessEnv = {}
): ChildProcess {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const key of CONFIG_ENV_KEYS) delete childEnv[key];
  Object.assign(childEnv, {
    PORT: String(SCRATCH_PORT),
    NODE_ENV: 'test',
    DOTENV_CONFIG_PATH: path.join(scratchDir, '.env'),
    WEA_SQLITE_PATH: path.join(scratchDir, 'webdav.db'),
    ...extraEnv,
  });

  const child = spawn(process.execPath, [path.join(rootDir, 'server', 'index.js')], {
    cwd: scratchDir,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (d: Buffer) =>
    process.stdout.write(`[setup-scratch:${SCRATCH_PORT}] ${d}`)
  );
  child.stderr?.on('data', (d: Buffer) =>
    process.stderr.write(`[setup-scratch:${SCRATCH_PORT}] ${d}`)
  );

  return child;
}

function pollHealth(timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;

    const attempt = () => {
      const req = http.get(`${SCRATCH_BASE}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }
        scheduleRetry();
      });
      req.on('error', () => scheduleRetry());
    };

    const scheduleRetry = () => {
      if (settled) return;
      if (Date.now() - startedAt >= timeoutMs) {
        settled = true;
        reject(
          new Error(
            `Scratch server on :${SCRATCH_PORT} did not become healthy within ${timeoutMs}ms`
          )
        );
        return;
      }
      setTimeout(attempt, 500);
    };

    attempt();
  });
}

/** Poll `/api/health` until 200. Server only listens after metadata init, so health 200 implies boot completed. */
export function waitForScratchHealth(child: ChildProcess, timeoutMs = 60_000): Promise<void> {
  return pollHealth(timeoutMs).catch((err) => {
    throw new Error(
      `${err.message}; child exited: ${child.exitCode !== null ? `code ${child.exitCode}` : 'still running'}`
    );
  });
}

/** SIGKILL the scratch server and await process exit. */
export async function killScratch(child: ChildProcess): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGKILL');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Parse the scratch `.env` into a plain key -> value object (dotenv assignment format). */
export function readEnvFile(scratchDir: string): Record<string, string> {
  const envPath = path.join(scratchDir, '.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=(.*)$/.exec(line);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

async function pgSuperuserQuery(sql: string): Promise<void> {
  const Pool = getPg();
  const pool = new Pool({
    host: PG_HOST,
    port: PG_PORT,
    database: 'postgres',
    user: PG_USER,
    password: PG_PASSWORD,
  });
  try {
    await pool.query(sql);
  } finally {
    await pool.end();
  }
}

/** Create the scratch metadata PG database (idempotent). */
export async function createScratchPgDb(dbName = 'webdav_e2e_setup'): Promise<void> {
  try {
    await pgSuperuserQuery(`CREATE DATABASE ${dbName}`);
  } catch (err) {
    const error = err as { code?: string };
    if (error?.code !== '42P04') throw err; // 42P04 = duplicate_database
  }
}

/** Drop the scratch metadata PG database (idempotent; FORCE terminates lingering connections). */
export async function dropScratchPgDb(dbName = 'webdav_e2e_setup'): Promise<void> {
  try {
    await pgSuperuserQuery(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  } catch (err) {
    const error = err as { code?: string };
    if (error?.code !== '3D000') throw err; // 3D000 = invalid_catalog_name (IF EXISTS race)
  }
}

/**
 * Run a read-only query against the scratch metadata PG database. Used for
 * Case 3 assertions (schema + seeded admin live in PG, not the scratch sqlite).
 * Creates and closes its own pool so it never leaks handles.
 */
export async function queryScratchPg<T = Record<string, unknown>>(
  dbName: string,
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const Pool = getPg();
  const pool = new Pool({
    host: PG_HOST,
    port: PG_PORT,
    database: dbName,
    user: PG_USER,
    password: PG_PASSWORD,
  });
  try {
    const result = await pool.query(text, params);
    return result.rows as T[];
  } finally {
    await pool.end();
  }
}

/**
 * Run a read-only query against a scratch sqlite file (Case 3: prove the
 * wizard's postgresql apply never seeded/updated users in the scratch sqlite
 * store). sqlite3 has no types; the local structural type keeps it typed.
 */
export function queryScratchSqlite<T = Record<string, unknown>>(
  dbPath: string,
  sql: string
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const { Database } = require('sqlite3') as {
      Database: new (path: string) => {
        all: (sql: string, cb: (err: Error | null, rows: T[]) => void) => void;
        close: (cb?: (err: Error | null) => void) => void;
      };
    };
    const db = new Database(dbPath);
    db.all(sql, (err, rows) => {
      db.close(() => {});
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/**
 * Ensure the webdav case subtree `/setup-e2e/<caseId>/` exists on the shared
 * bytemark container (MKCOL each missing segment). The wizard's WebDAV URL is
 * pointed at the subtree so each scratch case keeps its blobs isolated on the
 * always-up webdav server.
 *
 * global-setup wipes `data/webdav` (the container's bind mount) unconditionally,
 * but only restarts the webdav container in webdav mode. In s3 mode the in-container
 * dav root is deleted with no restart, so Apache 403s every DAV method until the
 * container is restarted. We therefore restore the dav root first (restart +
 * PROPFIND wait) when it is missing, then MKCOL each missing segment with retry
 * (mod_dav can still be settling right after the restart).
 */
export async function ensureWebdavSubtree(caseId: string): Promise<void> {
  await ensureWebdavRootReady();

  const segments = caseId.split('/').filter(Boolean);
  if (segments.length === 0) return;
  const fullPath = ['setup-e2e', ...segments];
  let current = '';
  for (const segment of fullPath) {
    current += `/${segment}`;
    await mkcol(`${WEBDAV_BASE}${current}`);
  }
}

/** Restore the webdav dav root (restart the container when PROPFIND / is not 200/207). */
async function ensureWebdavRootReady(): Promise<void> {
  if (await propfindRootOk(2)) return;

  console.log('[setup-scratch] webdav dav root missing — restarting webdav-e2e-test...');
  execFileSync('docker', ['restart', 'webdav-e2e-test'], { cwd: rootDir, stdio: 'inherit' });

  const startedAt = Date.now();
  // eslint-disable-next-line no-await-in-loop
  while (!(await propfindRootOk(1))) {
    if (Date.now() - startedAt > 60_000) {
      throw new Error('webdav dav root did not become reachable after restarting webdav-e2e-test');
    }
  }
}

/** PROPFIND `/`; resolves true when the dav root responds 200/207 (dav root exists). */
function propfindRootOk(attempts: number): Promise<boolean> {
  return new Promise((resolve) => {
    let attempt = 0;

    const tryOnce = () => {
      attempt += 1;
      const req = http.request(
        `${WEBDAV_BASE}/`,
        {
          method: 'PROPFIND',
          headers: { Authorization: `Basic ${WEBDAV_AUTH}`, Depth: '1' },
          timeout: 5000,
        },
        (res) => {
          res.resume();
          const status = res.statusCode || 0;
          if (status === 200 || status === 207) {
            resolve(true);
            return;
          }
          if (attempt < attempts) setTimeout(tryOnce, 1000);
          else resolve(false);
        }
      );
      req.on('timeout', () => {
        if (attempt < attempts) {
          req.destroy();
          setTimeout(tryOnce, 1000);
          return;
        }
        req.destroy();
        resolve(false);
      });
      req.on('error', () => {
        if (attempt < attempts) setTimeout(tryOnce, 1000);
        else resolve(false);
      });
      req.end();
    };

    tryOnce();
  });
}

const MKCOL_ATTEMPTS = 6;
const MKCOL_BACKOFF_MS = 1000;

function mkcol(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const tryOnce = () => {
      attempt += 1;
      const req = http.request(
        url,
        { method: 'MKCOL', headers: { Authorization: `Basic ${WEBDAV_AUTH}` }, timeout: 5000 },
        (res) => {
          res.resume();
          const status = res.statusCode || 0;
          // 201 created, 405/301/302/303 already-exists (bytemark), 409 raced.
          const ok = status >= 200 && status < 300;
          const tolerated = [405, 301, 302, 303, 409].includes(status);
          if (ok || tolerated) {
            resolve();
            return;
          }
          // Transient while the restarted container settles; retry.
          if (attempt < MKCOL_ATTEMPTS) {
            setTimeout(tryOnce, MKCOL_BACKOFF_MS);
            return;
          }
          reject(
            new Error(`MKCOL ${url} failed with status ${status} after ${MKCOL_ATTEMPTS} attempts`)
          );
        }
      );
      req.on('timeout', () => {
        if (attempt < MKCOL_ATTEMPTS) {
          req.destroy();
          setTimeout(tryOnce, MKCOL_BACKOFF_MS);
          return;
        }
        req.destroy(new Error(`MKCOL ${url} timed out after ${MKCOL_ATTEMPTS} attempts`));
      });
      req.on('error', (err) => {
        if (attempt < MKCOL_ATTEMPTS) {
          setTimeout(tryOnce, MKCOL_BACKOFF_MS);
          return;
        }
        reject(err);
      });
      req.end();
    };

    tryOnce();
  });
}
