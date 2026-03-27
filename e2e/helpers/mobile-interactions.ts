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
