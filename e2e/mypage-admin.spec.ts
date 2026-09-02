import { expect, test, type Page, type TestInfo } from '@playwright/test';

import {
  ensureApprovedUser,
  ensurePendingUser,
  getTestSuffix,
  loginAsAdmin,
  loginAsUser,
} from './helpers/auth';
import { buildName } from './helpers/files';
import { getSessionToken, resolveNodeId } from './helpers/resolvePath';
import { TEST_USERS } from './fixtures/test-data';

test.describe.configure({ mode: 'serial' });

async function createFolderViaApi(request: any, bearerToken: string, folderPath: string) {
  const segments = folderPath.split('/').filter(Boolean);
  const name = segments[segments.length - 1];
  const parentPath = `/${segments.slice(0, -1).join('/')}`;

  const parentNodeId = await resolveNodeId(request, bearerToken, parentPath);

  const res = await request.post('/api/folders/create', {
    headers: { Authorization: `Bearer ${bearerToken}` },
    data: { parentNodeId, name },
  });

  // Idempotent prerequisite: if retries happen, conflict is acceptable.
  if (res.status() !== 409) {
    expect(res.ok()).toBeTruthy();
  }
}

function isMobileProject(testInfo: TestInfo) {
  return testInfo.project.name.endsWith('-mobile');
}

async function openMyPageCategoryAndVerify(
  page: Page,
  isMobile: boolean,
  category: 'Users' | 'System settings'
) {
  if (isMobile) {
    const menuButton = page.locator('button[aria-label="My page"]');
    const drawer = page.locator('.MuiDrawer-paper');

    await menuButton.click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: /Users/i })).toBeVisible();
    await expect(drawer.getByRole('button', { name: /System settings/i })).toBeVisible();
    await expect(drawer.getByRole('button', { name: /Preferences/i })).toBeVisible();
    await expect(drawer.getByRole('button', { name: /Share management/i })).toHaveCount(0);
    await drawer.getByRole('button', { name: new RegExp(category) }).click();
    await expect(drawer).not.toBeVisible();
  } else {
    const sidebar = page.locator('.MuiList-root').first();
    await expect(sidebar.getByRole('button', { name: /Users/i })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /System settings/i })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /Preferences/i })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /Share management/i })).toHaveCount(0);
    await sidebar.getByRole('button', { name: new RegExp(category) }).click();
  }

  await expect(page.getByRole('heading', { level: 6, name: new RegExp(category) })).toBeVisible();
}

async function openMyPageCategory(
  page: Page,
  isMobile: boolean,
  category: 'Users' | 'System settings'
) {
  if (isMobile) {
    const menuButton = page.locator('button[aria-label="My page"]');
    const drawer = page.locator('.MuiDrawer-paper');

    await menuButton.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: new RegExp(category) }).click();
    await expect(drawer).not.toBeVisible();
  } else {
    const sidebar = page.locator('.MuiList-root').first();
    await sidebar.getByRole('button', { name: new RegExp(category) }).click();
  }

  await expect(page.getByRole('heading', { level: 6, name: new RegExp(category) })).toBeVisible();
}

async function clickPendingUserCardButton(
  page: Page,
  isMobile: boolean,
  label: 'Approve' | 'Reject'
) {
  if (isMobile) {
    await page.evaluate((lbl) => {
      const buttons = document.querySelectorAll('button');
      const target = Array.from(buttons).find(
        (b) => b.textContent?.trim() === lbl && b.closest('[class*="Card"]')
      );
      if (target) {
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }, label);
    return;
  }

  const button = page.getByRole('button', { name: label }).first();
  await expect(button).toBeVisible();
  await button.click();
}

async function clickDialogAddButton(
  page: Page,
  isMobile: boolean,
  addUserResponse: Promise<unknown>
) {
  const dialog = page.getByRole('dialog');
  const submitButton = dialog.getByRole('button', { name: 'Add', exact: true });

  // The Add submit sits at the bottom of a fullscreen scrollable dialog. On
  // WebKit mobile a pointer click can intermittently fail to reach the button's
  // React onClick, so dispatch the DOM click directly and re-dispatch until the
  // 201 create-user response is observed (bounded retries). If the dialog
  // closes first, the submit already succeeded — just await the response.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await expect(submitButton).toBeVisible();
      await submitButton.scrollIntoViewIfNeeded();
      await submitButton.dispatchEvent('click');
    } catch {
      break;
    }

    try {
      await Promise.race([
        addUserResponse,
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('Add response not yet observed')), 3000)
        ),
      ]);
      return;
    } catch {
      // Response not observed yet; re-dispatch the submit.
    }
  }

  await addUserResponse;
}

