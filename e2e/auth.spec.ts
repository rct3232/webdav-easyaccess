import { expect, Page, test } from '@playwright/test';
import { TEST_USERS } from './fixtures/test-data';
import {
  ensureApprovedUser,
  ensurePendingUser,
  ensureRejectedUser,
  gotoAsAnonymous,
  loginAsUser,
  getTestSuffix,
} from './helpers/auth';

/**
 * E2E-AUTH-001..007 — login entry and protected-route gating: anonymous
 * redirects from `/files` and `/mypage`, the login form itself, the successful
 * standard-user landing and the invalid-credential / pending / rejected error
 * surfaces.
 *
 * Owning projects: `s3-desktop` and `s3-mobile` (every case runs on both
 * platforms) against the SHARED stack — API `:5002` + client `:3000` with the
 * shared database; the users each case needs are seeded through the API by the
 * fixtures, so no scratch server is booted here.
 */

test.describe.configure({ mode: 'serial' });

// The shared client dev server compiles the login bundle on the first browser
// request. A cold release run starts desktop and mobile projects together, so
// login-page readiness gets an explicit budget instead of the 15s global
// expectation (which stays sensitive for product UI states).
const LOGIN_FORM_TIMEOUT = 30_000;

async function expectLoginFormVisible(page: Page) {
  await expect(page.locator('input[name="username"]')).toBeVisible({
    timeout: LOGIN_FORM_TIMEOUT,
  });
  await expect(page.locator('input[name="password"]')).toBeVisible({
    timeout: LOGIN_FORM_TIMEOUT,
  });
  await expect(page.locator('form button[type="submit"]')).toBeVisible({
    timeout: LOGIN_FORM_TIMEOUT,
  });
}

async function submitLogin(page: Page, username: string, password: string) {
  await expectLoginFormVisible(page);
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
}

test('E2E-AUTH-001: Redirect unauthenticated user from `/files` to `/login`', async ({ page }) => {
  await gotoAsAnonymous(page, '/files');

  await expect(page).toHaveURL(/\/login$/);
  await expectLoginFormVisible(page);
});

test('E2E-AUTH-002: Redirect unauthenticated user from `/mypage` to `/login`', async ({ page }) => {
  await gotoAsAnonymous(page, '/mypage');

  await expect(page).toHaveURL(/\/login$/);
  await expectLoginFormVisible(page);
});

test('E2E-AUTH-003: Login page loads and renders form', async ({ page }) => {
  await gotoAsAnonymous(page);

  await expect(page).toHaveURL(/\/login$/);
  await expectLoginFormVisible(page);
});

test('E2E-AUTH-004: Successful standard-user login lands in user-owned explorer path', async ({
  page,
  request,
}, testInfo) => {
  const suffix = getTestSuffix(testInfo);
  await ensureApprovedUser(request, 'user1', suffix);
  await loginAsUser(page, 'user1', suffix);

  await expect(page).toHaveURL(/\/files(?:\/node\/\d+)?$/);
  await expect(page.getByTestId('file-actions-fab')).toBeVisible();
});

test('E2E-AUTH-005: Invalid credentials show login failure', async ({ page }) => {
  await page.goto('/login');
  await submitLogin(page, 'admin', 'wrong-password');

  const alert = page.getByRole('alert');
  await expect(page).toHaveURL(/\/login$/);
  await expect(alert).toBeVisible();
});

test('E2E-AUTH-006: Pending account login shows warning', async ({ page, request }, testInfo) => {
  const suffix = getTestSuffix(testInfo);
  await ensurePendingUser(request, 'user2', suffix);
  await page.goto('/login');
  await submitLogin(page, `${TEST_USERS.user2.username}_${suffix}`, TEST_USERS.user2.password);

  const warning = page.locator('text=Your account is pending approval');
  await expect(page).toHaveURL(/\/login$/);
  await expect(warning).toBeVisible();
});

test('E2E-AUTH-007: Rejected account login shows rejection error', async ({
  page,
  request,
}, testInfo) => {
  const suffix = getTestSuffix(testInfo);
  await ensureRejectedUser(request, 'user3', suffix);
  await page.goto('/login');
  await submitLogin(page, `${TEST_USERS.user3.username}_${suffix}`, TEST_USERS.user3.password);

  const alert = page.getByRole('alert');
  await expect(page).toHaveURL(/\/login$/);
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('registration has been rejected');
});
