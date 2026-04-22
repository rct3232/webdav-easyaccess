import { expect, test } from '@playwright/test';

import {
  ensureApprovedUser,
  ensurePendingUser,
  loginAsAdmin,
  getTestSuffix,
} from './helpers/auth';
import { buildName } from './helpers/files';

const LATER_WAVES_FLAG = process.env.E2E_LATER_WAVES;

// ============================================================
// Desktop admin tests (sidebar-based navigation)
// ============================================================
test.describe('MyPage admin flows - desktop', () => {
  test('E2E-ADMIN-001: /admin redirects to admin MyPage category', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'desktop') {
      test.skip();
    }
    test.skip(!LATER_WAVES_FLAG, 'Wave 7 gated behind E2E_LATER_WAVES=1');

    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsAdmin(page);

    await page.goto('/admin');

    await expect(page).toHaveURL(/\/mypage$/);
    await expect(page.getByRole('heading', { level: 6, name: /Users/i, exact: false })).toBeVisible();
  });

  test('E2E-ADMIN-002: Admin sees user-management and system-settings categories', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'desktop') {
      test.skip();
    }
    test.skip(!LATER_WAVES_FLAG, 'Wave 7 gated behind E2E_LATER_WAVES=1');

    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');

    const sidebar = page.locator('.MuiList-root').first();

    await expect(sidebar.getByRole('button', { name: /Users/i })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /System settings/i })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /Preferences/i })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /Share management/i })).toHaveCount(0);

    await sidebar.getByRole('button', { name: /System settings/i }).click();
    await expect(page.getByRole('heading', { level: 6, name: /System settings/i })).toBeVisible();

    await sidebar.getByRole('button', { name: /Users/i }).click();
    await expect(page.getByRole('heading', { level: 6, name: /Users/i, exact: false })).toBeVisible();
  });

  test('E2E-ADMIN-003: Approve pending signup', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'desktop') {
      test.skip();
    }
    test.skip(!LATER_WAVES_FLAG, 'Wave 7 gated behind E2E_LATER_WAVES=1');

    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await ensurePendingUser(request, 'user2', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');

    const sidebar = page.locator('.MuiList-root').first();
    await sidebar.getByRole('button', { name: /Users/i }).click();

    await expect(page.getByRole('heading', { level: 6, name: /Users/i })).toBeVisible();

    const pendingUserCard = page.getByText('Pending', { exact: true }).first();
    await expect(pendingUserCard).toBeVisible();

    const pendingUsername = await pendingUserCard.evaluate((el) => {
      const card = el.closest('[class*="Card"]');
      return card ? card.querySelector('h6')?.textContent?.trim() || card.querySelector('[class*="Typography"]')?.textContent?.trim() : '';
    });
    expect(pendingUsername).toBeTruthy();

    const approveButton = page.getByRole('button', { name: 'Approve' }).first();
    await expect(approveButton).toBeVisible();

    const approveResponse = page.waitForResponse(
      (res) => res.url().includes('/admin/users/') && res.url().includes('/approve') && res.status() === 200,
      { timeout: 10000 },
    );

 await approveButton.click();

    await approveResponse;

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText(/has been approved/i)).toBeVisible();

    const approvedUserCard = page.locator('[class*="Card"]').filter({ hasText: pendingUsername! }).filter({ hasText: 'Approved' }).first();
    await expect(approvedUserCard.locator('[class*="Chip-label"]', { hasText: 'Approved' })).toBeVisible();
    await expect(approvedUserCard.locator('[class*="Chip-label"]', { hasText: 'User' })).toBeVisible();
    await expect(approvedUserCard.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(approvedUserCard.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  });

  test('E2E-ADMIN-004: Reject pending signup', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'desktop') {
      test.skip();
    }
    test.skip(!LATER_WAVES_FLAG, 'Wave 7 gated behind E2E_LATER_WAVES=1');

    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await ensurePendingUser(request, 'user3', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');

    const sidebar = page.locator('.MuiList-root').first();
    await sidebar.getByRole('button', { name: /Users/i }).click();

    await expect(page.getByRole('heading', { level: 6, name: /Users/i })).toBeVisible();

    const pendingUserCard = page.getByText('Pending', { exact: true }).first();
    await expect(pendingUserCard).toBeVisible();

    const pendingUsername = await pendingUserCard.evaluate((el) => {
      const card = el.closest('[class*="Card"]');
      return card ? card.querySelector('h6')?.textContent?.trim() || card.querySelector('[class*="Typography"]')?.textContent?.trim() : '';
    });
    expect(pendingUsername).toBeTruthy();

    const rejectButton = page.getByRole('button', { name: 'Reject' }).first();
    await expect(rejectButton).toBeVisible();

    const rejectResponse = page.waitForResponse(
      (res) => res.url().includes('/admin/users/') && res.url().includes('/reject') && res.status() === 200,
      { timeout: 10000 },
    );

    await rejectButton.click();

    await rejectResponse;

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText(/has been rejected/i)).toBeVisible();

    const rejectedUserCard = page.locator('[class*="Card"]').filter({ hasText: pendingUsername! }).filter({ hasText: 'Rejected' }).first();
    await expect(rejectedUserCard.locator('[class*="Chip-label"]', { hasText: 'Rejected' })).toBeVisible();
    await expect(rejectedUserCard.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(rejectedUserCard.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  });

  test('E2E-ADMIN-005: Create user from admin UI', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'desktop') {
      test.skip();
    }
    test.skip(!LATER_WAVES_FLAG, 'Wave 7 gated behind E2E_LATER_WAVES=1');

    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');

    const sidebar = page.locator('.MuiList-root').first();
    await sidebar.getByRole('button', { name: /Users/i }).click();

    const addIconButton = page.getByRole('button', { name: /Add/i }).first();
    await expect(addIconButton).toBeVisible();

    await addIconButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const usernameInput = dialog.getByLabel(/Username/i);
    await expect(usernameInput).toBeVisible();

    const emailInput = dialog.getByLabel(/Email/i);
    await expect(emailInput).toBeVisible();

    const passwordInputs = dialog.locator('input[type="password"]');
    await expect(passwordInputs).toHaveCount(2);

    const shortSuffix = testInfo.title.replace(/[^a-zA-Z0-9]/g, '').slice(0, 15);
    const newUserSuffix = `au${shortSuffix}`;
    await usernameInput.fill(newUserSuffix);
    await emailInput.fill(`${newUserSuffix}@test.com`);
    await passwordInputs.first().fill('password123');
    await passwordInputs.last().fill('password123');

    const addUserResponse = page.waitForResponse(
      (res) => res.url().includes('/admin/users') && res.status() === 201,
      { timeout: 10000 },
    );

    await dialog.getByRole('button', { name: /Add/i }).click();

    await addUserResponse;

    await expect(page.getByText(/has been added/i)).toBeVisible();

    await expect(page.getByText(newUserSuffix, { exact: true })).toBeVisible();

    const newUserCard = page.locator('[class*="Card"]').filter({ hasText: newUserSuffix }).filter({ hasText: 'Approved' }).first();
    await expect(newUserCard.locator('[class*="Chip-label"]', { hasText: 'Approved' })).toBeVisible();
    await expect(newUserCard.locator('[class*="Chip-label"]', { hasText: 'User' })).toBeVisible();
  });

  test('E2E-ADMIN-006: Delete standard user from admin UI', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'desktop') {
      test.skip();
    }
    test.skip(!LATER_WAVES_FLAG, 'Wave 7 gated behind E2E_LATER_WAVES=1');

    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await ensureApprovedUser(request, 'user2', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');

    const sidebar = page.locator('.MuiList-root').first();
    await sidebar.getByRole('button', { name: /Users/i }).click();

    await expect(page.getByRole('heading', { level: 6, name: /Users/i })).toBeVisible();

    const testCard = page.locator('[class*="Card"]').filter({ hasText: suffix }).first();
    await expect(testCard).toBeVisible();

    const deleteUsername = await testCard.evaluate((el) => {
      const h6 = el.querySelector('h6');
      return h6 ? h6.textContent?.trim() || '' : '';
    });
    expect(deleteUsername).toBeTruthy();

    const deleteButton = testCard.getByRole('button', { name: /Delete user/i }).first();
    await expect(deleteButton).toBeVisible();

    await deleteButton.click();

    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByRole('button', { name: /Delete/i })).toBeVisible();

    const deleteResponse = page.waitForResponse(
      (res) => res.url().includes('/admin/users/') && res.request().method() === 'DELETE' && res.status() === 200,
      { timeout: 10000 },
    );

    await confirmDialog.getByRole('button', { name: /Delete/i }).click();

    await deleteResponse;

    await expect(page.getByText(/account has been deleted/i)).toBeVisible();
  });

  test('E2E-ADMIN-007: Toggle registration-related settings', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'desktop') {
      test.skip();
    }
    test.skip(!LATER_WAVES_FLAG, 'Wave 7 gated behind E2E_LATER_WAVES=1');

    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');

    const sidebar = page.locator('.MuiList-root').first();
    await sidebar.getByRole('button', { name: /System settings/i }).click();

    await expect(page.getByRole('heading', { level: 6, name: /System settings/i })).toBeVisible();

    const registrationSwitch = page.getByRole('switch').first();
    await expect(registrationSwitch).toBeVisible();

    const currentChecked = await registrationSwitch.isChecked();

    await registrationSwitch.click();
    await expect(page.getByText(/Registration setting saved/i)).toBeVisible();
  });

  test('E2E-ADMIN-008: Cleanup actions show confirmation and completion feedback', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'desktop') {
      test.skip();
    }
    test.skip(!LATER_WAVES_FLAG, 'Wave 7 gated behind E2E_LATER_WAVES=1');

    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');

    const sidebar = page.locator('.MuiList-root').first();
    await sidebar.getByRole('button', { name: /System settings/i }).click();

    await expect(page.getByRole('heading', { level: 6, name: /System settings/i })).toBeVisible();

    const cleanupIcon = page.locator('button[aria-label="Clean up"]');
    await cleanupIcon.scrollIntoViewIfNeeded();
    await cleanupIcon.click();

    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByRole('heading', { name: /Confirm/i })).toBeVisible();

    await confirmDialog.getByRole('button', { name: /Clean up/i }).click();

    await expect(page.getByRole('alert')).toBeVisible();
  });
});

