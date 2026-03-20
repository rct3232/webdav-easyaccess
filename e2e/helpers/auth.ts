import { expect, Page } from '@playwright/test';

import { TEST_USERS } from '../fixtures/test-data';

export async function loginAsAdmin(page: Page) {
  await page.goto('/login');

  const usernameInput = page.locator('input[name="username"]');
  await expect(usernameInput).toBeVisible();

  await usernameInput.fill(TEST_USERS.admin.username);
  await page.locator('input[name="password"]').fill(TEST_USERS.admin.password);

  await Promise.all([
    page.waitForURL(/\/files(?:\/.*)?$/),
    page.locator('form button[type="submit"]').click(),
  ]);

  await expect(page.getByTestId('file-actions-fab')).toBeVisible();
}
