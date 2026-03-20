import { APIRequestContext, expect, Page } from '@playwright/test';

import { TEST_USERS } from '../fixtures/test-data';

type TestUserKey = 'admin' | 'user1' | 'user2';
type StandardTestUserKey = Exclude<TestUserKey, 'admin'>;

async function clearBrowserSession(page: Page) {
  await page.goto('/');
  await page.context().clearCookies();
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}

async function loginAs(page: Page, userKey: TestUserKey) {
  const user = TEST_USERS[userKey];

  await page.goto('/login');

  const usernameInput = page.locator('input[name="username"]');
  await expect(usernameInput).toBeVisible();

  await usernameInput.fill(user.username);
  await page.locator('input[name="password"]').fill(user.password);

  await Promise.all([
    page.waitForURL(/\/files(?:\/.*)?$/),
    page.locator('form button[type="submit"]').click(),
  ]);
}

export async function loginAsAdmin(page: Page) {
  await loginAs(page, 'admin');

  await expect(page.getByTestId('file-actions-fab')).toBeVisible();
}

export async function loginAsUser(page: Page, userKey: StandardTestUserKey) {
  await loginAs(page, userKey);
}

export async function gotoAsAnonymous(page: Page, targetPath = '/login') {
  await clearBrowserSession(page);
  await page.goto(targetPath);
}

export async function ensureApprovedUser(request: APIRequestContext, userKey: StandardTestUserKey) {
  const adminLoginResponse = await request.post('/api/auth/login', {
    data: {
      username: TEST_USERS.admin.username,
      password: TEST_USERS.admin.password,
    },
  });
  expect(adminLoginResponse.ok()).toBeTruthy();

  const adminLoginBody = await adminLoginResponse.json();
  const authHeaders = {
    Authorization: `Bearer ${adminLoginBody.token}`,
  };

  const createUserResponse = await request.post('/api/admin/users', {
    headers: authHeaders,
    data: TEST_USERS[userKey],
  });

  if (createUserResponse.status() === 201) {
    return;
  }

  if (createUserResponse.status() === 400) {
    const errorBody = await createUserResponse.json();
    const acceptableDuplicateCodes = new Set([
      'serverErrors.admin.usernameTaken',
      'serverErrors.admin.emailTaken',
    ]);

    expect(acceptableDuplicateCodes.has(errorBody?.errorCode)).toBeTruthy();
    return;
  }

  expect(createUserResponse.ok()).toBeTruthy();
}
