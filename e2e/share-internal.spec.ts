import { expect, test, type Page } from '@playwright/test';

import { buildName, fileItem } from './helpers/files';
import { ensureApprovedUser, loginAsUser, getTestSuffix } from './helpers/auth';
import { getSessionToken, nodeUrl, resolveNodeId } from './helpers/resolvePath';
import { TEST_USERS } from './fixtures/test-data';

type InternalSharingFixtures = {
  ownerUsername: string;
  ownerUserKey: 'user2';
  ownerSuffix: string;
  requesterUsername: string;
  requesterUserKey: 'user1';
  requesterSuffix: string;
  targetFolderName: string;
  targetFolderPath: string;
  targetNodeId: number;
  adminToken: string;
  requesterUserId: number;
  ownerHomePath: string;
  ownerHomeNodeId: number;
  requesterOwnFolderName: string;
  requesterOwnFolderPath: string;
  requesterOwnFolderNodeId: number;
};

async function loginByUsername(
  request: any,
  { username, password }: { username: string; password: string }
) {
  const res = await request.post('/api/auth/login', { data: { username, password } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body as { token: string; user: { id: number; username: string } };
}

async function createFolderViaApi(request: any, adminToken: string, folderPath: string) {
  const segments = folderPath.split('/').filter(Boolean);
  const name = segments[segments.length - 1];
  const parentPath = `/${segments.slice(0, -1).join('/')}`;

  const parentNodeId = await resolveNodeId(request, adminToken, parentPath);

  const res = await request.post('/api/folders/create', {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { parentNodeId, name },
  });

  // Idempotent prerequisite: if retries happen, conflict is acceptable.
  if (res.status() !== 409) {
    expect(res.ok()).toBeTruthy();
  }
}

async function grantReadViaApi(
  request: any,
  adminToken: string,
  userId: number,
  folderPath: string
) {
  const nodeId = await resolveNodeId(request, adminToken, folderPath);
  const res = await request.post('/api/permissions/grant', {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { userId, nodeId, permission: 'read' },
  });
  expect(res.ok()).toBeTruthy();
}

async function grantWriteViaApi(
  request: any,
  adminToken: string,
  userId: number,
  folderPath: string
) {
  const nodeId = await resolveNodeId(request, adminToken, folderPath);
  const res = await request.post('/api/permissions/grant', {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { userId, nodeId, permission: 'write' },
  });
  expect(res.ok()).toBeTruthy();
}

async function revokeViaApi(request: any, adminToken: string, userId: number, folderPath: string) {
  const nodeId = await resolveNodeId(request, adminToken, folderPath);
  const res = await request.delete('/api/permissions/revoke', {
    headers: { Authorization: `Bearer ${adminToken}` },
    params: { userId, nodeId },
  });
  expect(res.ok()).toBeTruthy();
}

async function gotoFolderByPath(page: Page, request: any, serverPath: string) {
  const bearerToken = await getSessionToken(page);
  const nodeId = await resolveNodeId(request, bearerToken, serverPath);
  await page.goto(nodeUrl(nodeId));
}

test.describe.serial('internal sharing request -> __shared__', () => {
  let fixtures: InternalSharingFixtures;

  test.beforeAll(async ({ request }, testInfo) => {
    const suffix = getTestSuffix(testInfo);
    const suffix1 = `${suffix}_1`;
    const suffix2 = `${suffix}_2`;

    await ensureApprovedUser(request, 'user1', suffix1);
    await ensureApprovedUser(request, 'user2', suffix2);

    const ownerUsername = `${TEST_USERS.user2.username}_${suffix2}`;
    const requesterUsername = `${TEST_USERS.user1.username}_${suffix1}`;

    const targetFolderName = buildName(testInfo, 'internal-share-target-folder');
    const targetFolderPath = `/${ownerUsername}/${targetFolderName}`;
    const ownerHomePath = `/${ownerUsername}`;

    const adminLogin = await loginByUsername(request, TEST_USERS.admin);
    const adminToken = adminLogin.token;

    const requesterLogin = await loginByUsername(request, {
      username: `${TEST_USERS.user1.username}_${suffix1}`,
      password: TEST_USERS.user1.password,
    });
    const requesterUserId = requesterLogin.user.id;

    await createFolderViaApi(request, adminToken, targetFolderPath);

    const targetNodeId = await resolveNodeId(request, adminToken, targetFolderPath);
    const ownerHomeNodeId = await resolveNodeId(request, adminToken, ownerHomePath);

    // Failure-precondition injection: the requester owns their own folders. If the
    // own subtree ever leaked into the shared permissions, the requester would see
    // them under `__shared__` alongside the genuine grant.
    const requesterOwnFolderName = buildName(testInfo, 'requester-own-folder');
    const requesterOwnFolderPath = `/${requesterUsername}/${requesterOwnFolderName}`;
    await createFolderViaApi(request, adminToken, requesterOwnFolderPath);
    const requesterOwnFolderNodeId = await resolveNodeId(
      request,
      adminToken,
      requesterOwnFolderPath
    );

    fixtures = {
      ownerUsername,
      ownerUserKey: 'user2',
      ownerSuffix: suffix2,
      requesterUsername,
      requesterUserKey: 'user1',
      requesterSuffix: suffix1,
      targetFolderName,
      targetFolderPath,
      targetNodeId,
      adminToken,
      requesterUserId,
      ownerHomePath,
      ownerHomeNodeId,
      requesterOwnFolderName,
      requesterOwnFolderPath,
      requesterOwnFolderNodeId,
    };
  });

  test("E2E-OVERLAY-003: Request access to another user's content from protected UI", async ({
    page,
    request,
  }) => {
    await loginAsUser(page, fixtures.requesterUserKey, fixtures.requesterSuffix);

    await gotoFolderByPath(page, request, fixtures.ownerHomePath);

    const targetItem = fileItem(page, fixtures.targetFolderPath);
    await expect(targetItem).toBeVisible({ timeout: 20_000 });
    await targetItem.getByLabel('More actions').click();
    await page.getByTestId('file-action-share').click();

    const dialog = page.getByRole('dialog');

    const requestReadBtn = dialog.getByRole('button', { name: /request read permission/i });
    await expect(requestReadBtn).toBeVisible();
    await requestReadBtn.click();

    await expect(dialog.getByText(/Read permission requested/i)).toBeVisible();
  });

  test('E2E-OVERLAY-004: Owner approves a pending request and requester can open the shared content', async ({
    page,
  }, testInfo) => {
    await loginAsUser(page, fixtures.ownerUserKey, fixtures.ownerSuffix);
    await page.goto('/mypage');

    if (testInfo.project.name.endsWith('-mobile')) {
      await page.getByRole('button', { name: /My page/i }).click();
    }

    // Select "Share management" in the MyPage sidebar (desktop) or in the mobile drawer.
    await page.getByRole('button', { name: /Share management/i }).click();
    await page.getByRole('button', { name: /Received requests/i }).click();

    await expect(page.getByText(fixtures.targetFolderPath)).toBeVisible();

    const targetRequestCard = page
      .getByText(fixtures.targetFolderPath)
      .locator('xpath=ancestor::*[.//button[normalize-space()="Review"]][1]');
    await expect(targetRequestCard).toBeVisible();
    await targetRequestCard.getByRole('button', { name: /Review/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: /Confirm/i })).toBeVisible();
    await dialog.getByRole('button', { name: /Confirm/i }).click();

    // Wait for the inbox entry to disappear (pending -> approved).
    await expect(page.getByText(fixtures.targetFolderPath)).toHaveCount(0, { timeout: 20_000 });

    // After approval, the requester should see the granted target under the authenticated `__shared__` root.
    await loginAsUser(page, fixtures.requesterUserKey, fixtures.requesterSuffix);
    await page.goto('/files/__shared__');
    await expect(page).toHaveURL(/\/files\/__shared__(?:\/.*)?$/);

    await expect(page.locator(`[data-file-node-id="${fixtures.targetNodeId}"]`)).toBeVisible({
      timeout: 20_000,
    });

    // Absence regression (class A): the requester's own folders must not leak into
    // `__shared__` next to the genuine grant.
    await expect(
      page.locator(`[data-file-node-id="${fixtures.requesterOwnFolderNodeId}"]`)
    ).toHaveCount(0);
  });

  test('E2E-OVERLAY-005: Owner rejects a pending request and requester stays blocked from the target', async ({
    page,
    request,
  }, testInfo) => {
    // Setup: Create a unique folder for this test to avoid collision
    const folderName = buildName(testInfo, 'reject-test-folder');
    const folderPath = `/${fixtures.ownerUsername}/${folderName}`;
    await createFolderViaApi(request, fixtures.adminToken, folderPath);

    // Request: user1 requests read permission
    await loginAsUser(page, fixtures.requesterUserKey, fixtures.requesterSuffix);
    await gotoFolderByPath(page, request, fixtures.ownerHomePath);

    const targetItem = fileItem(page, folderPath);
    await expect(targetItem).toBeVisible({ timeout: 20_000 });
    await targetItem.getByLabel('More actions').click();
    await page.getByTestId('file-action-share').click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /request read permission/i }).click();
    await expect(dialog.getByText(/Read permission requested/i)).toBeVisible();

    // Reject: user2 rejects the request
    await loginAsUser(page, fixtures.ownerUserKey, fixtures.ownerSuffix);
    await page.goto('/mypage');

    if (testInfo.project.name.endsWith('-mobile')) {
      await page.getByRole('button', { name: /My page/i }).click();
    }
    await page.getByRole('button', { name: /Share management/i }).click();
    await page.getByRole('button', { name: /Received requests/i }).click();

    const requestCard = page
      .getByText(folderPath)
      .locator('xpath=ancestor::div[contains(@class, "Paper")]');
    await expect(requestCard).toBeVisible();
    await requestCard.getByRole('button', { name: /Rejected/i }).click();

    // Verify: Request disappears from inbox
    await expect(page.getByText(folderPath)).toHaveCount(0, { timeout: 20_000 });

    // Verify: user1 still cannot access the folder content, but can see it as protected in the owner's home
    await loginAsUser(page, fixtures.requesterUserKey, fixtures.requesterSuffix);

    await gotoFolderByPath(page, request, fixtures.ownerHomePath);

    const targetItemVerification = fileItem(page, folderPath);
    await expect(targetItemVerification).toBeVisible({ timeout: 20_000 });

    await targetItemVerification.getByLabel('More actions').click();
    await page.getByTestId('file-action-share').click();

    const dialogVerification = page.getByRole('dialog');
    await expect(
      dialogVerification.getByRole('button', { name: /request read permission/i })
    ).toBeVisible();

    // Absence regression (class E): a rejected request must not produce a shared
    // entry at all — the rejected target is absent from the requester's `__shared__`.
    const rejectedFolderNodeId = await resolveNodeId(request, fixtures.adminToken, folderPath);
    await page.goto('/files/__shared__');
    await expect(page).toHaveURL(/\/files\/__shared__(?:\/.*)?$/);
    await expect(page.locator(`[data-file-node-id="${rejectedFolderNodeId}"]`)).toHaveCount(0);
  });

  test('E2E-OVERLAY-007: Shared target exposes write-capable actions when the granted permission is write', async ({
    page,
    request,
  }, testInfo) => {
    // Setup: Create folder and grant WRITE permission to user1
    const folderName = buildName(testInfo, 'write-test-folder');
    const folderPath = `/${fixtures.ownerUsername}/${folderName}`;
    await createFolderViaApi(request, fixtures.adminToken, folderPath);
    await grantWriteViaApi(request, fixtures.adminToken, fixtures.requesterUserId, folderPath);

    // Navigate: user1 goes to the folder
    await loginAsUser(page, fixtures.requesterUserKey, fixtures.requesterSuffix);
    await gotoFolderByPath(page, request, folderPath);

    // Verify FAB: "Create folder" and "Upload file" should be visible in the FAB menu
    const fab = page.getByTestId('file-actions-fab');
    await expect(fab).toBeVisible();
    await fab.click();
    await expect(page.getByRole('menuitem', { name: /Create folder/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Upload file/i })).toBeVisible();

    // Verify Actions: rename/delete/move in action sheet should not be disabled
    // Go up one level to see the folder as an item
    await gotoFolderByPath(page, request, fixtures.ownerHomePath);
    const folderItem = fileItem(page, folderPath);
    await folderItem.getByLabel('More actions').click();

    await expect(page.getByTestId('file-action-rename')).toBeVisible();
    await expect(page.getByTestId('file-action-delete')).toBeVisible();
    await expect(page.getByTestId('file-action-move')).toBeVisible();
  });

  test('E2E-OVERLAY-001: Approved user enters __shared__ from the explorer tree', async ({
    page,
  }, testInfo) => {
    await loginAsUser(page, fixtures.requesterUserKey, fixtures.requesterSuffix);
    await page.goto('/files');
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // On mobile, the folder tree is hidden by default and needs to be toggled open
    if (testInfo.project.name.endsWith('-mobile')) {
      const toggleBtn = page.locator('button[title="Open folder tree"]');
      const toggleCount = await toggleBtn.count();
      if (toggleCount > 0) {
        await toggleBtn.click();
      }
    }

    // Wait for folder tree to be ready with shared folders
    const folderTree = page.getByTestId('folder-tree');
    await expect(folderTree).toBeVisible({ timeout: 20_000 });

    // Click the "Shared" section header in the folder tree sidebar
    const sharedHeader = folderTree.getByRole('button', { name: /Shared/i, exact: false }).first();
    await expect(sharedHeader).toBeVisible();
    await sharedHeader.click();

    // Verify: browser navigates to /__shared__ path
    await expect(page).toHaveURL(/\/files\/__shared__(?:\/.*)?$/);

    // Verify: breadcrumb shows "Shared" label
    const breadcrumbChips = page.locator('.MuiChip-root');
    await expect(breadcrumbChips.first()).toContainText(/Shared/i);

    // Verify: the shared folders list is rendered under the __shared__ view
    // The __shared__ view shows the user's granted shared folders (top-level permission paths)
    // The approved target folder (not the owner home) should appear as a shared entry
    const sharedFolderItem = page.locator(`[data-file-node-id="${fixtures.targetNodeId}"]`);
    await expect(sharedFolderItem).toBeVisible({ timeout: 20_000 });
  });

  test('E2E-OVERLAY-002: Approved user navigates from __shared__ root into a nested shared folder', async ({
    page,
  }, testInfo) => {
    await loginAsUser(page, fixtures.requesterUserKey, fixtures.requesterSuffix);
    await page.goto('/files');
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // On mobile, the folder tree is hidden by default and needs to be toggled open
    if (testInfo.project.name.endsWith('-mobile')) {
      const toggleBtn = page.locator('button[title="Open folder tree"]');
      const toggleCount = await toggleBtn.count();
      if (toggleCount > 0) {
        await toggleBtn.click();
      }
    }

    // Wait for folder tree to be ready with shared folders
    const folderTree = page.getByTestId('folder-tree');
    await expect(folderTree).toBeVisible({ timeout: 20_000 });

    // Click the "Shared" section header to expand and navigate
    const sharedHeader = folderTree.getByRole('button', { name: /Shared/i, exact: false }).first();
    await expect(sharedHeader).toBeVisible();
    await sharedHeader.click();

    // Verify we are in the __shared__ view
    await expect(page).toHaveURL(/\/files\/__shared__(?:\/.*)?$/);

    // The listing should show the approved target folder as a shared entry
    const sharedFolderItem = page.locator(`[data-file-node-id="${fixtures.targetNodeId}"]`);
    await expect(sharedFolderItem).toBeVisible({ timeout: 20_000 });

    if (testInfo.project.name.endsWith('-mobile')) {
      // On mobile, click the shared folder item in the listing to navigate
      await sharedFolderItem.click();
      // Mobile navigates directly to the shared folder's nodeId URL
      await expect(page).toHaveURL(new RegExp(`/files/node/${fixtures.targetNodeId}$`));
    } else {
      // On desktop, click the shared folder in the tree sidebar to navigate
      // Re-open the folder tree (it may have collapsed after Shared header click)
      const toggleBtn = page.locator('button[title="Open folder tree"]');
      const toggleCount = await toggleBtn.count();
      if (toggleCount > 0) {
        await toggleBtn.click();
      }
      await expect(folderTree).toBeVisible({ timeout: 20_000 });
      const sharedTreeItem = folderTree
        .getByRole('button', { name: fixtures.targetFolderName })
        .first();
      await expect(sharedTreeItem).toBeVisible();
      await sharedTreeItem.click();
      await expect(page).toHaveURL(new RegExp(`/files/node/${fixtures.targetNodeId}$`));
    }

    // Verify: explorer shell is visible (breadcrumb present)
    const breadcrumbChips = page.locator('.MuiChip-root');
    await expect(breadcrumbChips.first()).toBeVisible();
  });

  test('E2E-OVERLAY-006: Shared target with read permission hides write actions', async ({
    page,
    request,
  }, testInfo) => {
    // Setup: Create a folder and grant READ permission (not write)
    const folderName = buildName(testInfo, 'readonly-test-folder');
    const folderPath = `/${fixtures.ownerUsername}/${folderName}`;
    await createFolderViaApi(request, fixtures.adminToken, folderPath);
    await grantReadViaApi(request, fixtures.adminToken, fixtures.requesterUserId, folderPath);

    // Navigate to the target folder as requester
    await loginAsUser(page, fixtures.requesterUserKey, fixtures.requesterSuffix);
    await gotoFolderByPath(page, request, folderPath);

    // Wait for the listing to load
    await page.waitForTimeout(2000);

    // Verify: the listing is visible (even if empty for a folder with no children)
    const breadcrumbChips = page.locator('.MuiChip-root');
    await expect(breadcrumbChips.first()).toBeVisible();

    // Verify: the FAB is not visible (no write permission means no create/upload actions)
    const fab = page.getByTestId('file-actions-fab');
    await expect(fab).not.toBeVisible({ timeout: 5000 });

    // Verify: the listing shows the folder is accessible but empty
    // (The listing container exists but has no items)
    const listingItems = page.locator('[data-file-path]');
    await expect(listingItems).toHaveCount(0);
  });
});
