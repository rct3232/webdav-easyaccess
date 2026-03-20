import { expect, Page, test } from '@playwright/test';

import { ensureApprovedUser, gotoAsAnonymous, loginAsAdmin, loginAsUser } from './helpers/auth';

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

test('logs in as a standard user and lands in the user home path', async ({ page, request }) => {
  await ensureApprovedUser(request, 'user1');
  await loginAsUser(page, 'user1');

  await expect(page).toHaveURL(/\/files\/user1$/);
  await expect(page.getByTestId('file-actions-fab')).toBeVisible();
});

test('shows a visible error for invalid credentials', async ({ page }) => {
  await page.goto('/login');
  await submitLogin(page, 'admin', 'wrong-password');

  const alert = page.getByRole('alert');
  await expect(page).toHaveURL(/\/login$/);
  await expect(alert).toBeVisible();
});
