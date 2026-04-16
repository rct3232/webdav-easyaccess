import { expect, test } from '@playwright/test';

import { loginAsAdmin } from './helpers/auth';
import { openFabAction } from './helpers/explorer';
import { buildName } from './helpers/files';
import { longPressItem, toggleFolderTree } from './helpers/mobile-interactions';

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
  test('E2E-MOBILE-001: Long-Press Selection', async ({ page }, testInfo) => {
    // 1. Login as admin
    await loginAsAdmin(page);

    // 2. Setup: Create a test file in root
    const fileName = buildName(testInfo, 'mobile-long-press') + '.txt';
    await createTestFile(page, fileName);

    // 3. Navigate to /files
    await page.goto('/files');
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // 4. Trigger Long-Press on the file
    await longPressItem(page, `/${fileName}`);

    // 5. Verify Selection Mode UI (Active): Bulk action buttons should be visible
    await expect(page.locator('[title="actions.move"]')).toBeVisible();
    await expect(page.locator('[title="actions.copy"]')).toBeVisible();
    await expect(page.locator('[title="actions.download"]')).toBeVisible();
    await expect(page.locator('[title="actions.delete"]')).toBeVisible();
    await expect(page.locator('[title="fileManager.selectAll"]')).toBeVisible();
    await expect(page.locator('[title="fileManager.deselectAll"]')).toBeVisible();

    // 6. Verify Selection Mode UI (Inactive): Normal control buttons should be hidden
    await expect(page.locator('[title="fileManager.sort"]')).not.toBeVisible();
    // View mode toggle buttons are usually identified by their role and name, 
    // and we can check if they are not visible.
    await expect(page.getByRole('button', { name: /list view/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /grid view/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /detail view/i })).not.toBeVisible();

    // 7. Verify Item Selection: The long-pressed item should have the visual selection indicator
    await expect(page.locator(`[data-file-path="/${fileName}"]`)).toHaveAttribute('aria-selected', 'true');
  });

  test('E2E-MOBILE-003: Folder Tree Toggle', async ({ page }, testInfo) => {
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
});
