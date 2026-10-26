import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';

import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

import { TEST_FILES } from './fixtures/test-data';
import { loginWithCredentials } from './helpers/auth';
import { readTestFileFixture } from './helpers/files';
import { blobExists, ensureS3BucketExists, listS3Keys } from './helpers/minio';
import { e2ePorts, s3Endpoint } from './helpers/ports';
import {
  createScratchPgDb,
  dropScratchPgDb,
  ensureClientBuild,
  killScratch,
  prepareScratchStorage,
  queryScratchSqlite,
  s3ScratchEnv,
  scratchDirFor,
  scratchRuntimeEnv,
  scratchS3Bucket,
  scratchWebdavUrl,
  spawnScratchServer,
  waitForScratchHealth,
  writeScratchEnv,
} from './helpers/setupScratch';

/**
 * Shared harness for the split unified-migration suites.
 *
 * `migration.s3.spec.ts` runs the backend-agnostic/meta flows on the default S3
 * file backend. `migration.webdav.spec.ts` keeps the cases whose source-of-truth
 * is a real WebDAV upload (native webdav files without object_map rows) and
 * targets a project-scoped S3 destination bucket.
 *
 * Every case owns a project-scoped scratch dir, port, source bucket or WebDAV
 * root, destination bucket (`e2e-migration-<project>`) and PG target database
 * (project slug included). The migration gate is process-global, so each case
 * boots its own scratch server and the file runs serial.
 */

export const PG_HOST = '127.0.0.1';
export const PG_PORT = String(e2ePorts.pg);
export const PG_USER = 'e2etest';
export const PG_PASSWORD = 'e2etest';

export const ADMIN_PASSWORD = 'MigrationE2e!123';
export const JWT_SECRET = 'migration-e2e-jwt-secret';

export const S3_ENDPOINT = s3Endpoint;
export const S3_REGION = 'us-east-1';
export const S3_ACCESS_KEY = 'minioadmin';
export const S3_SECRET_KEY = 'minioadmin';

export const textFixture = readTestFileFixture(TEST_FILES.smallText);

// The metadata DDL applied to scratch PG targets when a flow needs to pre-seed
// target data (Flow D-1's wipe-alert path).
export const METADATA_DDL = fs.readFileSync(
  path.join(
    process.cwd(),
    'server',
    'store',
    'postgresql',
    'ddl',
    '001_initial_normalized_schema.sql'
  ),
  'utf8'
);

export type MigrationBackend = 's3' | 'webdav';

export type MigrationBootOptions = {
  caseId: string;
  backend: MigrationBackend;
  /**
   * Create a project-scoped scratch PG target database for this case (dropped
   * in cleanup). A flow that later points the app at the target passes the full
   * WEA_DB_* block to the respawned server.
   */
  withPgTarget?: boolean;
  extraEnv?: Record<string, string>;
};

export type MigrationScratchState = {
  scratch: string;
  port: number;
  baseURL: string;
  backend: MigrationBackend;
  pgDb: string | null;
  destBucket: string;
  child: ChildProcess | null;
};

/** The migration scratch port for the project's platform. */
export function migrationPort(projectName: string): number {
  return projectName.endsWith('-mobile')
    ? e2ePorts.scratchMigrationMobile
    : e2ePorts.scratchMigration;
}

/** The project's dedicated blob-migration destination bucket. */
export function migrationDestBucket(projectName: string): string {
  return scratchS3Bucket(projectName, 'e2e-migration');
}

function slugify(value: string): string {
  return value
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}

/** PostgreSQL identifiers are max 63 bytes; truncate long project+case names deterministically. */
function pgIdentifier(raw: string): string {
  const normalized = raw.replace(/[^a-z0-9_]+/gi, '_').toLowerCase();
  if (normalized.length <= 63) return normalized;
  const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 8);
  return `${normalized.slice(0, 54)}_${hash}`;
}

/** Project-scoped migration PG target database (hyphens are not valid unquoted). */
export function migrationPgTarget(projectName: string, caseId: string): string {
  return pgIdentifier(
    `webdav_e2e_migration_${slugify(projectName).replace(/-/g, '_')}_${slugify(caseId).replace(
      /-/g,
      '_'
    )}`
  );
}

