import path from 'node:path';

import { expect, test } from '@playwright/test';

import { loginWithCredentials } from './helpers/auth';
import {
  execScratchSqlite,
  openSystemSettings,
  queryScratchPg,
  queryScratchSqlite,
} from './helpers/setupScratch';
import {
  METADATA_DDL,
  PG_HOST,
  PG_PASSWORD,
  PG_PORT,
  PG_USER,
  S3_ACCESS_KEY,
  S3_REGION,
  S3_SECRET_KEY,
  assertOnSystemSettings,
  bootMigrationScratch,
  cleanupMigrationScratch,
  createAdminFolder,
  fillPgTarget,
  loginAsAdminUi,
  loginToken,
  observeMigration,
  openMetadataMigrationDialog,
  pollJobStatus,
  pollJobStatusUntil,
  restartMigrationScratch,
  startBlobMigrationFromDialog,
  startTarpit,
  tarpitEndpoint,
  uploadAdminFile,
  waitForGateInactive,
  waitForTerminalModal,
  type MigrationScratchState,
} from './migration.helpers';

/**
 * Unified migration mode S3 cases (docs/features/migration-mode.md +
 * docs/spec/server/services/metadataMigrationService.md).
 *
 * Hermetic by design: every case spawns its own fully-configured scratch server
 * on the platform port (desktop :5011 / mobile :5018), with a project-scoped
 * scratch dir, sqlite metadata source and S3 file backend. Blob destinations are
 * project-scoped buckets (`e2e-migration-<project>`), so this suite never
 * touches the shared `e2e-test-bucket` or another project's data.
 *
 * The migration gate is process-global, so every migration runs against its own
 * scratch server with the per-test cleanup, serialized (the fixed per-platform
 * port also forces this).
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
test.describe.configure({ mode: 'serial', timeout: 240_000 });

let tarpit: Awaited<ReturnType<typeof startTarpit>> | null = null;
let scratch: MigrationScratchState | null = null;

test.afterEach(async () => {
  if (tarpit) {
    tarpit.close();
    tarpit = null;
  }
  if (scratch) {
    await cleanupMigrationScratch(scratch);
    scratch = null;
  }
});

test('E2E-S3-MIG-001 (Flow D-1): Metadata scan → empty target → seeded target wipe alert → confirm → start', async ({
  page,
  request,
}, testInfo) => {
  const caseId = 'flow-d1-scan-wipe';
  scratch = await bootMigrationScratch(testInfo, {
    caseId,
    backend: 's3',
    withPgTarget: true,
  });
  const { baseURL, pgDb } = scratch;
  expect(pgDb).toBeTruthy();

  // Give the source some metadata (admin + files).
  const token = await loginToken(baseURL, request);
  const folderName = `migration-d1-${Date.now()}`;
  const folderId = await createAdminFolder(baseURL, request, token, folderName);
  await uploadAdminFile(baseURL, request, token, folderId, 'd1-file.txt');

  await loginAsAdminUi(page);
  await openSystemSettings(page);
  await openMetadataMigrationDialog(page);
  await fillPgTarget(page, pgDb!);

  // B1: scan of a fresh, empty target → "no schema" info, no wipe alert.
  const scanButton = page.getByRole('dialog').getByRole('button', { name: 'Scan target' });
  await scanButton.click();
  await expect(page.getByRole('dialog').getByText(/has no schema/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('dialog').getByTestId('metadata-wipe-alert')).toHaveCount(0);

  // Pre-seed the target with a schema + a few rows so the wipe alert fires.
  await queryScratchPg(pgDb!, METADATA_DDL);
  await queryScratchPg(
    pgDb!,
    `INSERT INTO users (username, email, email_hash, password, status, is_admin) VALUES
      ('seeduser1', 'seed1@e2e.local', 'seed1hash', 'pw', 'approved', false),
      ('seeduser2', 'seed2@e2e.local', 'seed2hash', 'pw', 'approved', false)`
  );
  await queryScratchPg(
    pgDb!,
    `INSERT INTO settings (key, value) VALUES ('D1_SEED_KEY_1', '"seed1"'), ('D1_SEED_KEY_2', '"seed2"')`
  );

  // B2: rescan → wipe alert lists the affected tables/rows, Start disabled.
  await scanButton.click();
  const wipeAlert = page.getByRole('dialog').getByTestId('metadata-wipe-alert');
  await expect(wipeAlert).toBeVisible({ timeout: 60_000 });
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

test('E2E-S3-MIG-002 (Flow D-2): Metadata complete → env-cutover guidance → target rows/ids → ".env setup needed" banner', async ({
  page,
  request,
}, testInfo) => {
  const caseId = 'flow-d2-complete-banner';
  scratch = await bootMigrationScratch(testInfo, {
    caseId,
    backend: 's3',
    withPgTarget: true,
  });
  const { baseURL, pgDb } = scratch;
  expect(pgDb).toBeTruthy();
  const dbPath = path.join(scratch.scratch, 'webdav.db');

  const token = await loginToken(baseURL, request);
  // S3 scratch keeps the storage config in env, so the scratch settings table
  // would otherwise be empty. Seed real app-owned, DB-sourced settings rows
  // (not WEBDAV_* / S3_* config on an S3 source) so the migration copies a
  // representative settings payload AND the env-cutover banner's non-active
  // metadata-presence source is real data.
  const seededSettings = [
    { key: 'JWT_EXPIRES_IN', value: '45m' },
    { key: 'EMAIL_HOST', value: 'smtp.e2e.local' },
    { key: 'EMAIL_PORT', value: '2525' },
    { key: 'EMAIL_SECURE', value: 'false' },
    { key: 'AI_SEMANTIC_SEARCH_ENABLED', value: 'false' },
  ] as const;
  await execScratchSqlite(
    dbPath,
    `INSERT OR REPLACE INTO settings (key, value) VALUES ${seededSettings
      .map(({ key, value }) => `('${key}', '${value}')`)
      .join(', ')}`
  );
  const folderName = `migration-d2-${Date.now()}`;
  const folderId = await createAdminFolder(baseURL, request, token, folderName);
  await uploadAdminFile(baseURL, request, token, folderId, 'd2-file.txt');

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
  const srcSettings = await queryScratchSqlite<{ key: string; value: string }>(
    dbPath,
    'SELECT key, value FROM settings ORDER BY key'
  );

  await loginAsAdminUi(page);
  await openSystemSettings(page);
  await openMetadataMigrationDialog(page);
  await fillPgTarget(page, pgDb!);
  await page.getByRole('dialog').getByRole('button', { name: 'Scan target' }).click();
  // Empty target → no wipe needed; Start is enabled.
  await expect(page.getByRole('dialog').getByText(/has no schema/)).toBeVisible({
    timeout: 60_000,
  });
  const startButton = page.getByRole('dialog').getByRole('button', { name: 'Start migration' });
  await expect(startButton).toBeEnabled();

  await Promise.all([page.waitForURL(/\/migration/), startButton.click()]);
  await expect(page).toHaveURL(/\/migration/);

  // B4: terminal modal carries the env-cutover guidance (metadata variant).
  await observeMigration(page);
  const modalBody = await waitForTerminalModal(page);
  expect(modalBody).toContain('Migration completed');
  expect(modalBody).toContain('Metadata migration to PostgreSQL completed');

  // The terminal modal asserts `Migration completed` and the target-row
  // assertions below prove the committed copy, so no extra status poll is
  // needed here. The job-state contract is covered by the gate cases and the
  // server-side migration tests.

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
    pgDb!,
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
  }>(pgDb!, 'SELECT id, name, parent_id, type FROM file_nodes ORDER BY id');
  expect(normalizeNodes(tNodes)).toEqual(normalizeNodes(srcNodes));
  const tSettings = await queryScratchPg<{ key: string; value: unknown }>(
    pgDb!,
    'SELECT key, value FROM settings ORDER BY key'
  );
  // The copy transform stores every sqlite settings value as a JSON string
  // (metadataMigrationService transformRow), so normalize the target JSONB
  // back to the source's raw string before comparing the full key+value set.
  expect(
    tSettings.map((row) => ({
      key: row.key,
      value: typeof row.value === 'string' ? row.value : JSON.stringify(row.value),
    }))
  ).toEqual(srcSettings.map((row) => ({ key: row.key, value: String(row.value) })));

  // B8: Go to settings → System Settings is reachable (gate cleared).
  await page.getByRole('dialog').getByRole('button', { name: 'Go to settings' }).click();
  await page.waitForURL(/\/mypage/);
  await assertOnSystemSettings(page);

  // B8/D11: the final cutover is a manual .env step — repoint the app's
  // WEA_DB_* block at the migrated PG database and restart. The source sqlite
  // backend still holds the metadata (including the seeded settings rows), so
  // presence detection (D13) keeps the ".env setup needed" banner visible
  // after the cutover (the metadata backend is presence-selected, so a
  // sqlite-active boot cannot carry the WEA_DB_* identity keys needed to
  // reach the PG target).
  await restartMigrationScratch(scratch, {
    WEA_DB_HOST: PG_HOST,
    WEA_DB_PORT: PG_PORT,
    WEA_DB_DATABASE: pgDb!,
    WEA_DB_USER: PG_USER,
    WEA_DB_PASSWORD: PG_PASSWORD,
  });

  await loginAsAdminUi(page);
  await openSystemSettings(page);
  const banner = page.getByTestId('env-setup-needed-banner');
  await expect(banner).toBeVisible({ timeout: 60_000 });
  await expect(banner).toContainText('.env setup needed');
});

test('E2E-S3-MIG-003 (Flow B5): Metadata cancel → job cancelled, gate cleared, target rolled back', async ({
  request,
}, testInfo) => {
  const caseId = 'flow-b5-cancel-rollback';
  scratch = await bootMigrationScratch(testInfo, {
    caseId,
    backend: 's3',
    withPgTarget: true,
  });
  const { baseURL, pgDb } = scratch;
  expect(pgDb).toBeTruthy();
  const dbPath = path.join(scratch.scratch, 'webdav.db');

  const token = await loginToken(baseURL, request);
  const folderName = `migration-b5-${Date.now()}`;
  const folderId = await createAdminFolder(baseURL, request, token, folderName);
  await uploadAdminFile(baseURL, request, token, folderId, 'b5-file.txt');

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
  const startRes = await request.post(`${baseURL}/api/admin/migration/metadata`, {
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
    baseURL,
    request,
    token,
    jobId,
    (job) => job.status === 'running' && job.stage === 'copy' && (job.progress?.percent ?? 0) >= 10,
    60_000
  );
  const cancelRes = await request.post(`${baseURL}/api/admin/migration/jobs/${jobId}/cancel`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(cancelRes.ok()).toBeTruthy();

  const terminalJob = await pollJobStatus(
    baseURL,
    request,
    token,
    jobId,
    ['cancelled', 'completed', 'failed'],
    60_000
  );
  expect(terminalJob.status).toBe('cancelled');
  await waitForGateInactive(baseURL, request);

  // The whole target transaction (schema + wipe + copy) rolled back: no app
  // tables at all remain in the target database.
  const reg = await queryScratchPg<{ users: unknown; settings: unknown; file_nodes: unknown }>(
    pgDb!,
    "SELECT to_regclass('public.users') AS users, to_regclass('public.settings') AS settings, to_regclass('public.file_nodes') AS file_nodes"
  );
  const publicTables = await queryScratchPg<{ tablename: string }>(
    pgDb!,
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );
  testInfo.annotations.push({
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
  const statusAfter = await request.get(`${baseURL}/api/migration/status`);
  expect(((await statusAfter.json()) as { active?: boolean }).active).toBe(false);
});

test('E2E-S3-MIG-004 (Flow F-S3): S3 source -> WebDAV destination tarpit gate and role routing', async ({
  page,
  browser,
  request,
}, testInfo) => {
  const caseId = 'flow-f-s3-role-aware-gate';
  scratch = await bootMigrationScratch(testInfo, { caseId, backend: 's3' });
  const { baseURL } = scratch;

  // A real S3-source snapshot (at least one active file + object_map row) so
  // the worker would have a blob to copy if the destination probe succeeded.
  const token = await loginToken(baseURL, request);
  const folderName = `migration-f-s3-${Date.now()}`;
  const folderId = await createAdminFolder(baseURL, request, token, folderName);
  await uploadAdminFile(baseURL, request, token, folderId, 'f-s3-file.txt');

  // Provision the regular (approved, non-admin) user while the gate is still
  // inactive; userService auto-provisions its home node + grant. The session
  // lives in its own browser context so the admin token never leaks into it.
  const userName = `flow-f-s3-user-${Date.now()}`;
  const userPassword = 'FlowFS3UserE2e!123';
  const createUser = await request.post(`${baseURL}/api/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { username: userName, email: `${userName}@e2e.local`, password: userPassword },
  });
  expect(createUser.status()).toBe(201);

  const userContext = await browser.newContext({ baseURL });
  const userPage = await userContext.newPage();
  await loginWithCredentials(userPage, userName, userPassword);
  // Let the SPA settle on /files before the gate starts, so the later
  // /maintenance redirect is attributable to the guard alone.
  await expect(userPage.getByTestId('file-actions-fab')).toBeVisible({ timeout: 30_000 });
  await expect(userPage).toHaveURL(/\/files(?:\/.*)?$/);

  // Admin is already on /migration when the gate activates. Wait for the
  // boot-time /auth/me to settle on THIS full page load before starting the
  // gate: a still-in-flight session probe would 503 under the gate, clear the
  // session, and race the guard's /migration redirect.
  await loginAsAdminUi(page);
  const adminMe = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/auth/me'
  );
  await page.goto('/migration');
  await page.waitForURL(/\/migration/);
  expect((await adminMe).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Migration', exact: true })).toBeVisible();

  // A local raw TCP tarpit accepts the destination probe connection and never
  // replies, keeping the worker in probeDestination and the gate active.
  tarpit = await startTarpit();
  const hangEndpoint = tarpitEndpoint(tarpit);

  // S3 source -> WebDAV destination: the API route derives the expected
  // destination type from the composition, so this exercises the real
  // direction without any WebDAV container.
  const startPayload = {
    mode: 'dry-run',
    force: false,
    dest: {
      type: 'webdav',
      url: hangEndpoint,
      username: 'e2e',
      password: 'e2e',
    },
  };
  const startRes = await request.post(`${baseURL}/api/admin/migration/blobs`, {
    headers: { Authorization: `Bearer ${token}` },
    data: startPayload,
  });
  expect(startRes.status()).toBe(202);
  const { jobId } = (await startRes.json()) as { jobId: string };

  const activeGate = (await (
    await request.get(`${baseURL}/api/migration/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as { active?: boolean; jobId?: string };
  expect(activeGate.active).toBe(true);
  expect(activeGate.jobId).toBe(jobId);

  // Deliberate second POST (not a transport retry): one job/gate exists, so
  // the server rejects the duplicate start with 409 and keeps the same job.
  const secondRes = await request.post(`${baseURL}/api/admin/migration/blobs`, {
    headers: { Authorization: `Bearer ${token}` },
    data: startPayload,
  });
  expect(secondRes.status()).toBe(409);
  const gateAfterSecond = (await (
    await request.get(`${baseURL}/api/migration/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as { active?: boolean; jobId?: string };
  expect(gateAfterSecond.active).toBe(true);
  expect(gateAfterSecond.jobId).toBe(jobId);

  // Role a — authenticated admin: a client-side (history API) navigation away
  // from /migration is force-redirected back by the role-aware guard.
  await page.evaluate(() => {
    window.history.pushState({}, '', '/mypage');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/migration/, { timeout: 60_000 });

  // Role b — regular non-admin user: the settled /files session is routed to
  // the generic public maintenance page, never to /migration.
  await expect(userPage).toHaveURL(/\/maintenance/, { timeout: 30_000 });
  await expect(
    userPage.getByRole('heading', { name: 'System maintenance in progress' })
  ).toBeVisible();
  expect(userPage.url()).not.toMatch(/\/migration/);
  await userContext.close();

  // Role c — anonymous visitor: the public /migration route redirects to the
  // public maintenance page.
  const anonContext = await browser.newContext({ baseURL });
  const anonPage = await anonContext.newPage();
  await anonPage.goto('/migration');
  await expect(anonPage).toHaveURL(/\/maintenance/, { timeout: 30_000 });
  await expect(
    anonPage.getByRole('heading', { name: 'System maintenance in progress' })
  ).toBeVisible();
  await anonContext.close();
});
