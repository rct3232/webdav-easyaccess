import { APIRequestContext, expect, Page } from '@playwright/test';

import { TEST_USERS } from '../fixtures/test-data';

type TestUserKey = 'admin' | 'user1' | 'user2' | 'user3';
type StandardTestUserKey = Exclude<TestUserKey, 'admin'>;

export function getTestSuffix(testInfo: any) {
  const base = `${testInfo.project.name}_${testInfo.title.replace(/\s+/g, '_').toLowerCase()}`;
  // Attempt-unique identity (docs/TESTING_STRATEGY.md): a case that permanently
  // mutates the derived user (e.g. a password change) otherwise cannot be retried —
  // the retry finds the user already exists and logs in with the stale password.
  // `testInfo.retry` is constant within an attempt, so all helper calls in one
  // attempt resolve to the same user. First-attempt names stay unchanged.
  return testInfo.retry > 0 ? `${base}_r${testInfo.retry}` : base;
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

/**
 * Race-free anonymous reset. The previous flow (goto `/` → clear cookies +
 * storage on the LIVE document) was structurally racy: `/` boots the
 * authenticated home (App.js `/`→`/files` PrivateRoute), and `page.goto`
 * resolves on `load` while the async auth bootstrap is still in flight
 * (`GET /auth/me` from useAuthSession, the MigrationGuard status poll).
 * Clearing sessionStorage underneath the running app turns any of those
 * in-flight 401s into apiClient's refresh-failure path
 * (authNavigationPolicy `handle401RefreshFailure` → hard
 * `window.location.href = '/login'`), an app-originated navigation that
 * intermittently aborts the caller's follow-up goto ("navigation interrupted
 * by another navigation" / ERR_ABORTED) — hit/miss depended on server latency.
 *
 * New mechanism: the app never observes a token being invalidated.
 *  1. `context.clearCookies()` — context-level, touches no document.
 *  2. A one-shot document-start wipe via `addInitScript`: the NEXT navigation
 *     (the caller's target) clears localStorage + sessionStorage before the
 *     bundle runs, so the app boots anonymous — no authenticated-home
 *     bootstrap, no `/login` redirect while a navigation is pending. Any
 *     PrivateRoute `<Navigate to="/login">` happens after the target commit
 *     as a same-document replace and cannot abort a navigation.
 *  3. One-shot semantics are preserved via a marker cookie (re-armed by the
 *     clearCookies in step 1 of every reset): later full page-loads (e.g. a
 *     subsequent login + reload in the same test) are NOT re-wiped, exactly
 *     like the old evaluate-based one-time clear.
 */
const ANONYMOUS_RESET_MARKER = 'wea-e2e-anonymous-reset';

async function clearBrowserSession(page: Page) {
  const context = page.context();
  await context.clearCookies();
  await context.addInitScript((marker: string) => {
    try {
      if (document.cookie.split(';').some((c) => c.trim() === `${marker}=1`)) return;
      window.localStorage.clear();
      window.sessionStorage.clear();
      document.cookie = `${marker}=1; path=/`;
    } catch {
      // about:blank / opaque-origin document: nothing to wipe or mark.
    }
  }, ANONYMOUS_RESET_MARKER);
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

/**
 * Switch the page to an anonymous session and land on `targetPath`: cookies
 * and the app's localStorage/sessionStorage tokens are neutralized for this
 * and all subsequent navigations (see clearBrowserSession for the race-free
 * settlement mechanism). Protected targets settle on `/login` via the
 * anonymous-boot PrivateRoute redirect.
 */
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

  let registerResponse = await request.post('/api/auth/register', {
    data: {
      username: user.username,
      email: user.email,
      password: user.password,
    },
  });

  // Self-heal a racing disable: the registration-settings spec (single
  // desktop-project owner) may flip the GLOBAL setting between our set-true
  // and this POST — restore and retry once.
  if (registerResponse.status() === 403) {
    await setRegistrationEnabled(request, true);
    registerResponse = await request.post('/api/auth/register', {
      data: {
        username: user.username,
        email: user.email,
        password: user.password,
      },
    });
  }

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
