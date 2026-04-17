import { expect, test } from '@playwright/test';

import { TEST_FILES } from './fixtures/test-data';
import { loginAsAdmin } from './helpers/auth';
import { breadcrumbChip, openFabAction, openItemActions } from './helpers/explorer';
import { buildName, fileItem, readTestFileFixture } from './helpers/files';

const textFixtureBuffer = readTestFileFixture(TEST_FILES.smallText);
const imageFixtureBuffer = readTestFileFixture(TEST_FILES.smallImage);

function toFilesRoute(filePath: string) {
  return filePath === '/' ? '/files' : `/files${filePath}`;
}

async function createFolder(page: Parameters<typeof openFabAction>[0], folderName: string) {
  await openFabAction(page, 'Create folder');

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('create-folder-name-input')).toBeVisible();
  await dialog.getByTestId('create-folder-name-input').fill(folderName);
  await dialog.getByTestId('create-folder-submit').click();
}

async function uploadFile(
  page: Parameters<typeof openFabAction>[0],
  options: { fileName: string; mimeType: string; buffer: Buffer }
) {
  await openFabAction(page, 'Upload file');

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('upload-dialog-file-input')).toBeAttached();
  await dialog.getByTestId('upload-dialog-file-input').setInputFiles({
    name: options.fileName,
    mimeType: options.mimeType,
    buffer: options.buffer,
  });
  await dialog.getByTestId('upload-dialog-submit').click();
}

async function selectTwoFilesDesktop(
  page: Parameters<typeof openFabAction>[0],
  firstFilePath: string,
  secondFilePath: string,
) {
  // Desktop selection: single click enters selection mode; Ctrl-click adds/removes.
  await fileItem(page, firstFilePath).click();
  // On macOS, `Control+click` triggers a browser right-click context menu.
  // Use Command/meta to set event.metaKey without opening context menus.
  await fileItem(page, secondFilePath).click({ modifiers: ['Meta'] });

  // Wait for bulk toolbar to be present.
  await expect(page.getByTestId('bulk-action-move')).toBeVisible();
}

async function openFolderPickerAndSelectDestination(
  page: Parameters<typeof openFabAction>[0],
  action: 'move' | 'copy',
  destinationFolderName: string,
) {
  const testId = action === 'move' ? 'bulk-action-move' : 'bulk-action-copy';
  await page.getByTestId(testId).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: destinationFolderName, exact: true }).click();
  await dialog.getByRole('button', { name: 'Select', exact: true }).click();
}

async function waitForBulkOperationToComplete(
  page: Parameters<typeof openFabAction>[0],
  expectedFinalLabel: RegExp = /Done|완료/
) {
  const progressSlot = page.locator('#file-progress-slot');

  await expect(progressSlot).toContainText(/Preparing|준비 중|Processing|처리 중|Copying|복사 중|Moving|이동 중|Done|완료/, {
    timeout: 10000,
  });
  await expect(progressSlot).toContainText(expectedFinalLabel, { timeout: 15000 });
  await expect(progressSlot).toHaveText('', { timeout: 10000 });
}

async function openFolderRouteAndWaitForItems(
  page: Parameters<typeof openFabAction>[0],
  folderPath: string,
  expectedItemPaths: string[],
) {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await page.goto(toFilesRoute(folderPath));

    try {
      for (const itemPath of expectedItemPaths) {
        await expect(fileItem(page, itemPath)).toBeVisible({ timeout: 3000 });
      }
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await page.waitForTimeout(500 * attempt);
    }
  }

  throw lastError ?? new Error(`Expected copied items in ${folderPath}`);
}

async function bulkDeleteSelected(
  page: Parameters<typeof openFabAction>[0],
) {
  await page.getByTestId('bulk-action-delete').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('confirm-dialog-confirm')).toBeVisible();
  await dialog.getByTestId('confirm-dialog-confirm').click();
}

test('logs in and lands in the explorer', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page).toHaveURL(/\/files(?:\/.*)?$/);
  await expect(page.getByTestId('file-actions-fab')).toBeVisible();
});

test('creates a folder from the file actions fab', async ({ page }, testInfo) => {
  const folderName = buildName(testInfo, 'flow-folder');

  await loginAsAdmin(page);
  await createFolder(page, folderName);

  await expect(fileItem(page, `/${folderName}`)).toBeVisible();
});

