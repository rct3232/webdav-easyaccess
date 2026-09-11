import { type Page } from '@playwright/test';

import { ensureApprovedUser, getTestSuffix, setRegistrationEnabled } from './helpers/auth';
import { ADMIN_STATE, expect, test } from './fixtures/authenticated';

/**
 * Registration-setting cases (DEF-11/dechain C1). The `registration_enabled`
 * setting is a single GLOBAL server value; these are the ONLY cases allowed to
 * write it DISABLED, so they run in exactly ONE project (desktop; see
 * `desktopSpecMatch` in playwright.config.ts) and serially, with every flip
 * restored. The rest of the suite treats registration as ambient-enabled:
 * `ensurePendingUser` self-heals a racing disable, and `mypage-admin` 005/006
 * user rows are unique per run.
 */
test.describe.configure({ mode: 'serial' });

async function openMyPageCategoryDesktop(page: Page, category: 'System settings') {
  const sidebar = page.locator('.MuiList-root').first();
  await sidebar.getByRole('button', { name: new RegExp(category) }).click();
  await expect(page.getByRole('heading', { level: 6, name: new RegExp(category) })).toBeVisible();
}

test('E2E-AUTH-009: Register page availability follows public settings', async ({
  page,
  request,
}) => {
  // Test Enabled
  await setRegistrationEnabled(request, true);
  await page.goto('/register');
  await expect(page.locator('form')).toBeVisible();

  // Test Disabled
  await setRegistrationEnabled(request, false);
  try {
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
  } finally {
    // Restore the ambient default so no other spec (or later case here)
    // observes a disabled window.
    await setRegistrationEnabled(request, true);
  }
});

test('E2E-AUTH-010: Registration success with pending approval shows success state instead of explorer navigation', async ({
  page,
  request,
}) => {
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

test.describe('registration setting admin UI (E2E-ADMIN-007)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('E2E-ADMIN-007: Toggles registration-related settings', async ({
    page,
    request,
  }, testInfo) => {
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);

    await page.goto('/mypage');
    await openMyPageCategoryDesktop(page, 'System settings');

    const registrationSwitch = page.getByRole('switch').first();
    await expect(registrationSwitch).toBeVisible();

    const currentChecked = await registrationSwitch.isChecked();

    await registrationSwitch.click();
    await expect(page.getByText(/Registration setting saved/i)).toBeVisible();

    await expect(registrationSwitch).toBeChecked({ checked: !currentChecked });

    // Restore the value captured before the toggle: the ambient default here is
    // enabled (this file owns every disable), so no window is left behind.
    await setRegistrationEnabled(request, currentChecked);
  });
});
