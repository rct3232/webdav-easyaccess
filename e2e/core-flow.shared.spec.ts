import { type Page, type TestInfo } from '@playwright/test';

import { TEST_FILES } from './fixtures/test-data';
import { ADMIN_STATE, expect, test } from './fixtures/authenticated';
import { loginAsAdmin, loginAsUser, loginAsUserApi } from './helpers/auth';
import { breadcrumbChip, openItemActions } from './helpers/explorer';
import { switchViewMode, setSortMode } from './helpers/explorer-controls';
import { doubleClickItem } from './helpers/desktop-interactions';
import {
  apiMoveViaBatch,
  buildName,
  bulkDeleteSelected,
  createFolderAt,
  createFolderViaUi,
  downloadFile,
  fileItem,
  flushPrivateWorkspaceCleanups,
  listNodeChildren,
  openFolderPickerAndSelectDestination,
  openFolderRouteAndWaitForItems,
  openPrivateWorkspace,
  readTestFileFixture,
  uploadFileAt,
  uploadFileViaUi,
  waitForBulkOperationToComplete,
} from './helpers/files';
import {
  clickActionSheetItem,
  longPressItem,
  openActionSheet,
} from './helpers/mobile-interactions';
import {
  getSessionToken,
  gotoFilesPath,
  resolveNodeId,
  resolvePathOrNull,
} from './helpers/resolvePath';

/**
 * Shared explorer flows — core CRUD/navigation, bulk interactions, and the
 * virtual-collection surfaces (`E2E-EXP-*`, `E2E-BULK-*`, `E2E-OVERLAY-*`).
 *
 * Owning projects: `s3-desktop` / `s3-mobile` on the shared API/client stack
 * (API `:5002`, client `:3000`), plus the `webdav-smoke-desktop` subset selected
 * by `playwright.config.ts`. Authenticated with the seeded admin `storageState`;
 * cleanup runs per test through the API request context.
 */

test.use({ storageState: ADMIN_STATE });

test.afterEach(async ({ request }) => {
  await flushPrivateWorkspaceCleanups(request);
});

const textFixtureBuffer = readTestFileFixture(TEST_FILES.smallText);
const imageFixtureBuffer = readTestFileFixture(TEST_FILES.smallImage);

async function createTestFolder(page: any, folderName: string) {
  await createFolderViaUi(page, folderName);
}

async function createTestFile(page: any, fileName: string) {
  await uploadFileViaUi(page, {
    fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('test content'),
  });
}

function isMobileProject(testInfo: TestInfo) {
  return testInfo.project.name.endsWith('-mobile');
}

async function openItemMenu(
  page: Page,
  isMobile: boolean,
  filePath: string,
  action: 'rename' | 'delete'
) {
  if (isMobile) {
    await openActionSheet(page, filePath);
    await clickActionSheetItem(page, action);
  } else {
    await openItemActions(page, filePath);
    await page.getByTestId(`file-action-${action}`).click();
  }
}

async function selectSingleItemForBulk(page: Page, isMobile: boolean, filePath: string) {
  if (isMobile) {
    await longPressItem(page, filePath);
  } else {
    await fileItem(page, filePath).click();
  }
  await expect(page.getByTestId('bulk-action-move')).toBeVisible();
}

async function selectTwoFiles(
  page: Page,
  isMobile: boolean,
  firstFilePath: string,
  secondFilePath: string
) {
  if (isMobile) {
    // Long-press the first, then tap the second and verify BOTH items are
    // selected. WebKit synthetic taps can intermittently mis-target right after
    // the bulk toolbar mounts (selection count drops to 0 and the toolbar
    // disappears — see the s3-mobile E2E-BULK-002 CI flake). When a tap goes
    // astray, reset via "Deselect all" and redo the sequence (bounded).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        if (
          await page
            .getByTestId('bulk-action-deselect-all')
            .isVisible()
            .catch(() => false)
        ) {
          await page.getByTestId('bulk-action-deselect-all').click();
          await expect(page.getByTestId('bulk-action-move')).not.toBeVisible();
        }
      }
      await longPressItem(page, firstFilePath);
      await fileItem(page, secondFilePath).click();
      try {
        await expect(fileItem(page, firstFilePath)).toHaveAttribute('aria-selected', 'true', {
          timeout: 2500,
        });
        await expect(fileItem(page, secondFilePath)).toHaveAttribute('aria-selected', 'true', {
          timeout: 2500,
        });
        break;
      } catch {
        // Mis-targeted tap; retry the whole sequence.
      }
    }
    await expect(page.getByTestId('bulk-action-move')).toBeVisible();
  } else {
    await fileItem(page, firstFilePath).click();
    await fileItem(page, secondFilePath).click({ modifiers: ['Meta'] });
    await expect(page.getByTestId('bulk-action-move')).toBeVisible();
  }
}

async function openPreviewableItem(page: Page, isMobile: boolean, filePath: string) {
  if (isMobile) {
    await fileItem(page, filePath).click();
  } else {
    await fileItem(page, filePath).dblclick();
  }
}

