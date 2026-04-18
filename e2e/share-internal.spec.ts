import { expect, test } from '@playwright/test';

import { buildName, fileItem } from './helpers/files';
import { ensureApprovedUser, loginAsUser, getTestSuffix } from './helpers/auth';
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
  adminToken: string;
  requesterUserId: number;
  ownerHomePath: string;
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
  const res = await request.post('/api/folders/create', {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { path: folderPath },
  });

  // Idempotent prerequisite: if retries happen, conflict is acceptable.
  if (res.status() !== 409) {
    expect(res.ok()).toBeTruthy();
  }
}

async function grantReadViaApi(request: any, adminToken: string, userId: number, folderPath: string) {
  const res = await request.post('/api/permissions/grant', {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { userId, folderPath, permission: 'read' },
  });
  expect(res.ok()).toBeTruthy();
}

async function grantWriteViaApi(request: any, adminToken: string, userId: number, folderPath: string) {
  const res = await request.post('/api/permissions/grant', {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { userId, folderPath, permission: 'write' },
  });
  expect(res.ok()).toBeTruthy();
}

async function revokeViaApi(request: any, adminToken: string, userId: number, folderPath: string) {
  const res = await request.delete('/api/permissions/revoke', {
    headers: { Authorization: `Bearer ${adminToken}` },
    params: { userId, folderPath },
  });
  expect(res.ok()).toBeTruthy();
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
    await grantReadViaApi(request, adminToken, requesterUserId, ownerHomePath);

    fixtures = {
      ownerUsername,
      ownerUserKey: 'user2',
      ownerSuffix: suffix2,
      requesterUsername,
      requesterUserKey: 'user1',
      requesterSuffix: suffix1,
      targetFolderName,
      targetFolderPath,
      adminToken,
      requesterUserId,
      ownerHomePath,
    };
  });

  test('E2E-OVERLAY-003 requester can request read permission from protected UI', async ({ page, request }) => {
    await loginAsUser(page, fixtures.requesterUserKey, fixtures.requesterSuffix);

    await page.goto(`/files/${fixtures.ownerUsername}`);

    const targetItem = fileItem(page, fixtures.targetFolderPath);
    await expect(targetItem).toBeVisible({ timeout: 20_000 });
    await targetItem.getByLabel('More actions').click();
    await page.getByTestId('file-action-share').click();

    const dialog = page.getByRole('dialog');

    const requestReadBtn = dialog.getByRole('button', { name: /request read permission/i });
    await expect(requestReadBtn).toBeVisible();
    await requestReadBtn.click();

    await expect(dialog.getByText(/Read permission requested/i)).toBeVisible();

    // Avoid creating an extra shared root entry for `/user2` by removing the temporary parent grant.
    await revokeViaApi(request, fixtures.adminToken, fixtures.requesterUserId, fixtures.ownerHomePath);
  });

  test('E2E-OVERLAY-004 owner approves pending request; requester discovers target under __shared__', async ({ page }, testInfo) => {
    await loginAsUser(page, fixtures.ownerUserKey, fixtures.ownerSuffix);
    await page.goto('/mypage');

    if (testInfo.project.name === 'mobile') {
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

    await expect(fileItem(page, fixtures.targetFolderPath)).toBeVisible({ timeout: 20_000 });
  });

  test('E2E-OVERLAY-005 requester request can be rejected by owner', async ({ page, request }, testInfo) => {
    // Setup: Create a unique folder for this test to avoid collision
    const folderName = buildName(testInfo, 'reject-test-folder');
    const folderPath = `/${fixtures.ownerUsername}/${folderName}`;
    await createFolderViaApi(request, fixtures.adminToken, folderPath);

    // To allow user1 to see the folder item in /files/user2, we must grant read access to the home folder
    await grantReadViaApi(request, fixtures.adminToken, fixtures.requesterUserId, fixtures.ownerHomePath);

    // Request: user1 requests read permission
    await loginAsUser(page, fixtures.requesterUserKey, fixtures.requesterSuffix);
    await page.goto(`/files/${fixtures.ownerUsername}`);
    
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

    if (testInfo.project.name === 'mobile') {
      await page.getByRole('button', { name: /My page/i }).click();
    }
    await page.getByRole('button', { name: /Share management/i }).click();
    await page.getByRole('button', { name: /Received requests/i }).click();

    const requestCard = page.getByText(folderPath).locator('xpath=ancestor::div[contains(@class, "Paper")]');
    await expect(requestCard).toBeVisible();
    await requestCard.getByRole('button', { name: /Rejected/i }).click();

    // Verify: Request disappears from inbox
    await expect(page.getByText(folderPath)).toHaveCount(0, { timeout: 20_000 });

    // Verify: user1 still cannot access the folder content, but can see it as protected in the owner's home
    await loginAsUser(page, fixtures.requesterUserKey, fixtures.requesterSuffix);
    
    await page.goto(`/files/${fixtures.ownerUsername}`);
    
    const targetItemVerification = fileItem(page, folderPath);
    await expect(targetItemVerification).toBeVisible({ timeout: 20_000 });
    
    await targetItemVerification.getByLabel('More actions').click();
    await page.getByTestId('file-action-share').click();
    
    const dialogVerification = page.getByRole('dialog');
    await expect(dialogVerification.getByRole('button', { name: /request read permission/i })).toBeVisible();
  });

  test('E2E-OVERLAY-007 write-capable shared content allows mutations', async ({ page, request }, testInfo) => {
    // Setup: Create folder and grant WRITE permission to user1
    const folderName = buildName(testInfo, 'write-test-folder');
    const folderPath = `/${fixtures.ownerUsername}/${folderName}`;
    await createFolderViaApi(request, fixtures.adminToken, folderPath);
    await grantWriteViaApi(request, fixtures.adminToken, fixtures.requesterUserId, folderPath);

    // Navigate: user1 goes to the folder
    await loginAsUser(page, fixtures.requesterUserKey, fixtures.requesterSuffix);
    await page.goto(`/files/${folderPath}`);

    // Verify FAB: "Create folder" and "Upload file" should be visible in the FAB menu
    const fab = page.getByTestId('file-actions-fab');
    await expect(fab).toBeVisible();
    await fab.click();
    await expect(page.getByRole('menuitem', { name: /Create folder/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Upload file/i })).toBeVisible();

    // Verify Actions: rename/delete/move in action sheet should not be disabled
    // Go up one level to see the folder as an item
    await page.goto(`/files/${fixtures.ownerUsername}`);
    const folderItem = fileItem(page, folderPath);
    await folderItem.getByLabel('More actions').click();
    
    await expect(page.getByTestId('file-action-rename')).toBeVisible();
    await expect(page.getByTestId('file-action-delete')).toBeVisible();
    await expect(page.getByTestId('file-action-move')).toBeVisible();
  });
});