test('uploads a file from the upload dialog', async ({ page }, testInfo) => {
  const fileName = buildName(testInfo, 'flow-upload', '.txt');

  await loginAsAdmin(page);
  await uploadFile(page, {
    fileName,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });

  await expect(fileItem(page, `/${fileName}`)).toBeVisible();
});

test('renames and deletes a folder through file actions', async ({ page }, testInfo) => {
  const originalName = buildName(testInfo, 'flow-rename-source');
  const renamedName = buildName(testInfo, 'flow-renamed');
  const originalPath = `/${originalName}`;
  const renamedPath = `/${renamedName}`;

  await loginAsAdmin(page);

  await createFolder(page, originalName);
  await expect(fileItem(page, originalPath)).toBeVisible();

  await openItemActions(page, originalPath);
  await page.getByTestId('file-action-rename').click();

  let dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('rename-name-input')).toBeVisible();
  await dialog.getByTestId('rename-name-input').fill(renamedName);
  await dialog.getByTestId('rename-submit').click();

  await expect(fileItem(page, renamedPath)).toBeVisible();
  await expect(fileItem(page, originalPath)).toHaveCount(0);

  await openItemActions(page, renamedPath);
  await page.getByTestId('file-action-delete').click();

  dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('confirm-dialog-confirm')).toBeVisible();
  await dialog.getByTestId('confirm-dialog-confirm').click();

  await expect(fileItem(page, renamedPath)).toHaveCount(0);
});

