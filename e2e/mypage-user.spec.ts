import { expect, test } from '@playwright/test';

import { buildName, readTestFileFixture } from './helpers/files';
import { ensureApprovedUser, loginAsUser, getTestSuffix } from './helpers/auth';
import { createShareLink } from './helpers/shareLinks';
import { resolveNodeId } from './helpers/resolvePath';
import { TEST_FILES, TEST_USERS } from './fixtures/test-data';

async function uploadFileToUserHome(
  request: any,
  bearerToken: string,
  homePath: string,
  fileName: string
) {
  const parentNodeId = await resolveNodeId(request, bearerToken, homePath);
  const fileBuffer = readTestFileFixture(TEST_FILES.smallText);
  const uploadRes = await request.post('/api/files/upload', {
    headers: { Authorization: `Bearer ${bearerToken}` },
    multipart: {
      file: { name: fileName, mimeType: 'text/plain', buffer: fileBuffer },
      parentNodeId: String(parentNodeId),
      onConflict: 'overwrite',
    },
  });
  if (uploadRes.status() !== 409) expect(uploadRes.ok()).toBeTruthy();
}

async function requestFileReadPermission(request: any, bearerToken: string, filePath: string) {
  const fileNodeId = await resolveNodeId(request, bearerToken, filePath);
  const reqRes = await request.post('/api/permission-requests', {
    headers: { Authorization: `Bearer ${bearerToken}` },
    data: { fileNodeId, permission: 'read' },
  });
  if (reqRes.status() !== 409) expect(reqRes.ok()).toBeTruthy();
}

test('E2E-MYPAGE-001: Authenticated user can open MyPage', async ({ page, request }, testInfo) => {
  const suffix = getTestSuffix(testInfo);
  await ensureApprovedUser(request, 'user1', suffix);
  await loginAsUser(page, 'user1', suffix);

  await page.goto('/mypage');

  await expect(page.getByRole('button', { name: /close/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /log out/i })).toBeVisible();
});

test('E2E-MYPAGE-002: Close button returns user to file area', async ({
  page,
  request,
}, testInfo) => {
  const suffix = getTestSuffix(testInfo);
  await ensureApprovedUser(request, 'user1', suffix);
  await loginAsUser(page, 'user1', suffix);

  await page.goto('/mypage');
  await page.getByRole('button', { name: /close/i }).click();

  await expect(page).toHaveURL(/\/files(?:\/.*)?$/);
  await expect(page.getByRole('button', { name: /log out/i })).toHaveCount(0);
});