// ============================================================
// Mobile admin tests (drawer-based navigation)
// ============================================================
test.describe('MyPage admin flows - mobile', () => {
  test.describe.serial(() => {
  test('E2E-ADMIN-001: /admin redirects to admin MyPage category (mobile)', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'mobile') {
      test.skip();
    }
    test.skip(!LATER_WAVES_FLAG, 'Wave 7 gated behind E2E_LATER_WAVES=1');

    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsAdmin(page);

    await page.goto('/admin');

    await expect(page).toHaveURL(/\/mypage$/);

    const menuButton = page.locator('button[aria-label="My page"]');
    await menuButton.click();

    const drawer = page.locator('.MuiDrawer-paper').filter({ has: page.getByText(/Users/i) });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/Users/i)).toBeVisible();
    await expect(drawer.getByText(/System settings/i)).toBeVisible();
    await expect(drawer.getByText(/Preferences/i)).toBeVisible();
    await expect(drawer.getByText(/Share management/i)).toHaveCount(0);

    await drawer.getByRole('button', { name: /Users/i }).click();
    await expect(drawer).not.toBeVisible();
    await expect(page.getByRole('heading', { level: 6, name: /Users/i, exact: false })).toBeVisible();
  });

  test('E2E-ADMIN-002: Admin sees user-management and system-settings categories (mobile)', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'mobile') {
      test.skip();
    }
    test.skip(!LATER_WAVES_FLAG, 'Wave 7 gated behind E2E_LATER_WAVES=1');

    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');

    const menuButton = page.locator('button[aria-label="My page"]');
    await expect(menuButton).toBeVisible();

    const drawer = page.locator('.MuiDrawer-paper');
    await menuButton.click();
    await expect(drawer).toBeVisible();

    await expect(drawer.getByRole('button', { name: /Users/i })).toBeVisible();
    await expect(drawer.getByRole('button', { name: /System settings/i })).toBeVisible();
    await expect(drawer.getByRole('button', { name: /Preferences/i })).toBeVisible();
    await expect(drawer.getByRole('button', { name: /Share management/i })).toHaveCount(0);

    await drawer.getByRole('button', { name: /System settings/i }).click();
    await expect(drawer).not.toBeVisible();
    await expect(page.getByRole('heading', { level: 6, name: /System settings/i })).toBeVisible();

    await menuButton.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: /Users/i }).click();
    await expect(drawer).not.toBeVisible();
    await expect(page.getByRole('heading', { level: 6, name: /Users/i, exact: false })).toBeVisible();
  });

  test('E2E-ADMIN-003: Approve pending signup (mobile)', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'mobile') {
      test.skip();
    }
    test.skip(!LATER_WAVES_FLAG, 'Wave 7 gated behind E2E_LATER_WAVES=1');

    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await ensurePendingUser(request, 'user2', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');

    const menuButton = page.locator('button[aria-label="My page"]');
    const drawer = page.locator('.MuiDrawer-paper');

    await menuButton.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: /Users/i }).click();
    await expect(drawer).not.toBeVisible();

    await expect(page.getByRole('heading', { level: 6, name: /Users/i })).toBeVisible();

    const pendingUserCard = page.getByText('Pending', { exact: true }).first();
    await expect(pendingUserCard).toBeVisible();

    const pendingUsername = await pendingUserCard.evaluate((el) => {
      const card = el.closest('[class*="Card"]');
      return card ? card.querySelector('h6')?.textContent?.trim() || card.querySelector('[class*="Typography"]')?.textContent?.trim() : '';
    });
    expect(pendingUsername).toBeTruthy();

    const approveResponse = page.waitForResponse(
      (res) => res.url().includes('/admin/users/') && res.url().includes('/approve') && res.status() === 200,
      { timeout: 10000 },
    );

    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      const approveBtn = Array.from(buttons).find(b => b.textContent?.trim() === 'Approve' && b.closest('[class*="Card"]'));
      if (approveBtn) {
        approveBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        approveBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        approveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });

    await approveResponse;

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText(/has been approved/i)).toBeVisible();

    const approvedUserCard = page.locator('[class*="Card"]').filter({ hasText: pendingUsername! }).filter({ hasText: 'Approved' }).first();
    await expect(approvedUserCard.locator('[class*="Chip-label"]', { hasText: 'Approved' })).toBeVisible();
    await expect(approvedUserCard.locator('[class*="Chip-label"]', { hasText: 'User' })).toBeVisible();
    await expect(approvedUserCard.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(approvedUserCard.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  });

  test('E2E-ADMIN-004: Reject pending signup (mobile)', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'mobile') {
      test.skip();
    }
    test.skip(!LATER_WAVES_FLAG, 'Wave 7 gated behind E2E_LATER_WAVES=1');

    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await ensurePendingUser(request, 'user3', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');

    const menuButton = page.locator('button[aria-label="My page"]');
    const drawer = page.locator('.MuiDrawer-paper');

    await menuButton.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: /Users/i }).click();
    await expect(drawer).not.toBeVisible();

    await expect(page.getByRole('heading', { level: 6, name: /Users/i })).toBeVisible();

    const pendingUserCard = page.getByText('Pending', { exact: true }).first();
    await expect(pendingUserCard).toBeVisible();

    const pendingUsername = await pendingUserCard.evaluate((el) => {
      const card = el.closest('[class*="Card"]');
      return card ? card.querySelector('h6')?.textContent?.trim() || card.querySelector('[class*="Typography"]')?.textContent?.trim() : '';
    });
    expect(pendingUsername).toBeTruthy();

    const rejectResponse = page.waitForResponse(
      (res) => res.url().includes('/admin/users/') && res.url().includes('/reject') && res.status() === 200,
      { timeout: 10000 },
    );

    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      const rejectBtn = Array.from(buttons).find(b => b.textContent?.trim() === 'Reject' && b.closest('[class*="Card"]'));
      if (rejectBtn) {
        rejectBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        rejectBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        rejectBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });

    await rejectResponse;

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText(/has been rejected/i)).toBeVisible();

    const rejectedUserCard = page.locator('[class*="Card"]').filter({ hasText: pendingUsername! }).filter({ hasText: 'Rejected' }).first();
    await expect(rejectedUserCard.locator('[class*="Chip-label"]', { hasText: 'Rejected' })).toBeVisible();
    await expect(rejectedUserCard.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(rejectedUserCard.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  });

  test('E2E-ADMIN-005: Create user from admin UI (mobile)', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'mobile') {
      test.skip();
    }
    test.skip(!LATER_WAVES_FLAG, 'Wave 7 gated behind E2E_LATER_WAVES=1');

    const suffix = getTestSuffix(testInfo);
    await loginAsAdmin(page);

    await page.goto('/mypage');

    const menuButton = page.locator('button[aria-label="My page"]');
    const drawer = page.locator('.MuiDrawer-paper');

    await menuButton.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: /Users/i }).click();
    await expect(drawer).not.toBeVisible();

    const addIconButton = page.locator('button[aria-label*="Add"]').first();
    await expect(addIconButton).toBeVisible();

    await addIconButton.click();
    await page.waitForTimeout(1000);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const usernameInput = dialog.getByLabel(/Username/i);
    await expect(usernameInput).toBeVisible();

    const emailInput = dialog.getByLabel(/Email/i);
    await expect(emailInput).toBeVisible();

    const passwordInputs = dialog.locator('input[type="password"]');
    await expect(passwordInputs).toHaveCount(2);

    const shortSuffix = `${testInfo.project.name}_${testInfo.title.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)}`;
    const newUserSuffix = `au${shortSuffix}`;
    await usernameInput.fill(newUserSuffix);
    await emailInput.fill(`${newUserSuffix}@test.com`);
    await passwordInputs.first().fill('password123');
    await passwordInputs.last().fill('password123');

    const addSubmitButton = dialog.getByText('Add').first();
    await expect(addSubmitButton).toBeVisible();
    await addSubmitButton.scrollIntoViewIfNeeded();

    const addUserResponse = page.waitForResponse(
      (res) => res.url().includes('/admin/users') && res.status() === 201,
      { timeout: 10000 },
    );

    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      const addBtn = Array.from(buttons).find(b => b.textContent?.trim() === 'Add' && b.closest('[role="dialog"]'));
      if (addBtn) {
        addBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        addBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        addBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });

    await addUserResponse;

    await expect(page.getByText(/has been added/i)).toBeVisible();

    await expect(page.getByText(newUserSuffix, { exact: true })).toBeVisible();

    const newUserCard = page.locator('[class*="Card"]').filter({ hasText: newUserSuffix }).filter({ hasText: 'Approved' }).first();
    await expect(newUserCard.locator('[class*="Chip-label"]', { hasText: 'Approved' })).toBeVisible();
    await expect(newUserCard.locator('[class*="Chip-label"]', { hasText: 'User' })).toBeVisible();
  });

