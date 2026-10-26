import { ADMIN_STATE, expect, test } from './fixtures/authenticated';
import {
  buildName,
  createFolderViaUi,
  fileItem,
  flushPrivateWorkspaceCleanups,
  openPrivateWorkspace,
  uploadFileViaUi,
} from './helpers/files';
import {
  doubleClickItem,
  ctrlClickItem,
  shiftClickItem,
  clickEmptyArea,
  rightClickItem,
} from './helpers/desktop-interactions';
import { gotoFilesPath, resolveNodeId } from './helpers/resolvePath';

async function createTestFolder(page: any, folderName: string) {
  await createFolderViaUi(page, folderName);
}

async function createTestFile(page: any, fileName: string) {
  await uploadFileViaUi(page, {
    fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('test content'),
  });
  // The upload dialog closes before the background upload lands; wait for the
  // row before a following navigation or selection can race the upload.
  await expect(page.locator(`[data-file-path$="/${fileName}"]`)).toBeVisible({ timeout: 30_000 });
}

test.use({ storageState: ADMIN_STATE });

test.describe('core flow (desktop)', () => {
  test.afterEach(async ({ request }) => {
    await flushPrivateWorkspaceCleanups(request);
  });

  test('E2E-DESKTOP-001: Double-click opens folder or preview', async ({
    page,
    request,
  }, testInfo) => {
    // 1. Open the per-test workspace (logs in as admin and enters its base folder)
    const base = await openPrivateWorkspace(page, request, testInfo);

    // 2. Setup: Create a test folder and a test file inside the base folder
    const folderName = buildName(testInfo, 'folder-1');
    const fileName = buildName(testInfo, 'file-1') + '.txt';
    await createTestFolder(page, folderName);
    await createTestFile(page, fileName);

    // 3. Reload the base folder listing
    await gotoFilesPath(page, request, `/${base}`);
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // 4. Folder Interaction: Double-click folder to enter
    await doubleClickItem(page, `/${base}/${folderName}`);

    // 5. Assertion: Verify breadcrumb current path updates
    // We expect the last chip in the breadcrumb to be the folder name
    const breadcrumbChips = page.locator('.MuiChip-root');
    const lastChip = breadcrumbChips.last();
    await expect(lastChip).toContainText(folderName);

    // 6. Navigate back to the base folder listing to test file preview
    // Clicking the base breadcrumb chip (the listing that holds the file)
    await page.locator('.MuiChip-root').filter({ hasText: base }).click();

    // 7. File Interaction: Double-click file to preview
    await doubleClickItem(page, `/${base}/${fileName}`);

    // 8. Assertion: Verify preview pane is visible and contains the file name
    const previewPane = page.getByTestId('file-preview-dialog');
    await expect(previewPane).toBeVisible();
    await expect(previewPane).toContainText(fileName);
  });

  test('E2E-DESKTOP-002: Ctrl/Meta-click toggles multi-selection', async ({
    page,
    request,
  }, testInfo) => {
    // 1. Open the per-test workspace (logs in as admin and enters its base folder)
    const base = await openPrivateWorkspace(page, request, testInfo);

    // 2. Setup: Create 3 test files inside the base folder
    const file1 = buildName(testInfo, 'file-1') + '.txt';
    const file2 = buildName(testInfo, 'file-2') + '.txt';
    const file3 = buildName(testInfo, 'file-3') + '.txt';
    await createTestFile(page, file1);
    await createTestFile(page, file2);
    await createTestFile(page, file3);

    // 3. Reload the base folder listing
    await gotoFilesPath(page, request, `/${base}`);
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // 4. Multi-selection: Ctrl-click file1 and file3
    await ctrlClickItem(page, `/${base}/${file1}`);
    await ctrlClickItem(page, `/${base}/${file3}`);

    // 5. Assertion: Verify file1 and file3 are selected, file2 is not
    await expect(page.locator(`[data-file-path="/${base}/${file1}"]`)).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator(`[data-file-path="/${base}/${file3}"]`)).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator(`[data-file-path="/${base}/${file2}"]`)).not.toHaveAttribute(
      'aria-selected',
      'true'
    );

    // 6. Selection Toggle (Off): Ctrl-click file1 again
    await ctrlClickItem(page, `/${base}/${file1}`);

    // 7. Assertion: Verify file1 is no longer selected, file3 remains selected
    await expect(page.locator(`[data-file-path="/${base}/${file1}"]`)).not.toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator(`[data-file-path="/${base}/${file3}"]`)).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test('E2E-DESKTOP-003: Shift-click performs range selection', async ({
    page,
    request,
  }, testInfo) => {
    // 1. Open the per-test workspace (logs in as admin and enters its base folder)
    const base = await openPrivateWorkspace(page, request, testInfo);

    // 2. Setup: Create 3 test files inside the base folder
    const file1 = buildName(testInfo, 'range-1') + '.txt';
    const file2 = buildName(testInfo, 'range-2') + '.txt';
    const file3 = buildName(testInfo, 'range-3') + '.txt';
    await createTestFile(page, file1);
    await createTestFile(page, file2);
    await createTestFile(page, file3);

    // 3. Reload the base folder listing
    await gotoFilesPath(page, request, `/${base}`);
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // 4. Range Selection: Click file1 then Shift-click file3
    const item1 = page.locator(`[data-file-path="/${base}/${file1}"]`);
    await item1.click();
    await shiftClickItem(page, `/${base}/${file3}`);

    // 5. Assertion: Verify all items from anchor to target are selected
    await expect(page.locator(`[data-file-path="/${base}/${file1}"]`)).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator(`[data-file-path="/${base}/${file2}"]`)).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator(`[data-file-path="/${base}/${file3}"]`)).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test('E2E-DESKTOP-004: Clicking empty area exits selection mode', async ({
    page,
    request,
  }, testInfo) => {
    // 1. Open the per-test workspace (logs in as admin and enters its base folder)
    const base = await openPrivateWorkspace(page, request, testInfo);

    // 2. Setup: Create a test file inside the base folder
    const fileName = buildName(testInfo, 'clear-sel') + '.txt';
    await createTestFile(page, fileName);

    // 3. Reload the base folder listing
    await gotoFilesPath(page, request, `/${base}`);
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // 4. Select the file
    await page.locator(`[data-file-path="/${base}/${fileName}"]`).click();
    await expect(page.locator(`[data-file-path="/${base}/${fileName}"]`)).toHaveAttribute(
      'aria-selected',
      'true'
    );

    // 5. Click empty area to clear selection
    await clickEmptyArea(page);

    // 6. Assertion: Verify no items are selected
    await expect(page.locator('[aria-selected="true"]')).toHaveCount(0);
  });

  test('E2E-DESKTOP-005: Context menu opens per-item actions', async ({
    page,
    request,
  }, testInfo) => {
    // 1. Open the per-test workspace (logs in as admin and enters its base folder)
    const base = await openPrivateWorkspace(page, request, testInfo);

    // 2. Setup: Create a test file inside the base folder
    const fileName = buildName(testInfo, 'context-menu') + '.txt';
    await createTestFile(page, fileName);

    // 3. Reload the base folder listing
    await gotoFilesPath(page, request, `/${base}`);
    await expect(page.getByTestId('file-actions-fab')).toBeVisible();

    // 4. Right-click the file
    await rightClickItem(page, `/${base}/${fileName}`);

    // 5. Assertion: Verify context menu is visible
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // 6. Content Verification: Verify "Rename" and "Delete" items are present
    await expect(menu).toContainText('Rename');
    await expect(menu).toContainText('Delete');
  });

  test('E2E-BULK-005: Desktop multi-download is available', async ({ page, request }, testInfo) => {
    // 1. Open the per-test workspace (logs in as admin and enters its base folder)
    const base = await openPrivateWorkspace(page, request, testInfo);

    // 2. Setup: Create 3 test files inside the base folder
    const files = [
      buildName(testInfo, 'multi-dl-1', '.txt'),
      buildName(testInfo, 'multi-dl-2', '.jpg'),
      buildName(testInfo, 'multi-dl-3', '.pdf'),
    ];

    for (const fileName of files) {
      await createTestFile(page, fileName);
    }

    // 3. Reload the base folder listing
    await gotoFilesPath(page, request, `/${base}`);

    // 4. Multi-selection: Select all 3 files
    await page.locator(`[data-file-path="/${base}/${files[0]}"]`).click();
    await ctrlClickItem(page, `/${base}/${files[1]}`);
    await ctrlClickItem(page, `/${base}/${files[2]}`);

    // 5. Assertion: Verify bulk download button is visible and enabled
    const downloadBtn = page.getByTestId('bulk-action-download');
    await expect(downloadBtn).toBeVisible();
    await expect(downloadBtn).toBeEnabled();
  });
});
