import { expect, test } from '@playwright/test';

import { ensureApprovedUser, loginAsUser } from './helpers/auth';

test.describe('MyPage user shell', () => {
  test('E2E-MYPAGE-001 authenticated user can open MyPage', async ({ page, request }) => {
    await ensureApprovedUser(request, 'user1');
    await loginAsUser(page, 'user1');

    await page.goto('/mypage');

    await expect(page.getByRole('button', { name: /close/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /log out/i })).toBeVisible();
  });

  test('E2E-MYPAGE-002 close button returns user to file area', async ({ page, request }) => {
    await ensureApprovedUser(request, 'user1');
    await loginAsUser(page, 'user1');

    await page.goto('/mypage');
    await page.getByRole('button', { name: /close/i }).click();

    await expect(page).toHaveURL(/\/files(?:\/.*)?$/);
    await expect(page.getByRole('button', { name: /log out/i })).toHaveCount(0);
  });

  test('E2E-MYPAGE-003 logout clears session', async ({ page, request }) => {
    await ensureApprovedUser(request, 'user1');
    await loginAsUser(page, 'user1');

    await page.goto('/mypage');

    await page.getByRole('button', { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });
});

