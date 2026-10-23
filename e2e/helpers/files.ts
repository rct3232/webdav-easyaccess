import fs from 'node:fs';
import path from 'node:path';

import { APIRequestContext, expect, Page, TestInfo } from '@playwright/test';

import { openFabAction } from './explorer';
import { expectOk } from './http';
import { getSessionToken, gotoFilesPath, resolvePathOrNull } from './resolvePath';

export function buildName(testInfo: TestInfo, prefix: string, extension = '') {
  const projectSlug = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  // WebDAV-backed scratch suites nest these names 3-4 levels deep; the full
  // Playwright title makes each component ~180 chars and bytemark drops the
  // connection on duplicate MKCOL of such long paths. Keep a short, readable
  // title slug (the timestamp preserves uniqueness).
  const titleSlug = testInfo.title
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
    .slice(0, 48)
    .replace(/-+$/, '');
  return `${prefix}-${projectSlug}-${titleSlug}-${Date.now()}${extension}`;
}

/**
 * Assertion-context containment (see docs/TESTING_STRATEGY.md): opens a
 * per-test-owned base folder at the filesystem root for the seeded admin
 * session (see `e2e/fixtures/authenticated.ts`). Every item the caller later
 * creates/asserts must live under `/<base>/`, never at the root listing. The
 * caller's file-level `storageState` provides the admin session; the first
 * navigation below lets the init-script copy the seeded token into
 * sessionStorage before it is read.
 */
export async function openPrivateWorkspace(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo
): Promise<string> {
  const base = buildName(testInfo, 'workspace');
  await page.goto('/files');
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

/**
 * Register a case-owned workspace folder for the `afterEach` purge. Entries
 * carry the SESSION token that owned the folder; the purge itself is an
 * admin-only maintenance call, so regular-user sessions need the operator
 * fallback token on `flushPrivateWorkspaceCleanups` (admin-operator pivot —
 * see that function).
 */
export function trackWorkspaceCleanup(token: string, basePath: string) {
  pendingWorkspaceCleanups.push({ token, basePath });
}

/**
 * Delete a case-owned folder (and its subtree) via the API. Tolerant of the
 * folder having already been moved/renamed/deleted by the case itself.
 *
 * Uses the admin permanent-delete maintenance route, NOT the canonical
 * `POST /api/files/batch-delete`: since DEF-16 P2 the ordinary delete only
 * TRASHES the subtree, and cleanup must physically remove the case folder so
 * containment runs stay residue-free (see docs/TESTING_STRATEGY.md,
 * assertion-context containment).
 *
 * Dual-token cleanup (admin-operator pivot, PLAN §14): `perm-delete` is an
 * admin-only OPERATOR route — collections-era suites now track folders with a
 * regular-user session token, which 403s here. When the primary token fails
 * and the caller supplied a `fallbackToken` (the scratch operator token), the
 * purge retries as the operator. Without a fallback the primary-token result
 * keeps its original assertion (admin-session suites are unchanged).
 */
async function deleteFolderAt(
  request: APIRequestContext,
  token: string,
  folderPath: string,
  fallbackToken?: string
): Promise<void> {
  let nodeId = await resolvePathOrNull(request, token, folderPath);
  if (nodeId === null && fallbackToken) {
    nodeId = await resolvePathOrNull(request, fallbackToken, folderPath);
  }
  if (nodeId === null) return;
  const res = await request.delete('/api/admin/maintenance/perm-delete', {
    headers: { Authorization: `Bearer ${token}` },
    data: { nodeId },
  });
  if (res.ok()) return;
  if (!fallbackToken) {
    expect(res.ok()).toBeTruthy();
    return;
  }
  const fallbackNodeId = await resolvePathOrNull(request, fallbackToken, folderPath);
  if (fallbackNodeId === null) return; // the case already removed the subtree
  const retried = await request.delete('/api/admin/maintenance/perm-delete', {
    headers: { Authorization: `Bearer ${fallbackToken}` },
    data: { nodeId: fallbackNodeId },
  });
  expect(retried.ok()).toBeTruthy();
}

/**
 * Deletes every case-owned base folder registered for the current test. Call
 * from a per-file `test.afterEach` so per-case data never accumulates at the
 * filesystem root across a run (assertion-context containment cleanup).
 * `fallbackToken` (optional) is the admin OPERATOR token used when a tracked
 * entry's own session may not call the admin-only perm-delete route
 * (regular-user workspaces after the admin-operator pivot).
 */
export async function flushPrivateWorkspaceCleanups(
  request: APIRequestContext,
  fallbackToken?: string
): Promise<void> {
  const pending = pendingWorkspaceCleanups.splice(0, pendingWorkspaceCleanups.length);
  for (const cleanup of pending) {
    await deleteFolderAt(request, cleanup.token, cleanup.basePath, fallbackToken);
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
  await expectOk(res, 'folders/create');
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
  await expectOk(res, 'files/upload');
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

interface BulkJobSnapshot {
  status: string;
  progress: number;
  total: number;
  results: Array<{ status?: string; nodeId?: number }>;
  errorMessage: string | null;
}

/**
 * Poll GET /api/files/bulk-operation/:jobId until the job reaches a terminal
 * state and assert it completed with zero failed/skipped items. The batch
 * endpoints answer 202 + jobId, so every API-side mutation in these specs
 * goes through here (canonical mutation channel).
 */
export async function waitForBulkJobToComplete(
  request: APIRequestContext,
  token: string,
  jobId: string
): Promise<BulkJobSnapshot> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    let res;
    try {
      res = await request.get(`/api/files/bulk-operation/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (!/ECONNRESET|socket hang up|ECONNREFUSED|EPIPE/i.test(String(error?.message || ''))) {
        throw error;
      }
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    expect(res.ok()).toBeTruthy();
    const job = (await res.json()) as BulkJobSnapshot;
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      expect(job.errorMessage).toBeNull();
      expect(job.status).toBe('completed');
      expect((job.results ?? []).filter((r) => r.status !== 'succeeded')).toEqual([]);
      return job;
    }
    if (Date.now() > deadline) {
      throw new Error(`bulk job ${jobId} did not reach a terminal state: ${JSON.stringify(job)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Move nodes via the canonical batch channel: POST /api/files/batch-move
 * (202 + jobId) then poll the bulk job until it completes with zero failed
 * items.
 */
export async function apiMoveViaBatch(
  request: APIRequestContext,
  token: string,
  nodeIds: number[],
  destinationParentNodeId: number
): Promise<void> {
  const res = await request.post('/api/files/batch-move', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      moves: nodeIds.map((sourceNodeId) => ({ sourceNodeId, destinationParentNodeId })),
    },
  });
  expect(res.ok()).toBeTruthy();
  const { jobId } = await res.json();
  const job = await waitForBulkJobToComplete(request, token, String(jobId));
  expect(job.progress).toBe(nodeIds.length);
}