test('E2E-MYPAGE-003: Logout clears session', async ({ page, request }, testInfo) => {
  const suffix = getTestSuffix(testInfo);
  await ensureApprovedUser(request, 'user1', suffix);
  await loginAsUser(page, 'user1', suffix);

  await page.goto('/mypage');

  await page.getByRole('button', { name: /log out/i }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('input[name="username"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();
});

test('E2E-MYPAGE-004: Email update succeeds', async ({ page, request }, testInfo) => {
  const suffix = getTestSuffix(testInfo);
  await ensureApprovedUser(request, 'user1', suffix);
  await loginAsUser(page, 'user1', suffix);

  const bearerToken = await page.evaluate(() => sessionStorage.getItem('token'));
  expect(bearerToken).not.toBeNull();

  const newEmail = `updated_${suffix}@e2etest.com`;

  const meRes = await request.get('/api/auth/me', {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  expect(meRes.ok()).toBeTruthy();
  const meBody = await meRes.json();
  const userId = meBody.id;

  const updateRes = await request.put(`/api/users/${userId}/email`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
    data: { email: newEmail },
  });
  expect(updateRes.ok()).toBeTruthy();

  await page.goto('/mypage');
  await expect(page.getByText(newEmail, { exact: true })).toBeVisible({ timeout: 20_000 });
});

test('E2E-MYPAGE-005: Password change invalidates current session', async ({
  page,
  request,
}, testInfo) => {
  const suffix = getTestSuffix(testInfo);
  await ensureApprovedUser(request, 'user1', suffix);
  await loginAsUser(page, 'user1', suffix);

  const user = `${TEST_USERS.user1.username}_${suffix}`;

  const bearerToken = await page.evaluate(() => sessionStorage.getItem('token'));
  expect(bearerToken).not.toBeNull();

  const meRes = await request.get('/api/auth/me', {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  expect(meRes.ok()).toBeTruthy();
  const meBody = await meRes.json();
  const userId = meBody.id;

  const updateRes = await request.put(`/api/users/${userId}/password`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
    data: { password: 'newpassword123' },
  });
  expect(updateRes.ok()).toBeTruthy();

  await page.goto('/mypage');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('input[name="username"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();

  await page.locator('input[name="username"]').fill(user);
  await page.locator('input[name="password"]').fill('newpassword123');

  await Promise.all([
    page.waitForURL(/\/files(?:\/.*)?$/),
    page.locator('form button[type="submit"]').click(),
  ]);

  const adminLogin = await request.post('/api/auth/login', {
    data: { username: TEST_USERS.admin.username, password: TEST_USERS.admin.password },
  });
  expect(adminLogin.ok()).toBeTruthy();
  const adminBody = await adminLogin.json();
  const adminToken = adminBody.token;

  const usersRes = await request.get('/api/admin/users', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const users = await usersRes.json();
  const targetUser = users.find((u: any) => u.username === user);
  if (targetUser) {
    await request.put(`/api/admin/users/${targetUser.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { password: TEST_USERS.user1.password },
    });
  }
});

test('E2E-MYPAGE-006: Sharing inbox approve flow works', async ({ page, request }, testInfo) => {
  const suffix = getTestSuffix(testInfo);
  const suffix1 = `${suffix}_1`;
  const suffix2 = `${suffix}_2`;

  await ensureApprovedUser(request, 'user1', suffix1);
  await ensureApprovedUser(request, 'user2', suffix2);

  const user1Username = `${TEST_USERS.user1.username}_${suffix1}`;
  const user2Username = `${TEST_USERS.user2.username}_${suffix2}`;

  const adminLogin = await request.post('/api/auth/login', {
    data: { username: TEST_USERS.admin.username, password: TEST_USERS.admin.password },
  });
  expect(adminLogin.ok()).toBeTruthy();
  const adminBody = await adminLogin.json();
  const adminToken = adminBody.token;

  const targetFileName = buildName(testInfo, 'inbox-approve-file', '.txt');
  const targetFilePath = `/${user2Username}/${targetFileName}`;

  await uploadFileToUserHome(request, adminToken, `/${user2Username}`, targetFileName);

  const user1Login = await request.post('/api/auth/login', {
    data: { username: user1Username, password: TEST_USERS.user1.password },
  });
  const user1Body = await user1Login.json();
  const user1Token = user1Body.token;

  await requestFileReadPermission(request, user1Token, targetFilePath);

  await loginAsUser(page, 'user2', suffix2);
  await page.goto('/mypage');

  if (testInfo.project.name.endsWith('-mobile')) {
    await page.getByRole('button', { name: /My page/i }).click();
  }
  await page.getByRole('button', { name: /Share management/i }).click();
  await page.getByRole('button', { name: /Received requests/i }).click();

  await expect(page.getByText(targetFilePath)).toBeVisible({ timeout: 20_000 });

  const requestCard = page
    .getByText(targetFilePath)
    .locator('xpath=ancestor::div[contains(@class, "Paper")]');
  await expect(requestCard).toBeVisible();
  await requestCard.getByRole('button', { name: /Approved/i }).click();

  await expect(page.getByText(targetFilePath)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(/File permission request approved/i)).toBeVisible();
});

test('E2E-MYPAGE-007: Sharing inbox reject flow works', async ({ page, request }, testInfo) => {
  const suffix = getTestSuffix(testInfo);
  const suffix1 = `${suffix}_1`;
  const suffix2 = `${suffix}_2`;

  await ensureApprovedUser(request, 'user1', suffix1);
  await ensureApprovedUser(request, 'user2', suffix2);

  const user1Username = `${TEST_USERS.user1.username}_${suffix1}`;
  const user2Username = `${TEST_USERS.user2.username}_${suffix2}`;

  const adminLogin = await request.post('/api/auth/login', {
    data: { username: TEST_USERS.admin.username, password: TEST_USERS.admin.password },
  });
  expect(adminLogin.ok()).toBeTruthy();
  const adminBody = await adminLogin.json();
  const adminToken = adminBody.token;

  const rejectFileName = buildName(testInfo, 'inbox-reject-file', '.txt');
  const rejectFilePath = `/${user2Username}/${rejectFileName}`;

  await uploadFileToUserHome(request, adminToken, `/${user2Username}`, rejectFileName);

  const user1Login = await request.post('/api/auth/login', {
    data: { username: user1Username, password: TEST_USERS.user1.password },
  });
  const user1Body = await user1Login.json();
  const user1Token = user1Body.token;

  await requestFileReadPermission(request, user1Token, rejectFilePath);

  await loginAsUser(page, 'user2', suffix2);
  await page.goto('/mypage');

  if (testInfo.project.name.endsWith('-mobile')) {
    await page.getByRole('button', { name: /My page/i }).click();
  }
  await page.getByRole('button', { name: /Share management/i }).click();
  await page.getByRole('button', { name: /Received requests/i }).click();

  const requestCard = page
    .getByText(rejectFilePath)
    .locator('xpath=ancestor::div[contains(@class, "Paper")]');
  await expect(requestCard).toBeVisible();
  await requestCard.getByRole('button', { name: /Rejected/i }).click();

  await expect(page.getByText(rejectFilePath)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(/Request rejected/i)).toBeVisible();
});

test('E2E-MYPAGE-008: Sharing outbox cancel flow works', async ({ page, request }, testInfo) => {
  const suffix = getTestSuffix(testInfo);
  const suffix1 = `${suffix}_1`;
  const suffix2 = `${suffix}_2`;

  await ensureApprovedUser(request, 'user1', suffix1);
  await ensureApprovedUser(request, 'user2', suffix2);

  const user1Username = `${TEST_USERS.user1.username}_${suffix1}`;
  const user2Username = `${TEST_USERS.user2.username}_${suffix2}`;

  const adminLogin = await request.post('/api/auth/login', {
    data: { username: TEST_USERS.admin.username, password: TEST_USERS.admin.password },
  });
  expect(adminLogin.ok()).toBeTruthy();
  const adminBody = await adminLogin.json();
  const adminToken = adminBody.token;

  const cancelFileName = buildName(testInfo, 'outbox-cancel-file', '.txt');
  const cancelFilePath = `/${user2Username}/${cancelFileName}`;

  await uploadFileToUserHome(request, adminToken, `/${user2Username}`, cancelFileName);

  const user1Login = await request.post('/api/auth/login', {
    data: { username: user1Username, password: TEST_USERS.user1.password },
  });
  const user1Body = await user1Login.json();
  const user1Token = user1Body.token;

  await requestFileReadPermission(request, user1Token, cancelFilePath);

  await loginAsUser(page, 'user1', suffix1);
  await page.goto('/mypage');

  if (testInfo.project.name.endsWith('-mobile')) {
    await page.getByRole('button', { name: /My page/i }).click();
  }
  await page.getByRole('button', { name: /Share management/i }).click();
  await page.getByRole('button', { name: /My requests/i }).click();

  const requestCard = page
    .getByText(cancelFilePath)
    .locator('xpath=ancestor::div[contains(@class, "Paper")]');
  await expect(requestCard).toBeVisible();
  await requestCard.getByRole('button', { name: /Cancelled/i }).click();

  await expect(page.getByText(cancelFilePath)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(/Request cancelled/i)).toBeVisible();
});

test('E2E-MYPAGE-009: Share links list supports copy, extend, delete', async ({
  page,
  request,
  context,
}, testInfo) => {
  const suffix = getTestSuffix(testInfo);
  const suffix1 = `${suffix}_1`;

  await ensureApprovedUser(request, 'user1', suffix1);

  const user1Username = `${TEST_USERS.user1.username}_${suffix1}`;

  const adminLogin = await request.post('/api/auth/login', {
    data: { username: TEST_USERS.admin.username, password: TEST_USERS.admin.password },
  });
  expect(adminLogin.ok()).toBeTruthy();
  const adminBody = await adminLogin.json();
  const adminToken = adminBody.token;

  const user1HomePath = `/${user1Username}`;
  // The user1 home node is created server-side at approval time; resolve it as the
  // nodeId-based replacement for the old "ensure the home folder exists" create call.
  await resolveNodeId(request, adminToken, user1HomePath);

  const user1Login = await request.post('/api/auth/login', {
    data: { username: user1Username, password: TEST_USERS.user1.password },
  });
  const user1Body = await user1Login.json();
  const user1Token = user1Body.token;

  const shareFileName = buildName(testInfo, 'share-link-file', '.txt');
  const shareFilePath = `/${user1Username}/${shareFileName}`;

  await uploadFileToUserHome(request, user1Token, user1HomePath, shareFileName);

  const shareLink = await createShareLink(request, {
    bearerToken: user1Token,
    filePath: shareFilePath,
    expiresInDays: 30,
  });

  if (!testInfo.project.name.endsWith('-mobile')) {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  }

  page.on('dialog', (dialog) => dialog.accept());

  await loginAsUser(page, 'user1', suffix1);
  await page.goto('/mypage');

  if (testInfo.project.name.endsWith('-mobile')) {
    await page.getByRole('button', { name: /My page/i }).click();
  }
  await page.getByRole('button', { name: /Share management/i }).click();
  await page.getByRole('button', { name: /Links/i }).click();

  await expect(page.getByText(shareLink.token)).toBeVisible({ timeout: 20_000 });

  const linkCard = page
    .getByText(shareLink.token)
    .locator('xpath=ancestor::div[contains(@class, "Paper")]');
  await expect(linkCard).toBeVisible();

  await linkCard.locator('.MuiBox-root > .MuiIconButton-root').first().click();
  await expect(page.getByText(/Link copied to clipboard/i)).toBeVisible();

  await linkCard.getByRole('button', { name: /\+7 days/i }).click();
  await expect(page.getByText(/Link expiry has been extended/i)).toBeVisible();

  await linkCard.getByRole('button', { name: /Delete/i }).click();
  await expect(page.getByText(shareLink.token)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(/Share link has been deleted/i)).toBeVisible();
});

test('E2E-MYPAGE-011: Mobile menu button opens and closes the category drawer', async ({
  page,
  request,
}, testInfo) => {
  if (!testInfo.project.name.endsWith('-mobile')) {
    test.skip();
  }

  const suffix = getTestSuffix(testInfo);
  await ensureApprovedUser(request, 'user1', suffix);
  await loginAsUser(page, 'user1', suffix);

  await page.goto('/mypage');

  const menuButton = page.locator('button[aria-label="My page"]');
  await expect(menuButton).toBeVisible();

  const drawer = page.locator('.MuiDrawer-paper').filter({ has: page.getByText(/Account info/i) });

  await menuButton.click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(/Account info/i)).toBeVisible();
  await expect(drawer.getByText(/Share management/i)).toBeVisible();
  await expect(drawer.getByText(/Preferences/i)).toBeVisible();

  await drawer.getByRole('button', { name: /Account info/i }).click();
  await expect(drawer).not.toBeVisible();
});

test('E2E-MYPAGE-012: Selecting a category from the mobile drawer closes it and updates content', async ({
  page,
  request,
}, testInfo) => {
  if (!testInfo.project.name.endsWith('-mobile')) {
    test.skip();
  }

  const suffix = getTestSuffix(testInfo);
  await ensureApprovedUser(request, 'user1', suffix);
  await loginAsUser(page, 'user1', suffix);

  await page.goto('/mypage');

  const menuButton = page.locator('button[aria-label="My page"]');
  await expect(menuButton).toBeVisible();

  const drawer = page.locator('.MuiDrawer-paper').filter({ has: page.getByText(/Account info/i) });

  await menuButton.click();
  await expect(drawer).toBeVisible();

  await drawer.getByRole('button', { name: /Preferences/i }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('heading', { level: 6, name: /Preferences/i })).toBeVisible();
  await expect(page.getByText('Language', { exact: true })).toBeVisible();

  await menuButton.click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: /Share management/i }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('button', { name: /Received requests/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /My requests/i })).toBeVisible();
});
