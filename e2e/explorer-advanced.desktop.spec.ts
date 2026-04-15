import { expect, test } from '@playwright/test';

import { loginAsAdmin } from './helpers/auth';
import { openFabAction } from './helpers/explorer';
import { buildName } from './helpers/files';
import { switchViewMode, setSortMode } from './helpers/explorer-advanced';

async function createTestFolder(page: any, folderName: string) {
  await openFabAction(page, 'Create folder');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('create-folder-name-input')).toBeVisible();
  await dialog.getByTestId('create-folder-name-input').fill(folderName);
  await dialog.getByTestId('create-folder-submit').click();
}

test.describe('explorer advanced (desktop)', () => {
  test('E2E-EXP-009: View mode switch changes visible layout', async ({ page }, testInfo) => {
    // 1. Login as admin
    await loginAsAdmin(page);

    // 2. Create test folders first
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

    // 7. Switch to detail mode
    await switchViewMode(page, 'detail');
    
    // 8. Assert detail layout is visible (table row with data-file-path)
    await expect(page.locator(`table.MuiTable-root tbody tr[data-file-path="/${folderName}"]`)).toBeVisible();

    // 9. Switch back to list mode
    await switchViewMode(page, 'list');
    
    // 10. Assert list layout is visible again
    await expect(page.locator(`[data-file-path="/${folderName}"]`)).toBeVisible();
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

  test('E2E-EXP-011: Search filtering', async ({ page }, testInfo) => {
    // 1. Login as admin
    await loginAsAdmin(page);

    // 2. Create 3 test folders with distinct names
    const folderAlpha = buildName(testInfo, 'alpha');
    const folderBeta = buildName(testInfo, 'beta');
    const folderGamma = buildName(testInfo, 'gamma');
    
    await createTestFolder(page, folderAlpha);
    await createTestFolder(page, folderBeta);
    await createTestFolder(page, folderGamma);

    // 3. Navigate to /files
    await page.goto('/files');
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // 4. Verify all 3 folders are visible
    await expect(page.locator(`[data-file-path="/${folderAlpha}"]`)).toBeVisible();
    await expect(page.locator(`[data-file-path="/${folderBeta}"]`)).toBeVisible();
    await expect(page.locator(`[data-file-path="/${folderGamma}"]`)).toBeVisible();

    // 5. Fill searchbox with "beta"
    const searchbox = page.getByRole('searchbox');
    await expect(searchbox).toBeVisible();
    await searchbox.fill('beta');

    // 6. Assert only beta folder visible (search filters results)
    await expect(page.locator(`[data-file-path="/${folderBeta}"]`)).toBeVisible();
    await expect(page.locator(`[data-file-path="/${folderAlpha}"]`)).not.toBeVisible();
    await expect(page.locator(`[data-file-path="/${folderGamma}"]`)).not.toBeVisible();

    // 7. Click clear button (X icon) to clear search
    const clearButton = page.locator('[aria-label="Close search"]');
    await expect(clearButton).toBeVisible();
    await clearButton.click();

    // 8. Assert all folders visible again
    await expect(page.locator(`[data-file-path="/${folderAlpha}"]`)).toBeVisible();
    await expect(page.locator(`[data-file-path="/${folderBeta}"]`)).toBeVisible();
    await expect(page.locator(`[data-file-path="/${folderGamma}"]`)).toBeVisible();
  });
});
