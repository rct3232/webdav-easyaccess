import { type Page, type TestInfo } from '@playwright/test';

import { ensureApprovedUser, ensurePendingUser, getTestSuffix, loginAsUser } from './helpers/auth';
import { buildName } from './helpers/files';
import { getSessionToken, resolveNodeId } from './helpers/resolvePath';
import { TEST_USERS } from './fixtures/test-data';
import { ADMIN_STATE, expect, test } from './fixtures/authenticated';

test.use({ storageState: ADMIN_STATE });

test.describe.configure({ mode: 'serial' });

async function createFolderViaApi(request: any, bearerToken: string, folderPath: string) {
  const segments = folderPath.split('/').filter(Boolean);
  const name = segments[segments.length - 1];
  const parentPath = `/${segments.slice(0, -1).join('/')}`;

  const parentNodeId = await resolveNodeId(request, bearerToken, parentPath);

  const res = await request.post('/api/folders/create', {
    headers: { Authorization: `Bearer ${bearerToken}` },
    data: { parentNodeId, name },
  });

  // Idempotent prerequisite: if retries happen, conflict is acceptable.
  if (res.status() !== 409) {
    expect(res.ok()).toBeTruthy();
  }
}

function isMobileProject(testInfo: TestInfo) {
  return testInfo.project.name.endsWith('-mobile');
}

async function openMyPageCategoryAndVerify(
  page: Page,
  isMobile: boolean,
  category: 'Users' | 'System settings'
) {
  if (isMobile) {
    const menuButton = page.locator('button[aria-label="My page"]');
    const drawer = page.locator('.MuiDrawer-paper');

    await menuButton.click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: /Users/i })).toBeVisible();
    await expect(drawer.getByRole('button', { name: /System settings/i })).toBeVisible();
    await expect(drawer.getByRole('button', { name: /Preferences/i })).toBeVisible();
    await expect(drawer.getByRole('button', { name: /Share management/i })).toHaveCount(0);
    await drawer.getByRole('button', { name: new RegExp(category) }).click();
    await expect(drawer).not.toBeVisible();
  } else {
    const sidebar = page.locator('.MuiList-root').first();
    await expect(sidebar.getByRole('button', { name: /Users/i })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /System settings/i })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /Preferences/i })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /Share management/i })).toHaveCount(0);
    await sidebar.getByRole('button', { name: new RegExp(category) }).click();
  }

  await expect(page.getByRole('heading', { level: 6, name: new RegExp(category) })).toBeVisible();
}

async function openMyPageCategory(
  page: Page,
  isMobile: boolean,
  category: 'Users' | 'System settings'
) {
  if (isMobile) {
    const menuButton = page.locator('button[aria-label="My page"]');
    const drawer = page.locator('.MuiDrawer-paper');

    await menuButton.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: new RegExp(category) }).click();
    await expect(drawer).not.toBeVisible();
  } else {
    const sidebar = page.locator('.MuiList-root').first();
    await sidebar.getByRole('button', { name: new RegExp(category) }).click();
  }

  await expect(page.getByRole('heading', { level: 6, name: new RegExp(category) })).toBeVisible();
}

async function clickPendingUserCardButton(
  page: Page,
  isMobile: boolean,
  label: 'Approve' | 'Reject'
) {
  if (isMobile) {
    await page.evaluate((lbl) => {
      const buttons = document.querySelectorAll('button');
      const target = Array.from(buttons).find(
        (b) => b.textContent?.trim() === lbl && b.closest('[class*="Card"]')
      );
      if (target) {
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }, label);
    return;
  }

  const button = page.getByRole('button', { name: label }).first();
  await expect(button).toBeVisible();
  await button.click();
}

async function clickDialogAddButton(
  page: Page,
  isMobile: boolean,
  addUserResponse: Promise<unknown>
) {
  const dialog = page.getByRole('dialog');
  const submitButton = dialog.getByRole('button', { name: 'Add', exact: true });

  // The Add submit sits at the bottom of a fullscreen scrollable dialog. On
  // WebKit mobile a pointer click can intermittently fail to reach the button's
  // React onClick, so dispatch the DOM click directly and re-dispatch until the
  // 201 create-user response is observed (bounded retries). If the dialog
  // closes first, the submit already succeeded — just await the response.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await expect(submitButton).toBeVisible();
      await submitButton.scrollIntoViewIfNeeded();
      await submitButton.dispatchEvent('click');
    } catch {
      break;
    }

    try {
      await Promise.race([
        addUserResponse,
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('Add response not yet observed')), 3000)
        ),
      ]);
      return;
    } catch {
      // Response not observed yet; re-dispatch the submit.
    }
  }

  await addUserResponse;
}