test('E2E-ADMIN-006: Delete standard user from admin UI (mobile)', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'mobile') {
      test.skip();
    }
    test.skip(!LATER_WAVES_FLAG, 'Wave 7 gated behind E2E_LATER_WAVES=1');

    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await ensureApprovedUser(request, 'user2', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');

    const menuButton = page.locator('button[aria-label="My page"]');
    const drawer = page.locator('.MuiDrawer-paper');

    await menuButton.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: /Users/i }).click();
    await expect(drawer).not.toBeVisible();

    await expect(page.getByRole('heading', { level: 6, name: /Users/i })).toBeVisible();

    const testCard = page.locator('[class*="Card"]').filter({ hasText: suffix }).first();
    await expect(testCard).toBeVisible();

    const deleteUsername = await testCard.evaluate((el) => {
      const h6 = el.querySelector('h6');
      return h6 ? h6.textContent?.trim() || '' : '';
    });
    expect(deleteUsername).toBeTruthy();

    const deleteButton = testCard.getByRole('button', { name: /Delete user/i }).first();
    await expect(deleteButton).toBeVisible();

    await deleteButton.click();

    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByRole('button', { name: /Delete/i })).toBeVisible();

    const deleteResponse = page.waitForResponse(
      (res) => res.url().includes('/admin/users/') && res.request().method() === 'DELETE' && res.status() === 200,
      { timeout: 10000 },
    );

    await confirmDialog.getByRole('button', { name: /Delete/i }).click();

    await deleteResponse;

    await expect(page.getByText(/account has been deleted/i)).toBeVisible();
  });

  test('E2E-ADMIN-007: Toggle registration-related settings (mobile)', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'mobile') {
      test.skip();
    }
    test.skip(!LATER_WAVES_FLAG, 'Wave 7 gated behind E2E_LATER_WAVES=1');

    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');

    const menuButton = page.locator('button[aria-label="My page"]');
    const drawer = page.locator('.MuiDrawer-paper');

    await menuButton.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: /System settings/i }).click();
    await expect(drawer).not.toBeVisible();

    await expect(page.getByRole('heading', { level: 6, name: /System settings/i })).toBeVisible();

    const registrationSwitch = page.getByRole('switch').first();
    await expect(registrationSwitch).toBeVisible();

    const currentChecked = await registrationSwitch.isChecked();

    await registrationSwitch.click();
    await expect(page.getByText(/Registration setting saved/i)).toBeVisible();

    await expect(registrationSwitch).toBeChecked({ checked: !currentChecked });
  });

  test('E2E-ADMIN-008: Cleanup actions show confirmation and completion feedback (mobile)', async ({ page, request }, testInfo) => {
    if (testInfo.project.name !== 'mobile') {
      test.skip();
    }
    test.skip(!LATER_WAVES_FLAG, 'Wave 7 gated behind E2E_LATER_WAVES=1');

    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');

    const menuButton = page.locator('button[aria-label="My page"]');
    const drawer = page.locator('.MuiDrawer-paper');

    await menuButton.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: /System settings/i }).click();
    await expect(drawer).not.toBeVisible();

    await expect(page.getByRole('heading', { level: 6, name: /System settings/i })).toBeVisible();

    const cleanupIcon = page.locator('button[aria-label="Clean up"]');
    await cleanupIcon.scrollIntoViewIfNeeded();
    await cleanupIcon.click();

    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByRole('heading', { name: /Confirm/i })).toBeVisible();

    await confirmDialog.getByRole('button', { name: /Clean up/i }).click();

    await expect(page.getByRole('alert')).toBeVisible();
  });
});
});
