import { Page, expect } from '@playwright/test';

/**
 * Open the Action Sheet for a specific file/folder on mobile
 * Clicks the More (⋮) button on the item and waits for the bottom sheet to appear
 * 
 * @param page Playwright page
 * @param filePath The file path to open action sheet for (e.g., '/admin/test-file.txt')
 */
export async function openActionSheet(page: Page, filePath: string): Promise<void> {
  // Find the item with the matching data-file-path attribute
  const item = page.locator(`[data-file-path="${filePath}"]`);
  
  // Find the More button within this item (aria-label="More actions")
  const moreButton = item.locator('[aria-label="More actions"]');
  
  // Verify the button exists before clicking
  await expect(moreButton).toBeVisible();
  
  // Click the More button
  await moreButton.click();
  
  // Wait for the Action Sheet (SwipeableDrawer) to become visible
  // The drawer has anchor="bottom" and contains the file actions
  const actionSheet = page.locator('[role="dialog"]');
  await expect(actionSheet).toBeVisible();
}

/**
 * Close the Action Sheet on mobile
 * 
 * @param page Playwright page
 */
export async function closeActionSheet(page: Page): Promise<void> {
  // Click outside the drawer or press Escape to close
  await page.keyboard.press('Escape');
  
  // Wait for the drawer to close
  const actionSheet = page.locator('[role="dialog"]');
  await expect(actionSheet).not.toBeVisible();
}

/**
 * Click a specific action in the Action Sheet
 * 
 * @param page Playwright page
 * @param action The action to click: 'preview' | 'properties' | 'download' | 'rename' | 'move' | 'copy' | 'share' | 'delete'
 */
export async function clickActionSheetItem(
  page: Page,
  action: 'preview' | 'properties' | 'download' | 'rename' | 'move' | 'copy' | 'share' | 'delete'
): Promise<void> {
  const actionSelector = `[data-testid="file-action-${action}"]`;
  const actionItem = page.locator(actionSelector);
  
  await expect(actionItem).toBeVisible();
  await actionItem.click();
}

/**
 * Perform a long press on a file/folder item on mobile
 * 
 * @param page Playwright page
 * @param filePath The file path to long press
 */
export async function longPressItem(page: Page, filePath: string): Promise<void> {
  const item = page.locator(`[data-file-path="${filePath}"]`);
  await expect(item).toBeVisible();
  
  const box = await item.boundingBox();
  if (!box) throw new Error(`Could not get bounding box for item ${filePath}`);
  
  // Move to center of element
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Long press duration (e.g., 500ms)
  await page.waitForTimeout(500);
  await page.mouse.up();
}

/**
 * Toggle the folder tree using the breadcrumb toggle button on mobile
 * 
 * @param page Playwright page
 */
export async function toggleFolderTree(page: Page): Promise<void> {
  const toggleButton = page.getByTestId('breadcrumb-folder-tree-toggle');
  
  await expect(toggleButton).toBeVisible();
  await toggleButton.click();
}
