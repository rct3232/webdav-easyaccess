import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

import { TEST_FILES } from './fixtures/test-data';
import { loginWithCredentials } from './helpers/auth';
import { readTestFileFixture } from './helpers/files';
import { blobExists, emptyS3Bucket, listS3Keys } from './helpers/minio';
import {
  createScratchPgDb,
  dropScratchPgDb,
  ensureClientBuild,
  ensureWebdavSubtree,
  execScratchSqlite,
  killScratch,
  openSystemSettings,
  queryScratchPg,
  queryScratchSqlite,
  scratchDirFor,
  seedWebdavSettings,
  spawnScratchServer,
  waitForScratchHealth,
  writeScratchEnv,
} from './helpers/setupScratch';

/**
 * Unified migration mode E2E (PLAN.md D1–D14, docs/features/migration-mode.md).
 *
 * Hermetic by design: every case spawns its own fully-configured scratch server
 * on :5003 (own .env via DOTENV_CONFIG_PATH, own sqlite, own scratch PG target
 * database) and drives the migration dialogs + /migration page in the browser.
 * The shared :5002 server / `webdav_e2e` PG database / `e2e-test-bucket` are
 * only used for the docker infra (webdav :8090 subtree, minio :9010 bucket,
 * scratch PG superuser on :5433) — never pointed at by a migration target.
 *
 * The migration gate is process-global, so every migration must run against its
 * own scratch server with the per-test before/after kill, serialized (the fixed
 * :5003 port also forces this, same convention as admin-config / setup-wizard).
 *
 * Test-side deviations from the original task notes (all verified against the
 * running feature code before being made):
 * - Flow C gate hold does NOT use `WEA_SKIP_MIGRATION_WORKER=1`. The seam
 *   (`dispatchWorker`, server/domains/admin/routes/migration.js) deliberately
 *   skips `getMigrationGate().set(...)` when the seam is on ("never leaves a
 *   stale active gate behind" — covered by server tests), so no seam run can
 *   produce an active gate to hold. Flow C instead holds the gate with a real
 *   migration whose destination probe hangs on a local tarpit (a net.Server
 *   that accepts and never replies), which deterministically keeps the worker
 *   in `probeDestination` and the gate active.
 * - Flow C A8 performs a client-side (history API) navigation to `/mypage`
 *   from the already-authenticated SPA. A full page load of a PrivateRoute
 *   during a gate hold 503s `GET /api/users/me`, the auth layer clears the
 *   session and PrivateRoute navigates to /login — a route the app-guard
 *   exempts — racing the guard's /migration redirect (non-deterministic). The
 *   client-side navigation keeps the session intact, so the app-guard's
 *   force-redirect to /migration is the only navigation.
 */

const SCRATCH_BASE = 'http://127.0.0.1:5003';
const WEBDAV_BASE = 'http://127.0.0.1:8090';
const S3_ENDPOINT = 'http://127.0.0.1:9010';
const S3_BUCKET = 'e2e-test-bucket';
const S3_REGION = 'us-east-1';
const S3_ACCESS_KEY = 'minioadmin';
const S3_SECRET_KEY = 'minioadmin';

const PG_HOST = '127.0.0.1';
const PG_PORT = '5433';
const PG_USER = 'e2etest';
const PG_PASSWORD = 'e2etest';

const ADMIN_PASSWORD = 'MigrationE2e!123';
const JWT_SECRET = 'migration-e2e-jwt-secret';

const textFixture = readTestFileFixture(TEST_FILES.smallText);

// The metadata DDL applied to scratch PG targets when a flow needs to pre-seed
// target data (Flow D-1's wipe-alert path).
const METADATA_DDL = fs.readFileSync(
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

// Each case boots a fresh scratch server (:5003) + seeds + drives the full UI
// flow, so the default 30s test timeout is far too short. 240s per case.
test.describe.configure({ mode: 'serial', timeout: 240_000 });

let tarpit: net.Server | null = null;
let spawned: ReturnType<typeof spawnScratchServer> | null = null;
let currentScratch: string | null = null;
let currentPgDb: string | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(value: string): string {
  return value
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}

type BootOptions = {
  caseId: string;
  /** Ensure the isolated webdav subtree and seed WEBDAV_* DB settings. */
  withWebdav?: boolean;
  /**
   * Create a scratch PG target database for this case (dropped in afterEach).
   * The migration worker reaches it via the explicit dialog/API target
   * connection, never through the boot env — these cases boot the app on the
   * sqlite source, so no WEA_DB_* identity keys are written (sqlite is the
   * presence-selected default). A flow that later points the app at the target
   * passes the full WEA_DB_* block to the respawned server.
   */
  withPgTarget?: boolean;
  extraEnv?: Record<string, string>;
};

/**
 * Per-test scratch lifecycle: fresh dir + .env, optional webdav subtree / scratch
 * PG target, then boot the server on :5003 and wait for health. Every case
 * boots on sqlite (the migration source): no WEA_DB_* identity keys in the
 * env means presence-based selection defaults to the sqlite backend.
 */
async function bootScratch(testInfo: TestInfo, opts: BootOptions): Promise<void> {
  const scratch = scratchDirFor(`migration-${opts.caseId}`);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  currentScratch = scratch;

  ensureClientBuild();

  let pgDb: string | null = null;
  if (opts.withPgTarget) {
    // Hyphens are not valid in unquoted SQL identifiers (CREATE DATABASE).
    pgDb = `webdav_e2e_migration_${slugify(opts.caseId).replace(/-/g, '_')}`;
    currentPgDb = pgDb;
  }

  const env: Record<string, string> = {
    PORT: '5003',
    NODE_ENV: 'test',
    WEA_FILE_STORAGE: 'webdav',
    WEBDAV_UPSTREAM_URL: WEBDAV_BASE,
    JWT_SECRET,
    ADMIN_DEFAULT_PASSWORD: ADMIN_PASSWORD,
    ...opts.extraEnv,
  };
  writeScratchEnv(scratch, env);

  if (opts.withWebdav) {
    await ensureWebdavSubtree(`migration/${opts.caseId}`);
    await seedWebdavSettings(scratch, `${WEBDAV_BASE}/setup-e2e/migration/${opts.caseId}`);
  }
  if (pgDb) {
    // Drop-then-create so a leftover DB from a crashed previous run (whose
    // afterEach never ran) can never make a flow see stale target data.
    await dropScratchPgDb(pgDb).catch(() => {});
    await createScratchPgDb(pgDb);
  }

  spawned = spawnScratchServer(scratch);
  await waitForScratchHealth(spawned);

  testInfo.annotations.push({ type: 'migration-case', description: opts.caseId });
}

test.afterEach(async () => {
  if (tarpit) {
    tarpit.close();
    tarpit = null;
  }
  if (spawned) {
    await killScratch(spawned);
    spawned = null;
  }
  if (currentPgDb) {
    await dropScratchPgDb(currentPgDb).catch(() => {});
    currentPgDb = null;
  }
  if (currentScratch) {
    fs.rmSync(currentScratch, { recursive: true, force: true });
    currentScratch = null;
  }
});

async function loginToken(
  request: APIRequestContext,
  username = 'admin',
  password = ADMIN_PASSWORD
): Promise<string> {
  const res = await request.post(`${SCRATCH_BASE}/api/auth/login`, {
    data: { username, password },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.token as string;
}

async function loginAsAdminUi(page: Page): Promise<void> {
  await loginWithCredentials(page, 'admin', ADMIN_PASSWORD);
  await expect(page.getByTestId('file-actions-fab')).toBeVisible();
}

async function assertOnSystemSettings(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 6, name: /system settings/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run storage migration' })).toBeVisible();
}

async function openBlobMigrationDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Run storage migration' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Source:/)).toBeVisible();
  await expect(dialog.getByLabel(/^Bucket/)).toBeVisible();
}

async function fillS3Dest(
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

async function startBlobMigrationFromDialog(page: Page, mode: 'dry-run' | 'apply'): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: mode === 'apply' ? 'Apply' : 'Dry run' }).check();
  await Promise.all([
    page.waitForURL(/\/migration(?:\/|$)/),
    dialog.getByRole('button', { name: 'Start', exact: true }).click(),
  ]);
}