test.describe('mypage admin flows (E2E-ADMIN-001..009)', () => {
  test('E2E-ADMIN-001: Redirects /admin to the admin MyPage category', async ({
    page,
    request,
  }, testInfo) => {
    const isMobile = isMobileProject(testInfo);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);

    await page.goto('/admin');

    await expect(page).toHaveURL(/\/mypage$/);

    if (isMobile) {
      await openMyPageCategoryAndVerify(page, isMobile, 'Users');
    } else {
      await expect(
        page.getByRole('heading', { level: 6, name: /Users/i, exact: false })
      ).toBeVisible();
    }
  });

  test('E2E-ADMIN-002: Shows user-management and system-settings categories', async ({
    page,
    request,
  }, testInfo) => {
    const isMobile = isMobileProject(testInfo);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);

    await page.goto('/mypage');

    await openMyPageCategoryAndVerify(page, isMobile, 'System settings');
    await openMyPageCategoryAndVerify(page, isMobile, 'Users');
  });

  test('E2E-ADMIN-003: Approves a pending signup', async ({ page, request }, testInfo) => {
    const isMobile = isMobileProject(testInfo);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await ensurePendingUser(request, 'user2', suffix);

    await page.goto('/mypage');
    await openMyPageCategory(page, isMobile, 'Users');

    const pendingUserCard = page.getByText('Pending', { exact: true }).first();
    await expect(pendingUserCard).toBeVisible();

    const pendingUsername = await pendingUserCard.evaluate((el) => {
      const card = el.closest('[class*="Card"]');
      return card
        ? card.querySelector('h6')?.textContent?.trim() ||
            card.querySelector('[class*="Typography"]')?.textContent?.trim()
        : '';
    });
    expect(pendingUsername).toBeTruthy();

    const approveResponse = page.waitForResponse(
      (res) =>
        res.url().includes('/admin/users/') &&
        res.url().includes('/approve') &&
        res.status() === 200,
      { timeout: 10000 }
    );

    await clickPendingUserCardButton(page, isMobile, 'Approve');

    await approveResponse;

    // Scope to the approval alert: a bare getByRole('alert') would trip strict
    // mode (or green on an unrelated alert) once a second role=alert exists.
    await expect(page.getByRole('alert').filter({ hasText: /has been approved/i })).toBeVisible();
    await expect(page.getByText(/has been approved/i)).toBeVisible();

    const approvedUserCard = page
      .locator('[class*="Card"]')
      .filter({ hasText: pendingUsername! })
      .filter({ hasText: 'Approved' })
      .first();
    await expect(
      approvedUserCard.locator('[class*="Chip-label"]', { hasText: 'Approved' })
    ).toBeVisible();
    await expect(
      approvedUserCard.locator('[class*="Chip-label"]', { hasText: 'User' })
    ).toBeVisible();
    await expect(approvedUserCard.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(approvedUserCard.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  });

  test('E2E-ADMIN-004: Rejects a pending signup', async ({ page, request }, testInfo) => {
    const isMobile = isMobileProject(testInfo);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await ensurePendingUser(request, 'user3', suffix);

    await page.goto('/mypage');
    await openMyPageCategory(page, isMobile, 'Users');

    const pendingUserCard = page.getByText('Pending', { exact: true }).first();
    await expect(pendingUserCard).toBeVisible();

    const pendingUsername = await pendingUserCard.evaluate((el) => {
      const card = el.closest('[class*="Card"]');
      return card
        ? card.querySelector('h6')?.textContent?.trim() ||
            card.querySelector('[class*="Typography"]')?.textContent?.trim()
        : '';
    });
    expect(pendingUsername).toBeTruthy();

    const rejectResponse = page.waitForResponse(
      (res) =>
        res.url().includes('/admin/users/') &&
        res.url().includes('/reject') &&
        res.status() === 200,
      { timeout: 10000 }
    );

    await clickPendingUserCardButton(page, isMobile, 'Reject');

    await rejectResponse;

    // Scope to the rejection alert (see E2E-ADMIN-003): never a bare alert.
    await expect(page.getByRole('alert').filter({ hasText: /has been rejected/i })).toBeVisible();
    await expect(page.getByText(/has been rejected/i)).toBeVisible();

    const rejectedUserCard = page
      .locator('[class*="Card"]')
      .filter({ hasText: pendingUsername! })
      .filter({ hasText: 'Rejected' })
      .first();
    await expect(
      rejectedUserCard.locator('[class*="Chip-label"]', { hasText: 'Rejected' })
    ).toBeVisible();
    await expect(rejectedUserCard.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(rejectedUserCard.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  });

  test('E2E-ADMIN-005: Creates a user from the admin UI', async ({ page, request }, testInfo) => {
    const isMobile = isMobileProject(testInfo);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);

    await page.goto('/mypage');
    await openMyPageCategory(page, isMobile, 'Users');

    const addIconButton = isMobile
      ? page.locator('button[aria-label*="Add"]').first()
      : page.getByRole('button', { name: /Add/i }).first();
    await expect(addIconButton).toBeVisible();

    await addIconButton.click();
    if (isMobile) {
      await page.waitForTimeout(1000);
    }

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const usernameInput = dialog.getByLabel(/Username/i);
    await expect(usernameInput).toBeVisible();

    const emailInput = dialog.getByLabel(/Email/i);
    await expect(emailInput).toBeVisible();

    const passwordInputs = dialog.locator('input[type="password"]');
    await expect(passwordInputs).toHaveCount(2);

    const shortSuffix = testInfo.title.replace(/[^a-zA-Z0-9]/g, '').slice(0, 15);
    // Unique per RUN and per PROJECT: admin-desktop and admin-mobile may
    // execute this file concurrently once the project chain is dissolved, and
    // a retry must not collide with the user the failed attempt created.
    const newUserSuffix = `au${shortSuffix}${Date.now().toString(36).slice(-6)}`;
    await usernameInput.fill(newUserSuffix);
    await emailInput.fill(`${newUserSuffix}@test.com`);
    await passwordInputs.first().fill('password123');
    await passwordInputs.last().fill('password123');

    const addUserResponse = page.waitForResponse(
      (res) => res.url().includes('/admin/users') && res.status() === 201,
      { timeout: 15000 }
    );

    await clickDialogAddButton(page, isMobile, addUserResponse);

    await expect(page.getByText(/has been added/i)).toBeVisible();

    await expect(page.getByText(newUserSuffix, { exact: true })).toBeVisible();

    const newUserCard = page
      .locator('[class*="Card"]')
      .filter({ hasText: newUserSuffix })
      .filter({ hasText: 'Approved' })
      .first();
    await expect(
      newUserCard.locator('[class*="Chip-label"]', { hasText: 'Approved' })
    ).toBeVisible();
    await expect(newUserCard.locator('[class*="Chip-label"]', { hasText: 'User' })).toBeVisible();
  });

  test('E2E-ADMIN-006: Deletes a standard user from the admin UI', async ({
    page,
    request,
  }, testInfo) => {
    const isMobile = isMobileProject(testInfo);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);
    await ensureApprovedUser(request, 'user2', suffix);

    await page.goto('/mypage');
    await openMyPageCategory(page, isMobile, 'Users');

    const testCard = page.locator('[class*="Card"]').filter({ hasText: suffix }).first();
    await expect(testCard).toBeVisible();

    const deleteUsername = await testCard.evaluate((el) => {
      const h6 = el.querySelector('h6');
      return h6 ? h6.textContent?.trim() || '' : '';
    });
    expect(deleteUsername).toBeTruthy();

    const deleteButton = testCard.getByRole('button', { name: /Delete user/i }).first();
    await expect(deleteButton).toBeVisible();

    await deleteButton.click();

    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByRole('button', { name: /Delete/i })).toBeVisible();

    const deleteResponse = page.waitForResponse(
      (res) =>
        res.url().includes('/admin/users/') &&
        res.request().method() === 'DELETE' &&
        res.status() === 200,
      { timeout: 10000 }
    );

    await confirmDialog.getByRole('button', { name: /Delete/i }).click();

    await deleteResponse;

    await expect(page.getByText(/account has been deleted/i)).toBeVisible();
  });

  test('E2E-ADMIN-008: Cleanup actions show confirmation and completion feedback', async ({
    page,
    request,
  }, testInfo) => {
    const isMobile = isMobileProject(testInfo);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);

    // The file-level storageState already authenticates the admin session; this
    // navigation lets the init-script copy the seeded token into sessionStorage
    // before it is read below (see e2e/fixtures/authenticated.ts).
    await page.goto('/mypage');
    const adminToken = await getSessionToken(page);

    // Absence precondition injection: give the non-admin user own folders so a
    // self-grant leak into `__shared__` (class A/H) would be user-visible before
    // the "권한정리" cleanup removes it.
    const targetUsername = `${TEST_USERS.user1.username}_${suffix}`;
    const ownFolderName = buildName(testInfo, 'cleanup-own-folder');
    const ownFolderPath = `/${targetUsername}/${ownFolderName}`;
    await createFolderViaApi(request, adminToken, ownFolderPath);
    const ownFolderNodeId = await resolveNodeId(request, adminToken, ownFolderPath);

    await openMyPageCategory(page, isMobile, 'System settings');

    const cleanupIcon = page.locator('button[aria-label="Clean up"]');
    await cleanupIcon.scrollIntoViewIfNeeded();
    await cleanupIcon.click();

    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog.getByRole('heading', { name: /Confirm/i })).toBeVisible();

    await confirmDialog.getByRole('button', { name: /Clean up/i }).click();

    // Scope to the cleanup-completion alert: the System settings page can also
    // show a persistent env-setup warning banner (role=alert), which would trip
    // strict mode on a bare getByRole('alert').
    // DEF-18 contract (SystemSettingsContent.md §2): the alert reports honest GC
    // numbers — "No data to clean up." when the cycle deletes nothing, otherwise
    // "GC complete: …" (+ optional "Reports: …" for manual-review leftovers).
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: /No data to clean up|GC complete|정리할 데이터가 없습니다|정리 완료/i })
    ).toBeVisible();

    // Absence regression (class H): after cleanup, the non-admin user's shared view
    // shows no self-grant leftovers — empty for a user who only has own folders.
    await loginAsUser(page, 'user1', suffix);
    await page.goto('/files/__shared__');
    await expect(page).toHaveURL(/\/files\/__shared__(?:\/.*)?$/);
    await expect(page.locator('[data-file-node-id]')).toHaveCount(0);
    await expect(page.locator(`[data-file-node-id="${ownFolderNodeId}"]`)).toHaveCount(0);

    // Absence regression (class H): the tree must render no "Shared" section for a
    // user with no grants. A one-shot isVisible() right after goto raced the tree
    // mount and silently skipped the assertion — wait for the tree to render first.
    // On mobile the tree is collapsed behind the breadcrumb toggle, so open it.
    const folderTree = page.getByTestId('folder-tree');
    if (isMobile) {
      await page.locator('button[title="Open folder tree"]').click();
    }
    await expect(folderTree).toBeVisible({ timeout: 20_000 });
    await expect(folderTree.getByRole('button', { name: /Shared/i })).toHaveCount(0);
  });

  test('E2E-ADMIN-009: The admin reports section renders persisted ops rows after manual refresh', async ({
    page,
    request,
  }, testInfo) => {
    const isMobile = isMobileProject(testInfo);
    const suffix = getTestSuffix(testInfo);
    await ensureApprovedUser(request, 'user1', suffix);

    interface ReportRow {
      id: number;
      kind: string;
      status: string;
      payload: {
        gc?: unknown;
        errors?: unknown[];
        orphanedNodes?: unknown[];
        pendingUploadNodes?: unknown[];
        contentHashCompleteness?: { nullCount?: unknown } | null;
      } | null;
      created_at: string;
    }
    // The file-level storageState already authenticates the admin session; this
    // navigation lets the init-script copy the seeded token into sessionStorage
    // before it is read below (see e2e/fixtures/authenticated.ts).
    await page.goto('/mypage');
    const adminToken = await getSessionToken(page);

    const authHeaders = { Authorization: `Bearer ${adminToken}` };
    const listReports = async (): Promise<ReportRow[]> => {
      const res = await request.get('/api/admin/reports', { headers: authHeaders });
      expect(res.ok()).toBeTruthy();
      return (await res.json()).reports as ReportRow[];
    };
    const nullCountOf = (row: ReportRow): number => {
      const section = row.payload?.contentHashCompleteness;
      if (!section) return 0;
      return Number.isFinite(section.nullCount as number) ? (section.nullCount as number) : 0;
    };

    // SHARED-STACK DISCIPLINE: one real persisted row via the API cleanup
    // channel (same cycle the ADMIN-008 UI button drives); NO repair/backfill
    // clicks — shared state is not mutated beyond the appended report row.
    const before = await listReports();
    const maxIdBefore = before.reduce((acc, row) => Math.max(acc, row.id), 0);
    const cleanupRes = await request.post('/api/admin/cleanup/orphaned', {
      headers: authHeaders,
      data: {},
    });
    expect(cleanupRes.status()).toBe(200);
    const cleanupBody = await cleanupRes.json();
    expect(cleanupBody.results).toBeTruthy();

    // The persisted row is the newest `kind='cleanup'` report (cleanupService
    // persists the FULL result before responding; response body == stored
    // payload — docs/spec/server/routes/admin.md).
    const after = await listReports();
    const newRows = after.filter((row) => row.kind === 'cleanup' && row.id > maxIdBefore);
    expect(newRows.length).toBeGreaterThanOrEqual(1);
    const newRow = newRows.reduce((a, b) => (a.id > b.id ? a : b));

    await openMyPageCategory(page, isMobile, 'System settings');

    const section = page.getByTestId('admin-reports-section');
    await expect(section).toBeVisible();
    // AdminReportsContent.md §2.4: zero data fetch on mount — the section is
    // inert until the operator refreshes.
    await expect(page.locator('[data-testid^="admin-reports-row-"]')).toHaveCount(0);

    const firstFetch = page.waitForResponse(
      (res) =>
        res.request().method() === 'GET' &&
        new URL(res.url()).pathname === '/api/admin/reports' &&
        res.status() === 200,
      { timeout: 15_000 }
    );
    await page.getByTestId('admin-reports-refresh').click();
    await firstFetch;

    const newRowRow = page.getByTestId(`admin-reports-row-${newRow.id}`);
    await expect(newRowRow).toBeVisible();
    // kind chip (admin.reports.kind.cleanup = "Cleanup") + status chip.
    await expect(
      newRowRow.locator('[class*="Chip-label"]').filter({ hasText: 'Cleanup' })
    ).toBeVisible();
    await expect(newRowRow.locator('[class*="Chip-label"]').first()).toBeVisible();

    // Expand matrix mirrors the stored payload: `hasDetail` for a cleanup row
    // ⇔ gc section ∨ node groups ∨ errors (AdminReportsContent.md §2.5).
    // A successful shared-server cycle stores `gc` ⇒ the tier summary renders
    // after expand (zero counts fine); zero-count tiers are honest renders.
    const p = newRow.payload ?? {};
    const hasDetail =
      Boolean(p.gc) ||
      (p.orphanedNodes ?? []).length > 0 ||
      (p.pendingUploadNodes ?? []).length > 0 ||
      (p.errors ?? []).length > 0;
    const expand = page.getByTestId(`admin-reports-expand-${newRow.id}`);
    if (hasDetail) {
      await expect(expand).toBeVisible();
      await expand.click();
      if (p.gc) {
        await expect(newRowRow.getByText(/Tier [123]/).first()).toBeVisible();
      }
    } else {
      await expect(expand).toHaveCount(0);
    }

    // Refresh re-fetches cleanly (spinner→list), no error Alert.
    const refetch = page.waitForResponse(
      (res) =>
        res.request().method() === 'GET' &&
        new URL(res.url()).pathname === '/api/admin/reports' &&
        res.status() === 200,
      { timeout: 15_000 }
    );
    await page.getByTestId('admin-reports-refresh').click();
    await refetch;
    await expect(page.getByTestId('admin-reports-error')).toHaveCount(0);
    await expect(newRowRow).toBeVisible();

    // Backfill-button CONDITIONAL matrix (never a hard 0): the button renders
    // iff a failsafe row carries contentHashCompleteness with finite
    // nullCount > 0 (AdminReportsContent canBackfill). On a healthy shared
    // server that set is empty; on a hash-backfill-pending server every such
    // row shows its button — assert DOM ⇔ payload equivalence either way.
    const expectedBackfillIds = (await listReports())
      .filter((row) => row.kind === 'failsafe' && nullCountOf(row) > 0)
      .map((row) => row.id);
    await expect(page.locator('[data-testid^="admin-reports-backfill-"]')).toHaveCount(
      expectedBackfillIds.length
    );
    for (const id of expectedBackfillIds) {
      await expect(page.getByTestId(`admin-reports-backfill-${id}`)).toBeVisible();
    }
  });
});
