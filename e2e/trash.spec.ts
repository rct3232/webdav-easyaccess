import { type TestInfo } from '@playwright/test';

import { TEST_FILES, TEST_USERS } from './fixtures/test-data';
import { ADMIN_STATE, expect, test } from './fixtures/authenticated';
import { openItemActions } from './helpers/explorer';
import {
  buildName,
  createFolderViaUi,
  downloadFile,
  fileItem,
  flushPrivateWorkspaceCleanups,
  openPrivateWorkspace,
  readTestFileFixture,
  uploadFileAt,
  uploadFileViaUi,
} from './helpers/files';
import { deleteItemViaUi, openTrashItemActions, purgeTrashedItemByName } from './helpers/trash';
import { ensureApprovedUser, getTestSuffix, loginAsUser, loginAsUserApi } from './helpers/auth';
import {
  getSessionToken,
  gotoFilesPath,
  resolvePathOrNull,
  resolveNodeId,
} from './helpers/resolvePath';

test.use({ storageState: ADMIN_STATE });

// Case-owned trashed names; purged in afterEach so trash residue never
// accumulates across a run (assertion-context containment). The global
// empty-trash case (E2E-TRASH-007) lives in trash-admin.spec.ts — it purges
// EVERY project's trash, so it must not run in two projects concurrently.
const pendingTrashPurges: Array<{ token: string; name: string }> = [];

test.afterEach(async ({ request }) => {
  for (const { token, name } of pendingTrashPurges.splice(0, pendingTrashPurges.length)) {
    await purgeTrashedItemByName(request, token, name);
  }
  await flushPrivateWorkspaceCleanups(request);
});

const textFixtureBuffer = readTestFileFixture(TEST_FILES.smallText);

function isMobileProject(testInfo: TestInfo) {
  return testInfo.project.name.endsWith('-mobile');
}

test('E2E-TRASH-001: Deleted item disappears from its folder and appears in the trash view', async ({
  page,
  request,
}, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const isMobile = isMobileProject(testInfo);
  const token = await getSessionToken(page);
  const fileName = buildName(testInfo, 'trash-me', '.txt');
  const filePath = `/${base}/${fileName}`;

  await uploadFileViaUi(page, {
    fileName,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await expect(fileItem(page, filePath)).toBeVisible();

  await deleteItemViaUi(page, isMobile, filePath);
  pendingTrashPurges.push({ token, name: fileName });

  // The item leaves the live folder listing...
  await expect(fileItem(page, filePath)).toHaveCount(0);

  // ...and appears in the trash view under its original path.
  await page.goto('/files/__trash__');
  await expect(fileItem(page, filePath)).toBeVisible({ timeout: 10_000 });
});

test('E2E-TRASH-003: Restore round-trip keeps the file byte-identical', async ({
  page,
  request,
}, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const isMobile = isMobileProject(testInfo);
  const token = await getSessionToken(page);
  const fileName = buildName(testInfo, 'trash-restore-roundtrip', '.txt');
  const filePath = `/${base}/${fileName}`;

  // Known-bytes file created via API (seed), trashed via the UI, restored via
  // the trash UI, then downloaded and compared byte-for-byte.
  const folderNodeId = await resolveNodeId(request, token, `/${base}`);
  const fileNodeId = await uploadFileAt(
    request,
    token,
    folderNodeId,
    fileName,
    'text/plain',
    textFixtureBuffer
  );

  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, filePath)).toBeVisible();

  await deleteItemViaUi(page, isMobile, filePath);
  pendingTrashPurges.push({ token, name: fileName });

  await expect(fileItem(page, filePath)).toHaveCount(0);

  await page.goto('/files/__trash__');
  await expect(fileItem(page, filePath)).toBeVisible({ timeout: 10_000 });

  await openTrashItemActions(page, isMobile, filePath, 'restore');

  // The item returns to its original folder with its bytes intact.
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, filePath)).toBeVisible({ timeout: 10_000 });

  const downloaded = await downloadFile(request, token, fileNodeId);
  expect(downloaded.equals(textFixtureBuffer)).toBeTruthy();
});

test('E2E-TRASH-006: Permanent delete removes the item from the trash listing', async ({
  page,
  request,
}, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const isMobile = isMobileProject(testInfo);
  const token = await getSessionToken(page);
  const folderName = buildName(testInfo, 'trash-purge-folder');
  const folderPath = `/${base}/${folderName}`;

  await createFolderViaUi(page, folderName);
  await expect(fileItem(page, folderPath)).toBeVisible();

  await deleteItemViaUi(page, isMobile, folderPath);
  pendingTrashPurges.push({ token, name: folderName });

  await expect(fileItem(page, folderPath)).toHaveCount(0);

  await page.goto('/files/__trash__');
  await expect(fileItem(page, folderPath)).toBeVisible({ timeout: 10_000 });

  await openTrashItemActions(page, isMobile, folderPath, 'purge');

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('confirm-dialog-confirm')).toBeVisible();
  await dialog.getByTestId('confirm-dialog-confirm').click();

  // Gone from the trash listing and not restored to the live folder.
  await expect(fileItem(page, folderPath)).toHaveCount(0);
  await expect(await resolvePathOrNull(request, token, folderPath)).toBeNull();
});

test('E2E-TRASH-012: Sidebar Home from the trash view returns to the main list', async ({
  page,
  request,
}, testInfo) => {
  // Regression (DEF-16 P9): in the trash view the tree's Home item carries the
  // user's rootNodeId — a NUMBER for non-admins — and was hijacked by the
  // trash-breadcrumb branch (openTrashFolder), landing on the trash view again
  // instead of the main list. A regular (non-admin) user is required to
  // reproduce: the admin's homeNodeId is null and navigates correctly.
  const suffix = getTestSuffix(testInfo);
  await ensureApprovedUser(request, 'user1', suffix);
  const userToken = await loginAsUserApi(request, 'user1', suffix);
  const userHomeName = `${TEST_USERS.user1.username}_${suffix}`;
  const userHomePath = `/${userHomeName}`;

  const fileName = buildName(testInfo, 'trash-home', '.txt');
  const userFilePath = `${userHomePath}/${fileName}`;
  await uploadFileAt(
    request,
    userToken,
    await resolveNodeId(request, userToken, userHomePath),
    fileName,
    'text/plain',
    textFixtureBuffer
  );

  // Enter the trash view as user1 (UI login — the session determines whose
  // trash is shown; the trashed item belongs to user1).
  await loginAsUser(page, 'user1', suffix);
  await page.goto('/files');
  await expect(fileItem(page, userFilePath)).toBeVisible({ timeout: 10_000 });

  await deleteItemViaUi(page, isMobileProject(testInfo), userFilePath);
  await page.goto('/files/__trash__');
  await expect(fileItem(page, userFilePath)).toBeVisible({ timeout: 10_000 });

  // Click the tree's Home item (the bottom-pinned trash row is separate).
  // Mobile keeps the tree in a drawer — open it first.
  if (isMobileProject(testInfo)) {
    await page.getByRole('button', { name: /Open folder tree/i }).click();
    await expect(page.getByTestId('folder-tree-item').filter({ hasText: 'Home' })).toBeVisible();
  }
  await page
    .locator('[data-testid="folder-tree-item"]')
    .filter({ hasText: 'Home' })
    .first()
    .click();

  // Returns to the main list — NOT the trash view (topmost or folder view).
  await expect(page).not.toHaveURL(/__trash__/);
});
