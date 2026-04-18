import { expect, test } from '@playwright/test';

import { ensureApprovedUser, loginAsUser, getTestSuffix } from './helpers/auth';

test.describe('MyPage user shell', () => {
  test('E2E-MYPAGE-001 authenticated user can open MyPage', async ({ page, request }, testInfo) => {
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsUser(page, 'user1', suffix);

    await page.goto('/mypage');

    await expect(page.getByRole('button', { name: /close/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /log out/i })).toBeVisible();
  });

  test('E2E-MYPAGE-002 close button returns user to file area', async ({ page, request }, testInfo) => {
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsUser(page, 'user1', suffix);

    await page.goto('/mypage');
    await page.getByRole('button', { name: /close/i }).click();

    await expect(page).toHaveURL(/\/files(?:\/.*)?$/);
    await expect(page.getByRole('button', { name: /log out/i })).toHaveCount(0);
  });

  test('E2E-MYPAGE-003 logout clears session', async ({ page, request }, testInfo) => {
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsUser(page, 'user1', suffix);

    await page.goto('/mypage');

    await page.getByRole('button', { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test('E2E-MYPAGE-011 mobile drawer open/close', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'mobile') {
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

  test('E2E-MYPAGE-012 mobile drawer category selection', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'mobile') {
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
});

