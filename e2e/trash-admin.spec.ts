import { TEST_FILES } from './fixtures/test-data';
import { ADMIN_STATE, expect, test } from './fixtures/authenticated';
import {
  buildName,
  fileItem,
  flushPrivateWorkspaceCleanups,
  openPrivateWorkspace,
  readTestFileFixture,
  uploadFileViaUi,
} from './helpers/files';
import { deleteItemViaUi } from './helpers/trash';

test.use({ storageState: ADMIN_STATE });

/**
 * E2E-TRASH-007 — the GLOBAL destructive trash case, owned by its own spec so
 * it runs in exactly ONE project (desktop; see `desktopSpecMatch` in
 * playwright.config.ts). Empty trash purges every visible item for all users,
 * so two projects running it concurrently (or running it while another
 * project's trash cases are mid-flight) makes the "listing is empty"
 * assertion racy. Platform seams for the trash UI stay covered by
 * trash.spec.ts on both platforms.
 */
const textFixtureBuffer = readTestFileFixture(TEST_FILES.smallText);

test.afterEach(async ({ request }) => {
  await flushPrivateWorkspaceCleanups(request);
});

test('E2E-TRASH-007: Empty trash purges all visible trashed items', async ({
  page,
  request,
}, testInfo) => {
  const base = await openPrivateWorkspace(page, request, testInfo);
  const fileName = buildName(testInfo, 'trash-empty-item', '.txt');
  const filePath = `/${base}/${fileName}`;

  await uploadFileViaUi(page, {
    fileName,
    mimeType: 'text/plain',
    buffer: textFixtureBuffer,
  });
  await expect(fileItem(page, filePath)).toBeVisible();

  // Trash via the UI desktop seam (this project is desktop-only).
  await deleteItemViaUi(page, false, filePath);
  await expect(fileItem(page, filePath)).toHaveCount(0);

  await page.goto('/files/__trash__');
  await expect(fileItem(page, filePath)).toBeVisible({ timeout: 10_000 });

  // Admin-only empty-trash icon button in the controls row; the confirm copy
  // must state that it purges ALL trashed items for ALL users.
  const emptyButton = page.getByTestId('trash-empty');
  await expect(emptyButton).toBeVisible();
  await emptyButton.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(/all users|모든 사용자/i);
  await dialog.getByTestId('confirm-dialog-confirm').click();

  // The trash listing empties; the item does not return to the live folder.
  await expect(fileItem(page, filePath)).toHaveCount(0);
  await expect(page.getByText(/trash is empty|휴지통이 비어/i)).toBeVisible({
    timeout: 10_000,
  });
});
