import { expect, test } from '@playwright/test';

import { loginAsAdmin } from './helpers/auth';
import { openFabAction } from './helpers/explorer';
import { buildName } from './helpers/files';
import { switchViewMode, setSortMode } from './helpers/explorer-advanced';
import { openActionSheet, clickActionSheetItem } from './helpers/mobile-interactions';

async function createTestFolder(page: any, folderName: string) {
  await openFabAction(page, 'Create folder');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('create-folder-name-input')).toBeVisible();
  await dialog.getByTestId('create-folder-name-input').fill(folderName);
  await dialog.getByTestId('create-folder-submit').click();
}

test.describe('explorer advanced (mobile)', () => {
  test('E2E-EXP-009: View mode switch changes visible layout', async ({ page }, testInfo) => {
    // 1. Login as admin
    await loginAsAdmin(page);

    // 2. Create test folder
    const folderName = buildName(testInfo, 'view-mode-folder');
    await createTestFolder(page, folderName);
    
    // 3. Navigate to /files
    await page.goto('/files');
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // 4. Assert current layout (default is list) - check for folder item
    await expect(page.locator(`[data-file-path="/${folderName}"]`)).toBeVisible();

    // 5. Switch to grid mode
    await switchViewMode(page, 'grid');
    
    // 6. Assert grid layout is visible (Box with data-file-path containing MuiCard)
    await expect(page.locator(`[data-file-path="/${folderName}"] .MuiCard-root`)).toBeVisible();

    // 7. Switch back to list mode
    await switchViewMode(page, 'list');
    
    // 8. Assert list layout is visible again
    await expect(page.locator(`[data-file-path="/${folderName}"]`)).toBeVisible();

    // Note: Detail view is not available on mobile (FileManagerControls.js line 188)
    // Mobile only supports List and Grid view modes
  });

  test('E2E-EXP-010: Sort mode changes displayed order', async ({ page }, testInfo) => {
    // 1. Login as admin
    await loginAsAdmin(page);

    // 2. Create multiple test folders
    const folder1 = buildName(testInfo, 'folder-aaa');
    const folder2 = buildName(testInfo, 'folder-zzz');
    const folder3 = buildName(testInfo, 'folder-mmm');
    
    await createTestFolder(page, folder1);
    await createTestFolder(page, folder2);
    await createTestFolder(page, folder3);

    // 3. Navigate to /files
    await page.goto('/files');
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // 4. Get initial item order (name-asc by default)
    const initialItems = await page.locator('[data-file-path]').allTextContents();
    
    // 5. Set sort mode to name-desc
    await setSortMode(page, 'name-desc');
    
    // 6. Get sorted item order
    const sortedItemsDesc = await page.locator('[data-file-path]').allTextContents();
    
    // 7. Assert order changed (zzz should come before aaa)
    const zzzIndex = sortedItemsDesc.findIndex(item => item.includes('folder-zzz'));
    const aaaIndex = sortedItemsDesc.findIndex(item => item.includes('folder-aaa'));
    expect(zzzIndex).toBeLessThan(aaaIndex);

    // 8. Set sort mode to name-asc
    await setSortMode(page, 'name-asc');
    
    // 9. Get sorted item order
    const sortedItemsAsc = await page.locator('[data-file-path]').allTextContents();
    
    // 10. Assert order changed back (aaa should come before zzz)
    const aaaIndexAsc = sortedItemsAsc.findIndex(item => item.includes('folder-aaa'));
    const zzzIndexAsc = sortedItemsAsc.findIndex(item => item.includes('folder-zzz'));
    expect(aaaIndexAsc).toBeLessThan(zzzIndexAsc);
  });

  test('E2E-MOBILE-002: Action sheet opens from more button', async ({ page }, testInfo) => {
    // 1. Login as admin
    await loginAsAdmin(page);

    // 2. Create test file/folder for testing action sheet
    const folderName = buildName(testInfo, 'action-sheet-folder');
    await createTestFolder(page, folderName);
    
    // 3. Navigate to /files
    await page.goto('/files');
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // 4. Verify folder is visible before opening action sheet
    await expect(page.locator(`[data-file-path="/${folderName}"]`)).toBeVisible();

    // 5. Open action sheet for the folder
    await openActionSheet(page, `/${folderName}`);

    // 6. Assert action sheet is visible (SwipeableDrawer renders as [role="dialog"])
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    // 7. Assert action sheet contains the folder name in header
    await expect(page.locator('[role="dialog"]')).toContainText(folderName);

    // 8. Assert action items are visible (some common actions)
    // Preview may not be available for folders, but Properties, Download, Rename, etc. should be
    await expect(page.locator('[data-testid="file-action-properties"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-action-rename"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-action-move"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-action-copy"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-action-delete"]')).toBeVisible();

    // 9. Click on Properties action to verify it works
    await clickActionSheetItem(page, 'properties');

    // 10. Assert properties dialog opened
    await expect(page.getByRole('dialog', { name: /properties/i })).toBeVisible();
  });
});
