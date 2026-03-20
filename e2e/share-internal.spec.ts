import { expect, test } from '@playwright/test';

import { buildName, fileItem } from './helpers/files';
import { ensureApprovedUser, loginAsUser } from './helpers/auth';
import { TEST_USERS } from './fixtures/test-data';

type InternalSharingFixtures = {
  ownerUsername: string;
  requesterUsername: string;
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
    await ensureApprovedUser(request, 'user1');
    await ensureApprovedUser(request, 'user2');

    const ownerUsername = 'user2';
    const requesterUsername = 'user1';

    const targetFolderName = buildName(testInfo, 'internal-share-target-folder');
    const targetFolderPath = `/${ownerUsername}/${targetFolderName}`;
    const ownerHomePath = `/${ownerUsername}`;

    const adminLogin = await loginByUsername(request, TEST_USERS.admin);
    const adminToken = adminLogin.token;

    const requesterLogin = await loginByUsername(request, TEST_USERS[requesterUsername as 'user1']);
    const requesterUserId = requesterLogin.user.id;

    await createFolderViaApi(request, adminToken, targetFolderPath);
    await grantReadViaApi(request, adminToken, requesterUserId, ownerHomePath);

    fixtures = {
      ownerUsername,
      requesterUsername,
      targetFolderName,
      targetFolderPath,
      adminToken,
      requesterUserId,
      ownerHomePath,
    };
  });

  test('E2E-OVERLAY-003 requester can request read permission from protected UI', async ({ page, request }) => {
    await loginAsUser(page, fixtures.requesterUsername as 'user1');

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
    await loginAsUser(page, fixtures.ownerUsername as 'user2');
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
    await loginAsUser(page, fixtures.requesterUsername as 'user1');
    await page.goto('/files/__shared__');

    await expect(fileItem(page, fixtures.targetFolderPath)).toBeVisible({ timeout: 20_000 });
  });
});

