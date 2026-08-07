import crypto from 'node:crypto';

import { expect, test, type APIRequestContext } from '@playwright/test';

import { TEST_FILES, TEST_USERS } from './fixtures/test-data';
import { ensureApprovedUser, loginAsUser } from './helpers/auth';
import { buildName, fileItem, readTestFileFixture } from './helpers/files';
import { blobExists, listS3Keys, putBlob } from './helpers/minio';
import { closePgPool, queryPg } from './helpers/pg';
import { gotoFilesPath, resolveNodeId } from './helpers/resolvePath';

/**
 * S3 + PostgreSQL new-architecture integration (E2E-S3PG-001..008).
 *
 * S3-mode only: the scenarios assert blob-level / GC behavior that does not
 * exist in WebDAV mode. The suite self-guards via `E2E_BACKEND_MODE` so the
 * file still parses (and its tests remain listed) in webdav mode but skips.
 *
 * GC timing (E2E-S3PG-005/008): `.env.e2e` sets `GC_ORPHAN_TTL_DAYS=0.00002`
 * (~1.7 s) so a freshly orphaned/untracked blob is collectable in a test run.
 * The GC tests therefore wait past that cutoff before invoking
 * `POST /api/admin/maintenance/gc`.
 */

const backendMode = process.env.E2E_BACKEND_MODE || 's3';

const textFixtureBuffer = readTestFileFixture(TEST_FILES.smallText);
const imageFixtureBuffer = readTestFileFixture(TEST_FILES.smallImage);

