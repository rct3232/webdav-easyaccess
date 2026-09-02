import { expect, test } from '@playwright/test';

import {
  createPublicShareFixtures,
  createShareLink,
  type PublicShareFixtures,
} from './helpers/shareLinks';
import { gotoAsAnonymousShare, gotoAsLoggedInShare, loginAsUserApi } from './helpers/auth';
import { openItemActions } from './helpers/explorer';
import {
  buildName,
  createFolderAt,
  fileItem,
  readTestFileFixture,
  uploadFileAt,
} from './helpers/files';
import { nodeUrl, resolveNodeId } from './helpers/resolvePath';
import { TEST_FILES } from './fixtures/test-data';

const imageFixtureBuffer = readTestFileFixture(TEST_FILES.smallImage);

test.describe('public share link', () => {
  let fixtures: PublicShareFixtures;

  test.beforeAll(async ({ request }, testInfo) => {
    fixtures = await createPublicShareFixtures(request, testInfo);
  });

  test('E2E-SHARE-001: Invalid or expired share token shows error state', async ({ page }) => {
    await page.goto(`/share/${fixtures.invalidShareToken}`);
    await expect(page.getByText(/Link has expired or file could not be found\./i)).toBeVisible();
  });

  test('E2E-SHARE-002: Directory share loads read-only explorer view', async ({ page }) => {
    await gotoAsAnonymousShare(page, fixtures.anonDir.token);

    await expect(page.getByTestId('share-link-fab')).toBeVisible();
    await expect(page.getByTestId('file-actions-fab')).toHaveCount(0);
    await expect(fileItem(page, fixtures.anonDir.innerFilePath)).toBeVisible();
  });

  test('E2E-SHARE-003: Single-file share loads full-screen preview view', async ({ page }) => {
    await page.goto(`/share/${fixtures.singleFile.token}`);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('img').first()).toBeVisible();
  });

  test('E2E-SHARE-004: Anonymous user can open login flow from shared directory', async ({
    page,
  }) => {
    await gotoAsAnonymousShare(page, fixtures.anonDir.token);

    await page.getByTestId('share-link-fab').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test('E2E-SHARE-005: Logged-in user can add shared content to own permissions', async ({
    page,
  }) => {
    await gotoAsLoggedInShare(page, fixtures.addDir.token, 'user1', fixtures.approvedUserSuffix);

    await expect(page.getByTestId('confirm-dialog-confirm')).toBeVisible();
    await page.getByTestId('confirm-dialog-confirm').click();

    await expect(page).toHaveURL(new RegExp(`/files/node/${fixtures.addDir.nodeId}$`));
    await expect(page.getByTestId('share-link-fab')).toHaveCount(0);
    await expect(fileItem(page, fixtures.addDir.innerFilePath)).toBeVisible();

    // Absence regression (class A/E): add-to-my-permissions makes the shared node the
    // shared entry under `__shared__`, while the user's own home stays un-polluted.
    await page.goto('/files/__shared__');
    await expect(page).toHaveURL(/\/files\/__shared__(?:\/.*)?$/);
    await expect(page.locator(`[data-file-node-id="${fixtures.addDir.nodeId}"]`)).toBeVisible({
      timeout: 20_000,
    });

    await page.goto(nodeUrl(fixtures.approvedUserHomeNodeId));
    await expect(page.locator(`[data-file-node-id="${fixtures.addDir.nodeId}"]`)).toHaveCount(0);
  });

  test('E2E-SHARE-006: Successful add-to-my-permissions transitions to regular /files path', async ({
    page,
  }) => {
    await gotoAsLoggedInShare(
      page,
      fixtures.transitionDir.token,
      'user1',
      fixtures.approvedUserSuffix
    );

    await expect(page.getByTestId('confirm-dialog-confirm')).toBeVisible();
    await page.getByTestId('confirm-dialog-confirm').click();

    await expect(page).toHaveURL(/\/files(?:\/.*)?$/);
    await expect(page.getByTestId('share-link-fab')).toHaveCount(0);
    await expect(fileItem(page, fixtures.transitionDir.innerFilePath)).toBeVisible();

    // Absence regression (class A/E): the added node becomes the shared entry and the
    // user's own home stays un-polluted.
    await page.goto('/files/__shared__');
    await expect(page).toHaveURL(/\/files\/__shared__(?:\/.*)?$/);
    await expect(
      page.locator(`[data-file-node-id="${fixtures.transitionDir.nodeId}"]`)
    ).toBeVisible({ timeout: 20_000 });

    await page.goto(nodeUrl(fixtures.approvedUserHomeNodeId));
    await expect(
      page.locator(`[data-file-node-id="${fixtures.transitionDir.nodeId}"]`)
    ).toHaveCount(0);
  });

  test('E2E-SHARE-007: Leaving share scope requires confirmation', async ({ page }, testInfo) => {
    await gotoAsLoggedInShare(page, fixtures.leaveDir.token, 'user1', fixtures.approvedUserSuffix);

    await expect(page.getByTestId('confirm-dialog-confirm')).toBeVisible();
    await page.getByTestId('confirm-dialog-cancel').click(); // close add-to-my-permissions modal

    if (testInfo.project.name.endsWith('-mobile')) {
      const toggle = page.locator('button[title="Open folder tree"]');
      await toggle.click();
    }

    // In share mode for an authenticated non-admin user, the sidebar home item is their username.
    await page.getByRole('button', { name: fixtures.approvedUsername, exact: true }).click();

    await expect(page.getByTestId('confirm-dialog-confirm')).toBeVisible(); // leave-share confirm
    await page.getByTestId('confirm-dialog-confirm').click();

    await expect(page).toHaveURL(new RegExp(`/files/node/${fixtures.approvedUserHomeNodeId}$`));
    await expect(page.getByTestId('share-link-fab')).toHaveCount(0);
    // After leaving share scope, the user is taken back to their own explorer home;
    // the shared directory path should no longer be part of the visible listing.
    await expect(fileItem(page, fixtures.leaveDir.innerFilePath)).toHaveCount(0);
  });

  test('E2E-SHARE-008: Share mode hides or disables write actions', async ({ page }) => {
    await gotoAsAnonymousShare(page, fixtures.anonDir.token);

    await openItemActions(page, fixtures.anonDir.innerFilePath);
    await expect(page.getByTestId('file-action-download')).toBeVisible();

    await expect(page.getByTestId('file-action-rename')).toHaveCount(0);
    await expect(page.getByTestId('file-action-delete')).toHaveCount(0);
    await expect(page.getByTestId('file-action-share')).toHaveCount(0);
  });

  test('E2E-SHARE-009: Shared directory still allows file preview', async ({ page }, testInfo) => {
    await gotoAsAnonymousShare(page, fixtures.anonDir.token);

    const fileLocator = page.locator(`[data-file-path="${fixtures.anonDir.innerFilePath}"]`);

    if (testInfo.project.name.endsWith('-desktop')) {
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

  test('E2E-SHARE-011: Single-file share link survives a file rename (nodeId reference, not path)', async ({
    page,
    request,
  }, testInfo) => {
    // Ported from E2E-S3PG-007. This spec runs fully parallel, so the test
    // creates its OWN file + share token inside the body — it never touches
    // `fixtures.singleFile` (E2E-SHARE-003 reads it; renaming that file from a
    // parallel test would race).
    const dirName = buildName(testInfo, 'share-rename-dir');
    const oldName = buildName(testInfo, 'share-rename-old', '.jpg');
    const newName = buildName(testInfo, 'share-rename-new', '.jpg');
    const dirPath = `/user1/${dirName}`;

    const token = await loginAsUserApi(request, 'user1');

    const homeNodeId = await resolveNodeId(request, token, '/user1');
    const dirNodeId = await createFolderAt(request, token, homeNodeId, dirName);
    const fileNodeId = await uploadFileAt(
      request,
      token,
      dirNodeId,
      oldName,
      'image/jpeg',
      imageFixtureBuffer
    );

    const linkBody = await createShareLink(request, {
      bearerToken: token,
      filePath: `${dirPath}/${oldName}`,
    });
    const shareToken = linkBody.token as string;

    const renameRes = await request.put('/api/files/rename', {
      headers: { Authorization: `Bearer ${token}` },
      data: { nodeId: fileNodeId, newName },
    });
    expect(renameRes.ok()).toBeTruthy();

    // The share link points at the nodeId, so renaming the file must not break
    // it: the share page still resolves the node and renders the preview dialog
    // (an expired/not-found link would render the error text instead).
    await page.goto(`/share/${shareToken}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText(/expired|could not be found/i);

    // And the content is still served through the share token (nodeId reference).
    const anonRes = await request.get(`/api/files/download?nodeId=${fileNodeId}&inline=true`, {
      headers: { 'X-Share-Token': shareToken },
    });
    expect(anonRes.ok()).toBeTruthy();
    expect((await anonRes.body()).equals(imageFixtureBuffer)).toBeTruthy();
  });
});
