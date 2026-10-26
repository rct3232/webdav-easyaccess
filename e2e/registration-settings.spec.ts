import fs from 'node:fs';

import { type Page, type TestInfo } from '@playwright/test';

import {
  ensureApprovedUser,
  getTestSuffix,
  loginWithCredentials,
  setRegistrationEnabled,
} from './helpers/auth';
import { expect, test } from '@playwright/test';
import { emptyS3Bucket } from './helpers/minio';
import { e2ePorts } from './helpers/ports';
import {
  ensureClientBuild,
  killScratch,
  prepareScratchS3,
  s3ScratchEnv,
  scratchDirFor,
  scratchRuntimeEnv,
  spawnScratchServer,
  waitForScratchHealth,
  writeScratchEnv,
} from './helpers/setupScratch';

/**
 * Registration-setting cases (DEF-11/dechain C1). The `registration_enabled`
 * setting is a single GLOBAL server value, so this suite owns a dedicated
 * project-scoped S3 scratch server. Desktop and mobile have separate scratch
 * ports/DBs/buckets and no Playwright dependency.
 *
 * The `s3-regset-*` projects run in both the default S3 group and the core
 * subset. Each project flips only its own scratch server; shared platform
 * settings are never touched.
 */
test.describe.configure({ mode: 'serial' });

function isMobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name.endsWith('-mobile');
}

let scratch: string;
let spawned: ReturnType<typeof spawnScratchServer> | null = null;
let bucket: string;
let scratchPort: number;

test.beforeAll(async ({}, testInfo) => {
  const projectName = testInfo.project.name;
  scratchPort = isMobileProject(testInfo) ? e2ePorts.scratchRegsetMobile : e2ePorts.scratchRegset;
  scratch = scratchDirFor('registration-settings', projectName);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  bucket = await prepareScratchS3(projectName);
  writeScratchEnv(scratch, {
    PORT: String(scratchPort),
    JWT_SECRET: 'registration-settings-e2e-jwt-secret',
    ADMIN_DEFAULT_PASSWORD: 'admin',
    ...s3ScratchEnv(bucket),
    ...scratchRuntimeEnv({
      WEA_SKIP_GC_SCHEDULER: '1',
    }),
  });
  ensureClientBuild();
  spawned = spawnScratchServer(scratch, scratchPort);
  await waitForScratchHealth(spawned, scratchPort);
});

test.afterAll(async () => {
  if (spawned) {
    await killScratch(spawned);
    spawned = null;
  }
  if (bucket) await emptyS3Bucket(bucket).catch(() => {});
  if (scratch) {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

/** mypage category navigation — permanent sidebar (desktop) vs drawer (mobile). */
async function openMyPageCategory(page: Page, isMobile: boolean, category: 'System settings') {
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

test('E2E-AUTH-009: Register page availability follows public settings', async ({
  page,
  request,
}) => {
  await setRegistrationEnabled(request, true);
  await page.goto('/register');
  await expect(page.locator('form')).toBeVisible();

  await setRegistrationEnabled(request, false);
  try {
    await page.goto('/register');

    await page.locator('input[name="username"]').fill('disabled-test');
    await page.locator('input[name="email"]').fill('disabled-test@example.com');
    await page.locator('input[name="password"]').fill('password123');
    await page.locator('input[name="confirmPassword"]').fill('password123');
    await page.locator('form button[type="submit"]').click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Registration is currently disabled');
  } finally {
    await setRegistrationEnabled(request, true);
  }
});

test('E2E-AUTH-010: Registration success with pending approval shows success state instead of explorer navigation', async ({
  page,
  request,
}) => {
  // Registration success waits on the server (bcrypt hash + pending-approval
  // write); keep the explicit 90s success budget below inside a larger case
  // budget.
  test.setTimeout(180_000);
  await setRegistrationEnabled(request, true);
  await page.goto('/register');

  await page.locator('input[name="username"]').fill('reg-test-user' + Date.now());
  await page.locator('input[name="email"]').fill(`reg-test-${Date.now()}@example.com`);
  await page.locator('input[name="password"]').fill('password123');
  await page.locator('input[name="confirmPassword"]').fill('password123');
  await page.locator('form button[type="submit"]').click();

  const successTitle = page.locator('text=Registration complete!');
  await expect(successTitle).toBeVisible({ timeout: 90_000 });
  await expect(page).not.toHaveURL(/\/files/);
});

test.describe('registration setting admin UI (E2E-ADMIN-007)', () => {
  test('E2E-ADMIN-007: Toggles registration-related settings', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(180_000);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);

    await loginWithCredentials(page, 'admin', 'admin');
    await page.goto('/mypage');
    await openMyPageCategory(page, isMobileProject(testInfo), 'System settings');

    const registrationSwitch = page.getByRole('switch').first();
    await expect(registrationSwitch).toBeVisible();

    const currentChecked = await registrationSwitch.isChecked();

    await registrationSwitch.click();
    await expect(page.getByText(/Registration setting saved/i)).toBeVisible({ timeout: 60_000 });

    await expect(registrationSwitch).toBeChecked({ checked: !currentChecked });

    await setRegistrationEnabled(request, currentChecked);
  });
});