const GC_ORPHAN_AGE_MS = 4500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loginAndGetToken(
  request: APIRequestContext,
  username: string,
  password: string
): Promise<string> {
  const res = await request.post('/api/auth/login', { data: { username, password } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.token as string;
}

async function user1Token(request: APIRequestContext): Promise<string> {
  return loginAndGetToken(request, TEST_USERS.user1.username, TEST_USERS.user1.password);
}

async function adminToken(request: APIRequestContext): Promise<string> {
  return loginAndGetToken(request, TEST_USERS.admin.username, TEST_USERS.admin.password);
}

async function createFolderAt(
  request: APIRequestContext,
  token: string,
  parentNodeId: number,
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

async function uploadFileAt(
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

async function downloadFile(
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

async function listNodeChildren(
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

async function resolvePathOrNull(
  request: APIRequestContext,
  token: string,
  path: string
): Promise<number | null> {
  const res = await request.post('/api/files/resolve-path', {
    headers: { Authorization: `Bearer ${token}` },
    data: { path },
  });
  if (!res.ok()) return null;
  const body = await res.json();
  return body.nodeId as number;
}

test.describe('S3 + PostgreSQL integration scenarios', () => {
  test.beforeEach(() => {
    test.skip(backendMode !== 's3', 'E2E-S3PG-* scenarios run only in s3 backend mode');
  });

  test.afterAll(async () => {
    await closePgPool();
  });

  test('[P0] E2E-S3PG-001: upload -> list -> download -> content matches original', async ({
    page,
    request,
  }, testInfo) => {
    const dirName = buildName(testInfo, 's3pg-001-dir');
    const fileName = buildName(testInfo, 's3pg-001-file', '.txt');
    const dirPath = `/user1/${dirName}`;
    const filePath = `${dirPath}/${fileName}`;

    const token = await user1Token(request);
    const homeNodeId = await resolveNodeId(request, token, '/user1');
    const dirNodeId = await createFolderAt(request, token, homeNodeId, dirName);
    const fileNodeId = await uploadFileAt(
      request,
      token,
      dirNodeId,
      fileName,
      'text/plain',
      textFixtureBuffer
    );

    const listing = await listNodeChildren(request, token, dirNodeId);
    const listed = listing.find((item) => item.nodeId === fileNodeId);
    expect(listed).toBeTruthy();
    expect(listed?.name).toBe(fileName);
    expect(listed?.type).toBe('file');

    const downloaded = await downloadFile(request, token, fileNodeId);
    expect(downloaded.equals(textFixtureBuffer)).toBeTruthy();

    await loginAsUser(page, 'user1');
    await gotoFilesPath(page, request, dirPath);
    await expect(fileItem(page, filePath)).toBeVisible();
  });

  test('[P0] E2E-S3PG-002: rename is instant (DB-only, no blob copy) and file stays accessible', async ({
    page,
    request,
  }, testInfo) => {
    const dirName = buildName(testInfo, 's3pg-002-dir');
    const oldName = buildName(testInfo, 's3pg-002-old', '.txt');
    const newName = buildName(testInfo, 's3pg-002-new', '.txt');
    const dirPath = `/user1/${dirName}`;
    const oldPath = `${dirPath}/${oldName}`;
    const newPath = `${dirPath}/${newName}`;

    const token = await user1Token(request);
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

    // Time the rename round-trip for observability only. In S3 mode rename is
    // a DB-only operation (no blob move/copy), so it should be sub-second —
    // but we deliberately do NOT assert that bound here (a sub-second timing
    // assertion is flaky). Correctness is asserted instead.
    const startedAt = Date.now();
    const renameRes = await request.put('/api/files/rename', {
      headers: { Authorization: `Bearer ${token}` },
      data: { nodeId: fileNodeId, newName },
    });
    const elapsedMs = Date.now() - startedAt;
    expect(renameRes.ok()).toBeTruthy();
    test.info().annotations.push({ type: 's3pg-002-rename-ms', description: `${elapsedMs}` });

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

  test('[P1] E2E-S3PG-003: move file across folders -> accessible at new location', async ({
    page,
    request,
  }, testInfo) => {
    const folderAName = buildName(testInfo, 's3pg-003-a');
    const folderBName = buildName(testInfo, 's3pg-003-b');
    const fileName = buildName(testInfo, 's3pg-003-file', '.txt');
    const folderAPath = `/user1/${folderAName}`;
    const folderBPath = `/user1/${folderBName}`;
    const oldFilePath = `${folderAPath}/${fileName}`;
    const newFilePath = `${folderBPath}/${fileName}`;

    const token = await user1Token(request);
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

  test('[P1] E2E-S3PG-004: copy-on-write -> copy shares blob; overwrite copy leaves original unchanged', async ({
    request,
  }, testInfo) => {
    const dirName = buildName(testInfo, 's3pg-004-dir');
    const originalName = buildName(testInfo, 's3pg-004-original', '.txt');
    const copyName = buildName(testInfo, 's3pg-004-copy', '.txt');
    const dirPath = `/user1/${dirName}`;
    const originalContent = Buffer.from(`original-content-${testInfo.title}`);
    const overwrittenContent = Buffer.from(`overwritten-content-${testInfo.title}`);

    const token = await user1Token(request);
    const homeNodeId = await resolveNodeId(request, token, '/user1');
    const dirNodeId = await createFolderAt(request, token, homeNodeId, dirName);
    const originalNodeId = await uploadFileAt(
      request,
      token,
      dirNodeId,
      originalName,
      'text/plain',
      originalContent
    );

    const copyRes = await request.post('/api/files/copy', {
      headers: { Authorization: `Bearer ${token}` },
      data: { nodeId: originalNodeId, destinationParentNodeId: dirNodeId, newName: copyName },
    });
    expect(copyRes.ok()).toBeTruthy();
    const copyBody = await copyRes.json();
    const copiedNodeId = copyBody.copiedNodeId as number;
    expect(copiedNodeId).not.toBe(originalNodeId);

    // CoW: both nodes must reference the same active S3 blob. No API exposes
    // object_map.s3_key, so a targeted DB read is the only reliable assertion.
    const rows = await queryPg<{ s3_key: string }>(
      `SELECT s3_key FROM object_map
       WHERE file_node_id IN ($1, $2) AND status = 'active'`,
      [originalNodeId, copiedNodeId]
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].s3_key).toBe(rows[1].s3_key);

    expect(
      (await downloadFile(request, token, originalNodeId)).equals(originalContent)
    ).toBeTruthy();
    expect((await downloadFile(request, token, copiedNodeId)).equals(originalContent)).toBeTruthy();

    // Observable COW: overwriting the copy must not touch the original's content.
    const overwrittenNodeId = await uploadFileAt(
      request,
      token,
      dirNodeId,
      copyName,
      'text/plain',
      overwrittenContent
    );
    expect(overwrittenNodeId).toBe(copiedNodeId);
    expect(
      (await downloadFile(request, token, originalNodeId)).equals(originalContent)
    ).toBeTruthy();
    expect(
      (await downloadFile(request, token, copiedNodeId)).equals(overwrittenContent)
    ).toBeTruthy();
  });

  test('[P1] E2E-S3PG-005: delete -> orphaned blob -> GC admin endpoint cleans it up', async ({
    request,
  }, testInfo) => {
    const dirName = buildName(testInfo, 's3pg-005-dir');
    const fileName = buildName(testInfo, 's3pg-005-file', '.txt');
    const dirPath = `/user1/${dirName}`;

    const token = await user1Token(request);
    const gcAdmin = await adminToken(request);
    const homeNodeId = await resolveNodeId(request, token, '/user1');
    const dirNodeId = await createFolderAt(request, token, homeNodeId, dirName);
    const fileNodeId = await uploadFileAt(
      request,
      token,
      dirNodeId,
      fileName,
      'text/plain',
      textFixtureBuffer
    );

    // Capture the blob key before delete: deleting the node cascades the
    // object_map row away, so this is the only way to address the blob later.
    const activeRows = await queryPg<{ s3_key: string }>(
      `SELECT s3_key FROM object_map WHERE file_node_id = $1 AND status = 'active'`,
      [fileNodeId]
    );
    expect(activeRows).toHaveLength(1);
    const s3Key = activeRows[0].s3_key;
    expect(s3Key.length).toBeGreaterThan(0);
    expect(await blobExists(s3Key)).toBeTruthy();

    const delRes = await request.delete('/api/files/delete', {
      headers: { Authorization: `Bearer ${token}` },
      data: { nodeId: fileNodeId },
    });
    expect(delRes.ok()).toBeTruthy();

    // Delete is lazy in S3 mode: the blob remains until GC reclaims it.
    expect(await blobExists(s3Key)).toBeTruthy();

    // Wait past the small GC orphan TTL (see GC_ORPHAN_TTL_DAYS in .env.e2e).
    await sleep(GC_ORPHAN_AGE_MS);

    const gcRes = await request.post('/api/admin/maintenance/gc', {
      headers: { Authorization: `Bearer ${gcAdmin}` },
    });
    expect(gcRes.ok()).toBeTruthy();
    const gcBody = await gcRes.json();

    // Tier 2 (S3 reconciliation) must detect and delete the untracked blob.
    expect(gcBody.results.tier2.untrackedKeys).toBeGreaterThanOrEqual(1);
    expect(gcBody.results.tier2.deletedKeys).toBeGreaterThanOrEqual(1);
    expect(await blobExists(s3Key)).toBeFalsy();
  });

  test('[P0] E2E-S3PG-006: grant folder read -> child/grandchild accessible via __shared__', async ({
    page,
    request,
  }, testInfo) => {
    // Safe deterministic suffix: the raw test title contains punctuation (->, /)
    // that would corrupt the username/path, so slugify both project and title.
    const baseSuffix = `${testInfo.project.name.replace(/[^a-z0-9]+/gi, '-')}-${testInfo.title.replace(
      /[^a-z0-9]+/gi,
      '-'
    )}`;
    const suffix1 = `${baseSuffix}_1`;
    const suffix2 = `${baseSuffix}_2`;
    await ensureApprovedUser(request, 'user1', suffix1);
    await ensureApprovedUser(request, 'user2', suffix2);

    const requesterUsername = `${TEST_USERS.user1.username}_${suffix1}`;
    const requesterPassword = TEST_USERS.user1.password;
    const ownerUsername = `${TEST_USERS.user2.username}_${suffix2}`;
    const ownerPassword = TEST_USERS.user2.password;
    const ownerHomePath = `/${ownerUsername}`;

    const admin = await adminToken(request);
    const ownerToken = await loginAndGetToken(request, ownerUsername, ownerPassword);
    const ownerHomeNodeId = await resolveNodeId(request, admin, ownerHomePath);

    const parentName = buildName(testInfo, 's3pg-006-parent');
    const childName = buildName(testInfo, 's3pg-006-child');
    const fileName = buildName(testInfo, 's3pg-006-file', '.txt');
    const parentPath = `${ownerHomePath}/${parentName}`;
    const childPath = `${parentPath}/${childName}`;
    const filePath = `${childPath}/${fileName}`;

    const parentNodeId = await createFolderAt(request, ownerToken, ownerHomeNodeId, parentName);
    const childNodeId = await createFolderAt(request, ownerToken, parentNodeId, childName);
    const fileNodeId = await uploadFileAt(
      request,
      ownerToken,
      childNodeId,
      fileName,
      'text/plain',
      textFixtureBuffer
    );

    const requesterLogin = await request.post('/api/auth/login', {
      data: { username: requesterUsername, password: requesterPassword },
    });
    expect(requesterLogin.ok()).toBeTruthy();
    const requesterUserId = (await requesterLogin.json()).user.id as number;

    // Grant READ on the parent folder; descendants must inherit via closure table.
    const grantRes = await request.post('/api/permissions/grant', {
      headers: { Authorization: `Bearer ${admin}` },
      data: { userId: requesterUserId, nodeId: parentNodeId, permission: 'read' },
    });
    expect(grantRes.ok()).toBeTruthy();

    // Decisive observable: the requester can download the grandchild file.
    const requesterToken = await loginAndGetToken(request, requesterUsername, requesterPassword);
    const downloaded = await downloadFile(request, requesterToken, fileNodeId);
    expect(downloaded.equals(textFixtureBuffer)).toBeTruthy();

    // UI: the granted folder is exposed in the __shared__ view and descendants
    // are browsable through it.
    await loginAsUser(page, 'user1', suffix1);
    await page.goto('/files/__shared__');
    await expect(page).toHaveURL(/\/files\/__shared__/);

    const sharedEntry = page.locator(`[data-file-node-id="${parentNodeId}"]`);
    await expect(sharedEntry).toBeVisible({ timeout: 20_000 });

    const openEntry = async () => {
      if (testInfo.project.name.endsWith('-mobile')) {
        await sharedEntry.click();
      } else {
        await sharedEntry.dblclick();
      }
    };

    await openEntry();
    await expect(page).toHaveURL(new RegExp(`/files/node/${parentNodeId}$`));

    const childItem = fileItem(page, childPath);
    await expect(childItem).toBeVisible({ timeout: 20_000 });
    if (testInfo.project.name.endsWith('-mobile')) {
      await childItem.click();
    } else {
      await childItem.dblclick();
    }
    await expect(page).toHaveURL(new RegExp(`/files/node/${childNodeId}$`));
    await expect(fileItem(page, filePath)).toBeVisible({ timeout: 20_000 });
  });

  test('[P1] E2E-S3PG-007: share link survives file rename (nodeId reference, not path)', async ({
    page,
    request,
  }, testInfo) => {
    const dirName = buildName(testInfo, 's3pg-007-dir');
    const oldName = buildName(testInfo, 's3pg-007-old', '.jpg');
    const newName = buildName(testInfo, 's3pg-007-new', '.jpg');
    const dirPath = `/user1/${dirName}`;

    const token = await user1Token(request);
    const homeNodeId = await resolveNodeId(request, token, '/user1');
    const dirNodeId = await createFolderAt(request, token, homeNodeId, dirName);
    const fileNodeId = await uploadFileAt(
      request,
      token,
      dirNodeId,
      oldName,
      'image/jpeg',
      imageFixtureBuffer
    );

    const linkRes = await request.post('/api/share-links', {
      headers: { Authorization: `Bearer ${token}` },
      data: { fileNodeId, expiresInDays: 30 },
    });
    expect(linkRes.ok()).toBeTruthy();
    const linkBody = await linkRes.json();
    const shareToken = linkBody.token as string;

    const renameRes = await request.put('/api/files/rename', {
      headers: { Authorization: `Bearer ${token}` },
      data: { nodeId: fileNodeId, newName },
    });
    expect(renameRes.ok()).toBeTruthy();

    // The share link points at the nodeId, so renaming the file must not break
    // it: the share page still resolves the node and renders the preview dialog
    // (an expired/not-found link would render the error text instead).
    await page.goto(`/share/${shareToken}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText(/expired|could not be found/i);

    // And the content is still served through the share token (nodeId reference).
    const anonRes = await request.get(`/api/files/download?nodeId=${fileNodeId}&inline=true`, {
      headers: { 'X-Share-Token': shareToken },
    });
    expect(anonRes.ok()).toBeTruthy();
    expect((await anonRes.body()).equals(imageFixtureBuffer)).toBeTruthy();
  });

  test('[P1] E2E-S3PG-008: S3 reconciliation -> untracked blob is deleted by GC admin endpoint', async ({
    request,
  }, testInfo) => {
    const gcAdmin = await adminToken(request);
    const untrackedKey = `e2e-untracked-${crypto.randomUUID()}.txt`;
    await putBlob(untrackedKey, textFixtureBuffer);
    expect(await blobExists(untrackedKey)).toBeTruthy();

    // The blob has no object_map row; it must be old enough for the GC TTL.
    await sleep(GC_ORPHAN_AGE_MS);

    const gcRes = await request.post('/api/admin/maintenance/gc', {
      headers: { Authorization: `Bearer ${gcAdmin}` },
    });
    expect(gcRes.ok()).toBeTruthy();
    const gcBody = await gcRes.json();

    expect(gcBody.results.tier2.scannedKeys).toBeGreaterThan(0);
    expect(gcBody.results.tier2.untrackedKeys).toBeGreaterThanOrEqual(1);
    expect(gcBody.results.tier2.deletedKeys).toBeGreaterThanOrEqual(1);

    expect(await blobExists(untrackedKey)).toBeFalsy();
    expect((await listS3Keys()).includes(untrackedKey)).toBeFalsy();
  });
});
