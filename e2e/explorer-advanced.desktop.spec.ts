import { expect, test } from '@playwright/test';

import { loginAsAdmin } from './helpers/auth';
import { openFabAction } from './helpers/explorer';
import { buildName } from './helpers/files';
import { switchViewMode, setSortMode } from './helpers/explorer-advanced';
import { doubleClickItem, ctrlClickItem, shiftClickItem, clickEmptyArea, rightClickItem } from './helpers/desktop-interactions';

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

test.describe('explorer advanced (desktop)', () => {
  test('E2E-DESKTOP-001: Double-click behavior (Folder Entry & File Preview)', async ({ page }, testInfo) => {
    // 1. Login as admin
    await loginAsAdmin(page);

    // 2. Setup: Create a test folder and a test file in root
    const folderName = buildName(testInfo, 'folder-1');
    const fileName = buildName(testInfo, 'file-1') + '.txt';
    await createTestFolder(page, folderName);
    await createTestFile(page, fileName);

    // 3. Navigate to /files
    await page.goto('/files');
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // 4. Folder Interaction: Double-click folder to enter
    await doubleClickItem(page, `/${folderName}`);
    
    // 5. Assertion: Verify breadcrumb current path updates
    // We expect the last chip in the breadcrumb to be the folder name
    const breadcrumbChips = page.locator('.MuiChip-root');
    const lastChip = breadcrumbChips.last();
    await expect(lastChip).toContainText(folderName);

    // 6. Navigate back to root to test file preview
    // Clicking the root breadcrumb chip (usually the first one)
    await page.locator('.MuiChip-root').first().click();

    // 7. File Interaction: Double-click file to preview
    await doubleClickItem(page, `/${fileName}`);

    // 8. Assertion: Verify preview pane is visible and contains the file name
    const previewPane = page.getByTestId('file-preview-dialog');
    await expect(previewPane).toBeVisible();
    await expect(previewPane).toContainText(fileName);
  });

  test('E2E-DESKTOP-002: Ctrl-click multi-selection toggle', async ({ page }, testInfo) => {
    // 1. Login as admin
    await loginAsAdmin(page);

    // 2. Setup: Create 3 test files in root
    const file1 = buildName(testInfo, 'file-1') + '.txt';
    const file2 = buildName(testInfo, 'file-2') + '.txt';
    const file3 = buildName(testInfo, 'file-3') + '.txt';
    await createTestFile(page, file1);
    await createTestFile(page, file2);
    await createTestFile(page, file3);

    // 3. Navigate to /files
    await page.goto('/files');
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // 4. Multi-selection: Ctrl-click file1 and file3
    await ctrlClickItem(page, `/${file1}`);
    await ctrlClickItem(page, `/${file3}`);

    // 5. Assertion: Verify file1 and file3 are selected, file2 is not
    await expect(page.locator(`[data-file-path="/${file1}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(`[data-file-path="/${file3}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(`[data-file-path="/${file2}"]`)).not.toHaveAttribute('aria-selected', 'true');

    // 6. Selection Toggle (Off): Ctrl-click file1 again
    await ctrlClickItem(page, `/${file1}`);

    // 7. Assertion: Verify file1 is no longer selected, file3 remains selected
    await expect(page.locator(`[data-file-path="/${file1}"]`)).not.toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(`[data-file-path="/${file3}"]`)).toHaveAttribute('aria-selected', 'true');
  });

  test('E2E-DESKTOP-003: Shift-click range selection', async ({ page }, testInfo) => {
    // 1. Login as admin
    await loginAsAdmin(page);

    // 2. Setup: Create 3 test files in root
    const file1 = buildName(testInfo, 'range-1') + '.txt';
    const file2 = buildName(testInfo, 'range-2') + '.txt';
    const file3 = buildName(testInfo, 'range-3') + '.txt';
    await createTestFile(page, file1);
    await createTestFile(page, file2);
    await createTestFile(page, file3);

    // 3. Navigate to /files
    await page.goto('/files');
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // 4. Range Selection: Click file1 then Shift-click file3
    const item1 = page.locator(`[data-file-path="/${file1}"]`);
    await item1.click();
    await shiftClickItem(page, `/${file3}`);

    // 5. Assertion: Verify all items from anchor to target are selected
    await expect(page.locator(`[data-file-path="/${file1}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(`[data-file-path="/${file2}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(`[data-file-path="/${file3}"]`)).toHaveAttribute('aria-selected', 'true');
  });

  test('E2E-DESKTOP-004: Clear selection on empty area click', async ({ page }, testInfo) => {
    // 1. Login as admin
    await loginAsAdmin(page);

    // 2. Setup: Create a test file
    const fileName = buildName(testInfo, 'clear-sel') + '.txt';
    await createTestFile(page, fileName);

    // 3. Navigate to /files
    await page.goto('/files');
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // 4. Select the file
    await page.locator(`[data-file-path="/${fileName}"]`).click();
    await expect(page.locator(`[data-file-path="/${fileName}"]`)).toHaveAttribute('aria-selected', 'true');

    // 5. Click empty area to clear selection
    await clickEmptyArea(page);

    // 6. Assertion: Verify no items are selected
    await expect(page.locator('[aria-selected="true"]')).toHaveCount(0);
  });

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

  test('E2E-DESKTOP-005: Right-click context menu', async ({ page }, testInfo) => {
    // 1. Login as admin
    await loginAsAdmin(page);

    // 2. Setup: Create a test file
    const fileName = buildName(testInfo, 'context-menu') + '.txt';
    await createTestFile(page, fileName);

    // 3. Navigate to /files
    await page.goto('/files');
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // 4. Right-click the file
    await rightClickItem(page, `/${fileName}`);

    // 5. Assertion: Verify context menu is visible
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // 6. Content Verification: Verify "Rename" and "Delete" items are present
    await expect(menu).toContainText('Rename');
    await expect(menu).toContainText('Delete');
  });

  test('E2E-BULK-005: Desktop multi-download is available', async ({ page }, testInfo) => {
    // 1. Login as admin
    await loginAsAdmin(page);

    // 2. Setup: Create 3 test files in root
    const files = [
      buildName(testInfo, 'multi-dl-1', '.txt'),
      buildName(testInfo, 'multi-dl-2', '.jpg'),
      buildName(testInfo, 'multi-dl-3', '.pdf'),
    ];

    for (const fileName of files) {
      await createTestFile(page, fileName);
    }

    // 3. Navigate to /files
    await page.goto('/files');

    // 4. Multi-selection: Select all 3 files
    await page.locator(`[data-file-path="/${files[0]}"]`).click();
    await ctrlClickItem(page, `/${files[1]}`);
    await ctrlClickItem(page, `/${files[2]}`);

    // 5. Assertion: Verify bulk download button is visible and enabled
    const downloadBtn = page.getByTestId('bulk-action-download');
    await expect(downloadBtn).toBeVisible();
    await expect(downloadBtn).toBeEnabled();
  });

  test('E2E-BULK-007: Conflict resolution dialog appears when move/copy would collide', async ({ page }, testInfo) => {
    // 1. Login as admin
    await loginAsAdmin(page);

    // 2. Setup: Create two folders, each containing a file with the same name
    const folderA = buildName(testInfo, 'conflict-folder-a');
    const folderB = buildName(testInfo, 'conflict-folder-b');
    const conflictFileName = 'conflict_test.txt';

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
    await page.locator(`[data-file-path="/${folderA}/${conflictFileName}"]`).click();

    // Trigger bulk move
    await page.getByTestId('bulk-action-move').click();

    // Select folderB in the folder picker
    const pickerDialog = page.getByRole('dialog');
    await expect(pickerDialog).toBeVisible();

    // Navigate to root via breadcrumb to find folderB
    const rootBreadcrumb = pickerDialog.locator('.MuiBreadcrumbs-root button').first();
    await rootBreadcrumb.click();
    
    // Wait for the folder list to be populated and the loader to disappear
    await expect(pickerDialog.getByRole('progressbar')).not.toBeVisible();
    
    // Select folderB - ensure we wait for it to be attached and visible
    const folderBItem = pickerDialog.locator('li').filter({ hasText: folderB });
    await expect(folderBItem).toBeVisible({ timeout: 10000 });
    await folderBItem.click();
    await pickerDialog.getByRole('button', { name: 'Select', exact: true }).click();

    // 4. Assertion: Verify conflict resolution dialog appears
    const conflictDialog = page.getByRole('dialog');
    await expect(conflictDialog).toBeVisible();
    
    await expect(conflictDialog).toContainText('conflict', { ignoreCase: true });
    await expect(conflictDialog.getByRole('button', { name: /skip/i })).toBeVisible();
    await expect(conflictDialog.getByRole('button', { name: /merge/i })).toBeVisible();
  });
});
