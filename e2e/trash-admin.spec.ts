import fs from 'node:fs';
import http from 'node:http';

import { expect, test } from '@playwright/test';

import { TEST_FILES } from './fixtures/test-data';
import {
  ensureClientBuild,
  ensureWebdavSubtree,
  killScratch,
  scratchDirFor,
  seedWebdavSettings,
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
  uploadFileViaUi,
} from './helpers/files';
import { deleteItemViaUi } from './helpers/trash';

/**
 * E2E-TRASH-007 — the GLOBAL destructive trash case ("Empty trash" purges
 * every trashed item for ALL users).
 *
 * Shared-pool ownership is NOT sufficient for this case: the worker pool is
 * global and `fullyParallel` interleaves tests across spec files, so while
 * TRASH-007 purges, a trash case in trash.spec.ts (same admin user, same
 * shared :5002 server) loses its just-trashed item mid-assertion — this was
 * the deterministic DEF-20 flake in the webdav smoke (and a latent race in
 * the s3 desktop project, masked by CI retries).
 *
 * The case is therefore SCRATCH-HERMETIC like admin-config/migration: it
 * boots its own server on :5012 (own sqlite, fresh DB per run) and the
 * global purge can only ever affect its own world. Requires docker infra.
 */
const SCRATCH_PORT = 5012;
const WEBDAV_BASE = 'http://127.0.0.1:8090';
const WEBDAV_AUTH = Buffer.from('e2etest:e2etest123').toString('base64');
const CASE_ID = 'trash-admin';
const ADMIN_PASSWORD = 'TrashAdminE2e!123';

const textFixtureBuffer = readTestFileFixture(TEST_FILES.smallText);

// The scratch harness binds a fixed port (:5012), so the whole file must run
// in one worker. Same convention as admin-config.spec.ts.
test.describe.configure({ mode: 'serial' });

function deleteWebdavPath(davPath: string): Promise<void> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 8090,
        path: davPath,
        method: 'DELETE',
        headers: { Authorization: `Basic ${WEBDAV_AUTH}` },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve());
      }
    );
    req.on('error', () => resolve());
    req.end();
  });
}

let scratch: string;
let spawned: ReturnType<typeof spawnScratchServer> | null = null;

test.beforeAll(async () => {
  // Remote trash namespace is shared across scratch boots (fresh sqlite
  // restarts nodeIds, so a stale /.wea-trash/<id> collection would trip the
  // destination-exists guard of the case's trash MOVE). Start clean.
  await deleteWebdavPath('/.wea-trash/');
});

test.beforeEach(async () => {
  scratch = scratchDirFor(CASE_ID);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  writeScratchEnv(scratch, {
    PORT: String(SCRATCH_PORT),
    WEA_FILE_STORAGE: 'webdav',
    WEBDAV_UPSTREAM_URL: WEBDAV_BASE,
    JWT_SECRET: 'trash-admin-e2e-jwt-secret',
    ADMIN_DEFAULT_PASSWORD: ADMIN_PASSWORD,
  });
  await seedWebdavSettings(scratch);
  await ensureWebdavSubtree(CASE_ID);
  ensureClientBuild();
  spawned = spawnScratchServer(scratch, SCRATCH_PORT);
  await waitForScratchHealth(spawned!, SCRATCH_PORT);
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

test('E2E-TRASH-007: Empty trash purges all visible trashed items', async ({
  page,
  request,
}, testInfo) => {
  await loginWithCredentials(page, 'admin', ADMIN_PASSWORD);

  const base = await openPrivateWorkspace(page, request, testInfo);
  const fileName = buildName(testInfo, 'trash-empty-item', '.txt');
  const filePath = `/${base}/${fileName}`;

  await uploadFileViaUi(page, {
    fileName,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await expect(fileItem(page, filePath)).toBeVisible();

  // Trash via the UI desktop seam (this project is desktop-only).
  await deleteItemViaUi(page, false, filePath);
  await expect(fileItem(page, filePath)).toHaveCount(0);

  await page.goto('/files/__trash__');
  await expect(fileItem(page, filePath)).toBeVisible({ timeout: 10_000 });

  // Admin-only empty-trash icon button in the controls row; the confirm copy
  // must state that it purges ALL trashed items for ALL users.
  const emptyButton = page.getByTestId('trash-empty');
  await expect(emptyButton).toBeVisible();
  await emptyButton.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(/all users|모든 사용자/i);
  await dialog.getByTestId('confirm-dialog-confirm').click();

  // The trash listing empties; the item does not return to the live folder.
  await expect(fileItem(page, filePath)).toHaveCount(0);
  await expect(page.getByText(/trash is empty|휴지통이 비어/i)).toBeVisible({
    timeout: 10_000,
  });
});
