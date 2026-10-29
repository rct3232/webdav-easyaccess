import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync, execFileSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';

import { expect, type Page } from '@playwright/test';

import { composeProject, e2ePorts, s3Endpoint, webdavBase } from './ports';
import { emptyS3Bucket, ensureS3BucketExists } from './minio';

/**
 * Hermetic scratch-instance helpers for the backend-split E2E suites
 * (`*.s3.spec.ts` / `*.webdav.spec.ts`). These suites cannot use the shared E2E
 * infrastructure (the band's API/client servers and the shared `webdav_e2e` PG
 * database) because each one spawns and supervises its own scratch instance
 * with its own metadata store and file backend; in the wizard case restart is
 * the behavior under test.
 *
 * Every helper here is scratch-owned: own `.env` via `DOTENV_CONFIG_PATH`, own
 * sqlite path, own scratch PG database (`webdav_e2e_setup`, separate from the
 * read-only `webdav_e2e` used by the shared E2E infrastructure).
 *
 * Port contract (Option A Phase 1 + band isolation 2026-09-30): each hermetic
 * suite owns ONE distinct scratch port slot so the suites can run
 * concurrently — setup-wizard (base :5003, the exported `scratchPort`),
 * admin-config (:5010), migration (:5011), trash-admin (:5012), collections
 * (:5013, dual-platform chained); every slot shifts with this checkout's port band
 * (`e2e/helpers/ports.ts`). The port
 * is passed explicitly to `spawnScratchServer`/`waitForScratchHealth` and must
 * match the suite's playwright.config.ts baseURL. `pg` is required via
 * `createRequire` (ships no types; the local structural type keeps the surface
 * typed without a new dependency).
 */

const require = createRequire(__filename);

const rootDir = process.cwd();
const SCRATCH_ROOT = path.join(rootDir, 'e2e-data', 'setup-wizard');
const SCRATCH_PORT = e2ePorts.scratchWizard;

/** The setup-wizard suite's scratch server port (mirrors playwright.config.ts setup-wizard baseURL). */
export const scratchPort = SCRATCH_PORT;

// The wizard is the only writer of the keys below. Stripping them from the
// spawned child's env (plus the scratch isolation keys, which we set ourselves)
// guarantees a developer's shell can never leak real config into the scratch
// instance — real process env always wins over dotenv (override: false).
const CONFIG_ENV_KEYS = [
  'DOTENV_CONFIG_PATH',
  'WEA_SQLITE_PATH',
  'WEA_DB_HOST',
  'WEA_DB_PORT',
  'WEA_DB_DATABASE',
  'WEA_DB_USER',
  'WEA_DB_PASSWORD',
  'WEA_DB_SSL',
  'WEA_DB_MAX',
  'WEA_DB_QUERY_TIMEOUT_MS',
  'WEA_FILE_STORAGE',
  'S3_BUCKET',
  'S3_ENDPOINT',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'WEBDAV_URL',
  'WEBDAV_UPSTREAM_URL',
  'WEBDAV_USERNAME',
  'WEBDAV_PASSWORD',
  'WEBDAV_AUTH_TYPE',
  'WEA_MODEL_DIR',
  'WEA_SKIP_EMBED_MODEL',
  // Ambient truthy values would silently disable the worker. The seam is a
  // truthy check, so never set it to '0'; absence is the enabled state.
  'WEA_SKIP_AI_WORKER',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'PORT',
  'CORS_ORIGINS',
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
// connect to the e2e Postgres superuser on this band's host-exposed port.
const PG_HOST = '127.0.0.1';
const PG_PORT = e2ePorts.pg;
const PG_USER = process.env.WEA_DB_USER || 'e2etest';
const PG_PASSWORD = process.env.WEA_DB_PASSWORD || 'e2etest';

// bytemark/webdav container defaults (mirror e2e/global-setup.ts).
const WEBDAV_BASE = webdavBase;
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

/** Project slug used by every project-scoped scratch resource. */
export function scratchProjectSlug(projectName: string): string {
  return projectName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

/** Absolute path to a case's scratch directory, scoped by project when supplied. */
export function scratchDirFor(caseId: string, projectName?: string): string {
  const scopedCase = projectName ? `${caseId}-${scratchProjectSlug(projectName)}` : caseId;
  return path.join(SCRATCH_ROOT, scopedCase);
}

/** S3 bucket owned by one E2E project. */
export function scratchS3Bucket(projectName: string, prefix = 'e2e-scratch'): string {
  return `${prefix}-${scratchProjectSlug(projectName)}`;
}

/** Environment required by a scratch server that uses the S3 file backend. */
export function s3ScratchEnv(bucket: string): Record<string, string> {
  return {
    WEA_FILE_STORAGE: 's3',
    S3_BUCKET: bucket,
    S3_ENDPOINT: process.env.S3_ENDPOINT || s3Endpoint,
    AWS_REGION: process.env.AWS_REGION || 'us-east-1',
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || 'minioadmin',
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin',
  };
}

/** Non-AI scratch servers must not load the embedding worker/model. */
export function scratchRuntimeEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    WEA_SKIP_AI_WORKER: '1',
    WEA_SKIP_EMBED_MODEL: '1',
    ...extra,
  };
}

