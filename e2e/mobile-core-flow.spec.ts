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

async function mobileLongPressFile(
  page: Parameters<typeof openFabAction>[0],
  filePath: string,
) {
  // Mobile selection uses long-press touch handlers (~500ms) and does not rely on click.
  const selector = `[data-file-path="${filePath}"]`;
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`File element not found: ${sel}`);

    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const touch = {
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
      screenX: x,
      screenY: y,
    };

    const ev = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'touches', { value: [touch] });
    Object.defineProperty(ev, 'targetTouches', { value: [touch] });
    Object.defineProperty(ev, 'changedTouches', { value: [touch] });
    el.dispatchEvent(ev);
  }, selector);

  await page.waitForTimeout(550);

  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`File element not found: ${sel}`);
    const ev = new Event('touchend', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'touches', { value: [] });
    Object.defineProperty(ev, 'targetTouches', { value: [] });
    Object.defineProperty(ev, 'changedTouches', { value: [] });
    el.dispatchEvent(ev);
  }, selector);
}

async function selectTwoFilesMobile(
  page: Parameters<typeof openFabAction>[0],
  firstFilePath: string,
  secondFilePath: string,
) {
  await mobileLongPressFile(page, firstFilePath);
  await expect(page.getByTestId('bulk-action-move')).toBeVisible();

  // In selection mode, tapping another file toggles selection.
  await fileItem(page, secondFilePath).click();
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

async function bulkDeleteSelected(
  page: Parameters<typeof openFabAction>[0],
) {
  await page.getByTestId('bulk-action-delete').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('confirm-dialog-confirm')).toBeVisible();
  await dialog.getByTestId('confirm-dialog-confirm').click();
}

test('E2E-EXP-001: Explorer loads after login', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page).toHaveURL(/\/files(?:\/.*)?$/);
  await expect(page.getByTestId('file-actions-fab')).toBeVisible();
});

test('E2E-EXP-004: Create folder from FAB', async ({ page }, testInfo) => {
  const folderName = buildName(testInfo, 'flow-folder');

  await loginAsAdmin(page);
  await createFolder(page, folderName);

  await expect(fileItem(page, `/${folderName}`)).toBeVisible();
});

test('E2E-EXP-005: Upload file from dialog', async ({ page }, testInfo) => {
  const fileName = buildName(testInfo, 'flow-upload', '.txt');

  await loginAsAdmin(page);
  await uploadFile(page, {
    fileName,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });

  await expect(fileItem(page, `/${fileName}`)).toBeVisible();
});

test('E2E-EXP-006: Rename item from platform-specific actions', async ({ page }, testInfo) => {
  const originalName = buildName(testInfo, 'flow-rename-source');
  const renamedName = buildName(testInfo, 'flow-renamed');
  const originalPath = `/${originalName}`;
  const renamedPath = `/${renamedName}`;

  await loginAsAdmin(page);

  await createFolder(page, originalName);
  await expect(fileItem(page, originalPath)).toBeVisible();

  await openItemActions(page, originalPath);
  await expect(page.getByTestId('file-action-rename')).toBeVisible();
  await page.getByTestId('file-action-rename').click();

  let dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('rename-name-input')).toBeVisible();
  await dialog.getByTestId('rename-name-input').fill(renamedName);
  await dialog.getByTestId('rename-submit').click();

  await expect(fileItem(page, renamedPath)).toBeVisible();
  await expect(fileItem(page, originalPath)).toHaveCount(0);

  await openItemActions(page, renamedPath);
  await expect(page.getByTestId('file-action-delete')).toBeVisible();
  await page.getByTestId('file-action-delete').click();

  dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('confirm-dialog-confirm')).toBeVisible();
  await dialog.getByTestId('confirm-dialog-confirm').click();

  await expect(fileItem(page, renamedPath)).toHaveCount(0);
});

test('E2E-EXP-002: Direct route entry loads a nested folder path', async ({ page }, testInfo) => {
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

test('E2E-EXP-003: Breadcrumb navigation changes current folder', async ({ page }, testInfo) => {
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

test('E2E-EXP-008: Open previewable file', async ({ page }, testInfo) => {
  const imageFileName = buildName(testInfo, 'preview-image', '.jpg');
  const imageFilePath = `/${imageFileName}`;

  await loginAsAdmin(page);
  await uploadFile(page, {
    fileName: imageFileName,
    mimeType: 'image/jpeg',
    buffer: imageFixtureBuffer,
  });
  await expect(fileItem(page, imageFilePath)).toBeVisible();

  await fileItem(page, imageFilePath).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('img').first()).toBeVisible();
});

test('E2E-BULK-001: Enter selection mode and show bulk toolbar', async ({ page }, testInfo) => {
  const folderName = buildName(testInfo, 'bulk-select-folder');
  const folderPath = `/${folderName}`;

  await loginAsAdmin(page);
  await createFolder(page, folderName);
  await expect(fileItem(page, folderPath)).toBeVisible();

  await mobileLongPressFile(page, folderPath);

  await expect(page.getByTestId('bulk-action-move')).toBeVisible();
  await expect(page.getByTestId('bulk-action-copy')).toBeVisible();
  await expect(page.getByTestId('bulk-action-download')).toBeVisible();
  await expect(page.getByTestId('bulk-action-delete')).toBeVisible();
});

test('E2E-BULK-002: Move selected items to another folder', async ({ page }, testInfo) => {
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

  await selectTwoFilesMobile(page, srcFile1Path, srcFile2Path);

  await openFolderPickerAndSelectDestination(page, 'move', destFolderName);

  await expect(fileItem(page, srcFile1Path)).toHaveCount(0);
  await expect(fileItem(page, srcFile2Path)).toHaveCount(0);

  await page.goto(toFilesRoute(destFolderPath));
  await expect(fileItem(page, destFile1Path)).toBeVisible();
  await expect(fileItem(page, destFile2Path)).toBeVisible();
});

test('E2E-BULK-003: Copy selected items to another folder', async ({ page }, testInfo) => {
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

  await selectTwoFilesMobile(page, srcFile1Path, srcFile2Path);

  await openFolderPickerAndSelectDestination(page, 'copy', destFolderName);

  await expect(fileItem(page, srcFile1Path)).toBeVisible();
  await expect(fileItem(page, srcFile2Path)).toBeVisible();

  await page.goto(toFilesRoute(destFolderPath));
  await expect(fileItem(page, destFile1Path)).toBeVisible();
  await expect(fileItem(page, destFile2Path)).toBeVisible();
});

test('E2E-BULK-004: Delete selected items', async ({ page }, testInfo) => {
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

  await selectTwoFilesMobile(page, srcFile1Path, srcFile2Path);
  await bulkDeleteSelected(page);

  await expect(fileItem(page, srcFile1Path)).toHaveCount(0);
  await expect(fileItem(page, srcFile2Path)).toHaveCount(0);
});

test('E2E-BULK-006: Mobile multi-download is disabled', async ({ page }, testInfo) => {
  const srcFile1Name = buildName(testInfo, 'bulk-download-src-1', '.txt');
  const srcFile2Name = buildName(testInfo, 'bulk-download-src-2', '.txt');
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

  await selectTwoFilesMobile(page, srcFile1Path, srcFile2Path);

  const downloadButton = page.getByTestId('bulk-action-download');
  await expect(downloadButton).toBeVisible();
  await expect(downloadButton).toBeDisabled();
});