test('E2E-EXP-001: Explorer loads after login', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page).toHaveURL(/\/files(?:\/.*)?$/);
  await expect(page.getByTestId('file-actions-fab')).toBeVisible();
});

test('E2E-EXP-002: Direct route entry loads a nested folder path', async ({
  page,
  request,
}, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const parentFolderName = buildName(testInfo, 'direct-route-parent');
  const childFolderName = buildName(testInfo, 'direct-route-child');
  const markerFileName = buildName(testInfo, 'direct-route-marker', '.txt');
  const parentFolderPath = `/${base}/${parentFolderName}`;
  const childFolderPath = `${parentFolderPath}/${childFolderName}`;
  const markerFilePath = `${childFolderPath}/${markerFileName}`;

  await createFolderViaUi(page, parentFolderName);
  await expect(fileItem(page, parentFolderPath)).toBeVisible();

  await gotoFilesPath(page, request, parentFolderPath);
  await createFolderViaUi(page, childFolderName);
  await expect(fileItem(page, childFolderPath)).toBeVisible();

  await gotoFilesPath(page, request, childFolderPath);
  await uploadFileViaUi(page, {
    fileName: markerFileName,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await expect(fileItem(page, markerFilePath)).toBeVisible();

  await gotoFilesPath(page, request, `/${base}`);
  await gotoFilesPath(page, request, childFolderPath);

  await expect(fileItem(page, markerFilePath)).toBeVisible();
  await expect(breadcrumbChip(page, parentFolderName)).toBeVisible();
  await expect(breadcrumbChip(page, childFolderName)).toBeVisible();
});

test('E2E-EXP-003: Breadcrumb navigation changes current folder', async ({
  page,
  request,
}, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const parentFolderName = buildName(testInfo, 'breadcrumb-parent');
  const childFolderName = buildName(testInfo, 'breadcrumb-child');
  const nestedFileName = buildName(testInfo, 'breadcrumb-marker', '.txt');
  const parentFolderPath = `/${base}/${parentFolderName}`;
  const childFolderPath = `${parentFolderPath}/${childFolderName}`;
  const nestedFilePath = `${childFolderPath}/${nestedFileName}`;

  await createFolderViaUi(page, parentFolderName);

  await gotoFilesPath(page, request, parentFolderPath);
  await createFolderViaUi(page, childFolderName);

  await gotoFilesPath(page, request, childFolderPath);
  await uploadFileViaUi(page, {
    fileName: nestedFileName,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await expect(fileItem(page, nestedFilePath)).toBeVisible();

  await breadcrumbChip(page, parentFolderName).click();

  await expect(fileItem(page, childFolderPath)).toBeVisible();
  await expect(fileItem(page, nestedFilePath)).toHaveCount(0);
});

test('E2E-EXP-004: Creates a folder from the FAB', async ({ page, request }, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const folderName = buildName(testInfo, 'flow-folder');
  const folderPath = `/${base}/${folderName}`;

  await createFolderViaUi(page, folderName);

  await expect(fileItem(page, folderPath)).toBeVisible();

  // Absence regression (class A): a folder the user created themselves must never
  // surface in the "Shared" collection. Inject the failure precondition (the own
  // folder exists) and assert the user cannot see it as shared content.
  const bearerToken = await getSessionToken(page);
  const ownNodeId = await resolveNodeId(request, bearerToken, folderPath);

  await page.goto('/files/__shared__');
  await expect(page).toHaveURL(/\/files\/__shared__(?:\/.*)?$/);
  await expect(page.locator(`[data-file-node-id="${ownNodeId}"]`)).toHaveCount(0);

  // The sidebar must not render a "Shared" section for the own folder either.
  // Absence is asserted deterministically: a one-shot isVisible() right after goto
  // raced the tree mount — and on mobile the tree is collapsed behind the breadcrumb
  // toggle, so the check silently skipped. Open the tree on mobile, wait for it to
  // render, then assert the Shared section stays absent.
  const folderTree = page.getByTestId('folder-tree');
  if (isMobileProject(testInfo)) {
    await page.locator('button[title="Open folder tree"]').click();
  }
  await expect(folderTree).toBeVisible({ timeout: 20_000 });
  await expect(folderTree.getByRole('button', { name: /Shared/i })).toHaveCount(0);
});

test('E2E-EXP-005: Uploads a file from the dialog', async ({ page, request }, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const fileName = buildName(testInfo, 'flow-upload', '.txt');

  await uploadFileViaUi(page, {
    fileName,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });

  await expect(fileItem(page, `/${base}/${fileName}`)).toBeVisible();
});

test('E2E-EXP-006: Renames an item from platform-specific actions', async ({
  page,
  request,
}, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const isMobile = isMobileProject(testInfo);
  const originalName = buildName(testInfo, 'flow-rename-source');
  const renamedName = buildName(testInfo, 'flow-renamed');
  const originalPath = `/${base}/${originalName}`;
  const renamedPath = `/${base}/${renamedName}`;

  await createFolderViaUi(page, originalName);
  await expect(fileItem(page, originalPath)).toBeVisible();

  await openItemMenu(page, isMobile, originalPath, 'rename');

  let dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('rename-name-input')).toBeVisible();
  await dialog.getByTestId('rename-name-input').fill(renamedName);
  await dialog.getByTestId('rename-submit').click();

  await expect(fileItem(page, renamedPath)).toBeVisible();
  await expect(fileItem(page, originalPath)).toHaveCount(0);

  await openItemMenu(page, isMobile, renamedPath, 'delete');

  dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('confirm-dialog-confirm')).toBeVisible();
  await dialog.getByTestId('confirm-dialog-confirm').click();

  await expect(fileItem(page, renamedPath)).toHaveCount(0);
});

test('E2E-EXP-008: Opens a previewable file', async ({ page, request }, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const isMobile = isMobileProject(testInfo);
  const imageFileName = buildName(testInfo, 'preview-image', '.jpg');
  const imageFilePath = `/${base}/${imageFileName}`;

  await uploadFileViaUi(page, {
    fileName: imageFileName,
    mimeType: 'image/jpeg',
    buffer: imageFixtureBuffer,
  });
  await expect(fileItem(page, imageFilePath)).toBeVisible();

  await openPreviewableItem(page, isMobile, imageFilePath);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('img').first()).toBeVisible();
});

test('E2E-EXP-009: View mode switch changes visible layout', async ({
  page,
  request,
}, testInfo) => {
  // 1. Open the per-test workspace (logs in as admin and enters its base folder)
  const base = await openPrivateWorkspace(page, request, testInfo);
  const isMobile = isMobileProject(testInfo);

  // 2. Create a test folder inside the base folder
  const folderName = buildName(testInfo, 'view-mode-folder');
  await createTestFolder(page, folderName);

  // 3. Reload the base folder listing
  await gotoFilesPath(page, request, `/${base}`);
  await expect(page.getByTestId('file-actions-fab')).toBeVisible();

  // 4. Assert current layout (default is list) - check for folder item
  await expect(page.locator(`[data-file-path="/${base}/${folderName}"]`)).toBeVisible();

  // 5. Switch to grid mode
  await switchViewMode(page, 'grid');

  // 6. Assert grid layout is visible (Box with data-file-path containing MuiCard)
  await expect(
    page.locator(`[data-file-path="/${base}/${folderName}"] .MuiCard-root`)
  ).toBeVisible();

  // 7/8. Detail mode: desktop switches and asserts the table row; mobile has
  // NO detail toggle (FileManagerControls §2 — the collections mobile 016
  // contract), so it asserts the toggle's absence instead.
  if (isMobile) {
    await expect(page.getByTestId('view-mode-detail')).toHaveCount(0);
  } else {
    await switchViewMode(page, 'detail');

    await expect(
      page.locator(`table.MuiTable-root tbody tr[data-file-path="/${base}/${folderName}"]`)
    ).toBeVisible();
  }

  // 9. Switch back to list mode
  await switchViewMode(page, 'list');

  // 10. Assert list layout is visible again
  await expect(page.locator(`[data-file-path="/${base}/${folderName}"]`)).toBeVisible();
});

test('E2E-EXP-010: Sort mode changes displayed order', async ({ page, request }, testInfo) => {
  // 1. Open the per-test workspace (logs in as admin and enters its base folder)
  const base = await openPrivateWorkspace(page, request, testInfo);

  // 2. Create multiple test folders inside the base folder
  const folder1 = buildName(testInfo, 'folder-aaa');
  const folder2 = buildName(testInfo, 'folder-zzz');
  const folder3 = buildName(testInfo, 'folder-mmm');

  await createTestFolder(page, folder1);
  await createTestFolder(page, folder2);
  await createTestFolder(page, folder3);

  // 3. Reload the base folder listing
  await gotoFilesPath(page, request, `/${base}`);
  await expect(page.getByTestId('file-actions-fab')).toBeVisible();

  // 4. Get initial item order (name-asc by default)
  const initialItems = await page.locator('[data-file-path]').allTextContents();

  // 5. Set sort mode to name-desc
  await setSortMode(page, 'name-desc');

  // 6. Get sorted item order
  const sortedItemsDesc = await page.locator('[data-file-path]').allTextContents();

  // 7. Assert order changed (zzz should come before aaa)
  const zzzIndex = sortedItemsDesc.findIndex((item) => item.includes('folder-zzz'));
  const aaaIndex = sortedItemsDesc.findIndex((item) => item.includes('folder-aaa'));
  expect(zzzIndex).toBeLessThan(aaaIndex);

  // 8. Set sort mode to name-asc
  await setSortMode(page, 'name-asc');

  // 9. Get sorted item order
  const sortedItemsAsc = await page.locator('[data-file-path]').allTextContents();

  // 10. Assert order changed back (aaa should come before zzz)
  const aaaIndexAsc = sortedItemsAsc.findIndex((item) => item.includes('folder-aaa'));
  const zzzIndexAsc = sortedItemsAsc.findIndex((item) => item.includes('folder-zzz'));
  expect(aaaIndexAsc).toBeLessThan(zzzIndexAsc);
});

test('E2E-EXP-011: Search filters current listing', async ({ page, request }, testInfo) => {
  // 1. Open the per-test workspace (logs in as admin and enters its base folder)
  const base = await openPrivateWorkspace(page, request, testInfo);

  // 2. Create 3 test folders with distinct names inside the base folder
  const folderAlpha = buildName(testInfo, 'alpha');
  const folderBeta = buildName(testInfo, 'beta');
  const folderGamma = buildName(testInfo, 'gamma');

  await createTestFolder(page, folderAlpha);
  await createTestFolder(page, folderBeta);
  await createTestFolder(page, folderGamma);

  // 3. Reload the base folder listing
  await gotoFilesPath(page, request, `/${base}`);
  await expect(page.getByTestId('file-actions-fab')).toBeVisible();

  // 4. Verify all 3 folders are visible
  await expect(page.locator(`[data-file-path="/${base}/${folderAlpha}"]`)).toBeVisible();
  await expect(page.locator(`[data-file-path="/${base}/${folderBeta}"]`)).toBeVisible();
  await expect(page.locator(`[data-file-path="/${base}/${folderGamma}"]`)).toBeVisible();

  // 5. Fill searchbox with "beta"
  const searchbox = page.getByRole('searchbox');
  await expect(searchbox).toBeVisible();
  await searchbox.fill('beta');

  // 6. Assert only beta folder visible (search filters results)
  await expect(page.locator(`[data-file-path="/${base}/${folderBeta}"]`)).toBeVisible();
  await expect(page.locator(`[data-file-path="/${base}/${folderAlpha}"]`)).not.toBeVisible();
  await expect(page.locator(`[data-file-path="/${base}/${folderGamma}"]`)).not.toBeVisible();

  // 6b. The live filter term highlights the matched fragment inside the row
  // name (yellow live marks; nothing committed exists outside a results
  // session — browse-highlight contract folded in from the retrieval suite).
  const betaRow = page.locator(`[data-file-path="/${base}/${folderBeta}"]`);
  const liveMarks = betaRow.getByTestId('filter-highlight-range');
  await expect(liveMarks).toHaveCount(1);
  await expect(liveMarks).toHaveText(/beta/i);
  await expect(page.getByTestId('search-highlight-range')).toHaveCount(0);

  // 7. Click clear button (X icon) to clear search
  const clearButton = page.locator('[aria-label="Close search"]');
  await expect(clearButton).toBeVisible();
  await clearButton.click();

  // 8. Assert all folders visible again
  await expect(page.locator(`[data-file-path="/${base}/${folderAlpha}"]`)).toBeVisible();
  await expect(page.locator(`[data-file-path="/${base}/${folderBeta}"]`)).toBeVisible();
  await expect(page.locator(`[data-file-path="/${base}/${folderGamma}"]`)).toBeVisible();
});

test('E2E-EXP-012: Renames a file and keeps its content byte-identical', async ({
  page,
  request,
}, testInfo) => {
  // Ported from E2E-S3PG-002. Backend-agnostic regression net for the rename
  // re-upload sync path (WebDAV mode re-uploads the blob under the new name).
  const dirName = buildName(testInfo, 'rename-dir');
  const oldName = buildName(testInfo, 'rename-old', '.txt');
  const newName = buildName(testInfo, 'rename-new', '.txt');
  const dirPath = `/user1/${dirName}`;
  const oldPath = `${dirPath}/${oldName}`;
  const newPath = `${dirPath}/${newName}`;

  const token = await loginAsUserApi(request, 'user1');
  const homeNodeId = await resolveNodeId(request, token, '/user1');
  const dirNodeId = await createFolderAt(request, token, homeNodeId, dirName);
  const fileNodeId = await uploadFileAt(
    request,
    token,
    dirNodeId,
    oldName,
    'text/plain',
    textFixtureBuffer
  );

  const renameRes = await request.put('/api/files/rename', {
    headers: { Authorization: `Bearer ${token}` },
    data: { nodeId: fileNodeId, newName },
  });
  expect(renameRes.ok()).toBeTruthy();

  const renamedNodeId = await resolveNodeId(request, token, newPath);
  expect(renamedNodeId).toBe(fileNodeId);
  expect(await resolvePathOrNull(request, token, oldPath)).toBeNull();

  const downloaded = await downloadFile(request, token, renamedNodeId);
  expect(downloaded.equals(textFixtureBuffer)).toBeTruthy();

  await loginAsUser(page, 'user1');
  await gotoFilesPath(page, request, dirPath);
  await expect(fileItem(page, newPath)).toBeVisible();
  await expect(fileItem(page, oldPath)).toHaveCount(0);
});

test('E2E-EXP-013: Moves a file across folders and keeps its content byte-identical', async ({
  page,
  request,
}, testInfo) => {
  // Ported from E2E-S3PG-003. Backend-agnostic regression net for the move
  // sync path (old location must not keep serving the file in WebDAV mode).
  const folderAName = buildName(testInfo, 'move-a');
  const folderBName = buildName(testInfo, 'move-b');
  const fileName = buildName(testInfo, 'move-file', '.txt');
  const folderAPath = `/user1/${folderAName}`;
  const folderBPath = `/user1/${folderBName}`;
  const oldFilePath = `${folderAPath}/${fileName}`;
  const newFilePath = `${folderBPath}/${fileName}`;

  const token = await loginAsUserApi(request, 'user1');
  const homeNodeId = await resolveNodeId(request, token, '/user1');
  const folderANodeId = await createFolderAt(request, token, homeNodeId, folderAName);
  const folderBNodeId = await createFolderAt(request, token, homeNodeId, folderBName);
  const fileNodeId = await uploadFileAt(
    request,
    token,
    folderANodeId,
    fileName,
    'text/plain',
    textFixtureBuffer
  );

  await apiMoveViaBatch(request, token, [fileNodeId], folderBNodeId);

  expect(await resolvePathOrNull(request, token, oldFilePath)).toBeNull();
  const movedNodeId = await resolveNodeId(request, token, newFilePath);
  expect(movedNodeId).toBe(fileNodeId);

  const downloaded = await downloadFile(request, token, movedNodeId);
  expect(downloaded.equals(textFixtureBuffer)).toBeTruthy();

  const folderBListing = await listNodeChildren(request, token, folderBNodeId);
  expect(folderBListing.some((item) => item.nodeId === fileNodeId)).toBeTruthy();
  const folderAListing = await listNodeChildren(request, token, folderANodeId);
  expect(folderAListing.some((item) => item.nodeId === fileNodeId)).toBeFalsy();

  await loginAsUser(page, 'user1');
  await gotoFilesPath(page, request, folderBPath);
  await expect(fileItem(page, newFilePath)).toBeVisible();
  await gotoFilesPath(page, request, folderAPath);
  await expect(fileItem(page, oldFilePath)).toHaveCount(0);
});

test('E2E-EXP-014: Standard-user home shows Home labels in breadcrumb and folder tree', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const childFolderName = buildName(testInfo, 'home-label-child');
  const childFolderPath = `/user1/${childFolderName}`;

  const token = await loginAsUserApi(request, 'user1');
  const homeNodeId = await resolveNodeId(request, token, '/user1');
  await createFolderAt(request, token, homeNodeId, childFolderName);

  await loginAsUser(page, 'user1');
  await gotoFilesPath(page, request, childFolderPath);

  // Breadcrumb: first chip is Home; the username home node is never an extra chip.
  const breadcrumb = page.getByTestId('breadcrumb');
  await expect(breadcrumb.getByRole('button', { name: 'Home', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    breadcrumb.getByRole('button', { name: childFolderName, exact: true })
  ).toBeVisible();
  await expect(breadcrumb.getByRole('button', { name: 'user1', exact: true })).toHaveCount(0);

  // Folder tree: home row is Home (never the username); the home row stays selectable.
  const folderTree = page.getByTestId('folder-tree');
  if (isMobile) {
    await page.locator('button[title="Open folder tree"]').click();
  }
  await expect(folderTree).toBeVisible({ timeout: 20_000 });
  await expect(folderTree.getByRole('button', { name: 'Home', exact: true }).first()).toBeVisible();
  await expect(folderTree.getByRole('button', { name: 'user1', exact: true })).toHaveCount(0);
});

test('E2E-BULK-001: Enters selection mode and shows the bulk toolbar', async ({
  page,
  request,
}, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const isMobile = isMobileProject(testInfo);
  const folderName = buildName(testInfo, 'bulk-select-folder');
  const folderPath = `/${base}/${folderName}`;

  await createFolderViaUi(page, folderName);
  await expect(fileItem(page, folderPath)).toBeVisible();

  await selectSingleItemForBulk(page, isMobile, folderPath);

  await expect(page.getByTestId('bulk-action-move')).toBeVisible();
  await expect(page.getByTestId('bulk-action-copy')).toBeVisible();
  await expect(page.getByTestId('bulk-action-download')).toBeVisible();
  await expect(page.getByTestId('bulk-action-delete')).toBeVisible();
});

test('E2E-BULK-002: Moves selected items to another folder', async ({
  page,
  request,
}, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const isMobile = isMobileProject(testInfo);
  const srcFile1Name = buildName(testInfo, 'bulk-move-src-1', '.txt');
  const srcFile2Name = buildName(testInfo, 'bulk-move-src-2', '.txt');
  const srcFile1Path = `/${base}/${srcFile1Name}`;
  const srcFile2Path = `/${base}/${srcFile2Name}`;

  const destFolderName = buildName(testInfo, 'bulk-move-dest-folder');
  const destFolderPath = `/${base}/${destFolderName}`;
  const destFile1Path = `${destFolderPath}/${srcFile1Name}`;
  const destFile2Path = `${destFolderPath}/${srcFile2Name}`;

  await uploadFileViaUi(page, {
    fileName: srcFile1Name,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await uploadFileViaUi(page, {
    fileName: srcFile2Name,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await createFolderViaUi(page, destFolderName);

  await selectTwoFiles(page, isMobile, srcFile1Path, srcFile2Path);
  await openFolderPickerAndSelectDestination(page, 'move', destFolderName);

  await expect(fileItem(page, srcFile1Path)).toHaveCount(0);
  await expect(fileItem(page, srcFile2Path)).toHaveCount(0);

  await gotoFilesPath(page, request, destFolderPath);
  await expect(fileItem(page, destFile1Path)).toBeVisible();
  await expect(fileItem(page, destFile2Path)).toBeVisible();
});

test('E2E-BULK-003: Copies selected items to another folder', async ({
  page,
  request,
}, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const isMobile = isMobileProject(testInfo);
  const srcFile1Name = buildName(testInfo, 'bulk-copy-src-1', '.txt');
  const srcFile2Name = buildName(testInfo, 'bulk-copy-src-2', '.txt');
  const srcFile1Path = `/${base}/${srcFile1Name}`;
  const srcFile2Path = `/${base}/${srcFile2Name}`;

  const destFolderName = buildName(testInfo, 'bulk-copy-dest-folder');
  const destFolderPath = `/${base}/${destFolderName}`;
  const destFile1Path = `${destFolderPath}/${srcFile1Name}`;
  const destFile2Path = `${destFolderPath}/${srcFile2Name}`;

  await uploadFileViaUi(page, {
    fileName: srcFile1Name,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await uploadFileViaUi(page, {
    fileName: srcFile2Name,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await createFolderViaUi(page, destFolderName);

  await selectTwoFiles(page, isMobile, srcFile1Path, srcFile2Path);
  await openFolderPickerAndSelectDestination(page, 'copy', destFolderName);

  if (!isMobile) {
    await waitForBulkOperationToComplete(page);
  }

  await expect(fileItem(page, srcFile1Path)).toBeVisible();
  await expect(fileItem(page, srcFile2Path)).toBeVisible();

  await openFolderRouteAndWaitForItems(page, request, destFolderPath, [
    destFile1Path,
    destFile2Path,
  ]);
});

test('E2E-BULK-004: Deletes selected items', async ({ page, request }, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const isMobile = isMobileProject(testInfo);
  const srcFile1Name = buildName(testInfo, 'bulk-delete-src-1', '.txt');
  const srcFile2Name = buildName(testInfo, 'bulk-delete-src-2', '.txt');
  const srcFile1Path = `/${base}/${srcFile1Name}`;
  const srcFile2Path = `/${base}/${srcFile2Name}`;

  await uploadFileViaUi(page, {
    fileName: srcFile1Name,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await uploadFileViaUi(page, {
    fileName: srcFile2Name,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });

  await expect(fileItem(page, srcFile1Path)).toBeVisible();
  await expect(fileItem(page, srcFile2Path)).toBeVisible();

  await selectTwoFiles(page, isMobile, srcFile1Path, srcFile2Path);
  await bulkDeleteSelected(page);

  await expect(fileItem(page, srcFile1Path)).toHaveCount(0);
  await expect(fileItem(page, srcFile2Path)).toHaveCount(0);
});

test('E2E-BULK-006: Mobile multi-download is disabled', async ({ page, request }, testInfo) => {
  test.skip(!isMobileProject(testInfo), 'E2E-BULK-006 is mobile-only');

  const base = await openPrivateWorkspace(page, request, testInfo);
  const srcFile1Name = buildName(testInfo, 'bulk-download-src-1', '.txt');
  const srcFile2Name = buildName(testInfo, 'bulk-download-src-2', '.txt');
  const srcFile1Path = `/${base}/${srcFile1Name}`;
  const srcFile2Path = `/${base}/${srcFile2Name}`;

  await uploadFileViaUi(page, {
    fileName: srcFile1Name,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await uploadFileViaUi(page, {
    fileName: srcFile2Name,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });

  await expect(fileItem(page, srcFile1Path)).toBeVisible();
  await expect(fileItem(page, srcFile2Path)).toBeVisible();

  await selectTwoFiles(page, true, srcFile1Path, srcFile2Path);

  const downloadButton = page.getByTestId('bulk-action-download');
  await expect(downloadButton).toBeVisible();
  await expect(downloadButton).toBeDisabled();
});

test('E2E-BULK-007: Conflict resolution dialog appears when move/copy would collide', async ({
  page,
  request,
}, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const isMobile = isMobileProject(testInfo);
  const folderA = buildName(testInfo, 'conflict-folder-a');
  const folderB = buildName(testInfo, 'conflict-folder-b');
  const conflictFileName = 'conflict_test.txt';

  await createFolderViaUi(page, folderA);
  await createFolderViaUi(page, folderB);

  await gotoFilesPath(page, request, `/${base}/${folderA}`);
  await uploadFileViaUi(page, {
    fileName: conflictFileName,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });

  await gotoFilesPath(page, request, `/${base}/${folderB}`);
  await uploadFileViaUi(page, {
    fileName: conflictFileName,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });

  await gotoFilesPath(page, request, `/${base}/${folderA}`);
  await selectSingleItemForBulk(page, isMobile, `/${base}/${folderA}/${conflictFileName}`);

  await page.getByTestId('bulk-action-move').click();

  const pickerDialog = page.getByRole('dialog');
  await expect(pickerDialog).toBeVisible();

  // The picker opens listing the current folder's subfolders (none inside
  // folderA). Go to the filesystem root via the first breadcrumb, descend into
  // the per-test base folder, then pick folderB as the destination.
  await pickerDialog.locator('.MuiBreadcrumbs-root button').first().click();
  await expect(pickerDialog.getByRole('progressbar')).not.toBeVisible();

  const baseFolderItem = pickerDialog.locator('li').filter({ hasText: base });
  await expect(baseFolderItem).toBeVisible({ timeout: 10000 });
  await baseFolderItem.click();
  await expect(pickerDialog.getByRole('progressbar')).not.toBeVisible();

  const folderBItem = pickerDialog.locator('li').filter({ hasText: folderB });
  await expect(folderBItem).toBeVisible({ timeout: 10000 });
  await folderBItem.click();
  await pickerDialog.getByRole('button', { name: 'Select', exact: true }).click();

  const conflictDialog = page.getByRole('dialog');
  await expect(conflictDialog).toBeVisible();
  await expect(conflictDialog).toContainText('conflict', { ignoreCase: true });
  await expect(conflictDialog.getByRole('button', { name: /skip/i })).toBeVisible();
  await expect(conflictDialog.getByRole('button', { name: /merge/i })).toBeVisible();
});

test('E2E-BULK-010: Completed bulk move offers an undo toast that restores the source items', async ({
  page,
  request,
}, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const isMobile = isMobileProject(testInfo);
  const srcFile1Name = buildName(testInfo, 'bulk-undo-src-1', '.txt');
  const srcFile2Name = buildName(testInfo, 'bulk-undo-src-2', '.txt');
  const srcFile1Path = `/${base}/${srcFile1Name}`;
  const srcFile2Path = `/${base}/${srcFile2Name}`;

  const destFolderName = buildName(testInfo, 'bulk-undo-dest-folder');
  const destFolderPath = `/${base}/${destFolderName}`;
  const destFile1Path = `${destFolderPath}/${srcFile1Name}`;
  const destFile2Path = `${destFolderPath}/${srcFile2Name}`;

  await uploadFileViaUi(page, {
    fileName: srcFile1Name,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await uploadFileViaUi(page, {
    fileName: srcFile2Name,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await createFolderViaUi(page, destFolderName);

  await selectTwoFiles(page, isMobile, srcFile1Path, srcFile2Path);
  await openFolderPickerAndSelectDestination(page, 'move', destFolderName);

  // Job-backed completion: the progress chip reaches its terminal "Done"
  // state (then clears) before the command-level undo toast can be exercised.
  await waitForBulkOperationToComplete(page);

  // Journaled batch (domain=batch): ONE [Undo] slot per COMMAND on the
  // move-completion toast, never per item (useBulkOperations.md §2.6).
  const undoButton = page.getByTestId('undo-toast-action');
  await expect(undoButton).toBeVisible({ timeout: 10_000 });
  await expect(undoButton).toHaveText(/Undo/i);
  await expect(page.getByRole('alert').filter({ has: undoButton })).toContainText(
    /Move completed/i
  );

  // The forward move already emptied the source listing; the undo below must
  // re-list both items, so the restore assertions are not vacuous.
  await expect(fileItem(page, srcFile1Path)).toHaveCount(0);
  await expect(fileItem(page, srcFile2Path)).toHaveCount(0);

  await undoButton.click();

  // Journal inverse: both move-back entries restore the pre-move parent, and
  // the toast's per-call refresh re-reads the current (source) listing.
  await expect(fileItem(page, srcFile1Path)).toBeVisible({ timeout: 20_000 });
  await expect(fileItem(page, srcFile2Path)).toBeVisible({ timeout: 20_000 });

  await gotoFilesPath(page, request, destFolderPath);
  await expect(breadcrumbChip(page, destFolderName)).toBeVisible({ timeout: 20_000 });
  await expect(fileItem(page, destFile1Path)).toHaveCount(0);
  await expect(fileItem(page, destFile2Path)).toHaveCount(0);
});

test('E2E-OVERLAY-009: Approved user enters __recent__ and sees recent entries', async ({
  page,
  request,
}, testInfo) => {
  // 1. Open the per-test workspace (logs in as admin and enters its base folder)
  const base = await openPrivateWorkspace(page, request, testInfo);
  const isMobile = isMobileProject(testInfo);

  // 2. Setup: Create a test file inside the base folder to generate a recent entry
  const fileName = buildName(testInfo, 'recent-test-file') + '.txt';
  await createTestFile(page, fileName);

  // 2b. Open the file (double-click preview) so it is tracked as recent:
  // recent tracking fires on file open/preview, not on creation or listing.
  // Open (double-click on desktop; single tap on mobile — the file-parity
  // open contract proven by the collections mobile leg).
  const recentRow = fileItem(page, `/${base}/${fileName}`);
  await expect(recentRow).toBeVisible();
  if (isMobile) {
    await recentRow.tap();
  } else {
    await doubleClickItem(page, `/${base}/${fileName}`);
  }

  // 3. Navigate to the file's parent directory to track it as recent
  await gotoFilesPath(page, request, `/${base}`);
  await expect(page.getByTestId('file-actions-fab')).toBeVisible();

  // 4. Navigate directly to /files/__recent__ via URL
  // This triggers the __recent__ view which loads recent files from the API
  await page.goto('/files/__recent__');
  await expect(page).toHaveURL(/\/files\/__recent__(?:\/.*)?$/);

  // 5. Assertion: breadcrumb shows "Recent" label
  const breadcrumbChips = page.locator('.MuiChip-root');
  await expect(breadcrumbChips.first()).toContainText(/Recent/i);

  // 6. Assertion: the folder tree shows the Recent section in expanded/active
  // state — the tree lives in the permanent sidebar (desktop) or the drawer
  // (mobile), so the drawer opens first on mobile.
  if (isMobile) {
    await page.getByTestId('breadcrumb-folder-tree-toggle').click();
  }
  const folderTree = page.getByTestId('folder-tree');
  await expect(folderTree).toBeVisible({ timeout: 20_000 });
  const recentTreeButton = folderTree.getByRole('button', { name: /Recent/i }).first();
  await expect(recentTreeButton).toBeVisible();

  // 7. Assertion: a recent file entry is visible in the listing
  // The opened file appears in the recent files list. Recent entries are
  // keyed by nodeId and render `data-file-path` from display_path; wait for
  // the recent list to load (it is fetched after navigation).
  await expect(fileItem(page, `/${base}/${fileName}`)).toBeVisible({ timeout: 20_000 });
});

test('E2E-OVERLAY-010: Stale recent entry is removed after its file is deleted', async ({
  page,
  request,
}, testInfo) => {
  // 1. Open the per-test workspace (logs in as admin and enters its base folder)
  const base = await openPrivateWorkspace(page, request, testInfo);
  const isMobile = isMobileProject(testInfo);

  // 2. Setup: create a file inside the base folder and open it (preview) so it is
  // tracked as recent.
  const fileName = buildName(testInfo, 'recent-stale-file') + '.txt';
  await createTestFile(page, fileName);
  const staleRow = fileItem(page, `/${base}/${fileName}`);
  await expect(staleRow).toBeVisible();
  if (isMobile) {
    await staleRow.tap();
  } else {
    await doubleClickItem(page, `/${base}/${fileName}`);
  }

  const bearerToken = await getSessionToken(page);
  const nodeId = await resolveNodeId(request, bearerToken, `/${base}/${fileName}`);

  // 3. Precondition: the recent entry is present.
  await page.goto('/files/__recent__');
  await expect(page).toHaveURL(/\/files\/__recent__(?:\/.*)?$/);
  await expect(fileItem(page, `/${base}/${fileName}`)).toBeVisible({ timeout: 20_000 });

  // 4. Make the entry stale: delete the underlying file.
  await gotoFilesPath(page, request, `/${base}`);
  await expect(page.getByTestId('file-actions-fab')).toBeVisible();
  // Platform action surface: desktop row menu / mobile action sheet — the
  // sheet carries the same file-action-* testids (FileActionSheet parity).
  if (isMobile) {
    await openActionSheet(page, `/${base}/${fileName}`);
  } else {
    await openItemActions(page, `/${base}/${fileName}`);
  }
  await page.getByTestId('file-action-delete').click();
  const confirmDialog = page.getByRole('dialog');
  await expect(confirmDialog.getByTestId('confirm-dialog-confirm')).toBeVisible();
  await confirmDialog.getByTestId('confirm-dialog-confirm').click();
  await expect(fileItem(page, `/${base}/${fileName}`)).toHaveCount(0);

  // 5. Absence after recovery: the stale entry no longer appears in `__recent__`.
  await page.goto('/files/__recent__');
  await expect(page).toHaveURL(/\/files\/__recent__(?:\/.*)?$/);
  await expect(fileItem(page, `/${base}/${fileName}`)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(`[data-file-node-id="${nodeId}"]`)).toHaveCount(0);
});
