import { expect, test } from '@playwright/test';

import { TEST_FILES, TEST_USERS } from './fixtures/test-data';
import { loginAsAdmin, loginAsUser } from './helpers/auth';
import { breadcrumbChip, openFabAction } from './helpers/explorer';
import {
  buildName,
  createFolderAt,
  downloadFile,
  fileItem,
  listNodeChildren,
  readTestFileFixture,
  uploadFileAt,
} from './helpers/files';
import {
  getSessionToken,
  gotoFilesPath,
  resolveNodeId,
  resolvePathOrNull,
} from './helpers/resolvePath';

const textFixtureBuffer = readTestFileFixture(TEST_FILES.smallText);

async function loginUserViaApi(request: Parameters<typeof createFolderAt>[0]): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { username: TEST_USERS.user1.username, password: TEST_USERS.user1.password },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.token as string;
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

test('[P0] E2E-EXP-012: Rename a file keeps its content byte-identical', async ({
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

  const token = await loginUserViaApi(request);
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

test('[P0] E2E-EXP-013: Move a file across folders keeps its content byte-identical', async ({
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

  const token = await loginUserViaApi(request);
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
