import { type APIRequestContext, type Page, type TestInfo } from '@playwright/test';

import { ADMIN_STATE, expect, test } from './fixtures/authenticated';
import { openItemActions } from './helpers/explorer';
import {
  buildName,
  downloadFile,
  fileItem,
  openPrivateWorkspace,
  uploadFileAt,
} from './helpers/files';
import { clickActionSheetItem, openActionSheet } from './helpers/mobile-interactions';
import { getSessionToken, gotoFilesPath, resolveNodeId } from './helpers/resolvePath';

test.use({ storageState: ADMIN_STATE });

/**
 * DEF-11 version history E2E (S3 storage mode only — the versions tab is
 * rendered only when the active file storage is s3; the webdav-mode smoke
 * intentionally excludes this spec).
 *
 * Cleanup uses the admin permanent-delete maintenance route so case files
 * never accumulate (assertion-context containment).
 */
const pendingPermDeletes: Array<{ token: string; nodeId: number }> = [];

test.afterEach(async ({ request }) => {
  for (const pending of pendingPermDeletes.splice(0)) {
    await request.delete('/api/admin/maintenance/perm-delete', {
      headers: { Authorization: `Bearer ${pending.token}` },
      data: { nodeId: pending.nodeId },
    });
  }
});

async function openVersionsTab(page: Page, targetPath: string, isMobile: boolean) {
  if (isMobile) {
    await openActionSheet(page, targetPath);
    await clickActionSheetItem(page, 'properties');
  } else {
    await openItemActions(page, targetPath);
    await page.getByTestId('file-action-properties').click();
  }
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Switch to the Versions tab (DEF-11: tab bar between title and header).
  // The e2e browser locale resolves to English (fallbackLng) — match the tab
  // by its stable i18n value, not the displayed label.
  await dialog.getByTestId('props-tab-versions').click();
  return dialog;
}

test('E2E-PROPS-001: Properties dialog lists prior versions newest-first in the Versions tab', async ({
  page,
  request,
}, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const isMobile = isMobileProject(testInfo);
  const token = await getSessionToken(page);
  const fileName = buildName(testInfo, 'versioned', '.txt');
  const filePath = `/${base}/${fileName}`;
  const parentNodeId = await resolveNodeId(request, token, `/${base}`);

  // Seed three overwrite generations via the API (stable distinct sizes).
  await uploadFileAt(
    request,
    token,
    parentNodeId,
    fileName,
    'text/plain',
    Buffer.from('v1-content')
  );
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, filePath)).toBeVisible();

  // Two API overwrites produce v2/v3 (overwrites don't change the listing; no reload needed).
  await uploadFileAt(
    request,
    token,
    parentNodeId,
    fileName,
    'text/plain',
    Buffer.from('v2-content')
  );
  await uploadFileAt(
    request,
    token,
    parentNodeId,
    fileName,
    'text/plain',
    Buffer.from('v3-longer-content')
  );

  const nodeId = await resolveNodeId(request, token, filePath);
  pendingPermDeletes.push({ token, nodeId });

  const dialog = await openVersionsTab(page, filePath, isMobile);

  // Newest-first rows with the current-version badge.
  const rows = dialog.getByTestId('props-version-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('3');
  await expect(rows.nth(2)).toContainText('1');

  // The current badge is now an icon-slot rendered per row — assert exactly
  // one slot holds the check icon (aria-label seam).
  await expect(
    dialog.getByTestId('props-version-current').locator('[aria-label="Current"]')
  ).toHaveCount(1);
});

test('E2E-PROPS-002: Restoring an older version keeps content byte-identical', async ({
  page,
  request,
}, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const isMobile = isMobileProject(testInfo);
  const token = await getSessionToken(page);
  const fileName = buildName(testInfo, 'version-restore', '.txt');
  const filePath = `/${base}/${fileName}`;

  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  await uploadFileAt(
    request,
    token,
    parentNodeId,
    fileName,
    'text/plain',
    Buffer.from('restore-roundtrip-original')
  );
  await uploadFileAt(
    request,
    token,
    parentNodeId,
    fileName,
    'text/plain',
    Buffer.from('v2-replaced')
  );
  const nodeId = await resolveNodeId(request, token, filePath);
  pendingPermDeletes.push({ token, nodeId });

  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, filePath)).toBeVisible();

  // Restore v1 via the properties dialog (icon-only restore button, aria-label seam;
  // only the non-current history row offers restore).
  const dialog = await openVersionsTab(page, filePath, isMobile);
  const restoreButtons = dialog.locator('button[aria-label="Restore this version"]');
  await expect(restoreButtons).toHaveCount(1);
  await restoreButtons.first().click();

  // A confirmation dialog guards the restore. Clicking confirm fires the async
  // restore call — wait for its response before downloading (otherwise the
  // download races the restore and reads the pre-restore content).
  const confirm = page.getByRole('dialog').filter({ hasText: 'Restore' });
  const restoreResponse = page.waitForResponse(
    (r) => r.url().includes('/api/files/versions/restore') && r.request().method() === 'POST'
  );
  await confirm.getByTestId('confirm-dialog-confirm').click();
  const restored = await restoreResponse;
  expect(restored.ok()).toBeTruthy();

  // The restored file downloads byte-identical to v1.
  const downloaded = await downloadFile(request, token, nodeId);
  expect(downloaded.toString()).toBe('restore-roundtrip-original');

  // The dialog reflects the restored version as current (swap, no new row).
  await expect(dialog.getByTestId('props-version-row')).toHaveCount(2);
});

function isMobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name.endsWith('-mobile');
}
