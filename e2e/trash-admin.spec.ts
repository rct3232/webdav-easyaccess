import fs from 'node:fs';

import { expect, test, type TestInfo } from '@playwright/test';

import { TEST_FILES } from './fixtures/test-data';
import { e2ePorts } from './helpers/ports';
import {
  ensureClientBuild,
  killScratch,
  prepareScratchS3,
  s3ScratchEnv,
  scratchDirFor,
  scratchRuntimeEnv,
  spawnScratchServer,
  waitForScratchHealth,
  writeScratchEnv,
} from './helpers/setupScratch';
import { loginWithCredentials } from './helpers/auth';
import {
  buildName,
  fileItem,
  flushPrivateWorkspaceCleanups,
  openPrivateWorkspace,
  readTestFileFixture,
  uploadFileAt,
  waitForBulkJobToComplete,
} from './helpers/files';
import { deleteItemViaUi } from './helpers/trash';
import { getSessionToken, gotoFilesPath, resolveNodeId } from './helpers/resolvePath';

function isMobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name.endsWith('-mobile');
}

/**
 * E2E-S3-TRASHADMIN-001 — the GLOBAL destructive trash case ("Empty trash"
 * purges every trashed item for ALL users). Scratch-hermetic: each Playwright
 * project boots its own server (desktop :5012 / mobile :5019, own sqlite, own
 * project-scoped S3 bucket) and the global purge can only ever affect its own
 * isolated world. Desktop and mobile are independent siblings — no shared
 * scratch port, no dependency edge.
 *
 * Shared-pool ownership is NOT sufficient for this case: the worker pool is
 * global and `fullyParallel` interleaves tests across spec files, so while
 * E2E-S3-TRASHADMIN-001 purges, a trash case in trash.spec.ts (same admin
 * user, same shared :5002 server) loses its just-trashed item mid-assertion —
 * this was the deterministic DEF-20 flake (and a latent race in the s3
 * desktop project, masked by CI retries).
 *
 * The case is therefore SCRATCH-HERMETIC like admin-config/migration: it boots
 * its own server per test (own sqlite, fresh DB per run) and the global purge
 * can only ever affect its own world. Requires docker infra.
 */
const CASE_ID = 'trash-admin';
const ADMIN_PASSWORD = 'TrashAdminE2e!123';

const textFixtureBuffer = readTestFileFixture(TEST_FILES.smallText);

// The scratch harness owns one port per project, so the whole file must run in
// one worker per project. Same convention as admin-config.spec.ts.
test.describe.configure({ mode: 'serial' });

let scratch: string;
let spawned: ReturnType<typeof spawnScratchServer> | null = null;

test.beforeEach(async ({}, testInfo) => {
  const projectName = testInfo.project.name;
  // Independent desktop/mobile worlds: each project owns its port slot, its
  // scratch directory and its S3 bucket — never a shared scratch server.
  const port = isMobileProject(testInfo)
    ? e2ePorts.scratchTrashAdminMobile
    : e2ePorts.scratchTrashAdmin;
  scratch = scratchDirFor(CASE_ID, projectName);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  // S3 is the product's default backend; prepareScratchS3 ensures the
  // project-scoped bucket exists and empties it for a deterministic run (the
  // trash namespace lives in the fresh scratch DB, so there is nothing
  // WebDAV-side to clear).
  const bucket = await prepareScratchS3(projectName);
  writeScratchEnv(scratch, {
    PORT: String(port),
    ...s3ScratchEnv(bucket),
    ...scratchRuntimeEnv(),
    JWT_SECRET: 'trash-admin-e2e-jwt-secret',
    ADMIN_DEFAULT_PASSWORD: ADMIN_PASSWORD,
  });
  ensureClientBuild();
  spawned = spawnScratchServer(scratch, port);
  await waitForScratchHealth(spawned, port);
});

test.afterEach(async ({ request }) => {
  try {
    await flushPrivateWorkspaceCleanups(request);
  } catch {
    // scratch teardown below removes the DB anyway
  }
  if (spawned) {
    await killScratch(spawned);
    spawned = null;
  }
  if (scratch) {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('E2E-S3-TRASHADMIN-001: Empty trash purges all visible trashed items', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  await loginWithCredentials(page, 'admin', ADMIN_PASSWORD);

  const base = await openPrivateWorkspace(page, request, testInfo);
  const fileName = buildName(testInfo, 'trash-empty-item', '.txt');
  const filePath = `/${base}/${fileName}`;
  const token = await getSessionToken(page);
  const folderNodeId = await resolveNodeId(request, token, `/${base}`);
  await uploadFileAt(request, token, folderNodeId, fileName, 'text/plain', textFixtureBuffer);
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, filePath)).toBeVisible();

  // Trash via the platform UI seam (desktop context menu / mobile action sheet).
  const deleteResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/files/batch-delete') && response.request().method() === 'POST'
  );
  await deleteItemViaUi(page, isMobileProject(testInfo), filePath);
  const deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.status()).toBe(202);
  const { jobId } = await deleteResponse.json();
  await waitForBulkJobToComplete(request, token, String(jobId));
  await expect(fileItem(page, filePath)).toHaveCount(0);

  await page.goto('/files/__trash__');
  await expect(fileItem(page, filePath)).toBeVisible({ timeout: 30_000 });

  // Admin-only empty-trash icon button in the controls row; the confirm copy
  // must state that it purges ALL trashed items for ALL users.
  const emptyButton = page.getByTestId('trash-empty');
  await expect(emptyButton).toBeVisible();
  await emptyButton.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(/all users|모든 사용자/i);
  const emptyResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/files/trash/empty') && response.request().method() === 'POST',
    { timeout: 60_000 }
  );
  await dialog.getByTestId('confirm-dialog-confirm').click();
  expect((await emptyResponsePromise).ok()).toBeTruthy();

  // The trash listing empties; the item does not return to the live folder.
  await expect(fileItem(page, filePath)).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText(/trash is empty|휴지통이 비어/i)).toBeVisible({
    timeout: 60_000,
  });
});