test('loads nested folder contents when entering a direct route', async ({ page }, testInfo) => {
  const parentFolderName = buildName(testInfo, 'direct-route-parent');
  const childFolderName = buildName(testInfo, 'direct-route-child');
  const markerFileName = buildName(testInfo, 'direct-route-marker', '.txt');
  const parentFolderPath = `/${parentFolderName}`;
  const childFolderPath = `${parentFolderPath}/${childFolderName}`;
  const markerFilePath = `${childFolderPath}/${markerFileName}`;

  await loginAsAdmin(page);
  await createFolder(page, parentFolderName);
  await expect(fileItem(page, parentFolderPath)).toBeVisible();

  await page.goto(toFilesRoute(parentFolderPath));
  await createFolder(page, childFolderName);
  await expect(fileItem(page, childFolderPath)).toBeVisible();

  await page.goto(toFilesRoute(childFolderPath));
  await uploadFile(page, {
    fileName: markerFileName,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await expect(fileItem(page, markerFilePath)).toBeVisible();

  await page.goto('/files');
  await page.goto(toFilesRoute(childFolderPath));

  await expect(fileItem(page, markerFilePath)).toBeVisible();
  await expect(breadcrumbChip(page, parentFolderName)).toBeVisible();
  await expect(breadcrumbChip(page, childFolderName)).toBeVisible();
});

test('changes the current folder when a breadcrumb is clicked', async ({ page }, testInfo) => {
  const parentFolderName = buildName(testInfo, 'breadcrumb-parent');
  const childFolderName = buildName(testInfo, 'breadcrumb-child');
  const nestedFileName = buildName(testInfo, 'breadcrumb-marker', '.txt');
  const parentFolderPath = `/${parentFolderName}`;
  const childFolderPath = `${parentFolderPath}/${childFolderName}`;
  const nestedFilePath = `${childFolderPath}/${nestedFileName}`;

  await loginAsAdmin(page);
  await createFolder(page, parentFolderName);

  await page.goto(toFilesRoute(parentFolderPath));
  await createFolder(page, childFolderName);

  await page.goto(toFilesRoute(childFolderPath));
  await uploadFile(page, {
    fileName: nestedFileName,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await expect(fileItem(page, nestedFilePath)).toBeVisible();

  await breadcrumbChip(page, parentFolderName).click();

  await expect(fileItem(page, childFolderPath)).toBeVisible();
  await expect(fileItem(page, nestedFilePath)).toHaveCount(0);
});

test('opens a previewable file from the explorer', async ({ page }, testInfo) => {
  const imageFileName = buildName(testInfo, 'preview-image', '.jpg');
  const imageFilePath = `/${imageFileName}`;

  await loginAsAdmin(page);
  await uploadFile(page, {
    fileName: imageFileName,
    mimeType: 'image/jpeg',
    buffer: imageFixtureBuffer,
  });
  await expect(fileItem(page, imageFilePath)).toBeVisible();

  await fileItem(page, imageFilePath).dblclick();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('img').first()).toBeVisible();
});

test('bulk: enter selection mode and shows bulk toolbar', async ({ page }, testInfo) => {
  const folderName = buildName(testInfo, 'bulk-select-folder');
  const folderPath = `/${folderName}`;

  await loginAsAdmin(page);
  await createFolder(page, folderName);
  await expect(fileItem(page, folderPath)).toBeVisible();

  await fileItem(page, folderPath).click();

  await expect(page.getByTestId('bulk-action-move')).toBeVisible();
  await expect(page.getByTestId('bulk-action-copy')).toBeVisible();
  await expect(page.getByTestId('bulk-action-download')).toBeVisible();
  await expect(page.getByTestId('bulk-action-delete')).toBeVisible();
});

test('bulk: move selected items to another folder', async ({ page }, testInfo) => {
  const srcFile1Name = buildName(testInfo, 'bulk-move-src-1', '.txt');
  const srcFile2Name = buildName(testInfo, 'bulk-move-src-2', '.txt');
  const srcFile1Path = `/${srcFile1Name}`;
  const srcFile2Path = `/${srcFile2Name}`;

  const destFolderName = buildName(testInfo, 'bulk-move-dest-folder');
  const destFolderPath = `/${destFolderName}`;
  const destFile1Path = `${destFolderPath}/${srcFile1Name}`;
  const destFile2Path = `${destFolderPath}/${srcFile2Name}`;

  await loginAsAdmin(page);
  await uploadFile(page, {
    fileName: srcFile1Name,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await uploadFile(page, {
    fileName: srcFile2Name,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await createFolder(page, destFolderName);

  await selectTwoFilesDesktop(page, srcFile1Path, srcFile2Path);

  await openFolderPickerAndSelectDestination(page, 'move', destFolderName);

  // Source should no longer contain the moved items.
  await expect(fileItem(page, srcFile1Path)).toHaveCount(0);
  await expect(fileItem(page, srcFile2Path)).toHaveCount(0);

  // Destination should contain moved copies.
  await page.goto(toFilesRoute(destFolderPath));
  await expect(fileItem(page, destFile1Path)).toBeVisible();
  await expect(fileItem(page, destFile2Path)).toBeVisible();
});

test('bulk: copy selected items to another folder', async ({ page }, testInfo) => {
  const srcFile1Name = buildName(testInfo, 'bulk-copy-src-1', '.txt');
  const srcFile2Name = buildName(testInfo, 'bulk-copy-src-2', '.txt');
  const srcFile1Path = `/${srcFile1Name}`;
  const srcFile2Path = `/${srcFile2Name}`;

  const destFolderName = buildName(testInfo, 'bulk-copy-dest-folder');
  const destFolderPath = `/${destFolderName}`;
  const destFile1Path = `${destFolderPath}/${srcFile1Name}`;
  const destFile2Path = `${destFolderPath}/${srcFile2Name}`;

  await loginAsAdmin(page);
  await uploadFile(page, {
    fileName: srcFile1Name,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await uploadFile(page, {
    fileName: srcFile2Name,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await createFolder(page, destFolderName);

  await selectTwoFilesDesktop(page, srcFile1Path, srcFile2Path);

  await openFolderPickerAndSelectDestination(page, 'copy', destFolderName);
  await waitForBulkOperationToComplete(page);

  // Source should still contain the original items after copy.
  await expect(fileItem(page, srcFile1Path)).toBeVisible();
  await expect(fileItem(page, srcFile2Path)).toBeVisible();

  // Destination should contain copied items.
  await openFolderRouteAndWaitForItems(page, destFolderPath, [
    destFile1Path,
    destFile2Path,
  ]);
});

test('bulk: delete selected items', async ({ page }, testInfo) => {
  const srcFile1Name = buildName(testInfo, 'bulk-delete-src-1', '.txt');
  const srcFile2Name = buildName(testInfo, 'bulk-delete-src-2', '.txt');
  const srcFile1Path = `/${srcFile1Name}`;
  const srcFile2Path = `/${srcFile2Name}`;

  await loginAsAdmin(page);
  await uploadFile(page, {
    fileName: srcFile1Name,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await uploadFile(page, {
    fileName: srcFile2Name,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });

  await expect(fileItem(page, srcFile1Path)).toBeVisible();
  await expect(fileItem(page, srcFile2Path)).toBeVisible();

  await selectTwoFilesDesktop(page, srcFile1Path, srcFile2Path);
  await bulkDeleteSelected(page);

  await expect(fileItem(page, srcFile1Path)).toHaveCount(0);
  await expect(fileItem(page, srcFile2Path)).toHaveCount(0);
});