async function spawnMigrationServer(
  state: MigrationScratchState,
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<void> {
  state.child = spawnScratchServer(state.scratch, state.port, scratchRuntimeEnv(extraEnv));
  await waitForScratchHealth(state.child, state.port);
}

/**
 * Per-test scratch lifecycle: fresh project-scoped dir + .env, S3 source bucket
 * or WebDAV root, optional scratch PG target, then boot the server and wait for
 * health. S3 cases boot on the S3 file backend; webdav cases boot on the
 * project/case-scoped bytemark root. Metadata stays sqlite when no WEA_DB_*
 * identity keys are written.
 */
export async function bootMigrationScratch(
  testInfo: TestInfo,
  opts: MigrationBootOptions
): Promise<MigrationScratchState> {
  const projectName = testInfo.project.name;
  const scratch = scratchDirFor(`migration-${opts.backend}-${opts.caseId}`, projectName);
  const port = migrationPort(projectName);
  const pgDb = opts.withPgTarget ? migrationPgTarget(projectName, opts.caseId) : null;
  const state: MigrationScratchState = {
    scratch,
    port,
    baseURL: `http://127.0.0.1:${port}`,
    backend: opts.backend,
    pgDb,
    destBucket: migrationDestBucket(projectName),
    child: null,
  };

  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });

  try {
    ensureClientBuild();

    const env: Record<string, string> = {
      PORT: String(port),
      NODE_ENV: 'test',
      JWT_SECRET,
      ADMIN_DEFAULT_PASSWORD: ADMIN_PASSWORD,
      // Weak CI can take >5s to open a PG connection under parallel load.
      WEA_DB_CONNECTION_TIMEOUT_MS: '30000',
    };

    if (opts.backend === 'webdav') {
      const davRoot = `migration/${opts.caseId}`;
      Object.assign(env, {
        WEA_FILE_STORAGE: 'webdav',
        WEBDAV_UPSTREAM_URL: scratchWebdavUrl(davRoot, projectName),
      });
      writeScratchEnv(scratch, { ...env, ...opts.extraEnv });
      // prepareScratchWebdav seeds the same case-scoped URL into the scratch DB.
      await prepareScratchStorage(scratch, davRoot, 'webdav', projectName);
    } else {
      const prepared = await prepareScratchStorage(scratch, opts.caseId, 's3', projectName);
      if (!prepared.bucket) throw new Error('S3 scratch preparation returned no bucket');
      Object.assign(env, s3ScratchEnv(prepared.bucket));
      writeScratchEnv(scratch, { ...env, ...opts.extraEnv });
    }

    // The destination bucket is project-scoped and exists for every case; blob
    // cases empty it per case for a deterministic object-count baseline.
    await ensureS3BucketExists(state.destBucket);

    if (pgDb) {
      // Drop-then-create so a leftover DB from a crashed previous run (whose
      // cleanup never ran) can never make a flow see stale target data.
      await dropScratchPgDb(pgDb).catch(() => {});
      await createScratchPgDb(pgDb);
    }

    await spawnMigrationServer(state);
    testInfo.annotations.push({ type: 'migration-case', description: opts.caseId });
    return state;
  } catch (err) {
    await cleanupMigrationScratch(state);
    throw err;
  }
}

