import { type APIRequestContext, type Page, expect } from '@playwright/test';

import { openItemActions } from './explorer';
import { fileItem } from './files';
import { clickActionSheetItem, openActionSheet } from './mobile-interactions';

/**
 * Shared trash-flow helpers (DEF-16 P9).
 */

/**
 * Permanently delete a trashed item by exact name via the admin trash API.
 * Used for per-case cleanup only (the UI purge flow is covered by
 * E2E-TRASH-006). Tolerant of the item no longer being in the trash.
 */
export async function purgeTrashedItemByName(
  request: APIRequestContext,
  token: string,
  name: string
): Promise<void> {
  const res = await request.get('/api/files/trash', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok()) return;
  const body = await res.json();
  const match = (body?.items ?? []).find((item: { name: string }) => item.name === name);
  if (!match?.nodeId) return;
  const purge = await request.post('/api/files/trash/purge', {
    headers: { Authorization: `Bearer ${token}` },
    data: { nodeId: match.nodeId },
  });
  expect(purge.ok()).toBeTruthy();
}

/**
 * Platform seam for the trash per-item actions (desktop context menu vs mobile
 * action sheet). The trash action sheet has no rename row, so the shared
 * openActionSheet helper (which waits for `file-action-rename`) is not
 * reusable here; the same More-button entry is awaited against the trash
 * action rows instead.
 */
export async function openTrashItemActions(
  page: Page,
  isMobile: boolean,
  targetPath: string,
  action: 'restore' | 'purge'
): Promise<void> {
  if (isMobile) {
    const item = fileItem(page, targetPath);
    await expect(item).toBeVisible();
    await Promise.all([
      page.waitForSelector(`[data-testid="trash-action-${action}"]`, {
        state: 'visible',
        timeout: 5000,
      }),
      item.locator('[aria-label="More actions"]').click(),
    ]);
    await page.getByTestId(`trash-action-${action}`).click();
  } else {
    await openItemActions(page, targetPath);
    await page.getByTestId(`trash-action-${action}`).click();
  }
}

/** Shared live-folder delete flow (platform-specific action seam). */
export async function deleteItemViaUi(page: Page, isMobile: boolean, targetPath: string) {
  if (isMobile) {
    await openActionSheet(page, targetPath);
    await clickActionSheetItem(page, 'delete');
  } else {
    await openItemActions(page, targetPath);
    await page.getByTestId('file-action-delete').click();
  }
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('confirm-dialog-confirm')).toBeVisible();
  await dialog.getByTestId('confirm-dialog-confirm').click();
}
