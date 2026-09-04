import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { TEST_FILES } from './fixtures/test-data';
import { loginAsAdmin, loginAsUser, loginAsUserApi } from './helpers/auth';
import { breadcrumbChip, openItemActions } from './helpers/explorer';
import {
  buildName,
  bulkDeleteSelected,
  createFolderAt,
  createFolderViaUi,
  downloadFile,
  fileItem,
  listNodeChildren,
  openFolderPickerAndSelectDestination,
  openFolderRouteAndWaitForItems,
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

const textFixtureBuffer = readTestFileFixture(TEST_FILES.smallText);
const imageFixtureBuffer = readTestFileFixture(TEST_FILES.smallImage);

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
  const parentFolderName = buildName(testInfo, 'direct-route-parent');
  const childFolderName = buildName(testInfo, 'direct-route-child');
  const markerFileName = buildName(testInfo, 'direct-route-marker', '.txt');
  const parentFolderPath = `/${parentFolderName}`;
  const childFolderPath = `${parentFolderPath}/${childFolderName}`;
  const markerFilePath = `${childFolderPath}/${markerFileName}`;

  await loginAsAdmin(page);
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

  await page.goto('/files');
  await gotoFilesPath(page, request, childFolderPath);

  await expect(fileItem(page, markerFilePath)).toBeVisible();
  await expect(breadcrumbChip(page, parentFolderName)).toBeVisible();
  await expect(breadcrumbChip(page, childFolderName)).toBeVisible();
});

test('E2E-EXP-003: Breadcrumb navigation changes current folder', async ({
  page,
  request,
}, testInfo) => {
  const parentFolderName = buildName(testInfo, 'breadcrumb-parent');
  const childFolderName = buildName(testInfo, 'breadcrumb-child');
  const nestedFileName = buildName(testInfo, 'breadcrumb-marker', '.txt');
  const parentFolderPath = `/${parentFolderName}`;
  const childFolderPath = `${parentFolderPath}/${childFolderName}`;
  const nestedFilePath = `${childFolderPath}/${nestedFileName}`;

  await loginAsAdmin(page);
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
  const folderName = buildName(testInfo, 'flow-folder');

  await loginAsAdmin(page);
  await createFolderViaUi(page, folderName);

  await expect(fileItem(page, `/${folderName}`)).toBeVisible();

  // Absence regression (class A): a folder the user created themselves must never
  // surface in the "Shared" collection. Inject the failure precondition (the own
  // folder exists) and assert the user cannot see it as shared content.
  const bearerToken = await getSessionToken(page);
  const ownNodeId = await resolveNodeId(request, bearerToken, `/${folderName}`);

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

test('E2E-EXP-005: Uploads a file from the dialog', async ({ page }, testInfo) => {
  const fileName = buildName(testInfo, 'flow-upload', '.txt');

  await loginAsAdmin(page);
  await uploadFileViaUi(page, {
    fileName,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });

  await expect(fileItem(page, `/${fileName}`)).toBeVisible();
});

test('E2E-EXP-006: Renames an item from platform-specific actions', async ({ page }, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const originalName = buildName(testInfo, 'flow-rename-source');
  const renamedName = buildName(testInfo, 'flow-renamed');
  const originalPath = `/${originalName}`;
  const renamedPath = `/${renamedName}`;

  await loginAsAdmin(page);

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

test('E2E-EXP-008: Opens a previewable file', async ({ page }, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const imageFileName = buildName(testInfo, 'preview-image', '.jpg');
  const imageFilePath = `/${imageFileName}`;

  await loginAsAdmin(page);
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

  const moveRes = await request.post('/api/files/move', {
    headers: { Authorization: `Bearer ${token}` },
    data: { nodeId: fileNodeId, destinationParentNodeId: folderBNodeId },
  });
  expect(moveRes.ok()).toBeTruthy();
  const moveBody = await moveRes.json();
  expect(moveBody.newParentId).toBe(folderBNodeId);

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

test('E2E-BULK-001: Enters selection mode and shows the bulk toolbar', async ({
  page,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const folderName = buildName(testInfo, 'bulk-select-folder');
  const folderPath = `/${folderName}`;

  await loginAsAdmin(page);
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
  const isMobile = isMobileProject(testInfo);
  const srcFile1Name = buildName(testInfo, 'bulk-move-src-1', '.txt');
  const srcFile2Name = buildName(testInfo, 'bulk-move-src-2', '.txt');
  const srcFile1Path = `/${srcFile1Name}`;
  const srcFile2Path = `/${srcFile2Name}`;

  const destFolderName = buildName(testInfo, 'bulk-move-dest-folder');
  const destFolderPath = `/${destFolderName}`;
  const destFile1Path = `${destFolderPath}/${srcFile1Name}`;
  const destFile2Path = `${destFolderPath}/${srcFile2Name}`;

  await loginAsAdmin(page);
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
  const isMobile = isMobileProject(testInfo);
  const srcFile1Name = buildName(testInfo, 'bulk-copy-src-1', '.txt');
  const srcFile2Name = buildName(testInfo, 'bulk-copy-src-2', '.txt');
  const srcFile1Path = `/${srcFile1Name}`;
  const srcFile2Path = `/${srcFile2Name}`;

  const destFolderName = buildName(testInfo, 'bulk-copy-dest-folder');
  const destFolderPath = `/${destFolderName}`;
  const destFile1Path = `${destFolderPath}/${srcFile1Name}`;
  const destFile2Path = `${destFolderPath}/${srcFile2Name}`;

  await loginAsAdmin(page);
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

test('E2E-BULK-004: Deletes selected items', async ({ page }, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const srcFile1Name = buildName(testInfo, 'bulk-delete-src-1', '.txt');
  const srcFile2Name = buildName(testInfo, 'bulk-delete-src-2', '.txt');
  const srcFile1Path = `/${srcFile1Name}`;
  const srcFile2Path = `/${srcFile2Name}`;

  await loginAsAdmin(page);
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

test('E2E-BULK-006: Mobile multi-download is disabled', async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo), 'E2E-BULK-006 is mobile-only');

  const srcFile1Name = buildName(testInfo, 'bulk-download-src-1', '.txt');
  const srcFile2Name = buildName(testInfo, 'bulk-download-src-2', '.txt');
  const srcFile1Path = `/${srcFile1Name}`;
  const srcFile2Path = `/${srcFile2Name}`;

  await loginAsAdmin(page);
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
  const isMobile = isMobileProject(testInfo);
  const folderA = buildName(testInfo, 'conflict-folder-a');
  const folderB = buildName(testInfo, 'conflict-folder-b');
  const conflictFileName = 'conflict_test.txt';

  await loginAsAdmin(page);
  await createFolderViaUi(page, folderA);
  await createFolderViaUi(page, folderB);

  await gotoFilesPath(page, request, `/${folderA}`);
  await uploadFileViaUi(page, {
    fileName: conflictFileName,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });

  await gotoFilesPath(page, request, `/${folderB}`);
  await uploadFileViaUi(page, {
    fileName: conflictFileName,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });

  await gotoFilesPath(page, request, `/${folderA}`);
  await selectSingleItemForBulk(page, isMobile, `/${folderA}/${conflictFileName}`);

  await page.getByTestId('bulk-action-move').click();

  const pickerDialog = page.getByRole('dialog');
  await expect(pickerDialog).toBeVisible();

  await pickerDialog.locator('.MuiBreadcrumbs-root button').first().click();
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
