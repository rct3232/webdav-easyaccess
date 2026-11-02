import { Page, expect } from '@playwright/test';

/**
 * Switch view mode in FileManagerControls
 * @param page Playwright page
 * @param mode View mode: 'list' | 'grid' | 'detail'
 */
export async function switchViewMode(page: Page, mode: 'list' | 'grid' | 'detail'): Promise<void> {
  const testIds = {
    list: 'view-mode-list',
    grid: 'view-mode-grid',
    detail: 'view-mode-detail',
  };

  const button = page.getByTestId(testIds[mode]);
  await button.click();

  // Wait for view mode to change
  await page.waitForTimeout(500);
}

/**
 * Set sort mode in FileManagerControls
 * @param page Playwright page
 * @param mode Sort mode: 'name-asc' | 'name-desc' | 'date-asc' | 'date-desc'
 */
export async function setSortMode(
  page: Page,
  mode: 'name-asc' | 'name-desc' | 'date-asc' | 'date-desc'
): Promise<void> {
  // Click sort button to open menu - use test id for stability
  const sortButton = page.getByTestId('file-manager-sort');
  await sortButton.click();

  // Map mode to radio button value
  const sortValues = {
    'name-asc': 'name_asc',
    'name-desc': 'name_desc',
    'date-asc': 'date_asc',
    'date-desc': 'date_desc',
  };

  const value = sortValues[mode];

  // Find and click the radio button with the correct value
  const radio = page.locator(`[role="menu"] >> input[type="radio"][value="${value}"]`);
  await radio.click();

  // Wait for menu to close and sort to apply
  await page.waitForTimeout(500);
}

/**
 * Select a server sort option on the collections surface (P-2): the same
 * toolbar `file-manager-sort` button renders the flat five-option menu when
 * the collections list/archive surface is active. State is ephemeral —
 * nothing persists between navigations.
 * @param page Playwright page
 * @param option Server sort contract: 'activity' | 'name' | 'created' | 'updated' | 'similar'
 */
export async function setCollectionSort(
  page: Page,
  option: 'activity' | 'name' | 'created' | 'updated' | 'similar'
): Promise<void> {
  const sortButton = page.getByTestId('file-manager-sort');
  await sortButton.click();

  await page.getByTestId(`collections-sort-option-${option}`).click();

  // Menu closes on selection; the list re-fetch is asserted by the caller.
  await expect(page.getByRole('menu')).toHaveCount(0);
}

/**
 * Search in FloatingSearchBar
 * @param page Playwright page
 * @param query Search query
 */
export async function searchInExplorer(page: Page, query: string): Promise<void> {
  const searchbox = page.getByRole('searchbox');
  await searchbox.fill(query);

  // Wait for search results
  await page.waitForTimeout(500);
}

/**
 * Get visible items in the current folder
 * @param page Playwright page
 * @returns Array of visible item paths
 */
export async function getVisibleItems(page: Page): Promise<string[]> {
  const itemLocators = page.locator('[data-file-path]');
  const items = await itemLocators.allTextContents();

  // Extract paths from data-file-path attribute
  const paths = [];
  for (const locator of await itemLocators.all()) {
    const path = await locator.getAttribute('data-file-path');
    if (path) {
      paths.push(path);
    }
  }

  return paths;
}
