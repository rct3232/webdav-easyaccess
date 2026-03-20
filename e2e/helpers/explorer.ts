import { expect, Page } from '@playwright/test';

import { fileItem } from './files';

export async function openFabAction(page: Page, actionName: string) {
  await page.getByTestId('file-actions-fab').click();

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();

  const action = menu.getByRole('menuitem', { name: actionName }).first();
  await expect(action).toBeVisible();
  await action.click();
}

export async function openItemActions(page: Page, targetPath: string) {
  const item = fileItem(page, targetPath);
  await expect(item).toBeVisible();
  await item.getByLabel('More actions').click();
}

export function breadcrumbChip(page: Page, segmentName: string) {
  return page.getByRole('button', { name: segmentName, exact: true }).last();
}
