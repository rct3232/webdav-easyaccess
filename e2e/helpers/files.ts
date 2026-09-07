import fs from 'node:fs';
import path from 'node:path';

import { APIRequestContext, expect, Page, TestInfo } from '@playwright/test';

import { loginAsAdmin } from './auth';
import { openFabAction } from './explorer';
import { getSessionToken, gotoFilesPath, resolvePathOrNull } from './resolvePath';

export function buildName(testInfo: TestInfo, prefix: string, extension = '') {
  const projectSlug = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const titleSlug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return `${prefix}-${projectSlug}-${titleSlug}-${Date.now()}${extension}`;
}

/**
 * Assertion-context containment (see docs/TESTING_STRATEGY.md): logs in as admin
 * and opens a per-test-owned base folder at the filesystem root. Every item the
 * caller later creates/asserts must live under `/<base>/`, never at the root
 * listing. Logs in as admin itself (no prior login expected).
 */
export async function openPrivateWorkspace(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo
): Promise<string> {
  const base = buildName(testInfo, 'workspace');
  await loginAsAdmin(page);
  const token = await getSessionToken(page);
  const existing = await resolvePathOrNull(request, token, `/${base}`);
  if (existing === null) {
    await createFolderAt(request, token, null, base);
  }
  trackWorkspaceCleanup(token, `/${base}`);
  await gotoFilesPath(page, request, `/${base}`);
  return base;
}

const pendingWorkspaceCleanups: Array<{ token: string; basePath: string }> = [];

function trackWorkspaceCleanup(token: string, basePath: string) {
  pendingWorkspaceCleanups.push({ token, basePath });
}

/**
 * Delete a case-owned folder (and its subtree) via the API. Tolerant of the
 * folder having already been moved/renamed/deleted by the case itself.
 */
async function deleteFolderAt(
  request: APIRequestContext,
  token: string,
  folderPath: string
): Promise<void> {
  const nodeId = await resolvePathOrNull(request, token, folderPath);
  if (nodeId === null) return;
  const res = await request.delete('/api/files/delete', {
    headers: { Authorization: `Bearer ${token}` },
    data: { nodeId },
  });
  expect(res.ok()).toBeTruthy();
}

/**
 * Deletes every case-owned base folder registered for the current test. Call
 * from a per-file `test.afterEach` so per-case data never accumulates at the
 * filesystem root across a run (assertion-context containment cleanup).
 */
export async function flushPrivateWorkspaceCleanups(request: APIRequestContext): Promise<void> {
  const pending = pendingWorkspaceCleanups.splice(0, pendingWorkspaceCleanups.length);
  for (const cleanup of pending) {
    await deleteFolderAt(request, cleanup.token, cleanup.basePath);
  }
}

export function fileItem(page: Page, filePath: string) {
  return page.locator(`[data-file-path="${filePath}"]`);
}

export function readTestFileFixture(fileName: string) {
  return fs.readFileSync(path.join(process.cwd(), 'e2e', 'fixtures', 'test-files', fileName));
}

export async function createFolderViaUi(page: Page, folderName: string) {
  await openFabAction(page, 'Create folder');

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('create-folder-name-input')).toBeVisible();
  await dialog.getByTestId('create-folder-name-input').fill(folderName);
  await dialog.getByTestId('create-folder-submit').click();
}

export async function uploadFileViaUi(
  page: Page,
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

export async function openFolderPickerAndSelectDestination(
  page: Page,
  action: 'move' | 'copy',
  destinationFolderName: string
) {
  const testId = action === 'move' ? 'bulk-action-move' : 'bulk-action-copy';
  await page.getByTestId(testId).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: destinationFolderName, exact: true }).click();
  await dialog.getByRole('button', { name: 'Select', exact: true }).click();
}

export async function bulkDeleteSelected(page: Page) {
  await page.getByTestId('bulk-action-delete').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('confirm-dialog-confirm')).toBeVisible();
  await dialog.getByTestId('confirm-dialog-confirm').click();
}

export async function waitForBulkOperationToComplete(
  page: Page,
  expectedFinalLabel: RegExp = /Done|완료/
) {
  const progressSlot = page.locator('#file-progress-slot');

  await expect(progressSlot).toContainText(
    /Preparing|준비 중|Processing|처리 중|Copying|복사 중|Moving|이동 중|Done|완료/,
    {
      timeout: 10000,
    }
  );
  await expect(progressSlot).toContainText(expectedFinalLabel, { timeout: 15000 });
  await expect(progressSlot).toHaveText('', { timeout: 10000 });
}

export async function openFolderRouteAndWaitForItems(
  page: Page,
  request: APIRequestContext,
  folderPath: string,
  expectedItemPaths: string[]
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

export async function createFolderAt(
  request: APIRequestContext,
  token: string,
  parentNodeId: number | null,
  name: string
): Promise<number> {
  const res = await request.post('/api/folders/create', {
    headers: { Authorization: `Bearer ${token}` },
    data: { parentNodeId, name },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.nodeId as number;
}

export async function uploadFileAt(
  request: APIRequestContext,
  token: string,
  parentNodeId: number,
  fileName: string,
  mimeType: string,
  buffer: Buffer
): Promise<number> {
  const res = await request.post('/api/files/upload', {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: fileName, mimeType, buffer },
      parentNodeId: String(parentNodeId),
      onConflict: 'overwrite',
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.nodeId as number;
}

export async function downloadFile(
  request: APIRequestContext,
  token: string,
  nodeId: number
): Promise<Buffer> {
  const res = await request.get(`/api/files/download?nodeId=${nodeId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  return res.body();
}

export async function listNodeChildren(
  request: APIRequestContext,
  token: string,
  nodeId: number
): Promise<Array<{ nodeId: number; name: string; type: string }>> {
  const res = await request.get(`/api/files/list?nodeId=${nodeId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}
