import { expect, test } from '@playwright/test';

import { TEST_FILES } from './fixtures/test-data';
import { loginAsAdmin } from './helpers/auth';
import { openFabAction, openItemActions } from './helpers/explorer';
import { ADMIN_HOME_PATH, buildName, fileItem, readTestFileFixture } from './helpers/files';
import { gotoFilesPath } from './helpers/resolvePath';

const textFixtureBuffer = readTestFileFixture(TEST_FILES.smallText);
const imageFixtureBuffer = readTestFileFixture(TEST_FILES.smallImage);

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

async function createFolder(page: Parameters<typeof openFabAction>[0], folderName: string) {
  await openFabAction(page, 'Create folder');

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('create-folder-name-input')).toBeVisible();
  await dialog.getByTestId('create-folder-name-input').fill(folderName);
  await dialog.getByTestId('create-folder-submit').click();
}

async function selectTwoFilesDesktop(
  page: Parameters<typeof openFabAction>[0],
  firstFilePath: string,
  secondFilePath: string,
) {
  await fileItem(page, firstFilePath).click();
  await fileItem(page, secondFilePath).click({ modifiers: ['Meta'] });

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
  request: Parameters<typeof gotoFilesPath>[1],
  folderPath: string,
  expectedItemPaths: string[],
) {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await gotoFilesPath(page, request, folderPath);

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

test('E2E-EXP-006: Rename item from platform-specific actions', async ({ page }, testInfo) => {
  const originalName = buildName(testInfo, 'flow-rename-source');
  const renamedName = buildName(testInfo, 'flow-renamed');
  const originalPath = `${ADMIN_HOME_PATH}/${originalName}`;
  const renamedPath = `${ADMIN_HOME_PATH}/${renamedName}`;

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

test('E2E-EXP-008: Open previewable file', async ({ page }, testInfo) => {
  const imageFileName = buildName(testInfo, 'preview-image', '.jpg');
  const imageFilePath = `${ADMIN_HOME_PATH}/${imageFileName}`;

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

test('E2E-BULK-001: Enter selection mode and show bulk toolbar', async ({ page }, testInfo) => {
  const folderName = buildName(testInfo, 'bulk-select-folder');
  const folderPath = `${ADMIN_HOME_PATH}/${folderName}`;

  await loginAsAdmin(page);
  await createFolder(page, folderName);
  await expect(fileItem(page, folderPath)).toBeVisible();

  await fileItem(page, folderPath).click();

  await expect(page.getByTestId('bulk-action-move')).toBeVisible();
  await expect(page.getByTestId('bulk-action-copy')).toBeVisible();
  await expect(page.getByTestId('bulk-action-download')).toBeVisible();
  await expect(page.getByTestId('bulk-action-delete')).toBeVisible();
});

test('E2E-BULK-002: Move selected items to another folder', async ({ page, request }, testInfo) => {
  const srcFile1Name = buildName(testInfo, 'bulk-move-src-1', '.txt');
  const srcFile2Name = buildName(testInfo, 'bulk-move-src-2', '.txt');
  const srcFile1Path = `${ADMIN_HOME_PATH}/${srcFile1Name}`;
  const srcFile2Path = `${ADMIN_HOME_PATH}/${srcFile2Name}`;

  const destFolderName = buildName(testInfo, 'bulk-move-dest-folder');
  const destFolderPath = `${ADMIN_HOME_PATH}/${destFolderName}`;
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

  await expect(fileItem(page, srcFile1Path)).toHaveCount(0);
  await expect(fileItem(page, srcFile2Path)).toHaveCount(0);

  await gotoFilesPath(page, request, destFolderPath);
  await expect(fileItem(page, destFile1Path)).toBeVisible();
  await expect(fileItem(page, destFile2Path)).toBeVisible();
});

test('E2E-BULK-003: Copy selected items to another folder', async ({ page, request }, testInfo) => {
  const srcFile1Name = buildName(testInfo, 'bulk-copy-src-1', '.txt');
  const srcFile2Name = buildName(testInfo, 'bulk-copy-src-2', '.txt');
  const srcFile1Path = `${ADMIN_HOME_PATH}/${srcFile1Name}`;
  const srcFile2Path = `${ADMIN_HOME_PATH}/${srcFile2Name}`;

  const destFolderName = buildName(testInfo, 'bulk-copy-dest-folder');
  const destFolderPath = `${ADMIN_HOME_PATH}/${destFolderName}`;
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

  await expect(fileItem(page, srcFile1Path)).toBeVisible();
  await expect(fileItem(page, srcFile2Path)).toBeVisible();

  await openFolderRouteAndWaitForItems(page, request, destFolderPath, [
    destFile1Path,
    destFile2Path,
  ]);
});

test('E2E-BULK-004: Delete selected items', async ({ page }, testInfo) => {
  const srcFile1Name = buildName(testInfo, 'bulk-delete-src-1', '.txt');
  const srcFile2Name = buildName(testInfo, 'bulk-delete-src-2', '.txt');
  const srcFile1Path = `${ADMIN_HOME_PATH}/${srcFile1Name}`;
  const srcFile2Path = `${ADMIN_HOME_PATH}/${srcFile2Name}`;

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