test.describe('mypage admin flows (E2E-ADMIN-001..008)', () => {
  test('E2E-ADMIN-001: Redirects /admin to the admin MyPage category', async ({
    page,
    request,
  }, testInfo) => {
    const isMobile = isMobileProject(testInfo);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsAdmin(page);

    await page.goto('/admin');

    await expect(page).toHaveURL(/\/mypage$/);

    if (isMobile) {
      await openMyPageCategoryAndVerify(page, isMobile, 'Users');
    } else {
      await expect(
        page.getByRole('heading', { level: 6, name: /Users/i, exact: false })
      ).toBeVisible();
    }
  });

  test('E2E-ADMIN-002: Shows user-management and system-settings categories', async ({
    page,
    request,
  }, testInfo) => {
    const isMobile = isMobileProject(testInfo);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');

    await openMyPageCategoryAndVerify(page, isMobile, 'System settings');
    await openMyPageCategoryAndVerify(page, isMobile, 'Users');
  });

  test('E2E-ADMIN-003: Approves a pending signup', async ({ page, request }, testInfo) => {
    const isMobile = isMobileProject(testInfo);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await ensurePendingUser(request, 'user2', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');
    await openMyPageCategory(page, isMobile, 'Users');

    const pendingUserCard = page.getByText('Pending', { exact: true }).first();
    await expect(pendingUserCard).toBeVisible();

    const pendingUsername = await pendingUserCard.evaluate((el) => {
      const card = el.closest('[class*="Card"]');
      return card
        ? card.querySelector('h6')?.textContent?.trim() ||
            card.querySelector('[class*="Typography"]')?.textContent?.trim()
        : '';
    });
    expect(pendingUsername).toBeTruthy();

    const approveResponse = page.waitForResponse(
      (res) =>
        res.url().includes('/admin/users/') &&
        res.url().includes('/approve') &&
        res.status() === 200,
      { timeout: 10000 }
    );

    await clickPendingUserCardButton(page, isMobile, 'Approve');

    await approveResponse;

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText(/has been approved/i)).toBeVisible();

    const approvedUserCard = page
      .locator('[class*="Card"]')
      .filter({ hasText: pendingUsername! })
      .filter({ hasText: 'Approved' })
      .first();
    await expect(
      approvedUserCard.locator('[class*="Chip-label"]', { hasText: 'Approved' })
    ).toBeVisible();
    await expect(
      approvedUserCard.locator('[class*="Chip-label"]', { hasText: 'User' })
    ).toBeVisible();
    await expect(approvedUserCard.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(approvedUserCard.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  });

  test('E2E-ADMIN-004: Rejects a pending signup', async ({ page, request }, testInfo) => {
    const isMobile = isMobileProject(testInfo);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await ensurePendingUser(request, 'user3', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');
    await openMyPageCategory(page, isMobile, 'Users');

    const pendingUserCard = page.getByText('Pending', { exact: true }).first();
    await expect(pendingUserCard).toBeVisible();

    const pendingUsername = await pendingUserCard.evaluate((el) => {
      const card = el.closest('[class*="Card"]');
      return card
        ? card.querySelector('h6')?.textContent?.trim() ||
            card.querySelector('[class*="Typography"]')?.textContent?.trim()
        : '';
    });
    expect(pendingUsername).toBeTruthy();

    const rejectResponse = page.waitForResponse(
      (res) =>
        res.url().includes('/admin/users/') &&
        res.url().includes('/reject') &&
        res.status() === 200,
      { timeout: 10000 }
    );

    await clickPendingUserCardButton(page, isMobile, 'Reject');

    await rejectResponse;

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText(/has been rejected/i)).toBeVisible();

    const rejectedUserCard = page
      .locator('[class*="Card"]')
      .filter({ hasText: pendingUsername! })
      .filter({ hasText: 'Rejected' })
      .first();
    await expect(
      rejectedUserCard.locator('[class*="Chip-label"]', { hasText: 'Rejected' })
    ).toBeVisible();
    await expect(rejectedUserCard.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(rejectedUserCard.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  });

  test('E2E-ADMIN-005: Creates a user from the admin UI', async ({ page, request }, testInfo) => {
    const isMobile = isMobileProject(testInfo);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');
    await openMyPageCategory(page, isMobile, 'Users');

    const addIconButton = isMobile
      ? page.locator('button[aria-label*="Add"]').first()
      : page.getByRole('button', { name: /Add/i }).first();
    await expect(addIconButton).toBeVisible();

    await addIconButton.click();
    if (isMobile) {
      await page.waitForTimeout(1000);
    }

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
      { timeout: 15000 }
    );

    await clickDialogAddButton(page, isMobile, addUserResponse);

    await expect(page.getByText(/has been added/i)).toBeVisible();

    await expect(page.getByText(newUserSuffix, { exact: true })).toBeVisible();

    const newUserCard = page
      .locator('[class*="Card"]')
      .filter({ hasText: newUserSuffix })
      .filter({ hasText: 'Approved' })
      .first();
    await expect(
      newUserCard.locator('[class*="Chip-label"]', { hasText: 'Approved' })
    ).toBeVisible();
    await expect(newUserCard.locator('[class*="Chip-label"]', { hasText: 'User' })).toBeVisible();
  });

  test('E2E-ADMIN-006: Deletes a standard user from the admin UI', async ({
    page,
    request,
  }, testInfo) => {
    const isMobile = isMobileProject(testInfo);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await ensureApprovedUser(request, 'user2', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');
    await openMyPageCategory(page, isMobile, 'Users');

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
      (res) =>
        res.url().includes('/admin/users/') &&
        res.request().method() === 'DELETE' &&
        res.status() === 200,
      { timeout: 10000 }
    );

    await confirmDialog.getByRole('button', { name: /Delete/i }).click();

    await deleteResponse;

    await expect(page.getByText(/account has been deleted/i)).toBeVisible();
  });

  test('E2E-ADMIN-007: Toggles registration-related settings', async ({
    page,
    request,
  }, testInfo) => {
    const isMobile = isMobileProject(testInfo);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsAdmin(page);

    await page.goto('/mypage');
    await openMyPageCategory(page, isMobile, 'System settings');

    const registrationSwitch = page.getByRole('switch').first();
    await expect(registrationSwitch).toBeVisible();

    const currentChecked = await registrationSwitch.isChecked();

    await registrationSwitch.click();
    await expect(page.getByText(/Registration setting saved/i)).toBeVisible();

    await expect(registrationSwitch).toBeChecked({ checked: !currentChecked });
  });

  test('E2E-ADMIN-008: Cleanup actions show confirmation and completion feedback', async ({
    page,
    request,
  }, testInfo) => {
    const isMobile = isMobileProject(testInfo);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await loginAsAdmin(page);

    // Absence precondition injection: give the non-admin user own folders so a
    // self-grant leak into `__shared__` (class A/H) would be user-visible before
    // the "권한정리" cleanup removes it.
    const targetUsername = `${TEST_USERS.user1.username}_${suffix}`;
    const ownFolderName = buildName(testInfo, 'cleanup-own-folder');
    const ownFolderPath = `/${targetUsername}/${ownFolderName}`;
    const adminToken = await getSessionToken(page);
    await createFolderViaApi(request, adminToken, ownFolderPath);
    const ownFolderNodeId = await resolveNodeId(request, adminToken, ownFolderPath);

    await page.goto('/mypage');
    await openMyPageCategory(page, isMobile, 'System settings');

    const cleanupIcon = page.locator('button[aria-label="Clean up"]');
    await cleanupIcon.scrollIntoViewIfNeeded();
    await cleanupIcon.click();

    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByRole('heading', { name: /Confirm/i })).toBeVisible();

    await confirmDialog.getByRole('button', { name: /Clean up/i }).click();

    await expect(page.getByRole('alert')).toBeVisible();

    // Absence regression (class H): after cleanup, the non-admin user's shared view
    // shows no self-grant leftovers — empty for a user who only has own folders.
    await loginAsUser(page, 'user1', suffix);
    await page.goto('/files/__shared__');
    await expect(page).toHaveURL(/\/files\/__shared__(?:\/.*)?$/);
    await expect(page.locator('[data-file-node-id]')).toHaveCount(0);
    await expect(page.locator(`[data-file-node-id="${ownFolderNodeId}"]`)).toHaveCount(0);

    // Absence regression (class H): the tree must render no "Shared" section for a
    // user with no grants. A one-shot isVisible() right after goto raced the tree
    // mount and silently skipped the assertion — wait for the tree to render first.
    // On mobile the tree is collapsed behind the breadcrumb toggle, so open it.
    const folderTree = page.getByTestId('folder-tree');
    if (isMobile) {
      await page.locator('button[title="Open folder tree"]').click();
    }
    await expect(folderTree).toBeVisible({ timeout: 20_000 });
    await expect(folderTree.getByRole('button', { name: /Shared/i })).toHaveCount(0);
  });
});