/** Restart the same scratch server (same `.env`, sqlite and buckets), optional extra env. */
export async function restartMigrationScratch(
  state: MigrationScratchState,
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<void> {
  if (state.child) {
    await killScratch(state.child);
    state.child = null;
  }
  await spawnMigrationServer(state, extraEnv);
}

/** Kill the scratch server, drop its PG target and remove the scratch directory. */
export async function cleanupMigrationScratch(state: MigrationScratchState): Promise<void> {
  if (state.child) {
    await killScratch(state.child);
    state.child = null;
  }
  if (state.pgDb) {
    await dropScratchPgDb(state.pgDb).catch(() => {});
  }
  fs.rmSync(state.scratch, { recursive: true, force: true });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loginToken(
  baseURL: string,
  request: APIRequestContext,
  username = 'admin',
  password = ADMIN_PASSWORD
): Promise<string> {
  const res = await request.post(`${baseURL}/api/auth/login`, {
    data: { username, password },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.token as string;
}

export async function loginAsAdminUi(page: Page): Promise<void> {
  await loginWithCredentials(page, 'admin', ADMIN_PASSWORD);
  await expect(page.getByTestId('file-actions-fab')).toBeVisible();
}

export async function assertOnSystemSettings(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 6, name: /system settings/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run storage migration' })).toBeVisible();
}

export async function openBlobMigrationDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Run storage migration' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Source:/)).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByLabel(/^Bucket/)).toBeVisible({ timeout: 60_000 });
}

export async function fillS3Dest(
  page: Page,
  dest: { bucket: string; accessKey: string; secretKey: string; endpoint?: string; region?: string }
): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Bucket/).fill(dest.bucket);
  await dialog.getByLabel(/^Access key/).fill(dest.accessKey);
  await dialog.getByLabel(/^Secret key/).fill(dest.secretKey);
  if (dest.endpoint) await dialog.getByLabel(/^Endpoint/).fill(dest.endpoint);
  if (dest.region) await dialog.getByLabel(/^Region/).fill(dest.region);
}

export async function startBlobMigrationFromDialog(
  page: Page,
  mode: 'dry-run' | 'apply'
): Promise<string> {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: mode === 'apply' ? 'Apply' : 'Dry run' }).check();
  const startResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/admin/migration/blobs') &&
      response.request().method() === 'POST'
  );
  await Promise.all([
    page.waitForURL(/\/migration(?:\/|$)/),
    dialog.getByRole('button', { name: 'Start', exact: true }).click(),
  ]);
  const response = await startResponse;
  expect(response.status()).toBe(202);
  const body = (await response.json()) as { jobId: string };
  return body.jobId;
}

export async function openMetadataMigrationDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Run metadata migration' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/^Host/)).toBeVisible();
}

export async function fillPgTarget(page: Page, database: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Host/).fill(PG_HOST);
  await dialog.getByLabel(/^Port/).fill(PG_PORT);
  await dialog.getByLabel(/^Database/).fill(database);
  await dialog.getByLabel(/^User/).fill(PG_USER);
  await dialog.getByLabel(/^Password/).fill(PG_PASSWORD);
}

/**
 * Wait for the /migration terminal modal (title driven by the terminal state)
 * and return its full text. Used instead of asserting a transient running state
 * so fast migrations cannot flake.
 */
export async function waitForTerminalModal(page: Page, timeout = 180_000): Promise<string> {
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout });
  await expect(modal.getByRole('button', { name: 'Go to settings' })).toBeVisible({ timeout });
  return (await modal.textContent()) ?? '';
}

/**
 * Poll the /migration page until the terminal modal appears, recording whether
 * a "Running" state was observed along the way (robust to fast completion).
 */
export async function observeMigration(
  page: Page,
  timeout = 180_000
): Promise<{ sawRunning: boolean }> {
  let sawRunning = false;
  const modal = page.getByRole('dialog');
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await modal.isVisible().catch(() => false)) return { sawRunning };
    if (
      await page
        .getByText('Running')
        .first()
        .isVisible()
        .catch(() => false)
    )
      sawRunning = true;
    await sleep(200);
  }
  await expect(modal).toBeVisible();
  return { sawRunning };
}