// Build bootstrap delegated to the shared scripts/lib module (single freshness
// + eslint-disabled build path for ALL E2E entry points — see that file's
// header for the rationale).
export function ensureClientBuild(): void {
  require('../../scripts/lib/ensureClientBuild.js').ensureClientBuild(rootDir, '[setup-scratch]');
}

/**
 * Spawn the scratch server (boot 1 or boot 2) with hermetic isolation:
 * cwd=scratch (so the bare dotenv fallback reads `<scratch>/.env`, never a
 * developer's root `.env`), explicit suite port (see module header), own env
 * file path, own sqlite path.
 */
export function spawnScratchServer(
  scratchDir: string,
  port: number,
  extraEnv: NodeJS.ProcessEnv = {}
): ChildProcess {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const key of CONFIG_ENV_KEYS) delete childEnv[key];
  Object.assign(childEnv, {
    PORT: String(port),
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

  const stderrTail: string[] = [];
  child.stdout?.on('data', (d: Buffer) => process.stdout.write(`[setup-scratch:${port}] ${d}`));
  child.stderr?.on('data', (d: Buffer) => {
    const text = String(d);
    stderrTail.push(text);
    if (stderrTail.length > 40) stderrTail.shift();
    process.stderr.write(`[setup-scratch:${port}] ${text}`);
  });
  child.on('exit', (code, signal) => {
    // Normal teardown is SIGKILL; only surface abnormal exits with the tail.
    if (code === 0 || signal === 'SIGKILL') return;
    console.error(
      `[setup-scratch:${port}] exited code=${code} signal=${signal}\n${stderrTail.join('')}`
    );
  });

  return child;
}

function pollHealth(timeoutMs: number, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;

    const attempt = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
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
          new Error(`Scratch server on :${port} did not become healthy within ${timeoutMs}ms`)
        );
        return;
      }
      setTimeout(attempt, 500);
    };

    attempt();
  });
}

