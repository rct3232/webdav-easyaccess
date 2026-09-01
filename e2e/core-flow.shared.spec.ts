import { expect, test } from '@playwright/test';

import { TEST_FILES } from './fixtures/test-data';
import { loginAsAdmin } from './helpers/auth';
import { breadcrumbChip, openFabAction } from './helpers/explorer';
import { buildName, fileItem, readTestFileFixture } from './helpers/files';
import { getSessionToken, gotoFilesPath, resolveNodeId } from './helpers/resolvePath';

const textFixtureBuffer = readTestFileFixture(TEST_FILES.smallText);

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

test('E2E-EXP-001: Explorer loads after login', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page).toHaveURL(/\/files(?:\/.*)?$/);
  await expect(page.getByTestId('file-actions-fab')).toBeVisible();
});

test('E2E-EXP-004: Create folder from FAB', async ({ page, request }, testInfo) => {
  const folderName = buildName(testInfo, 'flow-folder');

  await loginAsAdmin(page);
  await createFolder(page, folderName);

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
  if (testInfo.project.name.endsWith('-mobile')) {
    await page.locator('button[title="Open folder tree"]').click();
  }
  await expect(folderTree).toBeVisible({ timeout: 20_000 });
  await expect(folderTree.getByRole('button', { name: /Shared/i })).toHaveCount(0);
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
  await createFolder(page, parentFolderName);
  await expect(fileItem(page, parentFolderPath)).toBeVisible();

  await gotoFilesPath(page, request, parentFolderPath);
  await createFolder(page, childFolderName);
  await expect(fileItem(page, childFolderPath)).toBeVisible();

  await gotoFilesPath(page, request, childFolderPath);
  await uploadFile(page, {
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
  await createFolder(page, parentFolderName);

  await gotoFilesPath(page, request, parentFolderPath);
  await createFolder(page, childFolderName);

  await gotoFilesPath(page, request, childFolderPath);
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
