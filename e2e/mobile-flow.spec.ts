import { expect, Page, test } from '@playwright/test';

import { TEST_FILES } from './fixtures/test-data';
import { loginAsAdmin } from './helpers/auth';
import { buildName, fileItem, readTestFileFixture } from './helpers/files';

const textFixtureBuffer = readTestFileFixture(TEST_FILES.smallText);

async function openFabAction(page: Page, actionName: string) {
  await page.getByTestId('file-actions-fab').click();

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();

  const action = page.locator(`[role="menuitem"][aria-label="${actionName}"]:visible`).first();
  await expect(action).toBeVisible();
  await action.click();
}

async function openItemActions(page: Page, targetPath: string) {
  const item = fileItem(page, targetPath);
  await expect(item).toBeVisible();
  await item.getByLabel('More actions').click();
}

test('logs in and lands in the explorer', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page).toHaveURL(/\/files(?:\/.*)?$/);
  await expect(page.getByTestId('file-actions-fab')).toBeVisible();
});

test('creates a folder from the file actions fab', async ({ page }, testInfo) => {
  const folderName = buildName(testInfo, 'flow-folder');

  await loginAsAdmin(page);
  await openFabAction(page, 'Create folder');

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('create-folder-name-input')).toBeVisible();
  await dialog.getByTestId('create-folder-name-input').fill(folderName);
  await dialog.getByTestId('create-folder-submit').click();

  await expect(fileItem(page, `/${folderName}`)).toBeVisible();
});

test('uploads a file from the upload dialog', async ({ page }, testInfo) => {
  const fileName = buildName(testInfo, 'flow-upload', '.txt');

  await loginAsAdmin(page);
  await openFabAction(page, 'Upload file');

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('upload-dialog-file-input')).toBeAttached();
  await dialog.getByTestId('upload-dialog-file-input').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await dialog.getByTestId('upload-dialog-submit').click();

  await expect(fileItem(page, `/${fileName}`)).toBeVisible();
});

test('renames and deletes a folder through file actions', async ({ page }, testInfo) => {
  const originalName = buildName(testInfo, 'flow-rename-source');
  const renamedName = buildName(testInfo, 'flow-renamed');
  const originalPath = `/${originalName}`;
  const renamedPath = `/${renamedName}`;

  await loginAsAdmin(page);

  await openFabAction(page, 'Create folder');
  let dialog = page.getByRole('dialog');
  await dialog.getByTestId('create-folder-name-input').fill(originalName);
  await dialog.getByTestId('create-folder-submit').click();
  await expect(fileItem(page, originalPath)).toBeVisible();

  await openItemActions(page, originalPath);
  await expect(page.getByTestId('file-action-rename')).toBeVisible();
  await page.getByTestId('file-action-rename').click();

  dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('rename-name-input')).toBeVisible();
  await dialog.getByTestId('rename-name-input').fill(renamedName);
  await dialog.getByTestId('rename-submit').click();

  await expect(fileItem(page, renamedPath)).toBeVisible();
  await expect(fileItem(page, originalPath)).toHaveCount(0);

  await openItemActions(page, renamedPath);
  await expect(page.getByTestId('file-action-delete')).toBeVisible();
  await page.getByTestId('file-action-delete').click();

  dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('confirm-dialog-confirm')).toBeVisible();
  await dialog.getByTestId('confirm-dialog-confirm').click();

  await expect(fileItem(page, renamedPath)).toHaveCount(0);
});