/** Poll `/api/health` until 200. Server only listens after metadata init, so health 200 implies boot completed. */
export function waitForScratchHealth(
  child: ChildProcess,
  port: number,
  timeoutMs = 60_000
): Promise<void> {
  return pollHealth(timeoutMs, port).catch((err) => {
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

/** Write `KEY=value` lines into the scratch `.env` (0600), keys in insertion order. */
export function writeScratchEnv(scratch: string, entries: Record<string, string>): void {
  const content =
    Object.entries(entries)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n';
  fs.writeFileSync(path.join(scratch, '.env'), content, { mode: 0o600 });
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
 * Run a write/DDL statement against a scratch sqlite file (its own connection,
 * closed afterwards). Used by the migration spec to seed object_map rows and
 * flood the source `settings` table. sqlite3 has no types; the local
 * structural type keeps it typed.
 */
export function execScratchSqlite(dbPath: string, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { Database } = require('sqlite3') as {
      Database: new (path: string) => {
        run: (sql: string, cb: (err: Error | null) => void) => void;
        close: (cb?: (err: Error | null) => void) => void;
      };
    };
    const db = new Database(dbPath);
    db.run(sql, (err) => {
      db.close(() => {});
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Pre-seed the scratch metadata sqlite with DB-sourced WebDAV connection keys
 * BEFORE the server's first boot (admin-config + migration pattern) so the
 * app's webdav blob store resolves WEBDAV_URL from the DB (to `url`) and
 * `setup_complete` derives true. The settings table schema mirrors the
 * converted DDL (CREATE TABLE IF NOT EXISTS makes the boot re-init a no-op).
 * App-layer field encryption was removed, so secret rows (WEBDAV_PASSWORD) are
 * stored as plaintext and read back directly by the server. Defaults `url` to
 * the shared WEBDAV_BASE.
 */
export async function seedWebdavSettings(scratchDir: string, url: string): Promise<void> {
  if (!url) throw new Error('seedWebdavSettings requires the case-scoped WebDAV URL');
  const dbPath = path.join(scratchDir, 'webdav.db');
  await execScratchSqlite(
    dbPath,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  );
  const rows: Array<[string, string]> = [
    ['WEBDAV_URL', url],
    ['WEBDAV_USERNAME', 'e2etest'],
    ['WEBDAV_PASSWORD', 'e2etest123'],
    ['WEBDAV_AUTH_TYPE', 'auto'],
  ];
  for (const [key, value] of rows) {
    await execScratchSqlite(
      dbPath,
      `INSERT OR REPLACE INTO settings (key, value) VALUES ('${key}', '${value}')`
    );
  }
}

/** THE scratch WebDAV root contract: every case owns `/setup-e2e/<project>/<caseId>`. */
export function scratchWebdavUrl(caseId: string, projectName?: string): string {
  const scopedCase = projectName ? `${scratchProjectSlug(projectName)}/${caseId}` : caseId;
  return `${WEBDAV_BASE}/setup-e2e/${scopedCase}`;
}

/**
 * Prepare the case-scoped WebDAV root BEFORE the scratch server boots and seed
 * the SAME URL into the scratch DB. Server URL, upstream URL, subtree creation
 * and the physical user homes all derive from this one value.
 */
export async function prepareScratchWebdav(
  scratchDir: string,
  caseId: string,
  projectName?: string
): Promise<string> {
  const url = scratchWebdavUrl(caseId, projectName);
  await ensureWebdavSubtree(projectName ? `${scratchProjectSlug(projectName)}/${caseId}` : caseId);
  await seedWebdavSettings(scratchDir, url);
  return url;
}

/** Prepare the S3 bucket owned by one scratch project; empty it for a deterministic run. */
export async function prepareScratchS3(
  projectName: string,
  bucketPrefix = 'e2e-scratch'
): Promise<string> {
  const bucket = scratchS3Bucket(projectName, bucketPrefix);
  await ensureS3BucketExists(bucket);
  await emptyS3Bucket(bucket);
  return bucket;
}

/** Unified scratch storage setup for S3 and WebDAV hermetic suites. */
export async function prepareScratchStorage(
  scratchDir: string,
  caseId: string,
  backend: 's3' | 'webdav',
  projectName: string
): Promise<{ backend: 's3' | 'webdav'; bucket?: string; webdavUrl?: string }> {
  if (backend === 'webdav') {
    const webdavUrl = await prepareScratchWebdav(scratchDir, caseId, projectName);
    return { backend, webdavUrl };
  }
  const bucket = await prepareScratchS3(projectName);
  return { backend, bucket };
}

/**
 * Ensure the webdav case subtree `/setup-e2e/<caseId>/` exists on the shared
 * bytemark container (MKCOL each missing segment). The wizard's WebDAV URL is
 * pointed at the subtree so each scratch case keeps its blobs isolated on the
 * always-up webdav server.
 *
 * global-setup wipes `data/webdav` (the container's bind mount) unconditionally
 * and restarts the webdav container in both modes, so the dav root is normally
 * already restored here. This PROPFIND check is a belt-and-braces safety net for
 * the `reuseExistingServer` developer loop; it restarts only when the root is
 * still missing, then MKCOL each missing segment with retry (mod_dav can still
 * be settling right after the restart).
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
  // MKCOL 409/405 is tolerated as "already exists" by mkcol(); verify the
  // final collection is actually reachable so a bad parent surfaces HERE, not
  // as a 500 in the first folders/create request.
  await assertCollection(`${WEBDAV_BASE}${current}/`);
}

/** PROPFIND Depth:0 assertion for a prepared scratch collection. */
function assertCollection(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: 'PROPFIND',
        headers: { Authorization: `Basic ${WEBDAV_AUTH}`, Depth: '0' },
        timeout: 5000,
      },
      (res) => {
        res.resume();
        const status = res.statusCode || 0;
        if (status === 200 || status === 207) resolve();
        else reject(new Error(`scratch WebDAV collection ${url} is not reachable (${status})`));
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`scratch WebDAV collection ${url} PROPFIND timed out`));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Restore the webdav dav root (compose-restart the webdav-test service when PROPFIND / is not 200/207). */
async function ensureWebdavRootReady(): Promise<void> {
  if (await propfindRootOk(2)) return;

  console.log('[setup-scratch] webdav dav root missing — compose restart webdav-test...');
  execFileSync(
    'docker',
    [
      'compose',
      '-p',
      composeProject,
      '-f',
      path.join(rootDir, 'docker-compose.e2e.yml'),
      'restart',
      'webdav-test',
    ],
    { cwd: rootDir, stdio: 'inherit' }
  );

  const startedAt = Date.now();
  // eslint-disable-next-line no-await-in-loop
  while (!(await propfindRootOk(1))) {
    if (Date.now() - startedAt > 60_000) {
      throw new Error('webdav dav root did not become reachable after restarting webdav-test');
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

/**
 * Navigate to `/mypage` and open the System settings category. MyPage returns
 * null until the async getMe() resolves; on mobile the category sidebar lives
 * in a non-keepMounted SwipeableDrawer. A one-shot isVisible()/count() right
 * after goto races React mount — both resolve to 0/0 before the app loads, the
 * drawer is never opened, and the later click() times out against the unmounted
 * drawer content. Wait for the MyPage shell first, then branch on the
 * mobile-only menu button.
 */
export async function openSystemSettings(page: Page): Promise<void> {
  await page.goto('/mypage');
  const systemSettings = page.getByRole('button', { name: /system settings/i });
  const menuButton = page.locator('button[aria-label="My page"]');
  await expect(menuButton.or(systemSettings).first()).toBeVisible({ timeout: 20000 });
  if ((await menuButton.count()) > 0) {
    await menuButton.click();
    await expect(page.locator('.MuiDrawer-paper')).toBeVisible();
  }
  await systemSettings.click();
  await expect(page.getByRole('heading', { level: 6, name: /system settings/i })).toBeVisible();
}
