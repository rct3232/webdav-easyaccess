import { expect, test } from '@playwright/test';

import { createPublicShareFixtures, type PublicShareFixtures } from './helpers/shareLinks';
import { gotoAsAnonymousShare, gotoAsLoggedInShare } from './helpers/auth';
import { openItemActions } from './helpers/explorer';
import { fileItem } from './helpers/files';

const laterWavesEnabled = process.env.E2E_LATER_WAVES === '1';

test.describe('public share link', () => {
  let fixtures: PublicShareFixtures;

  test.beforeAll(async ({ request }, testInfo) => {
    fixtures = await createPublicShareFixtures(request, testInfo);
  });

  test.beforeEach(async ({}, testInfo) => {
    const isP2Deferred = testInfo.title.includes('E2E-SHARE-010');

    test.skip(
      !laterWavesEnabled && isP2Deferred,
      'P2 share follow-up runs only when E2E_LATER_WAVES=1 (after share-public + bulk P0 are stable).',
    );
  });

  test('E2E-SHARE-001 invalid or expired share token shows error state', async ({ page }) => {
    await page.goto(`/share/${fixtures.invalidShareToken}`);
    await expect(page.getByText(/Link has expired or file could not be found\./i)).toBeVisible();
  });

  test('E2E-SHARE-002 valid directory share renders read-only explorer mode', async ({ page }) => {
    await gotoAsAnonymousShare(page, fixtures.anonDir.token);

    await expect(page.getByTestId('share-link-fab')).toBeVisible();
    await expect(page.getByTestId('file-actions-fab')).toHaveCount(0);
    await expect(fileItem(page, fixtures.anonDir.innerFilePath)).toBeVisible();
  });

  test('E2E-SHARE-008 share mode hides or disables write actions', async ({ page }) => {
    await gotoAsAnonymousShare(page, fixtures.anonDir.token);

    await openItemActions(page, fixtures.anonDir.innerFilePath);
    await expect(page.getByTestId('file-action-download')).toBeVisible();

    await expect(page.getByTestId('file-action-rename')).toHaveCount(0);
    await expect(page.getByTestId('file-action-delete')).toHaveCount(0);
    await expect(page.getByTestId('file-action-share')).toHaveCount(0);
  });

  test('E2E-SHARE-004 anonymous user can open login flow from shared directory', async ({ page }) => {
    await gotoAsAnonymousShare(page, fixtures.anonDir.token);

    await page.getByTestId('share-link-fab').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test('E2E-SHARE-005 logged-in user can add shared content to own permissions', async ({ page }) => {
    await gotoAsLoggedInShare(page, fixtures.addDir.token, 'user1');

    await expect(page.getByTestId('confirm-dialog-confirm')).toBeVisible();
    await page.getByTestId('confirm-dialog-confirm').click();

    await expect(page).toHaveURL(new RegExp(`/files/${fixtures.addDir.dirName}(?:/.*)?$`));
    await expect(page.getByTestId('share-link-fab')).toHaveCount(0);
    await expect(fileItem(page, fixtures.addDir.innerFilePath)).toBeVisible();
  });

  test('E2E-SHARE-006 successful add-to-my-permissions transitions to normal /files route', async ({ page }) => {
    await gotoAsLoggedInShare(page, fixtures.transitionDir.token, 'user1');

    await expect(page.getByTestId('confirm-dialog-confirm')).toBeVisible();
    await page.getByTestId('confirm-dialog-confirm').click();

    await expect(page).toHaveURL(/\/files(?:\/.*)?$/);
    await expect(page.getByTestId('share-link-fab')).toHaveCount(0);
    await expect(fileItem(page, fixtures.transitionDir.innerFilePath)).toBeVisible();
  });

  test('E2E-SHARE-007 leaving share scope requires confirmation', async ({ page }, testInfo) => {
    await gotoAsLoggedInShare(page, fixtures.leaveDir.token, 'user1');

    await expect(page.getByTestId('confirm-dialog-confirm')).toBeVisible();
    await page.getByTestId('confirm-dialog-cancel').click(); // close add-to-my-permissions modal

    if (testInfo.project.name === 'mobile') {
      const toggle = page.locator('button[title="Open folder tree"]');
      if (await toggle.count()) {
        await toggle.click();
      }
    }

    // In share mode for an authenticated non-admin user, the sidebar home item is their username.
    await page.getByRole('button', { name: 'user1', exact: true }).click();

    await expect(page.getByTestId('confirm-dialog-confirm')).toBeVisible(); // leave-share confirm
    await page.getByTestId('confirm-dialog-confirm').click();

    await expect(page).toHaveURL(/\/files\/user1(?:\/.*)?$/);
    await expect(page.getByTestId('share-link-fab')).toHaveCount(0);
    // After leaving share scope, the user is taken back to their own explorer home;
    // the shared directory path should no longer be part of the visible listing.
    await expect(fileItem(page, fixtures.leaveDir.innerFilePath)).toHaveCount(0);
  });

  test('E2E-SHARE-003 single-file share loads full-screen preview view', async ({ page }) => {
    await page.goto(`/share/${fixtures.singleFile.token}`);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('img').first()).toBeVisible();
  });

  test('E2E-SHARE-009 shared directory still allows file preview', async ({ page }, testInfo) => {
    await gotoAsAnonymousShare(page, fixtures.anonDir.token);

    const fileLocator = page.locator(`[data-file-path="${fixtures.anonDir.innerFilePath}"]`);

    if (testInfo.project.name === 'desktop') {
      // Desktop: 더블클릭으로 PreviewDialog 열림
      await fileLocator.dblclick();
    } else {
      // Mobile: 단일 클릭으로 PreviewDialog 열림
      await fileLocator.click();
    }

    // PreviewDialog 가 실제로 열림을 검증
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
  });
});

