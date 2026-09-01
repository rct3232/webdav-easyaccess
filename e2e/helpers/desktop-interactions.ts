import { Page, expect } from '@playwright/test';

/**
 * Double-click an item in the explorer
 *
 * @param page Playwright page
 * @param filePath The file path of the item to double-click
 */
export async function doubleClickItem(page: Page, filePath: string): Promise<void> {
  const item = page.locator(`[data-file-path="${filePath}"]`);
  await expect(item).toBeVisible();
  await item.dblclick();
}

/**
 * Ctrl-click an item in the explorer to toggle selection
 *
 * @param page Playwright page
 * @param filePath The file path of the item to ctrl-click
 */
export async function ctrlClickItem(page: Page, filePath: string): Promise<void> {
  const item = page.locator(`[data-file-path="${filePath}"]`);
  await expect(item).toBeVisible();

  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await item.click({ modifiers: [modifier] });
}

/**
 * Shift-click an item in the explorer to perform range selection
 *
 * @param page Playwright page
 * @param filePath The file path of the item to shift-click
 */
export async function shiftClickItem(page: Page, filePath: string): Promise<void> {
  const item = page.locator(`[data-file-path="${filePath}"]`);
  await expect(item).toBeVisible();
  await item.click({ modifiers: ['Shift'] });
}

/**
 * Right-click an item in the explorer to open the context menu
 *
 * @param page Playwright page
 * @param filePath The file path of the item to right-click
 */
export async function rightClickItem(page: Page, filePath: string): Promise<void> {
  const item = page.locator(`[data-file-path="${filePath}"]`);
  await expect(item).toBeVisible();
  await item.click({ button: 'right' });
}

/**
 * Click an empty area of the explorer to clear selection
 *
 * @param page Playwright page
 */
export async function clickEmptyArea(page: Page): Promise<void> {
  // Find the main explorer container
  const explorer = page.locator('[data-testid="explorer-container"]');
  await expect(explorer).toBeVisible();

  // Get the bounding box of the explorer to find a safe empty area
  const box = await explorer.boundingBox();
  if (!box) {
    throw new Error('Could not find bounding box for explorer container');
  }

  // Click a safe offset area (e.g., center of the container, but shifted
  // to avoid potentially overlapping items if the explorer is empty)
  // In a real scenario, we might want to find a specific empty slot or
  // use a more robust way to clear selection.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
