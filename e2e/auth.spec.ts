import { expect, Page, test } from '@playwright/test';
import { TEST_USERS } from './fixtures/test-data';
import { ensureApprovedUser, ensurePendingUser, ensureRejectedUser, gotoAsAnonymous, loginAsAdmin, loginAsUser, setRegistrationEnabled, getTestSuffix } from './helpers/auth';

test.describe.configure({ mode: 'serial' });

async function expectLoginFormVisible(page: Page) {
  await expect(page.locator('input[name="username"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();
  await expect(page.locator('form button[type="submit"]')).toBeVisible();
}

async function submitLogin(page: Page, username: string, password: string) {
  await expectLoginFormVisible(page);
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
}

test('redirects anonymous /files access to the login page', async ({ page }) => {
  await gotoAsAnonymous(page, '/files');

  await expect(page).toHaveURL(/\/login$/);
  await expectLoginFormVisible(page);
});

test('redirects anonymous /mypage access to the login page', async ({ page }) => {
  await gotoAsAnonymous(page, '/mypage');

  await expect(page).toHaveURL(/\/login$/);
  await expectLoginFormVisible(page);
});

test('renders the login form on /login', async ({ page }) => {
  await gotoAsAnonymous(page);

  await expect(page).toHaveURL(/\/login$/);
  await expectLoginFormVisible(page);
});

test('logs in as admin and lands in the explorer', async ({ page }) => {
  await loginAsAdmin(page);

  await expect(page).toHaveURL(/\/files(?:\/.*)?$/);
  await expect(page.getByTestId('file-actions-fab')).toBeVisible();
});

test('logs in as a standard user and lands in the user home path', async ({ page, request }, testInfo) => {
  const suffix = getTestSuffix(testInfo);
  await ensureApprovedUser(request, 'user1', suffix);
  await loginAsUser(page, 'user1', suffix);

  await expect(page).toHaveURL(new RegExp(`/files/user1_${suffix}$`));
  await expect(page.getByTestId('file-actions-fab')).toBeVisible();
});

test('shows a visible error for invalid credentials', async ({ page }) => {
  await page.goto('/login');
  await submitLogin(page, 'admin', 'wrong-password');

  const alert = page.getByRole('alert');
  await expect(page).toHaveURL(/\/login$/);
  await expect(alert).toBeVisible();
});

test('E2E-AUTH-007 shows warning for pending account login', async ({ page, request }, testInfo) => {
  const suffix = getTestSuffix(testInfo);
  await ensurePendingUser(request, 'user2', suffix);
  await page.goto('/login');
  await submitLogin(page, `${TEST_USERS.user2.username}_${suffix}`, TEST_USERS.user2.password);

  const warning = page.locator('text=Your account is pending approval');
  await expect(page).toHaveURL(/\/login$/);
  await expect(warning).toBeVisible();
});

test('E2E-AUTH-008 shows error for rejected account login', async ({ page, request }, testInfo) => {
  const suffix = getTestSuffix(testInfo);
  await ensureRejectedUser(request, 'user3', suffix);
  await page.goto('/login');
  await submitLogin(page, `${TEST_USERS.user3.username}_${suffix}`, TEST_USERS.user3.password);

  const alert = page.getByRole('alert');
  await expect(page).toHaveURL(/\/login$/);
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('registration has been rejected');
});

test('E2E-AUTH-009 register page availability follows public settings', async ({ page, request }) => {
  // Test Enabled
  await setRegistrationEnabled(request, true);
  await page.goto('/register');
  await expect(page.locator('form')).toBeVisible();

  // Test Disabled
  await setRegistrationEnabled(request, false);
  await page.goto('/register');
  
  // Submit form to trigger the 'registrationDisabled' error
  await page.locator('input[name="username"]').fill('disabled-test');
  await page.locator('input[name="email"]').fill('disabled-test@example.com');
  await page.locator('input[name="password"]').fill('password123');
  await page.locator('input[name="confirmPassword"]').fill('password123');
  await page.locator('form button[type="submit"]').click();

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Registration is currently disabled');
});

test('E2E-AUTH-010 registration success shows success state', async ({ page, request }) => {
  await setRegistrationEnabled(request, true);
  await page.goto('/register');
  
  await page.locator('input[name="username"]').fill('reg-test-user' + Date.now());
  await page.locator('input[name="email"]').fill(`reg-test-${Date.now()}@example.com`);
  await page.locator('input[name="password"]').fill('password123');
  await page.locator('input[name="confirmPassword"]').fill('password123');
  await page.locator('form button[type="submit"]').click();

  const successTitle = page.locator('text=Registration complete!');
  await expect(successTitle).toBeVisible();
  await expect(page).not.toHaveURL(/\/files/);
});
