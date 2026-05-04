import { expect, test } from '@playwright/test';

import { loginAsAdmin } from './helpers/auth';
import { openFabAction } from './helpers/explorer';
import { buildName } from './helpers/files';
import { longPressItem, toggleFolderTree, openActionSheet, closeActionSheet } from './helpers/mobile-interactions';

async function createTestFolder(page: any, folderName: string) {
  await openFabAction(page, 'Create folder');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('create-folder-name-input')).toBeVisible();
  await dialog.getByTestId('create-folder-name-input').fill(folderName);
  await dialog.getByTestId('create-folder-submit').click();
}

async function createTestFile(page: any, fileName: string) {
  await openFabAction(page, 'Upload file');
  const dialog = page.getByRole('dialog');
  const fileInput = dialog.getByTestId('upload-dialog-file-input');
  await expect(fileInput).toBeVisible();
  
  // Upload a dummy file
  await fileInput.setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('test content'),
  });

  await dialog.getByTestId('upload-dialog-submit').click();
  await expect(dialog).not.toBeVisible();
}

test.describe('explorer advanced (mobile)', () => {
  test('E2E-MOBILE-001: Long-press enters selection mode', async ({ page }, testInfo) => {
    // Log browser console messages to the terminal
    page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));
 
    // 1. Login as admin
    await loginAsAdmin(page);
 
    // 2. Setup: Create a test file in root
    const fileName = buildName(testInfo, 'mobile-long-press') + '.txt';
    await createTestFile(page, fileName);
 
    // 3. Navigate to /files
    await page.goto('/files');
    await page.waitForLoadState('networkidle');
    
    // Wait for refresh indicator to be fully invisible (opacity 0) to ensure layout is stable
    const refreshIndicator = page.getByTestId('refresh-indicator');
    try {
      await expect(refreshIndicator).toHaveCSS('opacity', '0', { timeout: 5000 });
    } catch (e) {
      // Indicator might have already been invisible
    }
    
    // Give a larger buffer for layout stabilization (CSS transitions take up to 0.3s)
    await page.waitForTimeout(1000);
 
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();
 
    // 4. Trigger Long-Press on the file
    await longPressItem(page, `/${fileName}`);
 
    // 5. Verify Selection Mode UI (Active): Bulk action buttons should be visible
    await expect(page.getByTestId('bulk-action-move')).toBeVisible();
    await expect(page.getByTestId('bulk-action-copy')).toBeVisible();
    await expect(page.getByTestId('bulk-action-download')).toBeVisible();
    await expect(page.getByTestId('bulk-action-delete')).toBeVisible();
    await expect(page.getByTestId('bulk-action-select-all')).toBeVisible();
    await expect(page.getByTestId('bulk-action-deselect-all')).toBeVisible();
 
    // 6. Verify Selection Mode UI (Inactive): Normal control buttons should be hidden
    await expect(page.getByTestId('file-manager-sort')).not.toBeVisible();
    // View mode toggle buttons are usually identified by their role and name, 
    // and we can check if they are not visible.
    await expect(page.getByTestId('view-mode-list')).not.toBeVisible();
    await expect(page.getByTestId('view-mode-grid')).not.toBeVisible();
    await expect(page.getByTestId('view-mode-detail')).not.toBeVisible();
 
    // 7. Verify Item Selection: The long-pressed item should have the visual selection indicator
    await expect(page.locator(`[data-file-path="/${fileName}"]`)).toHaveAttribute('aria-selected', 'true');
  });
 
  test('E2E-MOBILE-002: Action sheet opens from more button', async ({ page }, testInfo) => {
    // 1. Login as admin
    await loginAsAdmin(page);
 
    // 2. Setup: Create a test file in root
    const fileName = buildName(testInfo, 'mobile-action-sheet') + '.txt';
    await createTestFile(page, fileName);
    const filePath = `/${fileName}`;
 
    // 3. Navigate to /files
    await page.goto('/files');
 
    // 4. Trigger Action Sheet (openActionSheet already guarantees it's open)
    await openActionSheet(page, filePath);

    // 5. Verify key actions are present — use direct selectors instead of [role="dialog"]
    // to avoid race conditions with SwipeableDrawer's CSS transition
    await expect(page.locator('[data-testid="file-action-rename"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-action-delete"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-action-share"]')).toBeVisible();
 
    // 6. Cleanup
    await closeActionSheet(page);
  });
 
  test('E2E-MOBILE-003: Breadcrumb toggle opens and closes folder tree section', async ({ page }, testInfo) => {

    // 1. Login as admin
    await loginAsAdmin(page);

    // 2. Setup: Create a test folder to ensure the tree has content
    const folderName = buildName(testInfo, 'mobile-tree-toggle');
    await createTestFolder(page, folderName);

    // 3. Navigate to /files
    await page.goto('/files');

    // 4. Open Folder Tree
    await toggleFolderTree(page);

    // 5. Verify Expansion
    // Check if the folder tree container is visible
    await expect(page.getByTestId('folder-tree')).toBeVisible();
    // Check if folder tree items are rendered (now that we created a folder)
    await expect(page.getByTestId('folder-tree-item').first()).toBeVisible();

    // 6. Close Folder Tree
    await toggleFolderTree(page);

    // 7. Verify Collapse
    // Check if the folder tree container is no longer visible
    await expect(page.getByTestId('folder-tree')).not.toBeVisible();
  });

  test('E2E-BULK-007: Conflict resolution dialog appears when move/copy would collide', async ({ page }, testInfo) => {
    // 1. Login as admin
    await loginAsAdmin(page);

    // 2. Setup: Create two folders, each containing a file with the same name
    const folderA = buildName(testInfo, 'mobile-conflict-folder-a');
    const folderB = buildName(testInfo, 'mobile-conflict-folder-b');
    const conflictFileName = 'mobile_conflict_test.txt';

    await createTestFolder(page, folderA);
    await createTestFolder(page, folderB);

    // Upload file to folderA
    await page.goto(`/files/${folderA}`);
    await createTestFile(page, conflictFileName);

    // Upload file to folderB
    await page.goto(`/files/${folderB}`);
    await createTestFile(page, conflictFileName);

    // 3. Action: Move file from folderA to folderB
    await page.goto(`/files/${folderA}`);
    await longPressItem(page, `/${folderA}/${conflictFileName}`);
    
    // Trigger bulk move
    await page.getByTestId('bulk-action-move').click();
    
    // Select folderB in the folder picker
    const pickerDialog = page.getByRole('dialog');
    await expect(pickerDialog).toBeVisible();
    
    // Navigate to root via breadcrumb to find folderB
    const breadcrumbs = pickerDialog.locator('.MuiBreadcrumbs-root button');
    await breadcrumbs.first().click();
    
    // Wait for loading to finish
    await expect(pickerDialog.getByRole('progressbar')).not.toBeVisible();
    
    // Select folderB
    await pickerDialog.locator('li').filter({ hasText: folderB }).click();
    await pickerDialog.getByRole('button', { name: 'Select', exact: true }).click();

    // 4. Assertion: Verify conflict resolution dialog appears
    const conflictDialog = page.getByRole('dialog');
    await expect(conflictDialog).toBeVisible();
    
    await expect(conflictDialog).toContainText('conflict', { ignoreCase: true });
    await expect(conflictDialog.getByRole('button', { name: /skip/i })).toBeVisible();
    await expect(conflictDialog.getByRole('button', { name: /merge/i })).toBeVisible();
  });
});