export async function createAdminFolder(
  baseURL: string,
  request: APIRequestContext,
  token: string,
  name: string
): Promise<number> {
  const res = await request.post(`${baseURL}/api/folders/create`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { parentNodeId: null, name },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.nodeId as number;
}

export async function uploadAdminFile(
  baseURL: string,
  request: APIRequestContext,
  token: string,
  parentNodeId: number,
  fileName: string
): Promise<number> {
  const res = await request.post(`${baseURL}/api/files/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: fileName, mimeType: 'text/plain', buffer: textFixture },
      parentNodeId: String(parentNodeId),
      onConflict: 'overwrite',
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.nodeId as number;
}

/**
 * Assert the REAL webdav-mode upload precondition produced by the app API
 * (no DB seeding): files uploaded through `fileService.uploadFile`'s webdav
 * branch stay `sync_status='pending_upload'` (createNode hardcodes it; only
 * the S3-mode uploadService TX2 sets 'active') and create NO `object_map`
 * row (`uploadToWebdav` only upserts filecache). This is exactly the defect
 * path the server-side source-mode-aware snapshot fix (MIG-001/002/E3) is
 * meant to migrate.
 */
export async function assertRealWebdavPrecondition(
  dbPath: string,
  nodeIds: number[]
): Promise<void> {
  const idList = nodeIds.join(', ');
  const nodes = await queryScratchSqlite<{ id: number; sync_status: string }>(
    dbPath,
    `SELECT id, sync_status FROM file_nodes WHERE id IN (${idList}) ORDER BY id`
  );
  expect(nodes).toHaveLength(nodeIds.length);
  for (const row of nodes) expect(row.sync_status).toBe('pending_upload');

  const maps = await queryScratchSqlite<{ cnt: number }>(
    dbPath,
    `SELECT COUNT(*) AS cnt FROM object_map WHERE file_node_id IN (${idList})`
  );
  expect(Number(maps[0].cnt)).toBe(0);
}

/**
 * Assert the post-migration state for a list of uploaded webdav-source nodes
 * (the fix's new behavior): an active `s3` object_map row per file, every
 * node `sync_status='active'`, the S3 objects present (count + existence).
 * The exact `listS3Keys(destBucket)` count is only meaningful when the
 * destination bucket was emptied before the run (each blob case calls
 * `emptyS3Bucket(state.destBucket)`).
 */
export async function assertPostMigrationBlobState(
  dbPath: string,
  nodeIds: number[],
  destBucket: string
): Promise<Array<{ file_node_id: number; s3_key: string }>> {
  const idList = nodeIds.join(', ');
  const activeRows = await queryScratchSqlite<{ file_node_id: number; s3_key: string | null }>(
    dbPath,
    `SELECT file_node_id, s3_key FROM object_map
     WHERE status = 'active' AND storage_backend = 's3' AND file_node_id IN (${idList})
     ORDER BY file_node_id`
  );
  expect(activeRows).toHaveLength(nodeIds.length);
  for (const row of activeRows) expect(row.s3_key).toBeTruthy();

  const nodes = await queryScratchSqlite<{ id: number; sync_status: string }>(
    dbPath,
    `SELECT id, sync_status FROM file_nodes WHERE id IN (${idList}) ORDER BY id`
  );
  for (const row of nodes) expect(row.sync_status).toBe('active');

  const s3Keys = await listS3Keys(destBucket);
  expect(s3Keys).toHaveLength(nodeIds.length);
  for (const row of activeRows)
    expect(await blobExists(row.s3_key as string, destBucket)).toBe(true);

  return activeRows as Array<{ file_node_id: number; s3_key: string }>;
}

export async function pollJobStatus(
  baseURL: string,
  request: APIRequestContext,
  token: string,
  jobId: string,
  statuses: string[],
  timeout = 90_000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeout;
  let last: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    const res = await request.get(`${baseURL}/api/admin/migration/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok()) {
      const job = (await res.json()) as Record<string, unknown>;
      last = job;
      if (statuses.includes(String(job.status))) return job;
    }
    await sleep(150);
  }
  throw new Error(`Job ${jobId} did not reach ${statuses.join('/')}; last=${JSON.stringify(last)}`);
}

export async function pollJobStatusUntil(
  baseURL: string,
  request: APIRequestContext,
  token: string,
  jobId: string,
  predicate: (job: Record<string, any>) => boolean,
  timeout = 90_000,
  intervalMs = 120
): Promise<Record<string, any>> {
  const deadline = Date.now() + timeout;
  let last: Record<string, any> | null = null;
  while (Date.now() < deadline) {
    const res = await request.get(`${baseURL}/api/admin/migration/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok()) {
      const job = (await res.json()) as Record<string, any>;
      last = job;
      if (predicate(job)) return job;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Job ${jobId} did not satisfy predicate; last=${JSON.stringify(last)}`);
}

export async function waitForGateInactive(
  baseURL: string,
  request: APIRequestContext,
  timeout = 20_000
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const res = await request.get(`${baseURL}/api/migration/status`);
    const body = (await res.json()) as { active?: boolean };
    if (!body.active) return;
    await sleep(150);
  }
  throw new Error('migration gate did not clear');
}

/** A local TCP server that accepts connections and never replies (S3 probe hang). */
export function startTarpit(): Promise<net.Server> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on('error', () => {});
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

export function tarpitEndpoint(server: net.Server): string {
  const address = server.address() as net.AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