async function openMetadataMigrationDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Run metadata migration' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/^Host/)).toBeVisible();
}

async function fillPgTarget(page: Page, database: string): Promise<void> {
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
async function waitForTerminalModal(page: Page, timeout = 60_000): Promise<string> {
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible({ timeout });
  await expect(modal.getByRole('button', { name: 'Go to settings' })).toBeVisible({ timeout });
  return (await modal.textContent()) ?? '';
}

/**
 * Poll the /migration page until the terminal modal appears, recording whether
 * a "Running" state was observed along the way (robust to fast completion).
 */
async function observeMigration(page: Page): Promise<{ sawRunning: boolean }> {
  let sawRunning = false;
  const modal = page.getByRole('dialog');
  const deadline = Date.now() + 60_000;
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

async function createAdminFolder(
  request: APIRequestContext,
  token: string,
  name: string
): Promise<number> {
  const res = await request.post(`${SCRATCH_BASE}/api/folders/create`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { parentNodeId: null, name },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.nodeId as number;
}

async function uploadAdminFile(
  request: APIRequestContext,
  token: string,
  parentNodeId: number,
  fileName: string
): Promise<number> {
  const res = await request.post(`${SCRATCH_BASE}/api/files/upload`, {
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
async function assertRealWebdavPrecondition(dbPath: string, nodeIds: number[]): Promise<void> {
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
 * The exact `listS3Keys()` count is only meaningful when the destination
 * bucket was emptied before the run (each blob case calls `emptyS3Bucket`).
 */
async function assertPostMigrationBlobState(
  dbPath: string,
  nodeIds: number[]
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

  const s3Keys = await listS3Keys();
  expect(s3Keys).toHaveLength(nodeIds.length);
  for (const row of activeRows) expect(await blobExists(row.s3_key as string)).toBe(true);

  return activeRows as Array<{ file_node_id: number; s3_key: string }>;
}

async function pollJobStatus(
  request: APIRequestContext,
  token: string,
  jobId: string,
  statuses: string[],
  timeout = 90_000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeout;
  let last: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    const res = await request.get(`${SCRATCH_BASE}/api/admin/migration/jobs/${jobId}`, {
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

async function pollJobStatusUntil(
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
    const res = await request.get(`${SCRATCH_BASE}/api/admin/migration/jobs/${jobId}`, {
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

async function waitForGateInactive(request: APIRequestContext, timeout = 20_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const res = await request.get(`${SCRATCH_BASE}/api/migration/status`);
    const body = (await res.json()) as { active?: boolean };
    if (!body.active) return;
    await sleep(150);
  }
  throw new Error('migration gate did not clear');
}

/** A local TCP server that accepts connections and never replies (S3 probe hang). */
function startTarpit(): Promise<net.Server> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on('error', () => {});
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function tarpitEndpoint(server: net.Server): string {
  const address = server.address() as net.AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

test.describe('unified migration mode (E2E-MIG-001..009)', () => {
  test('E2E-MIG-001 (Flow A): Blob dry-run then apply happy path — dialog → /migration → terminal modal → settings', async ({
    page,
    request,
  }, testInfo) => {
    const caseId = 'flow-a-happy-path';
    await bootScratch(testInfo, { caseId, withWebdav: true });

    // Seed the source snapshot with REAL app uploads (webdav mode): the
    // multipart upload flows through fileService.uploadFile's webdav branch →
    // uploadToWebdav, leaving nodes pending_upload with no object_map row.
    const token = await loginToken(request);
    const folderName = `migration-a-${Date.now()}`;
    const folderId = await createAdminFolder(request, token, folderName);
    const fileNodeIds: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      fileNodeIds.push(await uploadAdminFile(request, token, folderId, `file-${i}.txt`));
    }

    // Prove the precondition is the real defect path (no seeded seam).
    const dbPath = path.join(currentScratch!, 'webdav.db');
    await assertRealWebdavPrecondition(dbPath, fileNodeIds);
    // Deterministic S3 count baseline for the no-extra-objects assertions.
    await emptyS3Bucket();

    await loginAsAdminUi(page);
    await openSystemSettings(page);

    // A3: dry-run — starts migration mode, completes, terminal modal, back.
    await openBlobMigrationDialog(page);
    await fillS3Dest(page, {
      bucket: S3_BUCKET,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
    });
    await startBlobMigrationFromDialog(page, 'dry-run');
    await expect(page).toHaveURL(/\/migration/);
    const dryRunObserved = await observeMigration(page);
    const dryRunBody = await waitForTerminalModal(page);
    // A1: dry-run writes nothing; terminal shows the default (no configPersist) guidance.
    expect(dryRunBody).toContain('Migration completed');
    expect(dryRunBody).toContain(
      'Blob migration completed. Restart the server to finish the storage cutover.'
    );
    // The dry-run only enumerated the real snapshot — it copied nothing: no
    // object_map rows and no S3 objects.
    const mapsAfterDryRun = await queryScratchSqlite<{ cnt: number }>(
      dbPath,
      'SELECT COUNT(*) AS cnt FROM object_map'
    );
    expect(Number(mapsAfterDryRun[0].cnt)).toBe(0);
    expect(await listS3Keys()).toHaveLength(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Go to settings' }).click();
    await page.waitForURL(/\/mypage/);
    await assertOnSystemSettings(page);

    // A2/A4: apply — reopens the dialog, copies, persists config, terminal modal.
    await openBlobMigrationDialog(page);
    await fillS3Dest(page, {
      bucket: S3_BUCKET,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
    });
    await startBlobMigrationFromDialog(page, 'apply');
    await expect(page).toHaveURL(/\/migration/);
    const applyObserved = await observeMigration(page);
    const applyBody = await waitForTerminalModal(page);
    // The S3_* destination keys are DB/default-sourced (not in the scratch .env),
    // so apply persisted them → the persisted guidance, not the manual .env one.
    expect(applyBody).toContain('Migration completed');
    expect(applyBody).toContain('was saved to the server settings');
    expect(applyBody).toContain('S3_BUCKET');
    expect(applyBody).not.toContain('Update them in .env manually');

    // Post-migration state (the fix's new behavior): every uploaded webdav file
    // now has an s3/active object_map row, sync_status='active', and its blob
    // exists in the destination bucket.
    await assertPostMigrationBlobState(dbPath, fileNodeIds);

    test.info().annotations.push({
      type: 'e2e-mig-001-running',
      description: `dry-run sawRunning=${dryRunObserved.sawRunning}, apply sawRunning=${applyObserved.sawRunning}`,
    });

    await page.getByRole('dialog').getByRole('button', { name: 'Go to settings' }).click();
    await page.waitForURL(/\/mypage/);
    await assertOnSystemSettings(page);
  });

  test('E2E-MIG-002 (Flow B): Blob cancel mid-copy, resume via shouldSkip, no duplicate blobs', async ({
    page,
    request,
  }, testInfo) => {
    const caseId = 'flow-b-cancel-resume';
    await bootScratch(testInfo, { caseId, withWebdav: true });

    const token = await loginToken(request);
    const folderName = `migration-b-${Date.now()}`;
    const folderId = await createAdminFolder(request, token, folderName);
    const fileNodeIds: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      fileNodeIds.push(await uploadAdminFile(request, token, folderId, `b-${i}.txt`));
    }
    // Real webdav-mode precondition (pending_upload + no object_map), then a
    // deterministic S3 baseline so the final count proves "no duplicates".
    const dbPath = path.join(currentScratch!, 'webdav.db');
    await assertRealWebdavPrecondition(dbPath, fileNodeIds);
    await emptyS3Bucket();

    await loginAsAdminUi(page);
    await openSystemSettings(page);

    // Start apply (real minio dest). 30 nodes keep the copy slow enough to cancel.
    await openBlobMigrationDialog(page);
    await fillS3Dest(page, {
      bucket: S3_BUCKET,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
    });
    await startBlobMigrationFromDialog(page, 'apply');
    await expect(page).toHaveURL(/\/migration/);

    // Observe running (or skip if it already reached a terminal state), then cancel
    // mid-copy once the worker reports 'running' and has copied at least one node.
    const statusRes = await request.get(`${SCRATCH_BASE}/api/migration/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const gateState = (await statusRes.json()) as { active?: boolean; jobId?: string };
    expect(gateState.active).toBe(true);
    const jobId = gateState.jobId as string;

    // Wait until the copy is genuinely in flight (at least one node copied) and
    // cancel as soon as it is. No fixed sleep: on a fast runner the whole
    // 30-node copy can finish before a 600ms head start elapses, and cancelling
    // a terminal job returns 404 (migrationJobStore.cancel), which made this
    // assertion flaky in CI.
    const runningJob = await pollJobStatusUntil(
      request,
      token,
      jobId,
      (job) =>
        ['completed', 'cancelled', 'failed'].includes(String(job.status)) ||
        (String(job.status) === 'running' && (job.results?.copied ?? 0) >= 1),
      30_000
    );
    expect(runningJob.status).toBe('running');

    const cancelRes = await request.post(
      `${SCRATCH_BASE}/api/admin/migration/jobs/${jobId}/cancel`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    expect(cancelRes.ok()).toBeTruthy();

    const cancelledJob = await pollJobStatus(
      request,
      token,
      jobId,
      ['cancelled', 'completed', 'failed'],
      30_000
    );
    expect(cancelledJob.status).toBe('cancelled');
    await waitForGateInactive(request);

    const cancelledResults = (cancelledJob.results ?? {}) as { copied?: number };
    // A6: the copy actually made progress before the cancel took effect.
    expect(cancelledResults.copied ?? 0).toBeGreaterThanOrEqual(1);

    // The /migration page surfaced the cancelled terminal modal.
    const cancelBody = await waitForTerminalModal(page);
    expect(cancelBody).toContain('Migration cancelled');

    // Snapshot the post-cancel object_map state (resume marker).
    const keysAfterCancel = await queryScratchSqlite<{
      s3_key: string | null;
      file_node_id: number;
    }>(
      dbPath,
      "SELECT file_node_id, s3_key FROM object_map WHERE status = 'active' ORDER BY file_node_id"
    );

    // A7: resume — rerun apply; already-migrated nodes are skipped.
    await page.getByRole('dialog').getByRole('button', { name: 'Go to settings' }).click();
    await page.waitForURL(/\/mypage/);
    await assertOnSystemSettings(page);
    await openBlobMigrationDialog(page);
    await fillS3Dest(page, {
      bucket: S3_BUCKET,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
    });
    await startBlobMigrationFromDialog(page, 'apply');
    await expect(page).toHaveURL(/\/migration/);
    // Capture the resume jobId while the gate is still active (the copy of the
    // remaining ~20+ nodes keeps the worker busy for a second or more).
    const resumeGate = (await (
      await request.get(`${SCRATCH_BASE}/api/migration/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as {
      jobId?: string;
    };
    expect(resumeGate.jobId).toBeDefined();

    const resumeObserved = await observeMigration(page);
    const resumeBody = await waitForTerminalModal(page);
    expect(resumeBody).toContain('Migration completed');

    const resumedJob = await pollJobStatus(
      request,
      token,
      resumeGate.jobId as string,
      ['completed', 'failed'],
      60_000
    );
    expect(resumedJob.status).toBe('completed');
    const resumeResults = (resumedJob.results ?? {}) as { skipped?: number; copied?: number };

    // shouldSkip proof: the rerun skipped at least the nodes copied pre-cancel and
    // copied at most the remaining nodes.
    expect(resumeResults.skipped ?? 0).toBeGreaterThanOrEqual(cancelledResults.copied ?? 0);
    expect((resumeResults.copied ?? 0) + (resumeResults.skipped ?? 0)).toBe(fileNodeIds.length);
    test.info().annotations.push({
      type: 'e2e-mig-002-resume',
      description: `cancelledCopied=${cancelledResults.copied}, resumed: skipped=${resumeResults.skipped} copied=${resumeResults.copied} sawRunning=${resumeObserved.sawRunning}`,
    });

    // No duplicate objects: every file node has exactly one active object_map row
    // and the post-cancel keys were NOT re-rolled on resume.
    const dupRows = await queryScratchSqlite<{ file_node_id: number; cnt: number }>(
      dbPath,
      "SELECT file_node_id, COUNT(*) AS cnt FROM object_map WHERE status = 'active' GROUP BY file_node_id HAVING COUNT(*) > 1"
    );
    expect(dupRows).toHaveLength(0);
    const keysAfterResume = await queryScratchSqlite<{
      s3_key: string | null;
      file_node_id: number;
    }>(
      dbPath,
      "SELECT file_node_id, s3_key FROM object_map WHERE status = 'active' ORDER BY file_node_id"
    );
    // No re-copy: every node that already had an s3_key at the cancel point keeps
    // the exact same key after the resume (nodes that were still null are the
    // remaining ones the resume legitimately copies).
    const copiedBefore = new Map(
      keysAfterCancel.filter((k) => k.s3_key).map((k) => [k.file_node_id, k.s3_key])
    );
    expect(copiedBefore.size).toBeGreaterThanOrEqual(1);
    for (const row of keysAfterResume) {
      const before = copiedBefore.get(row.file_node_id);
      if (before) expect(row.s3_key).toBe(before);
    }

    const migratedCount = await queryScratchSqlite<{ cnt: number }>(
      dbPath,
      "SELECT COUNT(*) AS cnt FROM object_map WHERE status = 'active' AND s3_key IS NOT NULL"
    );
    expect(Number(migratedCount[0].cnt)).toBe(fileNodeIds.length);

    // No duplicate blobs: the destination holds exactly one object per file —
    // the resume/skip (s3_key marker) prevented any re-copy on the rerun. And
    // every node reached the fix's post-migration lifecycle state.
    expect(await listS3Keys()).toHaveLength(fileNodeIds.length);
    const postResumeNodes = await queryScratchSqlite<{ id: number; sync_status: string }>(
      dbPath,
      `SELECT id, sync_status FROM file_nodes WHERE id IN (${fileNodeIds.join(', ')})
       ORDER BY id`
    );
    for (const row of postResumeNodes) expect(row.sync_status).toBe('active');
  });

  test('E2E-MIG-008 (Flow E3): Native webdav file (no object_map) is snapshotted + migrated; rerun is skipped (no duplicate)', async ({
    page,
    request,
  }, testInfo) => {
    const caseId = 'e3-native-webdav-no-object-map';
    await bootScratch(testInfo, { caseId, withWebdav: true });

    const token = await loginToken(request);
    const folderName = `migration-e3-${Date.now()}`;
    const folderId = await createAdminFolder(request, token, folderName);
    const fileNodeIds: number[] = [];
    for (let i = 0; i < 2; i += 1) {
      fileNodeIds.push(await uploadAdminFile(request, token, folderId, `e3-${i}.txt`));
    }
    const dbPath = path.join(currentScratch!, 'webdav.db');

    // Explicit focus: the node has NO object_map row at all and stays
    // pending_upload — the exact precondition for which the old snapshot
    // silently enumerated 0 nodes. The fix must still include it.
    await assertRealWebdavPrecondition(dbPath, fileNodeIds);
    const globalMaps = await queryScratchSqlite<{ cnt: number }>(
      dbPath,
      'SELECT COUNT(*) AS cnt FROM object_map'
    );
    expect(Number(globalMaps[0].cnt)).toBe(0);
    await emptyS3Bucket();

    await loginAsAdminUi(page);
    await openSystemSettings(page);

    // First apply: the native webdav nodes ARE migrated.
    await openBlobMigrationDialog(page);
    await fillS3Dest(page, {
      bucket: S3_BUCKET,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
    });
    await startBlobMigrationFromDialog(page, 'apply');
    await expect(page).toHaveURL(/\/migration/);
    const e3Run1Body = await waitForTerminalModal(page);
    expect(e3Run1Body).toContain('Migration completed');
    const keysAfterRun1 = await assertPostMigrationBlobState(dbPath, fileNodeIds);

    await page.getByRole('dialog').getByRole('button', { name: 'Go to settings' }).click();
    await page.waitForURL(/\/mypage/);
    await assertOnSystemSettings(page);

    // Rerun apply: every node is skipped via its preserved s3_key resume
    // marker — nothing is re-copied (no duplicate objects, no re-rolled keys).
    await openBlobMigrationDialog(page);
    await fillS3Dest(page, {
      bucket: S3_BUCKET,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
    });
    await startBlobMigrationFromDialog(page, 'apply');
    await expect(page).toHaveURL(/\/migration/);
    const e3Run2Body = await waitForTerminalModal(page);
    expect(e3Run2Body).toContain('Migration completed');

    const mapsAfterRun2 = await queryScratchSqlite<{ file_node_id: number; s3_key: string }>(
      dbPath,
      "SELECT file_node_id, s3_key FROM object_map WHERE status = 'active' ORDER BY file_node_id"
    );
    expect(mapsAfterRun2).toHaveLength(fileNodeIds.length);
    expect(mapsAfterRun2.map((r) => r.s3_key).sort()).toEqual(
      keysAfterRun1.map((r) => r.s3_key).sort()
    );
    const s3KeysAfterRun2 = await listS3Keys();
    expect(s3KeysAfterRun2).toHaveLength(fileNodeIds.length);

    const nodesAfterRun2 = await queryScratchSqlite<{ id: number; sync_status: string }>(
      dbPath,
      `SELECT id, sync_status FROM file_nodes WHERE id IN (${fileNodeIds.join(', ')})
       ORDER BY id`
    );
    for (const row of nodesAfterRun2) expect(row.sync_status).toBe('active');

    test.info().annotations.push({
      type: 'e2e-mig-008-no-duplicate',
      description: `keysRun1=${keysAfterRun1.map((r) => r.s3_key).join(',')} keysRun2=${mapsAfterRun2.map((r) => r.s3_key).join(',')} s3ObjectsRun2=${s3KeysAfterRun2.length}`,
    });
  });

  test('E2E-MIG-003 (Flow C): Gate hold — app-guard force-redirect, /login allow-list, 409 on second start', async ({
    page,
    request,
  }, testInfo) => {
    const caseId = 'flow-c-gate-hold';
    // withWebdav seeds the WEBDAV_* DB settings so setup_complete derives true
    // (webdav mode requires WEBDAV_URL/USERNAME/PASSWORD to be configured);
    // otherwise /login redirects to /setup and the guard case cannot start.
    await bootScratch(testInfo, { caseId, withWebdav: true });

    // A deterministic active gate: a real migration whose destination probe hangs
    // on a local tarpit (accepts connections, never replies). The worker stays in
    // probeDestination, so the gate stays active for the whole case.
    tarpit = await startTarpit();
    const hangEndpoint = tarpitEndpoint(tarpit);

    await loginAsAdminUi(page);
    await openSystemSettings(page);
    await openBlobMigrationDialog(page);
    await fillS3Dest(page, {
      bucket: S3_BUCKET,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      endpoint: hangEndpoint,
      region: S3_REGION,
    });
    await startBlobMigrationFromDialog(page, 'dry-run');
    await expect(page).toHaveURL(/\/migration/);

    // Precondition: the gate is genuinely active (job stuck on the probe).
    const token = await loginToken(request);
    const statusRes = await request.get(`${SCRATCH_BASE}/api/migration/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const gateState = (await statusRes.json()) as { active?: boolean; jobId?: string };
    expect(gateState.active).toBe(true);
    expect(gateState.jobId).toBeDefined();

    // A8: navigating to another route in the SPA → app-guard force-redirects back
    // to /migration (client-side navigation keeps the session; a full reload of a
    // PrivateRoute would 503 getMe and race a /login redirect instead).
    await page.evaluate(() => {
      window.history.pushState({}, '', '/mypage');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForURL(/\/migration/, { timeout: 15_000 });

    // A9: a fresh tab's /login still loads (allow-list) and renders the form —
    // not a 503 error page.
    const loginPage = await page.context().newPage();
    await loginPage.goto('/login');
    // The login page's settings fetch (GET /api/settings/public) returns 503
    // while the gate is active and the httpClient retries 5xx ~7s before the
    // form renders — allow time, then assert the form (not a 503 error page).
    await expect(loginPage.locator('input[name="username"]')).toBeVisible({ timeout: 25_000 });
    await expect(loginPage).toHaveURL(/\/login/);
    await loginPage.close();

    // B7: a second blob start while a job is in flight → 409.
    const second = await request.post(`${SCRATCH_BASE}/api/admin/migration/blobs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        mode: 'dry-run',
        force: false,
        dest: {
          type: 's3',
          bucket: S3_BUCKET,
          accessKey: S3_ACCESS_KEY,
          secretKey: S3_SECRET_KEY,
          endpoint: hangEndpoint,
          region: S3_REGION,
        },
      },
    });
    expect(second.status()).toBe(409);
  });

  test('E2E-MIG-009 (Flow F): Role-aware gate hold — an authenticated admin stays on /migration while a regular user and an anonymous visitor are routed to the public /maintenance page', async ({
    page,
    browser,
    request,
  }, testInfo) => {
    const caseId = 'flow-f-role-aware-gate';
    await bootScratch(testInfo, { caseId, withWebdav: true });

    // Flow C gate-hold pattern: a real blob migration whose destination probe
    // hangs on a local tarpit (accepts connections, never replies) keeps the
    // worker in probeDestination and the gate active for the whole case.
    tarpit = await startTarpit();
    const hangEndpoint = tarpitEndpoint(tarpit);

    await loginAsAdminUi(page);
    const token = await loginToken(request);

    // Provision a regular (approved, non-admin) user via the admin API while
    // the gate is still inactive so the call succeeds; userService
    // auto-provisions the user's home node + grant. The user session runs in
    // its own browser context so the per-context sessionStorage tokens never
    // leak between the admin and the user roles.
    const userName = `flow-f-user-${Date.now()}`;
    const userPassword = 'FlowFUserE2e!123';
    const createUser = await request.post(`${SCRATCH_BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { username: userName, email: `${userName}@e2e.local`, password: userPassword },
    });
    expect(createUser.status()).toBe(201);

    const userContext = await browser.newContext({ baseURL: 'http://localhost:5003' });
    const userPage = await userContext.newPage();
    await loginWithCredentials(userPage, userName, userPassword);
    // Let the SPA settle on /files while the gate is still inactive (no 503s),
    // so the later /maintenance redirect is attributable to the guard alone.
    await expect(userPage.getByTestId('file-actions-fab')).toBeVisible({ timeout: 15_000 });
    await expect(userPage).toHaveURL(/\/files(?:\/.*)?$/);

    // Hold the gate: start a dry-run blob migration via the admin API against
    // the hanging destination (dispatchWorker sets the gate synchronously, so
    // the 202 response already implies an active gate).
    const startRes = await request.post(`${SCRATCH_BASE}/api/admin/migration/blobs`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        mode: 'dry-run',
        force: false,
        dest: {
          type: 's3',
          bucket: S3_BUCKET,
          accessKey: S3_ACCESS_KEY,
          secretKey: S3_SECRET_KEY,
          endpoint: hangEndpoint,
          region: S3_REGION,
        },
      },
    });
    expect(startRes.status()).toBe(202);

    const statusRes = await request.get(`${SCRATCH_BASE}/api/migration/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(statusRes.ok()).toBeTruthy();
    const gateState = (await statusRes.json()) as { active?: boolean; jobId?: string };
    expect(gateState.active).toBe(true);
    expect(gateState.jobId).toBeDefined();

    // Role a — authenticated admin: a client-side (history API) navigation away
    // from /migration is force-redirected back by the role-aware guard. A full
    // reload during a held gate would 503 GET /api/users/me and log the session
    // out, so only the pushState + popstate idiom is safe here.
    await page.evaluate(() => {
      window.history.pushState({}, '', '/mypage');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page).toHaveURL(/\/migration/, { timeout: 15_000 });

    // Role b — regular non-admin user: the already-settled /files session is
    // redirected by the guard on its next poll tick (≤4s + fetch) to the generic
    // public /maintenance page, never to /migration.
    await expect(userPage).toHaveURL(/\/maintenance/, { timeout: 15_000 });
    await expect(
      userPage.getByRole('heading', { name: 'System maintenance in progress' })
    ).toBeVisible();
    // An authenticated regular session gets a plain "Log out" link (nothing else
    // to do on this screen) — not an operator sign-in action.
    await expect(userPage.getByRole('link', { name: 'Log out' })).toBeVisible();
    expect(userPage.url()).not.toMatch(/\/migration/);
    // Anti-regression: the maintenance screen exposes NO migration operational
    // copy (no job/type/counter text) — only the generic title/body/sign-out.
    await expect(userPage.getByRole('heading', { name: /^Migration$/ })).toHaveCount(0);
    await expect(userPage.getByText('Migration overview')).toHaveCount(0);
    await expect(userPage.getByText(/copied\s+\d+/)).toHaveCount(0);
    await userContext.close();

    // Role c — anonymous visitor: a fresh context with no storage state hits the
    // public, non-exempt /migration route directly and is redirected to the
    // public /maintenance page (which renders no operational metadata either).
    const anonContext = await browser.newContext({ baseURL: 'http://localhost:5003' });
    const anonPage = await anonContext.newPage();
    await anonPage.goto('/migration');
    await expect(anonPage).toHaveURL(/\/maintenance/, { timeout: 15_000 });
    await expect(
      anonPage.getByRole('heading', { name: 'System maintenance in progress' })
    ).toBeVisible();
    // Anonymous visitors have no session to log out of, so no action is shown.
    await expect(anonPage.getByRole('link', { name: 'Log out' })).toHaveCount(0);
    await expect(anonPage.getByRole('heading', { name: /^Migration$/ })).toHaveCount(0);
    await anonContext.close();
  });

  test('E2E-MIG-004 (Flow D-1): Metadata scan → empty target → seeded target wipe alert → confirm → start', async ({
    page,
    request,
  }, testInfo) => {
    const caseId = 'flow-d1-scan-wipe';
    await bootScratch(testInfo, { caseId, withWebdav: true, withPgTarget: true });
    const pgDb = currentPgDb!;

    // Give the source some metadata (admin + files).
    const token = await loginToken(request);
    const folderName = `migration-d1-${Date.now()}`;
    const folderId = await createAdminFolder(request, token, folderName);
    await uploadAdminFile(request, token, folderId, 'd1-file.txt');

    await loginAsAdminUi(page);
    await openSystemSettings(page);
    await openMetadataMigrationDialog(page);
    await fillPgTarget(page, pgDb);

    // B1: scan of a fresh, empty target → "no schema" info, no wipe alert.
    const scanButton = page.getByRole('dialog').getByRole('button', { name: 'Scan target' });
    await scanButton.click();
    await expect(page.getByRole('dialog').getByText(/has no schema/)).toBeVisible();
    await expect(page.getByRole('dialog').getByTestId('metadata-wipe-alert')).toHaveCount(0);

    // Pre-seed the target with a schema + a few rows so the wipe alert fires.
    await queryScratchPg(pgDb, METADATA_DDL);
    await queryScratchPg(
      pgDb,
      `INSERT INTO users (username, email, email_hash, password, status, is_admin) VALUES
        ('seeduser1', 'seed1@e2e.local', 'seed1hash', 'pw', 'approved', false),
        ('seeduser2', 'seed2@e2e.local', 'seed2hash', 'pw', 'approved', false)`
    );
    await queryScratchPg(
      pgDb,
      `INSERT INTO settings (key, value) VALUES ('D1_SEED_KEY_1', '"seed1"'), ('D1_SEED_KEY_2', '"seed2"')`
    );

    // B2: rescan → wipe alert lists the affected tables/rows, Start disabled.
    await scanButton.click();
    const wipeAlert = page.getByRole('dialog').getByTestId('metadata-wipe-alert');
    await expect(wipeAlert).toBeVisible();
    await expect(wipeAlert).toContainText('users: 2');
    await expect(wipeAlert).toContainText('settings: 2');
    await expect(wipeAlert).toContainText('Total rows: 4');
    const startButton = page.getByRole('dialog').getByRole('button', { name: 'Start migration' });
    await expect(startButton).toBeDisabled();

    // Explicit wipe confirmation enables Start.
    await page.getByRole('dialog').getByRole('checkbox').check();
    await expect(startButton).toBeEnabled();

    // B3: Start → 202 + auto-redirect to /migration (completion not asserted).
    const startRespPromise = page.waitForResponse(
      (r) => r.url().includes('/api/admin/migration/metadata') && r.request().method() === 'POST'
    );
    await Promise.all([page.waitForURL(/\/migration/), startButton.click()]);
    const startResp = await startRespPromise;
    expect(startResp.status()).toBe(202);
    await expect(page).toHaveURL(/\/migration/);
  });

  test('E2E-MIG-005 (Flow D-2): Metadata complete → env-cutover guidance → target rows/ids → ".env setup needed" banner', async ({
    page,
    request,
  }, testInfo) => {
    const caseId = 'flow-d2-complete-banner';
    await bootScratch(testInfo, { caseId, withWebdav: true, withPgTarget: true });
    const pgDb = currentPgDb!;
    const dbPath = path.join(currentScratch!, 'webdav.db');

    const token = await loginToken(request);
    const folderName = `migration-d2-${Date.now()}`;
    const folderId = await createAdminFolder(request, token, folderName);
    await uploadAdminFile(request, token, folderId, 'd2-file.txt');

    // Capture the source rows for the B6 id/row preservation assertion.
    const srcUsers = await queryScratchSqlite<{ id: number; username: string }>(
      dbPath,
      'SELECT id, username FROM users ORDER BY id'
    );
    const srcNodes = await queryScratchSqlite<{
      id: number;
      name: string;
      parent_id: number | null;
      type: string;
    }>(dbPath, 'SELECT id, name, parent_id, type FROM file_nodes ORDER BY id');
    const srcSettings = await queryScratchSqlite<{ key: string }>(
      dbPath,
      'SELECT key FROM settings ORDER BY key'
    );

    await loginAsAdminUi(page);
    await openSystemSettings(page);
    await openMetadataMigrationDialog(page);
    await fillPgTarget(page, pgDb);
    await page.getByRole('dialog').getByRole('button', { name: 'Scan target' }).click();
    // Empty target → no wipe needed; Start is enabled.
    await expect(page.getByRole('dialog').getByText(/has no schema/)).toBeVisible();
    const startButton = page.getByRole('dialog').getByRole('button', { name: 'Start migration' });
    await expect(startButton).toBeEnabled();

    await Promise.all([page.waitForURL(/\/migration/), startButton.click()]);
    await expect(page).toHaveURL(/\/migration/);

    // B4: terminal modal carries the env-cutover guidance (metadata variant).
    await observeMigration(page);
    const modalBody = await waitForTerminalModal(page);
    expect(modalBody).toContain('Migration completed');
    expect(modalBody).toContain('Metadata migration to PostgreSQL completed');

    // Wait for the job to fully reach completed (gate cleared in the worker).
    // Capture the jobId right after the redirect while the gate is still active;
    // if the metadata copy was fast enough to clear it already, the terminal
    // modal assertion above plus the B6 target assertions are sufficient proof.
    const gate = (await (
      await request.get(`${SCRATCH_BASE}/api/migration/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as {
      jobId?: string;
    };
    if (gate.jobId) {
      const job = await pollJobStatus(request, token, gate.jobId, [
        'completed',
        'failed',
        'cancelled',
      ]);
      expect(job.status).toBe('completed');
    }

    // B6: target PG holds the copied rows with ids preserved (BIGSERIAL is
    // returned as a string by node-pg; normalize both sides).
    const normalizeNodes = (
      rows: Array<{ id: unknown; name: string; parent_id: unknown; type: string }>
    ) =>
      rows.map((r) => [
        String(r.id),
        r.name,
        r.parent_id == null ? null : String(r.parent_id),
        r.type,
      ]);
    const tUsers = await queryScratchPg<{ id: string; username: string }>(
      pgDb,
      'SELECT id, username FROM users ORDER BY id'
    );
    expect(tUsers.map((r) => [String(r.id), r.username])).toEqual(
      srcUsers.map((r) => [String(r.id), r.username])
    );
    const tNodes = await queryScratchPg<{
      id: string;
      name: string;
      parent_id: string | null;
      type: string;
    }>(pgDb, 'SELECT id, name, parent_id, type FROM file_nodes ORDER BY id');
    expect(normalizeNodes(tNodes)).toEqual(normalizeNodes(srcNodes));
    const tSettings = await queryScratchPg<{ key: string }>(
      pgDb,
      'SELECT key FROM settings ORDER BY key'
    );
    expect(tSettings).toEqual(srcSettings);

    // B8: Go to settings → System Settings is reachable (gate cleared).
    await page.getByRole('dialog').getByRole('button', { name: 'Go to settings' }).click();
    await page.waitForURL(/\/mypage/);
    await assertOnSystemSettings(page);

    // B8/D11: the final cutover is a manual .env step — repoint the app's
    // WEA_DB_* block at the migrated PG database and restart. The source sqlite
    // backend still holds the metadata, so presence detection (D13) keeps the
    // ".env setup needed" banner visible after the cutover (the metadata
    // backend is presence-selected, so a sqlite-active boot cannot carry the
    // WEA_DB_* identity keys needed to reach the PG target).
    await killScratch(spawned!);
    spawned = spawnScratchServer(currentScratch!, {
      WEA_DB_HOST: PG_HOST,
      WEA_DB_PORT: PG_PORT,
      WEA_DB_DATABASE: pgDb,
      WEA_DB_USER: PG_USER,
      WEA_DB_PASSWORD: PG_PASSWORD,
    });
    await waitForScratchHealth(spawned);

    await loginAsAdminUi(page);
    await openSystemSettings(page);
    const banner = page.getByTestId('env-setup-needed-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('.env setup needed');
  });

  test('E2E-MIG-006 (Flow A5): Env-sourced blob destination → completed modal shows manual .env guidance', async ({
    page,
    request,
  }, testInfo) => {
    const caseId = 'flow-a5-env-sourced';
    await bootScratch(testInfo, {
      caseId,
      withWebdav: true,
      extraEnv: {
        S3_BUCKET,
        AWS_REGION: S3_REGION,
        AWS_ACCESS_KEY_ID: S3_ACCESS_KEY,
        AWS_SECRET_ACCESS_KEY: S3_SECRET_KEY,
        S3_ENDPOINT,
      },
    });

    const token = await loginToken(request);
    const folderName = `migration-a5-${Date.now()}`;
    const folderId = await createAdminFolder(request, token, folderName);
    // Real webdav-mode uploads (pending_upload, no object_map) now satisfy the
    // source-aware snapshot — no DB seeding needed.
    for (let i = 0; i < 4; i += 1) {
      await uploadAdminFile(request, token, folderId, `a5-${i}.txt`);
    }

    await loginAsAdminUi(page);
    await openSystemSettings(page);
    await openBlobMigrationDialog(page);
    // The destination connection is still entered in the dialog (used for the
    // copy); because every S3_* key is env-sourced, persist skips them.
    await fillS3Dest(page, {
      bucket: S3_BUCKET,
      accessKey: S3_ACCESS_KEY,
      secretKey: S3_SECRET_KEY,
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
    });
    await startBlobMigrationFromDialog(page, 'apply');
    await expect(page).toHaveURL(/\/migration/);

    await observeMigration(page);
    const modalBody = await waitForTerminalModal(page);
    expect(modalBody).toContain('Migration completed');
    // Env-sourced fallback, NOT the persisted variant.
    expect(modalBody).toContain('configured via environment variables');
    expect(modalBody).toContain('S3_BUCKET');
    expect(modalBody).toContain('Update them in .env manually');
    expect(modalBody).not.toContain('was saved to the server settings');
  });

  // E2E-MIG-007 covers Case A (surfaced by this spec, 2026-09-01): a metadata
  // migration could NOT be cancelled mid-run because
  // `runMetadataMigrationWorker`'s onProgress callback wrote
  // `migrationJobStore.update(jobId, { status: 'running', ... })` on every
  // progress tick, overwriting the 'cancelled' status that
  // `POST /api/admin/migration/jobs/:id/cancel` sets — so `isCancelled()`
  // always read 'running' during the copy and the transaction always COMMITted
  // (status trace running→…→completed, never 'cancelled', in scan/schema/copy).
  // The blob worker was unaffected (its onProgress does not set status).
  // FIXED: the metadata worker now only advances a non-terminal job to
  // 'running' and preserves an existing 'cancelled' status, so a cancel that
  // lands between progress ticks stays observable and the target transaction
  // ROLLBACKs. This test now asserts the correct (previously expected-to-fail)
  // behavior instead of a test.fail() placeholder.
  test('E2E-MIG-007 (Flow B5): Metadata cancel → job cancelled, gate cleared, target rolled back', async ({
    page,
    request,
  }, testInfo) => {
    const caseId = 'flow-b5-cancel-rollback';
    await bootScratch(testInfo, { caseId, withWebdav: true, withPgTarget: true });
    const pgDb = currentPgDb!;
    const dbPath = path.join(currentScratch!, 'webdav.db');

    const token = await loginToken(request);
    const folderName = `migration-b5-${Date.now()}`;
    const folderId = await createAdminFolder(request, token, folderName);
    await uploadAdminFile(request, token, folderId, 'b5-file.txt');

    // Widen the copy window: flood the source `settings` table (copied last, in
    // FK order) so a mid-copy cancel point is reachable. Measured on this stack:
    // ~20k settings rows complete the whole metadata copy in ~780ms, so 50k
    // rows give a ~1.5s settings-copy window. The inserts are chunked to stay
    // under SQLite's max-SQL-length bound.
    const FLOOD_ROWS = 50_000;
    for (let start = 0; start < FLOOD_ROWS; start += 25_000) {
      const values: string[] = [];
      for (let i = start; i < Math.min(start + 25_000, FLOOD_ROWS); i += 1) {
        values.push(`('flood_key_${i}', 'flood')`);
      }
      await execScratchSqlite(
        dbPath,
        `INSERT INTO settings (key, value) VALUES ${values.join(', ')}`
      );
    }

    // Start the metadata migration via the admin API.
    const startRes = await request.post(`${SCRATCH_BASE}/api/admin/migration/metadata`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        targetBackend: 'postgresql',
        pg: {
          host: PG_HOST,
          port: Number(PG_PORT),
          database: pgDb,
          user: PG_USER,
          password: PG_PASSWORD,
          ssl: false,
        },
        wipeTarget: false,
      },
    });
    expect(startRes.status()).toBe(202);
    const jobId = ((await startRes.json()) as { jobId: string }).jobId;

    // Cancel mid-copy (job progress % inside the settings-table copy). The
    // contract is cancel → ROLLBACK: the worker's progress updates no longer
    // overwrite the cancel flag, so isCancelled() aborts the copy and the whole
    // target transaction (schema + copy) is rolled back.
    const midCopyJob = await pollJobStatusUntil(
      request,
      token,
      jobId,
      (job) =>
        job.status === 'running' && job.stage === 'copy' && (job.progress?.percent ?? 0) >= 10,
      60_000
    );
    const cancelRes = await request.post(
      `${SCRATCH_BASE}/api/admin/migration/jobs/${jobId}/cancel`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    expect(cancelRes.ok()).toBeTruthy();

    const terminalJob = await pollJobStatus(
      request,
      token,
      jobId,
      ['cancelled', 'completed', 'failed'],
      60_000
    );
    expect(terminalJob.status).toBe('cancelled');
    await waitForGateInactive(request);

    // The whole target transaction (schema + wipe + copy) rolled back: no app
    // tables at all remain in the target database.
    const reg = await queryScratchPg<{ users: unknown; settings: unknown; file_nodes: unknown }>(
      pgDb,
      "SELECT to_regclass('public.users') AS users, to_regclass('public.settings') AS settings, to_regclass('public.file_nodes') AS file_nodes"
    );
    const publicTables = await queryScratchPg<{ tablename: string }>(
      pgDb,
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    test.info().annotations.push({
      type: 'e2e-mig-007-post-cancel',
      description: `cancelAt=${JSON.stringify(midCopyJob.progress)} users=${JSON.stringify(
        reg[0].users
      )} settings=${JSON.stringify(reg[0].settings)} tables=${JSON.stringify(
        publicTables.map((t) => t.tablename)
      )}`,
    });
    expect(reg[0].users).toBeNull();
    expect(reg[0].settings).toBeNull();
    expect(reg[0].file_nodes).toBeNull();

    // The gate is clear, so the app is unlocked again (sanity, not the full
    // REST-only gate matrix which the server tests cover).
    const statusAfter = await request.get(`${SCRATCH_BASE}/api/migration/status`);
    expect(((await statusAfter.json()) as { active?: boolean }).active).toBe(false);
  });
});
