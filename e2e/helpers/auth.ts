import { APIRequestContext, expect, Page } from '@playwright/test';

import { TEST_USERS } from '../fixtures/test-data';

type TestUserKey = 'admin' | 'user1' | 'user2' | 'user3';
type StandardTestUserKey = Exclude<TestUserKey, 'admin'>;

export function getTestSuffix(testInfo: any) {
  return `${testInfo.project.name}_${testInfo.title.replace(/\s+/g, '_').toLowerCase()}`;
}

function getUserData(userKey: TestUserKey, suffix?: string) {
  const user = TEST_USERS[userKey];
  if (!suffix) return user;

  const [local, domain] = user.email.split('@');
  return {
    ...user,
    username: `${user.username}_${suffix}`,
    email: `${local}_${suffix}@${domain}`,
  };
}

async function clearBrowserSession(page: Page) {
  await page.goto('/');
  await page.context().clearCookies();
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}

async function loginAs(page: Page, userKey: TestUserKey, suffix?: string) {
  const user = getUserData(userKey, suffix);
  await loginWithCredentials(page, user.username, user.password);
}

/**
 * UI login form-fill shared by the auth helpers and the hermetic scratch specs
 * (setup-wizard/admin-config/migration): goto `/login`, fill username/password,
 * submit and wait for the explorer URL.
 */
export async function loginWithCredentials(page: Page, username: string, password: string) {
  await page.goto('/login');

  const usernameInput = page.locator('input[name="username"]');
  await expect(usernameInput).toBeVisible();

  await usernameInput.fill(username);
  await page.locator('input[name="password"]').fill(password);

  await Promise.all([
    page.waitForURL(/\/files(?:\/.*)?$/),
    page.locator('form button[type="submit"]').click(),
  ]);
}

export async function loginAsAdmin(page: Page) {
  await loginAs(page, 'admin');

  await expect(page.getByTestId('file-actions-fab')).toBeVisible();
}

export async function loginAsUser(page: Page, userKey: StandardTestUserKey, suffix?: string) {
  await loginAs(page, userKey, suffix);
}

export async function gotoAsAnonymous(page: Page, targetPath = '/login') {
  await clearBrowserSession(page);
  await page.goto(targetPath);
}

export async function gotoAsAnonymousShare(page: Page, shareToken: string) {
  await gotoAsAnonymous(page, `/share/${shareToken}`);
}

export async function gotoAsLoggedInShare(
  page: Page,
  shareToken: string,
  userKey: StandardTestUserKey,
  suffix?: string
) {
  await loginAsUser(page, userKey, suffix);
  await page.goto(`/share/${shareToken}`);
}

async function ensureUserCanLogin(
  request: APIRequestContext,
  userKey: StandardTestUserKey,
  suffix?: string
) {
  const user = getUserData(userKey, suffix);
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

export async function loginAsUserApi(
  request: APIRequestContext,
  userKey: StandardTestUserKey,
  suffix?: string
): Promise<string> {
  const user = getUserData(userKey, suffix);
  const response = await request.post('/api/auth/login', {
    data: { username: user.username, password: user.password },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return body.token as string;
}

export async function getAdminToken(request: APIRequestContext) {
  const response = await request.post('/api/auth/login', {
    data: {
      username: TEST_USERS.admin.username,
      password: TEST_USERS.admin.password,
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return body.token;
}

export async function setRegistrationEnabled(request: APIRequestContext, enabled: boolean) {
  const token = await getAdminToken(request);
  const response = await request.put('/api/admin/settings', {
    headers: { Authorization: `Bearer ${token}` },
    data: { registration_enabled: String(enabled) },
  });
  expect(response.ok()).toBeTruthy();
}

export async function deleteUser(
  request: APIRequestContext,
  userKey: StandardTestUserKey,
  suffix?: string
) {
  const token = await getAdminToken(request);
  const user = getUserData(userKey, suffix);

  const usersResponse = await request.get('/api/admin/users', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(usersResponse.ok()).toBeTruthy();
  const users = await usersResponse.json();
  const targetUser = users.find((u: any) => u.username === user.username);

  if (targetUser) {
    await request.delete(`/api/admin/users/${targetUser.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}

export async function ensurePendingUser(
  request: APIRequestContext,
  userKey: StandardTestUserKey,
  suffix?: string
) {
  await deleteUser(request, userKey, suffix);
  await setRegistrationEnabled(request, true);
  const user = getUserData(userKey, suffix);

  const registerResponse = await request.post('/api/auth/register', {
    data: {
      username: user.username,
      email: user.email,
      password: user.password,
    },
  });

  if (registerResponse.status() === 201) {
    return;
  }

  if (registerResponse.status() === 400 || registerResponse.status() === 409) {
    const body = await registerResponse.json();
    if (
      body.errorCode === 'serverErrors.auth.usernameTaken' ||
      body.errorCode === 'serverErrors.auth.emailTaken'
    ) {
      return;
    }
  }

  expect(registerResponse.ok()).toBeTruthy();
}

export async function ensureRejectedUser(
  request: APIRequestContext,
  userKey: StandardTestUserKey,
  suffix?: string
) {
  await ensurePendingUser(request, userKey, suffix);

  const token = await getAdminToken(request);
  const user = getUserData(userKey, suffix);

  const usersResponse = await request.get('/api/admin/users', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(usersResponse.ok()).toBeTruthy();
  const users = await usersResponse.json();
  const targetUser = users.find((u: any) => u.username === user.username);
  expect(targetUser).toBeDefined();

  const rejectResponse = await request.post(`/api/admin/users/${targetUser.id}/reject`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!rejectResponse.ok()) {
    const errorBody = await rejectResponse.text();
    console.error(`Reject API failed with status ${rejectResponse.status()}: ${errorBody}`);
  }
  expect(rejectResponse.ok()).toBeTruthy();
}

export async function ensureApprovedUser(
  request: APIRequestContext,
  userKey: StandardTestUserKey,
  suffix?: string
) {
  const token = await getAdminToken(request);
  const authHeaders = {
    Authorization: `Bearer ${token}`,
  };

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const createUserResponse = await request.post('/api/admin/users', {
      headers: authHeaders,
      data: getUserData(userKey, suffix),
    });

    if (createUserResponse.status() === 201) {
      await ensureUserCanLogin(request, userKey, suffix);
      return;
    }

    if (createUserResponse.status() === 400) {
      const errorBody = await createUserResponse.json();
      const acceptableDuplicateCodes = new Set([
        'serverErrors.admin.usernameTaken',
        'serverErrors.admin.emailTaken',
      ]);

      expect(acceptableDuplicateCodes.has(errorBody?.errorCode)).toBeTruthy();
      await ensureUserCanLogin(request, userKey, suffix);
      return;
    }

    if (createUserResponse.status() === 429 || createUserResponse.status() >= 500) {
      const delayMs = 600 * attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    if (createUserResponse.status() === 409) {
      await ensureUserCanLogin(request, userKey, suffix);
      return;
    }

    expect(createUserResponse.ok()).toBeTruthy();
  }
}
