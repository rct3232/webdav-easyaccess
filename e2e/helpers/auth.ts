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

export async function gotoAsAnonymousShare(page: Page, shareToken: string) {
  await gotoAsAnonymous(page, `/share/${shareToken}`);
}

export async function gotoAsLoggedInShare(page: Page, shareToken: string, userKey: StandardTestUserKey) {
  await loginAsUser(page, userKey);
  await page.goto(`/share/${shareToken}`);
}

async function ensureUserCanLogin(request: APIRequestContext, userKey: StandardTestUserKey) {
  const user = TEST_USERS[userKey];
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const loginResponse = await request.post('/api/auth/login', {
      data: {
        username: user.username,
        password: user.password,
      },
    });

    if (loginResponse.ok()) {
      return;
    }

    if (attempt === maxAttempts) {
      expect(loginResponse.ok()).toBeTruthy();
      return;
    }

    const delayMs = 300 * attempt;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
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

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const createUserResponse = await request.post('/api/admin/users', {
      headers: authHeaders,
      data: TEST_USERS[userKey],
    });

    if (createUserResponse.status() === 201) {
      await ensureUserCanLogin(request, userKey);
      return;
    }

    if (createUserResponse.status() === 400) {
      const errorBody = await createUserResponse.json();
      const acceptableDuplicateCodes = new Set([
        'serverErrors.admin.usernameTaken',
        'serverErrors.admin.emailTaken',
      ]);

      expect(acceptableDuplicateCodes.has(errorBody?.errorCode)).toBeTruthy();
      await ensureUserCanLogin(request, userKey);
      return;
    }

    // Retryable infra-ish failures (rate limiting / transient backend errors).
    if (createUserResponse.status() === 429 || createUserResponse.status() >= 500) {
      const delayMs = 600 * attempt;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    // If the user already exists but the backend returns a different conflict shape,
    // treat it as "already ensured" rather than failing the suite.
    if (createUserResponse.status() === 409) {
      await ensureUserCanLogin(request, userKey);
      return;
    }

    expect(createUserResponse.ok()).toBeTruthy();
  }
}
