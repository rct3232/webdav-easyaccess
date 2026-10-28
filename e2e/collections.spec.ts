import fs from 'node:fs';
import path from 'node:path';

import { APIRequestContext, expect, Page, Request, TestInfo, test } from '@playwright/test';

import {
  ensureClientBuild,
  execScratchSqlite,
  killScratch,
  prepareScratchS3,
  queryScratchSqlite,
  s3ScratchEnv,
  scratchDirFor,
  scratchRuntimeEnv,
  spawnScratchServer,
  waitForScratchHealth,
  writeScratchEnv,
} from './helpers/setupScratch';
import { e2ePorts } from './helpers/ports';
import { gotoAsAnonymous, loginWithCredentials } from './helpers/auth';
import {
  ensureScratchRegularUser,
  loginScratchAdmin,
  type ScratchUserCreds,
} from './helpers/scratchUser';
import {
  buildName,
  createFolderAt,
  fileItem,
  flushPrivateWorkspaceCleanups,
  readTestFileFixture,
  trackWorkspaceCleanup,
  uploadFileAt,
} from './helpers/files';
import { loginAndOpenUserWorkspace, seedFile } from './helpers/collectionsWorkspace';
import { getSessionToken, gotoFilesPath, gotoNodePage, resolveNodeId } from './helpers/resolvePath';
import { rightClickItem } from './helpers/desktop-interactions';
import { closeActionSheet, longPressItem, openActionSheet } from './helpers/mobile-interactions';
import { setCollectionSort } from './helpers/explorer-controls';
import { TEST_FILES, TEST_USERS } from './fixtures/test-data';

/**
 * E2E-S3-COLLECTION-001..014 + 018..025 — the P0 collections binding lifecycle
 * plus the P3 proposal/sharing/suggestions/membership surfaces
 * (docs/E2E_COVERAGE_PLAN.md § "Collections platform lifecycle (hermetic)").
 *
 * Chain: create → add members → digest counts → archive → undo → restore →
 * purge, plus the key P0 UI anchors: the Collections sidebar section, card
 * menus, the file-side Add-to-collection submenu, the like toggle, the
 * Storage dashboard and the actions feed + undo toast. P-4 adds the members
 * shared-renderer contract (011: grid default, per-surface list persistence,
 * double-click preview) and the member-publish route (012: publish-all banner
 * + owner per-row publish menu — the granted_role:null visibility fix). P-5
 * adds the Likes child row (013: sidebar row → member-parity liked listing,
 * per-surface likedViewMode persistence, unlike drops the row live).
 *
 * SCRATCH-HERMETIC per the destructive-case policy (docs/TESTING_STRATEGY.md):
 * the suite permanently deletes collections, exercises per-subject undo-journal
 * tip semantics and renders the regular user's MyPage Storage dashboard, so it
 * boots its OWN server per Playwright project (desktop :5013 / mobile :5014,
 * own sqlite, project-scoped S3 bucket) and never touches the shared :5002
 * pool. One scratch server serves the whole (serial) file per project —
 * restart is not a behavior under test here. No AI surfaces are expected
 * (`semantic` key absent) and the scratch server runs with
 * `WEA_SKIP_AI_WORKER=1`: P0 only — the merge-card cases (021/022) stay
 * LLM-free by seeding the pending suggestion rows directly (the proposal WRITE
 * side is the evolution pass; the card contract under test is the read surface
 * + dispatch), and the persisted-suggestion case (023) seeds hash-duplicates
 * through the upload API — the dup generator leg of the dashboard read is
 * hash-first/LLM-free (`routes/dashboard.md` §2.4); only the near-dup VECTOR
 * variant needs an embed model, and its ABSENCE is part of what 023 pins
 * (§4.12 absent-not-disabled).
 *
 * IDENTITY (admin-operator pivot, PLAN §14): every case authenticates as a
 * REGULAR USER provisioned by `beforeAll` (`ensureScratchRegularUser` — admin
 * API create, which also ensures the `/<username>` home node). The U1 server
 * gates 403 admin on collections/file-likes/dashboard and U2 hides those
 * surfaces for admin sessions, so an admin actor can no longer exercise this
 * lifecycle. The scratch admin stays bootstrapped for OPERATOR duties only:
 * user provisioning and the perm-delete folder-purge fallback
 * (`flushPrivateWorkspaceCleanups`).
 */
const CASE_ID = 'collections';
/** Scratch boot identity (ADMIN_DEFAULT_PASSWORD) — OPERATOR duties only since the pivot (PLAN §14). */
const ADMIN_PASSWORD = 'CollectionsE2e!123';
/** The provisioned regular user every case acts as (home node: `/collections-e2e-user`). */
const USER_CREDS: ScratchUserCreds = {
  username: 'collections-e2e-user',
  password: 'CollectionsE2eUser!123',
  email: 'collections-e2e-user@e2etest.com',
};

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

interface CollectionRow {
  collection_id: number;
  name: string;
  status: string;
  item_count?: number;
  last_visited_at?: string | null;
  updated_at?: string | null;
  name_locked?: boolean;
}

// Collections created by the running case (UI or API); afterEach purges them
// so the scratch world stays case-contained across the serial run.
const trackedCollections: string[] = [];

test.describe.configure({ mode: 'serial', timeout: 180_000 });

async function listCollections(
  request: APIRequestContext,
  token: string,
  include = 'mine,shared,archived'
): Promise<CollectionRow[]> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await request.get(`/api/collections?include=${include}`, {
        headers: auth(token),
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      return body.collections as CollectionRow[];
    } catch (error) {
      lastError = error;
      if (!/ECONNRESET|socket hang up|ECONNREFUSED|EPIPE/i.test(String(error?.message || ''))) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

async function findCollectionByName(
  request: APIRequestContext,
  token: string,
  name: string
): Promise<CollectionRow | undefined> {
  const rows = await listCollections(request, token);
  return rows.find((row) => row.name === name);
}

async function createCollectionApi(
  request: APIRequestContext,
  token: string,
  name: string
): Promise<number> {
  trackedCollections.push(name);
  const res = await request.post('/api/collections', {
    headers: auth(token),
    data: { name },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return body.collection.collection_id as number;
}

async function addItemsApi(
  request: APIRequestContext,
  token: string,
  collectionId: number,
  nodeIds: number[]
): Promise<void> {
  const res = await request.post(`/api/collections/${collectionId}/items`, {
    headers: auth(token),
    data: { nodeIds },
  });
  expect(res.ok()).toBeTruthy();
}

async function archiveCollectionApi(
  request: APIRequestContext,
  token: string,
  collectionId: number
): Promise<void> {
  const res = await request.post(`/api/collections/${collectionId}/archive`, {
    headers: auth(token),
  });
  expect(res.ok()).toBeTruthy();
}

async function getCollectionStatus(
  request: APIRequestContext,
  token: string,
  collectionId: number
): Promise<number> {
  const res = await request.get(`/api/collections/${collectionId}`, { headers: auth(token) });
  if (!res.ok()) return res.status();
  const body = await res.json();
  return body.status;
}

function collectionCard(page: Page, name: string) {
  return page.locator('[data-testid^="collection-card-"]').filter({ hasText: name });
}

function isMobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name.endsWith('-mobile');
}

/** Platform action surface for a file row: desktop context menu / mobile action
 * sheet — the sheet carries the SAME action testids (FileActionSheet parity:
 * collection-add, like-toggle, file-action-*), so downstream testid clicks stay
 * identical on both platforms. */
async function openFileActions(page: Page, filePath: string, isMobile: boolean) {
  if (isMobile) {
    await openActionSheet(page, filePath);
  } else {
    await rightClickItem(page, filePath);
  }
}

/** The collections tree lives in the permanent sidebar (desktop) or the drawer
 * (mobile) — the drawer opens before any tree interaction on mobile. */
async function openFolderTreeSection(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByTestId('breadcrumb-folder-tree-toggle').click();
  }
}

/** WebKit mobile: the drawer's sibling overlay can intercept pointer events on
 * tree rows even while they report visible/stable — the dispatch-retry idiom
 * of mypage-admin (clickPendingUserCardButton) bypasses hit-testing; React
 * onClick still fires through the bubbling synthetic event. */
async function clickTreeItem(page: Page, isMobile: boolean, locator) {
  if (isMobile) {
    await locator.evaluate((el) => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  } else {
    await locator.click();
  }
}

async function openCardMenu(page: Page, name: string, action: string): Promise<void> {
  const card = collectionCard(page, name);
  const menuButton = card.locator('[data-testid^="card-menu-button-"]');
  const option = page.getByTestId(`card-menu-option-${action}`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  // The collections list can refresh/remount immediately after navigation. If
  // the menu did not survive that refresh, retry the open once the card is
  // stable; this remains an observable, bounded interaction.
  await expect(async () => {
    if (await option.isVisible().catch(() => false)) return;
    await menuButton.click();
    await expect(option).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
  await option.click();
}

/** File-parity open (P-3): double-click the card body on desktop; mobile taps
 * ONCE directly into the members view (the E2E-S3-COLLECTION-015 contract — a
 * second activation would land inside the members surface). The ⋮ menu button
 * keeps its own (stopPropagation) click region top-right either way. */
async function openCollectionCard(page: Page, name: string, isMobile: boolean): Promise<void> {
  const card = collectionCard(page, name);
  await expect(card).toBeVisible({ timeout: 10_000 });
  if (isMobile) {
    await card.tap({ position: { x: 8, y: 8 } });
  } else {
    await card.dblclick({ position: { x: 8, y: 8 } });
  }
}

/** File context menu → Add to collection → inline New collection (name + Enter). */
async function uiCreateCollectionWithFile(
  page: Page,
  filePath: string,
  name: string,
  isMobile: boolean
) {
  trackedCollections.push(name);
  await openFileActions(page, filePath, isMobile);
  await page.getByTestId('collection-add').click();
  await page.getByTestId('new-collection-row').click();
  await page.getByTestId('new-collection-input').fill(name);
  await page.keyboard.press('Enter');
  if (isMobile) {
    // The action closes the sheet and the inline-create closes the menu —
    // force-clear any lingering modal stack before the case proceeds (the
    // mobile WebKit modal ordering left the sheet backdrop intercepting).
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('file-action-rename')).toBeHidden();
  }
}

async function uiAddToCollection(
  page: Page,
  filePath: string,
  collectionName: string,
  isMobile: boolean
) {
  await openFileActions(page, filePath, isMobile);
  await page.getByTestId('collection-add').click();
  // F1 (2026-10-01): menu rows middle-truncate long names inside the fixed 280px paper —
  // the leading fragment (always ≥ the 12 chars used here for ASCII names) and the final
  // 6 chars survive truncation (`pixelMiddleTruncate` back-length contract), short names
  // render verbatim ⇒ both fragments match either way.
  await page
    .locator('[data-testid^="collection-option-"]')
    .filter({ hasText: collectionName.slice(0, 12) })
    .filter({ hasText: collectionName.slice(-6) })
    .first()
    .click();
}

let scratch: string;
let spawned: ReturnType<typeof spawnScratchServer> | null = null;
/** Scratch admin bearer — OPERATOR duties only after boot: provisioning (beforeAll) + perm-delete fallback (afterEach). */
let operatorToken = '';

test.beforeAll(async ({ request }, testInfo) => {
  const projectName = testInfo.project.name;
  // Independent desktop/mobile worlds: each project owns its port slot, its
  // scratch directory and its S3 bucket — never a shared scratch server.
  const port = isMobileProject(testInfo)
    ? e2ePorts.scratchCollectionsMobile
    : e2ePorts.scratchCollections;
  scratch = scratchDirFor(CASE_ID, projectName);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  // S3 is the product's default backend; prepareScratchS3 ensures the
  // project-scoped bucket exists and empties it for a deterministic run.
  const bucket = await prepareScratchS3(projectName);
  writeScratchEnv(scratch, {
    PORT: String(port),
    ...s3ScratchEnv(bucket),
    ...scratchRuntimeEnv(),
    JWT_SECRET: 'collections-e2e-jwt-secret',
    ADMIN_DEFAULT_PASSWORD: ADMIN_PASSWORD,
  });
  ensureClientBuild();
  spawned = spawnScratchServer(scratch, port);
  await waitForScratchHealth(spawned, port);
  // Admin-operator pivot (PLAN §14): the lifecycle ACTOR is a regular user,
  // provisioned through the bootstrapped admin (which also creates + grants
  // the `/<username>` home node). The admin token stays for OPERATOR calls.
  operatorToken = await loginScratchAdmin(request, ADMIN_PASSWORD);
  await ensureScratchRegularUser(request, operatorToken, USER_CREDS);
});

test.afterAll(async () => {
  if (spawned) {
    await killScratch(spawned);
    spawned = null;
  }
  if (scratch) {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test.afterEach(async ({ page, request }) => {
  // Case containment: purge every collection the case tracked (archive first
  // when still active — permanent delete is archived-only) with the USER
  // session token (collections CRUD is the user's own surface), then the
  // workspace folders. The physical folder purge is the admin-only perm-delete
  // maintenance route, so the flush gets the OPERATOR token as fallback
  // (dual-token cleanup — admin-operator pivot, PLAN §14).
  const pending = trackedCollections.splice(0, trackedCollections.length);
  if (pending.length === 0) {
    await flushPrivateWorkspaceCleanups(request, operatorToken);
    return;
  }
  try {
    const token = await getSessionToken(page);
    for (const name of pending) {
      const row = await findCollectionByName(request, token, name);
      if (!row) continue;
      if (row.status === 'active') {
        await archiveCollectionApi(request, token, row.collection_id);
      }
      const del = await request.delete(`/api/collections/${row.collection_id}`, {
        headers: auth(token),
      });
      expect(del.status()).toBe(204);
    }
  } catch {
    // A failed setup leaves an incomplete world; afterAll's rm -rf scratch
    // removes the whole database anyway.
  }
  await flushPrivateWorkspaceCleanups(request, operatorToken);
});

test('E2E-S3-COLLECTION-001: Collections sidebar section expands to the archive node and routes to the collections list view', async ({
  page,
}, testInfo) => {
  await loginWithCredentials(page, USER_CREDS.username, USER_CREDS.password);
  await page.goto('/files');
  // The tree lives in the drawer on mobile — open it before the section
  // assertions (the permanent sidebar hosts it on desktop).
  await openFolderTreeSection(page, isMobileProject(testInfo));

  const section = page.getByTestId('collections-section');
  await expect(section).toBeVisible();
  await expect(section).toContainText('Collections');

  await page.getByTestId('collections-toggle').click();
  await expect(page.getByTestId('collections-archive-node')).toBeVisible();

  await clickTreeItem(
    page,
    isMobileProject(testInfo),
    section.getByText('Collections', { exact: true })
  );
  await expect(page).toHaveURL(/__collections__/);
  await expect(page.getByTestId('collections-list-view')).toBeVisible();
  await expect(page.getByTestId('collections-list-region')).toBeVisible();
  // P-2: the single context-aware toolbar sort button owns collections sort.
  await expect(page.getByTestId('file-manager-sort')).toBeVisible();
});

test('E2E-S3-COLLECTION-002: Add-to-collection submenu creates a collection inline, adds a second file through the collection row and the member view lists them', async ({
  page,
  request,
}, testInfo) => {
  // P-3: home-based user workspace so the 2×2 card preview renders
  // owner-owned members (home-closure ownership; root-level case folders
  // would be foreign-owner → preview-excluded).
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const fileA = await seedFile(request, token, base, testInfo, 'col002-a');
  const fileB = await seedFile(request, token, base, testInfo, 'col002-b');
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, fileA.path)).toBeVisible();

  const name = buildName(testInfo, 'col');
  await uiCreateCollectionWithFile(page, fileA.path, name, isMobileProject(testInfo));

  // One undo toast per command (spec §2.3): the create carries the pointer.
  await expect(page.getByText(/Collection created/i)).toBeVisible();
  await expect(page.getByTestId('undo-toast-action')).toBeVisible();

  await gotoFilesPath(page, request, `/${base}`);
  await uiAddToCollection(page, fileB.path, name, isMobileProject(testInfo));
  await expect(page.getByText(/Added to collection/i)).toBeVisible();

  await page.goto('/files/__collections__');
  await expect(collectionCard(page, name)).toBeVisible();

  // P-3 previews: the card media area carries one cell per recent member.
  await expect(page.getByTestId(`collection-preview-${fileA.nodeId}`)).toBeVisible();
  await expect(page.getByTestId(`collection-preview-${fileB.nodeId}`)).toBeVisible();

  // §11 follow-up 5 (2026-10-01): the creator's cursor is seeded at create — the
  // sidebar row for a freshly created collection carries NO new dot.
  const createdRow = await findCollectionByName(request, token, name);
  expect(createdRow?.last_visited_at).toBeTruthy();
  await expect(page.getByTestId(`collection-new-dot-${createdRow?.collection_id}`)).toHaveCount(0);

  await openCollectionCard(page, name, isMobileProject(testInfo));
  await expect(page.getByTestId('members-list')).toBeVisible();
  await expect(page.locator('[data-testid^="member-row-"]')).toHaveCount(2);
});

test('E2E-S3-COLLECTION-003: Re-opening a collection member view reports the digest of members added since the last visit', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const fileA = await seedFile(request, token, base, testInfo, 'col003-a');
  const fileB = await seedFile(request, token, base, testInfo, 'col003-b');
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, fileA.path)).toBeVisible();

  const name = buildName(testInfo, 'col');
  await uiCreateCollectionWithFile(page, fileA.path, name, isMobileProject(testInfo));
  // The create toast proves the collection exists before the API follow-ups.
  await expect(page.getByTestId('undo-toast-action')).toBeVisible();
  const created = await findCollectionByName(request, token, name);
  expect(created).toBeDefined();
  const collectionId = created!.collection_id;

  // First visit stores the client-side digest cursor for this collection.
  await page.goto('/files/__collections__');
  await openCollectionCard(page, name, isMobileProject(testInfo));
  await expect(page.getByTestId('members-list')).toBeVisible();
  await expect(page.getByTestId('digest-banner')).toHaveCount(0);

  await gotoFilesPath(page, request, `/${base}`);
  // `created_at` is second-granular on the scratch sqlite; wait past the
  // cursor second so the added member is strictly newer than the visit.
  await page.waitForTimeout(1500);
  await addItemsApi(request, token, collectionId, [fileB.nodeId]);

  await page.goto('/files/__collections__');
  await openCollectionCard(page, name, isMobileProject(testInfo));
  await expect(page.getByTestId('digest-banner')).toContainText(/\+1\s*\/\s*-0/);
  // Admin-operator pivot (PLAN §14): the acting regular user OWNS the whole
  // workspace subtree through the home-root ADMIN closure grant — a member
  // inside it is NOT foreign: no bogus `shared_excluded` lock badge. fileB is
  // unpublished ⇒ the publish-pending badge renders (R2 suppression applies
  // to excluded rows only).
  await expect(page.getByTestId(`member-excluded-badge-${fileB.nodeId}`)).toHaveCount(0);
  await expect(page.getByTestId(`member-publish-pending-badge-${fileB.nodeId}`)).toBeVisible();
});

test('E2E-S3-COLLECTION-004: Card menu archive moves the collection into the archive view and restore returns it to the active list', async ({
  page,
  request,
}, testInfo) => {
  const { token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const name = buildName(testInfo, 'col');
  await createCollectionApi(request, token, name);

  await page.goto('/files/__collections__');
  await openCardMenu(page, name, 'archive');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(/Archive this collection/i);
  await dialog.getByTestId('confirm-dialog-confirm').click();
  await expect(page.getByText(/Collection archived/i)).toBeVisible();

  // Gone from the active list, present in the archive view (M-4: the status
  // chip is retired — archive membership is view-scoped, the card itself is
  // the anchor).
  await page.goto('/files/__collections__');
  await expect(page.getByTestId('collections-list-region')).toBeVisible();
  await expect(collectionCard(page, name)).toHaveCount(0);
  await page.goto('/files/__collections__/__archive__');
  const archivedCard = collectionCard(page, name);
  await expect(archivedCard).toBeVisible();

  // Restore replaces the archive entry in the archive view (§2.4 as-built).
  await archivedCard.locator('[data-testid^="card-menu-button-"]').click();
  await expect(page.getByTestId('card-menu-option-restore')).toBeVisible();
  await expect(page.getByTestId('card-menu-option-archive')).toHaveCount(0);
  await page.getByTestId('card-menu-option-restore').click();
  await expect(page.getByText(/Collection restored/i)).toBeVisible();

  await page.goto('/files/__collections__');
  await expect(collectionCard(page, name)).toBeVisible();
});

test('E2E-S3-COLLECTION-005: Undo toast reverses a collection archive', async ({
  page,
  request,
}, testInfo) => {
  const { token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const name = buildName(testInfo, 'col');
  const collectionId = await createCollectionApi(request, token, name);

  await page.goto('/files/__collections__');
  await openCardMenu(page, name, 'archive');
  await page.getByRole('dialog').getByTestId('confirm-dialog-confirm').click();

  await expect(page.getByTestId('undo-toast-action')).toBeVisible();
  await page.getByTestId('undo-toast-action').click();

  await expect
    .poll(() => getCollectionStatus(request, token, collectionId), { timeout: 15_000 })
    .toBe('active');

  await page.goto('/files/__collections__');
  await expect(collectionCard(page, name)).toBeVisible();
});

test('E2E-S3-COLLECTION-006: Permanent delete is offered only in the archive view and purges the collection after two confirmations', async ({
  page,
  request,
}, testInfo) => {
  const { token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const name = buildName(testInfo, 'col');
  const collectionId = await createCollectionApi(request, token, name);

  // Two-step lifecycle: no Delete entry on the active-list card menu.
  await page.goto('/files/__collections__');
  await collectionCard(page, name).locator('[data-testid^="card-menu-button-"]').click();
  await expect(page.getByTestId('card-menu-option-archive')).toBeVisible();
  await expect(page.getByTestId('card-menu-option-delete-permanent')).toHaveCount(0);
  await page.getByTestId('card-menu-option-archive').click();
  await page.getByRole('dialog').getByTestId('confirm-dialog-confirm').click();

  await page.goto('/files/__collections__/__archive__');
  await openCardMenu(page, name, 'delete-permanent');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(/Permanently delete this collection\?/i);
  await dialog.getByTestId('confirm-dialog-confirm').click();
  await expect(dialog).toContainText(/cannot be undone/i);
  await dialog.getByTestId('confirm-dialog-confirm').click();

  // Report-only toast — permanent delete carries no undo pointer (§4.11).
  await expect(page.getByText(/Collection deleted permanently/i)).toBeVisible();
  await expect(page.getByTestId('undo-toast-action')).toHaveCount(0);

  await expect(collectionCard(page, name)).toHaveCount(0);
  const purgeCheck = await request.get(`/api/collections/${collectionId}`, {
    headers: auth(token),
  });
  expect(purgeCheck.status()).toBe(404);

  // Already purged — drop it from the afterEach purge list.
  trackedCollections.splice(trackedCollections.indexOf(name), 1);
});

test('E2E-S3-COLLECTION-007: Like toggle from the file context menu persists the viewer-scoped like', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const fileA = await seedFile(request, token, base, testInfo, 'col007');
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, fileA.path)).toBeVisible();

  await openFileActions(page, fileA.path, isMobileProject(testInfo));
  await expect(page.getByTestId('like-toggle')).toHaveText(/^like$/i);
  await page.getByTestId('like-toggle').click();

  // Re-opened menu reflects the flipped state (optimistic + server truth).
  await openFileActions(page, fileA.path, isMobileProject(testInfo));
  await expect(page.getByTestId('like-toggle')).toHaveText(/^unlike$/i);

  await expect
    .poll(async () => {
      const res = await request.get('/api/file-likes', { headers: auth(token) });
      const body = await res.json();
      return (body.liked as number[]).includes(fileA.nodeId);
    })
    .toBe(true);
});

test('E2E-S3-COLLECTION-008: Member row menu excludes a file with undo and exposes no file-mutating entries', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const fileA = await seedFile(request, token, base, testInfo, 'col008-a');
  const fileB = await seedFile(request, token, base, testInfo, 'col008-b');

  const name = buildName(testInfo, 'col');
  const collectionId = await createCollectionApi(request, token, name);
  await addItemsApi(request, token, collectionId, [fileA.nodeId, fileB.nodeId]);

  await page.goto('/files/__collections__');
  await openCollectionCard(page, name, isMobileProject(testInfo));
  const rowB = page.getByTestId(`member-row-${fileB.nodeId}`);
  await expect(rowB).toBeVisible();
  await expect(page.getByTestId(`member-row-${fileA.nodeId}`)).toBeVisible();

  await rowB.locator('[data-testid="member-menu-button"]').click();
  await expect(page.getByTestId('member-exclude')).toBeVisible();
  await expect(page.getByTestId('member-show-original')).toBeVisible();
  await expect(page.getByTestId('member-properties')).toBeVisible();
  // §3.2 invariant: a collection is a view, never a workspace — the member
  // menu carries no file-mutating entries (rename/move/copy/delete).
  await expect(page.locator('[data-testid^="file-action-"]')).toHaveCount(0);

  await page.getByTestId('member-exclude').click();
  await expect(rowB).toHaveCount(0);
  await expect(page.getByText(/Removed from collection/i)).toBeVisible();
  await page.getByTestId('undo-toast-action').click();

  // The undo re-inserts the stored member (API truth), visible after re-entry.
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/collections/${collectionId}/items`, {
          headers: auth(token),
        });
        const body = await res.json();
        return (body.items as { node_id: number }[]).some((item) => item.node_id === fileB.nodeId);
      },
      { timeout: 15_000 }
    )
    .toBe(true);

  await page.goto('/files/__collections__');
  await openCollectionCard(page, name, isMobileProject(testInfo));
  await expect(page.getByTestId(`member-row-${fileB.nodeId}`)).toBeVisible();
});

test('E2E-S3-COLLECTION-009: Storage dashboard renders the collection journal feed and feed undo restores an archived collection', async ({
  page,
  request,
}, testInfo) => {
  const { token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const name = buildName(testInfo, 'col');
  const collectionId = await createCollectionApi(request, token, name);
  await archiveCollectionApi(request, token, collectionId);

  await page.goto('/mypage');
  // MyPage category navigation: permanent sidebar (desktop) vs drawer (mobile)
  // — the mypage-admin openMyPageCategoryAndVerify idiom.
  if (isMobileProject(testInfo)) {
    const drawer = page.locator('.MuiDrawer-paper');
    await page.locator('button[aria-label="My page"]').click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: /^storage$/i }).click();
    await expect(drawer).not.toBeVisible();
  } else {
    await page.getByRole('button', { name: /^storage$/i }).click();
  }
  await expect(page.getByTestId('collection-dashboard')).toBeVisible();
  await expect(page.getByText(/System changes/i)).toBeVisible();

  // Newest-first feed: the first row of this subject is the archive tip.
  const tipRow = page.locator('[data-testid="journal-row"]').filter({ hasText: name }).first();
  await expect(tipRow).toContainText(/archived/i);
  await tipRow.getByTestId('journal-undo').click();

  await expect
    .poll(() => getCollectionStatus(request, token, collectionId), { timeout: 15_000 })
    .toBe('active');

  const undoneRow = page
    .locator('[data-testid="journal-row"][data-status="undone"]')
    .filter({ hasText: name });
  await expect(undoneRow.first()).toBeVisible({ timeout: 10_000 });

  // P0 expectation: no AI surfaces — no capacity sparkline (series seam
  // absent) and no suggestion checkboxes (`semantic` key absent).
  await expect(page.getByTestId('capacity-sparkline')).toHaveCount(0);
  await expect(page.getByTestId('suggestion-checkbox')).toHaveCount(0);
});

test('E2E-S3-COLLECTION-010: The toolbar sort button re-sorts the collections list by created (newest-first) and name (ASC)', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const file = await seedFile(request, token, base, testInfo, 'col010');
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, file.path)).toBeVisible();

  // Distinctly ordered names: 'Aaa' < 'Zzz' at the FIRST differing character,
  // so ORDER BY name (ASC) and created_at DESC, id DESC give opposite orders.
  const nameA = buildName(testInfo, 'col010-Aaa');
  const nameZ = buildName(testInfo, 'col010-Zzz');
  await uiCreateCollectionWithFile(page, file.path, nameA, isMobileProject(testInfo));
  await expect(page.getByText(/Collection created/i)).toBeVisible();
  await uiCreateCollectionWithFile(page, file.path, nameZ, isMobileProject(testInfo));

  // Settle wait (flake fix, RCA 2026-10-02): Enter dispatches the async
  // create→addItems chain (`onCreateAndAdd`); a page.goto issued before the
  // CHAINED `POST /:id/items` leaves the unload window kills that request —
  // the new card then legitimately renders the empty `collection-card-fallback`
  // and shifts every nth() index below. Poll until both members landed
  // SERVER-side; the sort assertions themselves are unchanged.
  await expect
    .poll(
      async () => {
        const rows = await listCollections(request, token, 'mine,shared');
        const a = rows.find((r) => r.name === nameA);
        const z = rows.find((r) => r.name === nameZ);
        return Boolean(a && z && a.item_count === 1 && z.item_count === 1);
      },
      { timeout: 15_000 }
    )
    .toBe(true);

  await page.goto('/files/__collections__');
  await expect(collectionCard(page, nameA)).toBeVisible();
  await expect(collectionCard(page, nameZ)).toBeVisible();
  // P-2: ONE sort control on this surface — the toolbar button; the private
  // CollectionsListView menu is retired. (Default `activity` order is NOT
  // asserted: score ties make it a server concern, not a UI contract here.)
  await expect(page.getByTestId('file-manager-sort')).toBeVisible();
  await expect(page.getByTestId('collections-sort-menu')).toHaveCount(0);

  // Real card roots only: the prefix also matches the decorative
  // `collection-card-fallback` child (zero-preview cards) — never count it.
  const cards = page.locator(
    '[data-testid^="collection-card-"]:not([data-testid="collection-card-fallback"])'
  );

  // Created → created_at DESC with an `id DESC` tie-break (both stores): the
  // later-created 'Zzz' is first even when second-granular timestamps tie.
  await setCollectionSort(page, 'created');
  await expect(cards.nth(0)).toContainText(nameZ);
  await expect(cards.nth(1)).toContainText(nameA);

  // Name → ORDER BY name ASC: 'Aaa' first. The previous DOM held the CREATED
  // order ([Z, A]), so passing this assertion proves a real re-sort landed.
  await setCollectionSort(page, 'name');
  await expect(cards.nth(0)).toContainText(nameA);
  await expect(cards.nth(1)).toContainText(nameZ);

  // Updated switch (gap-coverage amendment): the `updated` sort is
  // `c.updated_at DESC, id DESC` (collectionsStore.md §2.5). NOTE: adding a
  // member bumps `last_member_change_at`, NOT `updated_at`
  // (`repo.touchMemberChange`, store code-verified) — the updated_at bump
  // that the sort reads comes from the journaled PUT /:id row update
  // (routes/collections.md PUT: pinned/publishMode/name all SET
  // updated_at=CURRENT_TIMESTAMP). The member add below stays as an
  // additional real change to A; the PUT is what the `updated` sort keys on.
  // Second-granular sqlite stamps ⇒ poll/re-issue until A strictly exceeds Z.
  const rowA = await findCollectionByName(request, token, nameA);
  const rowZ = await findCollectionByName(request, token, nameZ);
  expect(rowA && rowZ).toBeTruthy();
  const extraMember = await seedFile(request, token, base, testInfo, 'col010-extra');
  await addItemsApi(request, token, rowA!.collection_id, [extraMember.nodeId]);
  await expect
    .poll(
      async () => {
        // Toggle publishMode so every re-issue is a real row UPDATE.
        // GET /:id answers the collection row DIRECTLY (routes.js).
        const current = await request.get(`/api/collections/${rowA!.collection_id}`, {
          headers: auth(token),
        });
        const mode = (await current.json()).publish_mode === 'off' ? 'ask' : 'off';
        await request.put(`/api/collections/${rowA!.collection_id}`, {
          headers: auth(token),
          data: { publishMode: mode },
        });
        const rows = await listCollections(request, token, 'mine,shared');
        const a = rows.find((r) => r.collection_id === rowA!.collection_id);
        const z = rows.find((r) => r.collection_id === rowZ!.collection_id);
        return Boolean(a && z && a.updated_at && z.updated_at && a.updated_at > z.updated_at);
      },
      { timeout: 20_000, intervals: [500, 1000] }
    )
    .toBe(true);

  await page.goto('/files/__collections__');
  await setCollectionSort(page, 'updated');
  await expect(cards.nth(0)).toContainText(nameA);
  await expect(cards.nth(1)).toContainText(nameZ);

  // Name switch again: the NAME order is untouched by the A-side update —
  // the same [Aaa, Zzz] pin (proves `updated` did not leak into `name`).
  await setCollectionSort(page, 'name');
  await expect(cards.nth(0)).toContainText(nameA);
  await expect(cards.nth(1)).toContainText(nameZ);
});

test('E2E-S3-COLLECTION-011: members render the shared grid by default, the list toggle persists per-surface and double-click previews by nodeId', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const fileA = await seedFile(request, token, base, testInfo, 'col011-a');
  const fileName = fileA.path.split('/').pop() as string;
  // Middle-truncation keeps head + tail; the unique leading prefix always shows.
  const nameHead = fileName.slice(0, 14);

  const name = buildName(testInfo, 'col');
  const collectionId = await createCollectionApi(request, token, name);
  await addItemsApi(request, token, collectionId, [fileA.nodeId]);

  await page.goto('/files/__collections__');
  await openCollectionCard(page, name, isMobileProject(testInfo));
  await expect(page.getByTestId('members-list')).toBeVisible();
  const row = page.getByTestId(`member-row-${fileA.nodeId}`);
  await expect(row).toBeVisible();

  // P-4 default: the shared FileGrid renderer (Card shell inside the row);
  // M-8: the members toolbar shows the sort button (files-style radios bound to
  // the persisted collectionMemberSortMode) alongside the view toggles.
  await expect(row.locator('.MuiCard-root')).toBeVisible();
  await expect(page.getByTestId('view-mode-list')).toBeVisible();
  await expect(page.getByTestId('file-manager-sort')).toBeVisible();

  // Toggle to LIST: FileList rows (no card shell), name shown, NO size ever
  // rendered (the member wire carries none — the adapter suppresses the slot).
  await page.getByTestId('view-mode-list').click();
  await expect(row.locator('.MuiCard-root')).toHaveCount(0);
  await expect(row).toContainText(nameHead);
  await expect(row).not.toContainText(/KB|MB|0 B/);
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('collectionMemberViewMode')))
    .toBe('list');

  // Persistence across surface exits (per-surface key; the file viewMode is a
  // different key and stays untouched by the member dispatch).
  expect(await page.evaluate(() => window.localStorage.getItem('viewMode'))).not.toBe('detail');
  await page.goto('/files/__collections__');
  await openCollectionCard(page, name, isMobileProject(testInfo));
  await expect(row.locator('.MuiCard-root')).toHaveCount(0);

  // Double-click → preview through the SHARED click machinery (nodeId
  // metadata/blob channel — member rows carry path:'' by contract).
  await row.dblclick();
  const preview = page.getByTestId('file-preview-dialog');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(nameHead);
});

test('E2E-S3-COLLECTION-012: the publish-all banner flips stored members through PUT /:id/items/publish and the owner per-row publish menu is reachable', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const fileA = await seedFile(request, token, base, testInfo, 'col012-a');
  const fileB = await seedFile(request, token, base, testInfo, 'col012-b');

  // Default publish_mode 'ask': stored members start published:false.
  const name = buildName(testInfo, 'col');
  const collectionId = await createCollectionApi(request, token, name);
  await addItemsApi(request, token, collectionId, [fileA.nodeId, fileB.nodeId]);

  await page.goto('/files/__collections__');
  await openCollectionCard(page, name, isMobileProject(testInfo));
  await expect(page.getByTestId('members-list')).toBeVisible();

  await expect(page.getByTestId('publish-pending-banner')).toContainText(/2/);
  // §11 follow-up 3: the badges render in ALL member views — assert them in the
  // surface DEFAULT view (grid) first, then keep the list path valid.
  await expect(page.getByTestId(`member-publish-pending-badge-${fileA.nodeId}`)).toBeVisible();
  await expect(page.getByTestId(`member-publish-pending-badge-${fileB.nodeId}`)).toBeVisible();

  await page.getByTestId('view-mode-list').click();
  await expect(page.getByTestId(`member-publish-pending-badge-${fileA.nodeId}`)).toBeVisible();
  await expect(page.getByTestId(`member-publish-pending-badge-${fileB.nodeId}`)).toBeVisible();

  // C3 owner-visibility fix: OWN collection (granted_role null) + ask ⇒ the
  // per-row publish toggle IS offered.
  const rowA = page.getByTestId(`member-row-${fileA.nodeId}`);
  await rowA.locator('[data-testid="member-menu-button"]').click();
  await expect(page.getByTestId('member-publish')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('member-publish')).toHaveCount(0);

  // Banner batch action → PUT /:id/items/publish {nodeIds, published:true}.
  await page.getByTestId('publish-batch').click();
  await expect(page.getByTestId('publish-pending-banner')).toHaveCount(0);
  await expect(page.getByTestId(`member-publish-pending-badge-${fileA.nodeId}`)).toHaveCount(0);
  await expect(page.getByTestId(`member-publish-pending-badge-${fileB.nodeId}`)).toHaveCount(0);
  await expect(rowA).toBeVisible(); // membership untouched — only the flag flipped

  await expect
    .poll(async () => {
      const res = await request.get(`/api/collections/${collectionId}/items`, {
        headers: auth(token),
      });
      const body = await res.json();
      return body.publish_pending_count as number;
    })
    .toBe(0);
});

test('E2E-S3-COLLECTION-013: the sidebar Likes child row lists liked files through the member machinery, persists its own view key, and unlike drops the row live without touching collections', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const fileA = await seedFile(request, token, base, testInfo, 'col013-a');

  // A collection the likes lifecycle must never touch (membership + sidebar).
  const collectionName = buildName(testInfo, 'col');
  const collectionId = await createCollectionApi(request, token, collectionName);
  await addItemsApi(request, token, collectionId, [fileA.nodeId]);

  // Like via the file context menu (same entry E2E-S3-COLLECTION-007 persists).
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, fileA.path)).toBeVisible();
  await openFileActions(page, fileA.path, isMobileProject(testInfo));
  await expect(page.getByTestId('like-toggle')).toHaveText(/^like$/i);
  await page.getByTestId('like-toggle').click();

  // Open the Likes row through the SIDEBAR (Collections-section child, P-5
  // owner ruling — not a top-level virtual root).
  await openFolderTreeSection(page, isMobileProject(testInfo));
  await page.getByTestId('collections-toggle').click();
  await expect(page.getByTestId('collections-liked-node')).toBeVisible({ timeout: 60_000 });
  await clickTreeItem(page, isMobileProject(testInfo), page.getByTestId('collections-liked-node'));
  await expect(page).toHaveURL(/__collections__\/liked/);
  await expect(page.getByTestId('members-list')).toBeVisible();

  // Member-parity machinery: shared grid by default; M-8: the sort button
  // renders (same collectionMemberSortMode state as the members surface).
  const row = page.getByTestId(`member-row-${fileA.nodeId}`);
  await expect(row).toBeVisible();
  await expect(row.locator('.MuiCard-root')).toBeVisible();
  await expect(page.getByTestId('file-manager-sort')).toBeVisible();

  // Toggle to LIST: persists on the DEDICATED likedViewMode key.
  await page.getByTestId('view-mode-list').click();
  await expect(row.locator('.MuiCard-root')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('likedViewMode')))
    .toBe('list');

  // Per-surface isolation: opening the MEMBERS surface keeps its own default
  // (grid) — the likes dispatch never bled into collectionMemberViewMode.
  await page.goto('/files/__collections__');
  await openCollectionCard(page, collectionName, isMobileProject(testInfo));
  const memberRow = page.getByTestId(`member-row-${fileA.nodeId}`);
  await expect(memberRow).toBeVisible();
  await expect(memberRow.locator('.MuiCard-root')).toBeVisible();
  // (the session persists the default on mount — the isolation claim is the
  // LIKES dispatch never touching the member key's value)
  expect(
    await page.evaluate(() => window.localStorage.getItem('collectionMemberViewMode'))
  ).not.toBe('list');

  // Re-entering Likes via the sidebar row: the LIST mode persisted across the
  // reload (per-surface key, member-parity rows).
  await openFolderTreeSection(page, isMobileProject(testInfo));
  await clickTreeItem(page, isMobileProject(testInfo), page.getByTestId('collections-liked-node'));
  await expect(page.getByTestId('members-list')).toBeVisible();
  await expect(row).toBeVisible();
  await expect(row.locator('.MuiCard-root')).toHaveCount(0);

  // Unlike from the row menu: collection:null gates (no Exclude/publish —
  // membership mutations structurally absent), Download stays; the row drops.
  await row.locator('[data-testid="member-menu-button"]').click();
  await expect(page.getByTestId('member-exclude')).toHaveCount(0);
  await expect(page.getByTestId('member-publish')).toHaveCount(0);
  await expect(page.getByTestId('member-download')).toBeVisible();
  await page.getByTestId('like-toggle').click();
  await expect(row).toHaveCount(0);

  // Server truth converged (invariant 9 read) and the COLLECTION is untouched:
  // sidebar row still listed, member still a member.
  await expect
    .poll(async () => {
      const res = await request.get('/api/file-likes', { headers: auth(token) });
      const body = await res.json();
      return (body.liked as number[]).includes(fileA.nodeId);
    })
    .toBe(false);
  // The sidebar row lives in the drawer on mobile (permanent sidebar on
  // desktop) — open the drawer and re-expand the section if needed first.
  await openFolderTreeSection(page, isMobileProject(testInfo));
  const sidebarRow = page.getByTestId(`collection-row-${collectionId}`);
  if (isMobileProject(testInfo) && !(await sidebarRow.isVisible())) {
    await page.getByTestId('collections-toggle').click();
  }
  await expect(sidebarRow).toBeVisible();
  await expect
    .poll(async () => {
      const res = await request.get(`/api/collections/${collectionId}/items`, {
        headers: auth(token),
      });
      const body = await res.json();
      return (body.items as { node_id: number }[]).some((item) => item.node_id === fileA.nodeId);
    })
    .toBe(true);
});

test('E2E-S3-COLLECTION-014: Likes-first/Archive-last tiles navigate, archive view shows no tiles under Collections › Archive crumb, collection opens as Collections › <name>', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const fileA = await seedFile(request, token, base, testInfo, 'col014-a');

  const name = buildName(testInfo, 'col');
  const collectionId = await createCollectionApi(request, token, name);
  await addItemsApi(request, token, collectionId, [fileA.nodeId]);

  // Active list: Likes tile FIRST, Archive tile LAST (M-2).
  await page.goto('/files/__collections__');
  await expect(collectionCard(page, name)).toBeVisible();
  const likedTile = page.getByTestId('collection-tile-liked');
  const archiveTile = page.getByTestId('collection-tile-archive');
  await expect(likedTile).toBeVisible();
  await expect(archiveTile).toBeVisible();

  // Breadcrumb (M-9): opening the collection trails Collections › <name> (no Home).
  await openCollectionCard(page, name, isMobileProject(testInfo));
  await expect(page.getByTestId('members-list')).toBeVisible();
  const crumb = page.getByTestId('breadcrumb');
  await expect(crumb.getByText('Collections', { exact: true })).toBeVisible();
  await expect(crumb.getByText(name, { exact: true })).toBeVisible();

  // The Collections chip navigates back to the list surface.
  await crumb.getByText('Collections', { exact: true }).click();
  await expect(page).toHaveURL(/__collections__/);
  await expect(page.getByTestId('collections-list-view')).toBeVisible();

  // Archive tile → archive view: NO pseudo-tiles remain (F3, 2026-10-01 — supersedes
  // the M-2 "Likes only" default) and the crumb reads Collections › Archive (F2).
  await archiveTile.click();
  await expect(page).toHaveURL(/__collections__\/__archive__/);
  await expect(page.getByTestId('collection-tile-liked')).toHaveCount(0);
  await expect(page.getByTestId('collection-tile-archive')).toHaveCount(0);
  await expect(crumb.getByText('Collections', { exact: true })).toBeVisible();
  await expect(crumb.getByText('Archive', { exact: true })).toBeVisible();

  // Liked surface via route (tiles are gone from the archive view): member mode,
  // empty here — legal empty view, no list chrome either.
  await page.goto('/files/__collections__/liked');
  await expect(page.getByTestId('members-list')).toBeVisible();
  await expect(page.getByTestId('collection-tile-liked')).toHaveCount(0);
});

test('E2E-S3-COLLECTION-018: Card menu rename updates the card and the sidebar row, locks the name and is undoable', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const file = await seedFile(request, token, base, testInfo, 'col018');
  const seededFile = fileItem(page, file.path);
  await expect(async () => {
    await gotoFilesPath(page, request, `/${base}`);
    await expect(seededFile).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 60_000 });

  const name = buildName(testInfo, 'col018');
  await uiCreateCollectionWithFile(page, file.path, name, isMobileProject(testInfo));
  await expect(page.getByText(/Collection created/i)).toBeVisible();
  const created = await findCollectionByName(request, token, name);
  expect(created).toBeDefined();
  const collectionId = created!.collection_id;

  // Card menu → Rename → RenameDialog submit (FileManager handleCardAction
  // 'rename' → collectionsApi.renameCollection → PUT /:id {name}).
  await page.goto('/files/__collections__');
  // Route auto-expand contract: /files/__collections__ mounts the tree with the
  // Collections section expanded — no toggle click is needed to reveal rows.
  await expect(page.getByTestId('collections-toggle')).toHaveAttribute('aria-expanded', 'true');
  await openCardMenu(page, name, 'rename');
  const renameDialog = page.getByRole('dialog');
  await renameDialog.getByTestId('rename-name-input').fill('Q3 reports');
  await renameDialog.getByTestId('rename-submit').click();

  // One journaled command ⇒ one undo toast ("Collection renamed",
  // collections.undoRenamed). BOTH platforms verify the same rename-effect
  // contracts BEFORE the undo click — the renamed card and the server-side
  // name lock (`PUT /:id` with a `name` write sets name_locked=true,
  // routes/collections.md PUT + store §2 renameCollection). The desktop sidebar
  // is permanently mounted, so it additionally verifies the notifier refresh
  // renames the row in place while the section stays expanded. Mobile cannot
  // reliably open the WebKit drawer inside the 8 s toast window; it asserts the
  // same sidebar state at the stable post-undo moment instead.
  await expect(collectionCard(page, 'Q3 reports')).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(
      async () => {
        const row = await findCollectionByName(request, token, 'Q3 reports');
        return row?.name_locked === true && row.collection_id === collectionId;
      },
      { timeout: 15_000 }
    )
    .toBe(true);

  if (!isMobileProject(testInfo)) {
    await expect(page.getByTestId(`collection-row-${collectionId}`)).toContainText('Q3 reports');
    await expect(page.getByTestId('collections-toggle')).toHaveAttribute('aria-expanded', 'true');
  }

  // One journaled command ⇒ one undo toast ("Collection renamed",
  // collections.undoRenamed); clicking Undo applies the inverse name.
  await expect(page.getByText(/Collection renamed/i)).toBeVisible();
  await expect(page.getByTestId('undo-toast-action')).toBeVisible();
  await page.getByTestId('undo-toast-action').click();

  // The undo refresh updates the cards and the sidebar rows through the
  // collections notifier. The route did not change, so the section must stay
  // expanded: the restored row is visible WITHOUT re-opening the section.
  await expect
    .poll(async () => Boolean(await findCollectionByName(request, token, name)), {
      timeout: 15_000,
    })
    .toBe(true);
  await expect(collectionCard(page, name)).toBeVisible({ timeout: 10_000 });
  await expect(collectionCard(page, 'Q3 reports')).toHaveCount(0);

  // Mobile may open the folder-tree drawer only; desktop uses the permanent
  // sidebar. Neither platform clicks `collections-toggle` after undo.
  await openFolderTreeSection(page, isMobileProject(testInfo));
  const collectionsSection = page.getByTestId('collections-section');
  const restoredRow = page.getByTestId(`collection-row-${collectionId}`);
  await expect(collectionsSection).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('collections-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(restoredRow).toBeVisible({ timeout: 15_000 });
  // Tree rows middle-truncate long generated names — assert the stable leading
  // fragment (the F1 back-length contract idiom) on both platforms.
  await expect(restoredRow).toContainText(name.slice(0, 12));
  await expect(collectionsSection.getByText('Q3 reports')).toHaveCount(0);
});

test('E2E-S3-COLLECTION-019: The properties dialog header toggles the viewer-scoped like and the surfaces share the state', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const file = await seedFile(request, token, base, testInfo, 'col019');
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, file.path)).toBeVisible();

  // Dialog-scoped like toggle (FilePropertiesDialog §3.3 header IconButton —
  // aria-label Like/Unlike, not menu text).
  await openFileActions(page, file.path, isMobileProject(testInfo));
  await page.getByTestId('file-action-properties').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const dialogLike = dialog.getByTestId('like-toggle');
  await expect(dialogLike).toHaveAttribute('aria-label', 'Like');
  await dialogLike.click();

  await expect
    .poll(async () => {
      const res = await request.get('/api/file-likes', { headers: auth(token) });
      const body = await res.json();
      return (body.liked as number[]).includes(file.nodeId);
    })
    .toBe(true);

  // Reopen the dialog: the header toggle reads the flipped (shared) state.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await openFileActions(page, file.path, isMobileProject(testInfo));
  await page.getByTestId('file-action-properties').click();
  await expect(page.getByRole('dialog').getByTestId('like-toggle')).toHaveAttribute(
    'aria-label',
    'Unlike'
  );

  // Context-menu row reads the same state (optimistic row merge + notifier):
  // shared like state across surfaces, invariant 9 (viewer-scoped).
  await page.keyboard.press('Escape');
  await openFileActions(page, file.path, isMobileProject(testInfo));
  await expect(page.getByTestId('like-toggle')).toHaveText(/^unlike$/i);
  await page.keyboard.press('Escape');
});

test('E2E-S3-COLLECTION-020: The sidebar Archive node routes into the tile-free archive view with the Collections › Archive breadcrumb and the chip returns to the ordered active list', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const name = buildName(testInfo, 'col020');
  const collectionId = await createCollectionApi(request, token, name);
  await archiveCollectionApi(request, token, collectionId);

  // Sidebar routing (CLICK, not goto): expand the section, hit the Archive
  // node — FolderTree handleArchiveClick → /files/__collections__/__archive__.
  await openFolderTreeSection(page, isMobileProject(testInfo));
  await page.getByTestId('collections-toggle').click();
  await expect(page.getByTestId('collections-archive-node')).toBeVisible();
  await clickTreeItem(
    page,
    isMobileProject(testInfo),
    page.getByTestId('collections-archive-node')
  );
  await expect(page).toHaveURL(/\/files\/__collections__\/__archive__$/);

  // Breadcrumb per locale (desktop runs the en bundle — same anchors as 014).
  const crumb = page.getByTestId('breadcrumb');
  await expect(crumb.getByText('Collections', { exact: true })).toBeVisible();
  await expect(crumb.getByText('Archive', { exact: true })).toBeVisible();

  // Archive view is tile-free (F3, 2026-10-01) and lists the archived card.
  await expect(page.locator('[data-testid^="collection-tile-"]')).toHaveCount(0);
  await expect(collectionCard(page, name)).toBeVisible();

  // Collections crumb chip back → active list; M-2 tile order: Likes FIRST,
  // Archive LAST (014 parity — order pinned via DOM position here).
  await crumb.getByText('Collections', { exact: true }).click();
  await expect(page).toHaveURL(/\/files\/__collections__$/);
  await expect(page.getByTestId('collections-list-view')).toBeVisible();
  const tiles = page.locator('[data-testid^="collection-tile-"]');
  await expect(tiles).toHaveCount(2);
  await expect(tiles.first()).toHaveAttribute('data-testid', 'collection-tile-liked');
  await expect(tiles.last()).toHaveAttribute('data-testid', 'collection-tile-archive');
});

// ---------------------------------------------------------------------------
// Merge-proposal card lifecycle (T3.1 — §4.4 card, R2 real compare overlay)
// ---------------------------------------------------------------------------

/** Seed a PENDING pair row directly in the scratch sqlite (the proposal WRITE
 * side rides the evolution pass, which stays outside this suite's P0 scope —
 * the card contract is the READ surface + dispatch, so the pending set is
 * provisioned the same deterministic way other cases provision fixtures).
 * Pair is normalized `a_id < b_id` per `routes/collections.md`. */
async function seedMergeSuggestion(aId: number, bId: number, score: number): Promise<void> {
  const low = Math.min(aId, bId);
  const high = Math.max(aId, bId);
  await execScratchSqlite(
    path.join(scratch, 'webdav.db'),
    `INSERT INTO collection_merge_suggestions (a_id, b_id, score, state)
     VALUES (${low}, ${high}, ${score}, 'pending')`
  );
}

async function suggestionStateOf(aId: number, bId: number): Promise<string | undefined> {
  const low = Math.min(aId, bId);
  const high = Math.max(aId, bId);
  const rows = await queryScratchSqlite<{ state: string }>(
    path.join(scratch, 'webdav.db'),
    `SELECT state FROM collection_merge_suggestions WHERE a_id = ${low} AND b_id = ${high}`
  );
  return rows[0]?.state;
}

/** Re-surface a DISMISSED pair for the terminal-reject leg: the cadence writer
 * is the nightly pass (out of this suite), so the fixture flips the state the
 * same direct-DB way the seed does. UNIQUE(a,b) keeps INSERT unusable here. */
async function reopenMergeSuggestion(aId: number, bId: number): Promise<void> {
  const low = Math.min(aId, bId);
  const high = Math.max(aId, bId);
  await execScratchSqlite(
    path.join(scratch, 'webdav.db'),
    `UPDATE collection_merge_suggestions
        SET state = 'pending', dismiss_count = 0, dismissed_at = NULL
      WHERE a_id = ${low} AND b_id = ${high}`
  );
}

test('E2E-S3-COLLECTION-021: the merge proposal card cycles the pending set, compares the real sample rows, executes a merge from the card and the undo toast restores the absorbed collection', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const shared = await seedFile(request, token, base, testInfo, 'merge-shared');
  const onlyA = await seedFile(request, token, base, testInfo, 'merge-only-a');
  const onlyB = await seedFile(request, token, base, testInfo, 'merge-only-b');

  const nameA = buildName(testInfo, 'merge-a');
  const nameB = buildName(testInfo, 'merge-b');
  const aId = await createCollectionApi(request, token, nameA);
  const bId = await createCollectionApi(request, token, nameB);
  await addItemsApi(request, token, aId, [shared.nodeId, onlyA.nodeId]);
  await addItemsApi(request, token, bId, [shared.nodeId, onlyB.nodeId]);
  await seedMergeSuggestion(aId, bId, 900);

  // Second pending pair — the NEVER-STACKED rule: two rows still render ONE
  // card, and the `+1 more` chip cycles the displayed row (score desc first).
  const other = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const otherShared = await seedFile(request, other.token, other.base, testInfo, 'merge2-shared');
  const nameC = buildName(testInfo, 'merge-c');
  const nameD = buildName(testInfo, 'merge-d');
  const cId = await createCollectionApi(request, other.token, nameC);
  const dId = await createCollectionApi(request, other.token, nameD);
  await addItemsApi(request, other.token, cId, [otherShared.nodeId]);
  await addItemsApi(request, other.token, dId, [otherShared.nodeId]);
  await seedMergeSuggestion(cId, dId, 700);

  await page.goto('/files/__collections__');
  const card = page.getByTestId('merge-proposal-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('merge-proposal-card')).toHaveCount(1);
  // Highest score first: the A|B pair line names both collections.
  await expect(card).toContainText(nameA);
  await expect(card).toContainText(nameB);
  await expect(card.getByTestId('merge-cycle-chip')).toContainText('+1 more');

  // Expand: the strip opens the two-column compare overlay with REAL sample
  // rows (shared tile + per-side unique names — zero-fabrication rule).
  await card.getByTestId('merge-strip').click();
  const overlay = page.getByTestId('merge-compare-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByTestId(`merge-sample-tile-${shared.nodeId}`)).toBeVisible();
  await expect(overlay.getByTestId(`merge-unique-a-${onlyA.nodeId}`)).toContainText(
    onlyA.path.split('/').pop() as string
  );
  await expect(overlay.getByTestId(`merge-unique-b-${onlyB.nodeId}`)).toContainText(
    onlyB.path.split('/').pop() as string
  );
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);

  // The card IS the confirmation: Merge dispatches with NO extra dialog.
  await card.getByTestId('merge-accept').click();
  await expect(page.getByTestId('undo-toast-action')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The merged pair left the pending set; the cycled card shows the next pair.
  await expect(card).toContainText(nameC);

  // Undo reverses the merge: the loser is restored with its members.
  await page.getByTestId('undo-toast-action').click();
  let restoredRow: CollectionRow | undefined;
  await expect
    .poll(
      async () => {
        restoredRow = await findCollectionByName(request, token, nameB);
        return restoredRow?.status === 'active' ? restoredRow.item_count : 0;
      },
      { timeout: 30_000 }
    )
    .toBe(2);
  // `merge-collections` inverse RECREATES the loser (routes/collections.md
  // §merge undo: "loser recreated with name/`name_locked`/origin/publish_mode/
  // pin state" + the precondition REFUSES a reused loser id) — the restored
  // row carries a NEW collection_id, the old `bId` legitimately 404s. Anchor
  // the members-back proof on the name-resolved row instead of the dead id.
  const restored = await request.get(`/api/collections/${restoredRow!.collection_id}/items`, {
    headers: auth(token),
  });
  expect(restored.ok()).toBeTruthy();
  const restoredBody = await restored.json();
  const restoredNodeIds = (restoredBody.items as { node_id: number }[])
    .map((item) => item.node_id)
    .sort((x, y) => x - y);
  expect(restoredNodeIds).toEqual([shared.nodeId, onlyB.nodeId].sort((x, y) => x - y));
});

test('E2E-S3-COLLECTION-022: Later defers the pair into a DB-dormant card removal, Keep separate suppresses it permanently and the last resolved pair leaves zero layout footprint', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const file1 = await seedFile(request, token, base, testInfo, 'mergedisp-1');
  const file2 = await seedFile(request, token, base, testInfo, 'mergedisp-2');

  const nameA = buildName(testInfo, 'merge-x');
  const nameB = buildName(testInfo, 'merge-y');
  const aId = await createCollectionApi(request, token, nameA);
  const bId = await createCollectionApi(request, token, nameB);
  await addItemsApi(request, token, aId, [file1.nodeId, file2.nodeId]);
  await addItemsApi(request, token, bId, [file1.nodeId, file2.nodeId]);
  await seedMergeSuggestion(aId, bId, 800);

  await page.goto('/files/__collections__');
  const card = page.getByTestId('merge-proposal-card');
  await expect(card).toBeVisible({ timeout: 30_000 });

  // Later → dismissed (re-raisable by the nightly cadence; the row STAYS).
  await card.getByTestId('merge-later').click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => suggestionStateOf(aId, bId), { timeout: 15_000 }).toBe('dismissed');

  // Keep separate on the re-surfaced pair is terminal.
  await reopenMergeSuggestion(aId, bId);
  await page.goto('/files/__collections__');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByTestId('merge-keep-separate').click();
  await expect(card).toHaveCount(0);
  await expect.poll(() => suggestionStateOf(aId, bId), { timeout: 15_000 }).toBe('rejected');

  // Zero pending ⇒ zero footprint: no card DOM node above the list, and the
  // collection cards still render (the slot collapsed, it did not shift).
  await expect(page.getByTestId('merge-proposal-card')).toHaveCount(0);
  await expect(collectionCard(page, nameA)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Persisted cleanup-suggestion lifecycle (T3.3 — routes/dashboard.md §2.4,
// SuggestionsChecklist.md §2.3/§2.7, AI_FEATURE_PLAN §4.12/§4.16/§4.17)
// ---------------------------------------------------------------------------

interface DashboardSuggestionRow {
  id: number;
  node_id: number;
  kind: string;
  path: string;
  size_bytes: number;
  reason: { kind: string; keep_node_id?: number };
  created_at: string;
  expires_at: string | null;
}

interface DashboardBody {
  duplicates: { group_count: number; duplicate_count: number; reclaimable_bytes: number };
  near_duplicates?: { group_count: number; duplicate_count: number };
  suggestions: DashboardSuggestionRow[];
  trash: { item_count: number; total_bytes: number; retention_days: number };
}

/** The LAST persisted row state for a node (`file_suggestions` is append-per-
 * kind: the accept→undo→dismiss transitions ride the same row). */
async function fileSuggestionStateForNode(nodeId: number): Promise<string | undefined> {
  const rows = await queryScratchSqlite<{ state: string }>(
    path.join(scratch, 'webdav.db'),
    `SELECT state FROM file_suggestions WHERE node_id = ${nodeId} ORDER BY id DESC LIMIT 1`
  );
  return rows[0]?.state;
}

/** MyPage category navigation (009 idiom): permanent sidebar (desktop) vs
 * drawer (mobile). */
async function openMyPageStorage(page: Page, isMobile: boolean): Promise<void> {
  await page.goto('/mypage');
  if (isMobile) {
    const drawer = page.locator('.MuiDrawer-paper');
    await page.locator('button[aria-label="My page"]').click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: /^storage$/i }).click();
    await expect(drawer).not.toBeVisible();
  } else {
    await page.getByRole('button', { name: /^storage$/i }).click();
  }
}

test('E2E-S3-COLLECTION-023: the persisted cleanup-suggestion checklist accepts the hash-duplicate row with an undo that restores the node and re-lists the row, dismisses silently and stays AI-block free while the embed model is absent', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  // Two byte-identical uploads: the hash-first pass lists the HIGHER node id
  // under the deterministic keeper rule (`keep_node_id` = smallest id); the
  // upload write side stamps `content_hash` (`fileService` post-commit hook),
  // so the rows materialize on the dashboard read itself.
  const keeper = await seedFile(request, token, base, testInfo, 'sugg-keeper');
  const dup = await seedFile(request, token, base, testInfo, 'sugg-dup');
  const dupName = dup.path.split('/').pop() as string;

  const readDashboard = async (): Promise<DashboardBody> => {
    const res = await request.get('/api/dashboard', { headers: auth(token) });
    expect(res.ok()).toBeTruthy();
    return res.json() as Promise<DashboardBody>;
  };

  // (a) Persisted rows: the read materializes the pending set, rows carry ids,
  //     the keeper never lists, and the embed-unconfigured payload omits the
  //     vector section entirely (§4.12 absent-not-disabled).
  let body = await readDashboard();
  const seeded = body.suggestions.find((row) => row.node_id === dup.nodeId);
  expect(seeded).toBeTruthy();
  expect(seeded!.kind).toBe('exact_dup');
  expect(seeded!.id).toBeTruthy();
  expect(seeded!.reason.keep_node_id).toBe(keeper.nodeId);
  expect(body.suggestions.some((row) => row.node_id === keeper.nodeId)).toBe(false);
  expect(body.near_duplicates).toBeUndefined();
  expect(body.suggestions.every((row) => row.kind !== 'near_dup')).toBe(true);
  const trashBaseline = body.trash.item_count;

  await openMyPageStorage(page, isMobile);
  await expect(page.getByTestId('collection-dashboard')).toBeVisible();

  // (b) The checklist row: checkbox + per-row dismiss anchored on the
  //     PERSISTED id; NO accept control before a selection (single-control
  //     rule, SuggestionsChecklist.md §2.3).
  const checklistRow = page.locator('#dashboard-suggestions li').filter({ hasText: dupName });
  await expect(checklistRow).toBeVisible({ timeout: 30_000 });
  await expect(checklistRow.getByTestId('suggestion-checkbox')).toBeVisible();
  await expect(page.getByTestId(`suggestion-dismiss-${seeded!.id}`)).toBeVisible();
  await expect(page.getByTestId('suggestions-accept')).toHaveCount(0);

  // (c) checkbox → accept → trash verify. The trash check runs INSIDE the 8 s
  //     undo-toast window (bounded API reads, not browser navigation).
  await checklistRow.getByTestId('suggestion-checkbox').check();
  await expect(page.getByTestId('suggestions-accept')).toContainText('Accept selected (1)');
  await page.getByTestId('suggestions-accept').click();

  await expect(page.getByText(/Moved 1 items to Trash/i)).toBeVisible();
  const toastUndo = page.getByTestId('undo-toast-action');
  await expect(toastUndo).toBeVisible();
  await expect
    .poll(
      async () => {
        const after = await readDashboard();
        return (
          after.trash.item_count === trashBaseline + 1 &&
          !after.suggestions.some((row) => row.node_id === dup.nodeId)
        );
      },
      { timeout: 10_000 }
    )
    .toBe(true);
  await expect(checklistRow).toHaveCount(0);
  await expect.poll(() => fileSuggestionStateForNode(dup.nodeId)).toBe('accepted');

  // (d) undo → the node returns from trash AND the row re-lists (the same
  //     command flips `pending → accepted` back, one journaled command).
  await toastUndo.click();
  await expect(page.getByText(/1 undone/i)).toBeVisible();
  await expect(checklistRow).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => fileSuggestionStateForNode(dup.nodeId)).toBe('pending');
  await expect.poll(async () => (await readDashboard()).trash.item_count).toBe(trashBaseline);

  // (e) dismiss removes the row WITHOUT a toast (self-reversing preference,
  //     no journal row — routes/dashboard.md §2.4 dismiss).
  body = await readDashboard();
  const relisted = body.suggestions.find((row) => row.node_id === dup.nodeId);
  expect(relisted?.id).toBeTruthy();
  await page.getByTestId(`suggestion-dismiss-${relisted!.id}`).click();
  await expect(checklistRow).toHaveCount(0);
  await expect(page.getByTestId('undo-toast-action')).toHaveCount(0);
  await expect(page.getByText(/items to Trash/i)).toHaveCount(0);
  await expect.poll(() => fileSuggestionStateForNode(dup.nodeId)).toBe('dismissed');
  // Never re-listed and never re-inserted for the same node+kind.
  await expect(async () => {
    const after = await readDashboard();
    expect(after.suggestions.some((row) => row.node_id === dup.nodeId)).toBe(false);
  }).toPass({ timeout: 10_000 });

  // (f) AI-block gate audit (§4.12): embed unconfigured ⇒ no capacity sparkline
  //     (series seam absent) and no near-dup surfaces on the dashboard.
  await expect(page.getByTestId('capacity-sparkline')).toHaveCount(0);
  await expect(page.getByText(/near[- ]duplicate/i)).toHaveCount(0);

  // The trashed→restored pair rides the afterEach workspace purge (perm-delete
  // of the case folder; the dismissed suggestion row dies with the scratch db).
});

test('E2E-S3-COLLECTION-024: the sharing lifecycle grants a second user, the recipient views the received card and its members, exits via Revoke permission, and the owner re-grant re-dots the collection', async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    isMobileProject(testInfo),
    'E2E-S3-COLLECTION-024 is a desktop-only leg (mobile sharing parity stays deferred with the card-menu surfaces)'
  );

  // Second regular user (grantee) on the scratch instance — provisioned via
  // the OPERATOR admin API (identity pivot, PLAN §14).
  const recipientCreds: ScratchUserCreds = {
    username: 't32b-recipient',
    password: 'T32bRecipient!123',
    email: 't32b-recipient@e2etest.com',
  };
  await ensureScratchRegularUser(request, operatorToken, recipientCreds);

  // Owner world: home-based workspace, collection over owner-owned members,
  // one PUBLISHED member (ask-mode parking itself is 012's contract).
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const fileA = await seedFile(request, token, base, testInfo, 'col024-a');
  const name = buildName(testInfo, 'col024');
  const collectionId = await createCollectionApi(request, token, name);
  await addItemsApi(request, token, collectionId, [fileA.nodeId]);
  const publishRes = await request.put(`/api/collections/${collectionId}/items/publish`, {
    headers: auth(token),
    data: { nodeIds: [fileA.nodeId], published: true },
  });
  expect(publishRes.ok()).toBeTruthy();

  // Grantee numeric id from the owner-visible approved list.
  const usersRes = await request.get('/api/users/approved', { headers: auth(token) });
  expect(usersRes.ok()).toBeTruthy();
  const recipientUser = (await usersRes.json()).find(
    (candidate: { username: string }) => candidate.username === recipientCreds.username
  );
  expect(recipientUser).toBeTruthy();

  // 1) OWNER UI — the `sharing` card-menu dispatch opens the dialog on the
  //    Sharing tab (CollectionPropertiesDialog.md §2.3).
  await page.goto('/files/__collections__');
  await openCardMenu(page, name, 'sharing');
  await expect(page.getByTestId('collection-props-tab-sharing')).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByTestId('collection-publish-mode-exposure-note')).toBeVisible();

  // Add grant via the UserSelectionMenu picker (default role viewer).
  await expect(page.getByTestId('collection-grant-role-viewer')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.getByTestId('collection-grant-add').click();
  // The picker row carries username (span) AND email (<p>) — the email is a
  // superstring of the username, so the click must be EXACT (strict mode).
  await page.getByRole('menu').getByText(recipientCreds.username, { exact: true }).click();
  const grantRow = page.getByTestId(`collection-grant-row-${recipientUser.id}`);
  await expect(grantRow).toBeVisible({ timeout: 15_000 });
  await expect(grantRow).toContainText('Viewer'); // localized chip, never the raw enum
  await expect(page.getByText(/Collection shared/i)).toBeVisible();
  // The undo toast is NOT clicked: the lifecycle leg below is the intended
  // re-grant path (revoke-undo = re-grant only behind an explicit click).

  // publish_mode ask→auto PUT through the radio (exposure copy visible above).
  await page.getByTestId('collection-publish-mode-auto').click();
  await expect(page.getByText(/Publish mode updated/i)).toBeVisible();

  await page.getByRole('button', { name: 'Close' }).last().click();

  // 2) RECIPIENT UI — switch sessions (clear + re-login as the grantee).
  await page.evaluate(() => window.localStorage.clear());
  await loginWithCredentials(page, recipientCreds.username, recipientCreds.password);
  await page.goto('/files/__collections__');
  const card = collectionCard(page, name);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`card-shared-chip-${collectionId}`)).toBeVisible();

  // Members view as a grantee: the published owner-owned member renders
  // (cross-leak rule §4.7 — foreign rows are never delivered server-side).
  await openCollectionCard(page, name, false);
  await expect(page.getByTestId(`member-row-${fileA.nodeId}`)).toBeVisible({ timeout: 30_000 });

  // Leaving is Path-1 self-revocation: the grantee card menu carries
  // `Revoke permission` ONLY — the owner Sharing entry is absent by
  // construction (granted rows omit it; the dialog would omit the tab).
  await page.goto('/files/__collections__');
  await openCardMenu(page, name, 'revoke-permission');
  // (openCardMenu already clicked the option — instant, no confirm dialog)
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId(`collection-new-dot-${collectionId}`)).toHaveCount(0);

  // 3) RE-GRANT (owner API) re-dots: both revoke TXs deleted the grantee's
  //    digest cursor, so a fresh grant renders the new-dot again (Ruling B,
  //    AI_FEATURE_PLAN §12.2 — the read-IS-the-visit open above stamped it).
  const regrantRes = await request.post(`/api/collections/${collectionId}/grants`, {
    headers: auth(token),
    data: { userId: recipientUser.id, role: 'viewer' },
  });
  expect(regrantRes.ok()).toBeTruthy();
  await page.goto('/files/__collections__');
  await expect(collectionCard(page, name)).toBeVisible({ timeout: 30_000 });
  const toggle = page.getByTestId('collections-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await expect(page.getByTestId(`collection-new-dot-${collectionId}`)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Files-surface membership badges + toolbar bulk add (T3.6 —
// CollectionMembershipBadges.md, useCollectionMemberships.md,
// BulkActionToolbar.md §3 merged idiom, pages/FileManager.md §7 operator rule)
// ---------------------------------------------------------------------------

/** Dual-platform multi-select idiom (core-flow.shared `selectTwoFiles`): the
 * desktop first click enters selection mode and Meta-clicks add rows; mobile
 * long-presses the first, taps the second, and re-does the sequence when a
 * WebKit synthetic tap mis-targets (bounded). */
async function selectTwoForBulk(page: Page, isMobile: boolean, p1: string, p2: string) {
  if (isMobile) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        if (
          await page
            .getByTestId('bulk-action-deselect-all')
            .isVisible()
            .catch(() => false)
        ) {
          await page.getByTestId('bulk-action-deselect-all').click();
          await expect(page.getByTestId('bulk-action-move')).not.toBeVisible();
        }
      }
      await longPressItem(page, p1);
      await fileItem(page, p2).click();
      try {
        await expect(fileItem(page, p1)).toHaveAttribute('aria-selected', 'true', {
          timeout: 2500,
        });
        await expect(fileItem(page, p2)).toHaveAttribute('aria-selected', 'true', {
          timeout: 2500,
        });
        break;
      } catch {
        // Mis-targeted tap; retry the whole sequence.
      }
    }
    await expect(page.getByTestId('bulk-action-move')).toBeVisible();
  } else {
    await fileItem(page, p1).click();
    await fileItem(page, p2).click({ modifiers: ['Meta'] });
    await expect(page.getByTestId('bulk-action-move')).toBeVisible();
  }
}

test('E2E-S3-COLLECTION-025: files-surface rows badge their collections in grid and list with the cap plus overflow, the bulk toolbar add lands checkmarked on read-only granted rows and moves badges without reload, and an admin session stays badge-free and collections-IO-silent', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const fileA = await seedFile(request, token, base, testInfo, 'chip-a');
  const fileB = await seedFile(request, token, base, testInfo, 'chip-b');

  const name1 = buildName(testInfo, 'chip-c1');
  const name2 = buildName(testInfo, 'chip-c2');
  const name3 = buildName(testInfo, 'chip-c3');
  const c1 = await createCollectionApi(request, token, name1);
  const c2 = await createCollectionApi(request, token, name2);
  const c3 = await createCollectionApi(request, token, name3);
  // Two seeded memberships: fileA ∈ C1, fileB ∈ C2.
  await addItemsApi(request, token, c1, [fileA.nodeId]);
  await addItemsApi(request, token, c2, [fileB.nodeId]);

  // Read-only host subtree: a SECOND regular user owns the granted folder —
  // the operator seeds the folder + files and grants the ACTOR READ (the
  // share-internal idiom, PLAN §14 admin-operator pivot). The rows stay
  // readable-not-writable for the actor: the T3.6 bulk-add gate ("you may
  // only add what you can read").
  const hostCreds: ScratchUserCreds = {
    username: 't36-ro-host',
    password: 'T36RoHost!123',
    email: 't36-ro-host@e2etest.com',
  };
  await ensureScratchRegularUser(request, operatorToken, hostCreds);
  const roFolderName = buildName(testInfo, 'chip-ro-host');
  const hostHomeId = await resolveNodeId(request, operatorToken, `/${hostCreds.username}`);
  const roFolderId = await createFolderAt(request, operatorToken, hostHomeId, roFolderName);
  const roFixture = readTestFileFixture(TEST_FILES.smallText);
  const ro1Name = buildName(testInfo, 'chip-ro-1', '.txt');
  const ro2Name = buildName(testInfo, 'chip-ro-2', '.txt');
  const ro1 = {
    nodeId: await uploadFileAt(
      request,
      operatorToken,
      roFolderId,
      ro1Name,
      'text/plain',
      roFixture
    ),
    path: `/${hostCreds.username}/${roFolderName}/${ro1Name}`,
  };
  const ro2 = {
    nodeId: await uploadFileAt(
      request,
      operatorToken,
      roFolderId,
      ro2Name,
      'text/plain',
      roFixture
    ),
    path: `/${hostCreds.username}/${roFolderName}/${ro2Name}`,
  };
  const meRes = await request.get('/api/auth/me', { headers: auth(token) });
  expect(meRes.ok()).toBeTruthy();
  const viewerUserId = (await meRes.json()).id as number;
  const grantRes = await request.post('/api/permissions/grant', {
    headers: auth(operatorToken),
    data: { userId: viewerUserId, nodeId: roFolderId, permission: 'read' },
  });
  expect(grantRes.ok()).toBeTruthy();
  // The granted subtree is case-owned too (registered with the USER token —
  // the perm-delete fallback runs it through the OPERATOR, dual-token idiom).
  trackWorkspaceCleanup(token, `/${hostCreds.username}/${roFolderName}`);
  // Both granted rows already live in C2: the checkmark anchor of the bulk
  // menu (C2 contains ALL targets) + the badge-on-read-only-row anchor.
  await addItemsApi(request, token, c2, [ro1.nodeId, ro2.nodeId]);

  // (a) HOME GRID: the batched for-nodes read badges both rows with the
  //     collection NAMES (aria tooltip `membershipChip`, en bundle).
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, fileA.path)).toBeVisible();
  await page.getByTestId('view-mode-grid').click();
  const badgeA1 = page.getByTestId(`membership-badge-${fileA.nodeId}-${c1}`);
  await expect(badgeA1).toBeVisible({ timeout: 30_000 });
  await expect(badgeA1).toHaveAttribute('aria-label', `Member of ${name1}`);
  await expect(page.getByTestId(`membership-badge-${fileB.nodeId}-${c2}`)).toBeVisible();
  await expect(page.locator('[data-testid^="membership-badge-"]')).toHaveCount(2);

  // (b) HOME LIST: the SAME testids through the leading-column overlay.
  await page.getByTestId('view-mode-list').click();
  await expect(badgeA1).toBeVisible();
  await expect(page.getByTestId(`membership-badge-${fileB.nodeId}-${c2}`)).toBeVisible();

  // (c) Context-menu toggle of a SECOND collection on fileA: the single-target
  //     menu pre-checks the containing collection (membershipIds), the add
  //     lands the new badge on the spot (no reload — the notifier re-read).
  await openFileActions(page, fileA.path, isMobile);
  await page.getByTestId('collection-add').click();
  await expect(page.getByTestId(`collection-checked-${c1}`)).toBeVisible();
  await expect(page.getByTestId(`collection-checked-${c2}`)).toHaveCount(0);
  await page.getByTestId(`collection-option-${c2}`).click();
  await expect(page.getByText(/Added to collection/i)).toBeVisible();
  await expect(page.getByTestId(`membership-badge-${fileA.nodeId}-${c2}`)).toBeVisible({
    timeout: 15_000,
  });
  // Let the 8 s undo toast expire before re-opening the row surface (the
  // bottom Snackbar overlays the mobile action anchor).
  await expect(page.getByText(/Added to collection/i)).toBeHidden({ timeout: 15_000 });

  // (d) The THIRD membership collapses to the cap: exactly two collection
  //     plates + the `+1 more` overflow naming the hidden collection.
  await openFileActions(page, fileA.path, isMobile);
  await page.getByTestId('collection-add').click();
  await page.getByTestId(`collection-option-${c3}`).click();
  await expect(page.getByText(/Added to collection/i)).toBeVisible();
  const fileABadges = page.locator(`[data-testid^="membership-badge-${fileA.nodeId}-"]`);
  const overflow = page.getByTestId(`membership-badge-more-${fileA.nodeId}`);
  await expect(fileABadges).toHaveCount(2);
  await expect(overflow).toBeVisible({ timeout: 15_000 });
  const shownIds = await fileABadges.evaluateAll((els) =>
    els.map((el) => Number(String(el.getAttribute('data-testid')).split('-').pop()))
  );
  const missingId = [c1, c2, c3].find((id) => !shownIds.includes(id));
  const missingName = missingId === c1 ? name1 : missingId === c2 ? name2 : name3;
  await expect(overflow).toHaveAttribute('aria-label', new RegExp(`\\+1 more — ${missingName}`));

  // (e) The granted (read-only) rows badge too — the batched read is
  //     permission-agnostic and belongs to the FILES surfaces (shared routes
  //     included). Then the bulk toolbar add lands on them.
  await gotoNodePage(page, roFolderId);
  await expect(fileItem(page, ro1.path)).toBeVisible();
  await expect(page.getByTestId(`membership-badge-${ro1.nodeId}-${c2}`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId(`membership-badge-${ro2.nodeId}-${c2}`)).toBeVisible();

  await selectTwoForBulk(page, isMobile, ro1.path, ro2.path);
  // The file-write gate still holds (move disabled) while the membership
  // write stays available for readable rows (T3.6 ruling, §30.1).
  await expect(page.getByText(/Selection includes read-only files/i)).toBeVisible();
  await expect(page.getByTestId('bulk-action-move')).toBeDisabled();
  const bulkAdd = page.getByTestId('bulk-collection-add');
  await expect(bulkAdd).toBeEnabled();
  await bulkAdd.click();

  // Checkmark rows = collections containing ALL targets: C2 holds both.
  await expect(page.getByTestId(`collection-checked-${c2}`)).toBeVisible();
  await expect(page.getByTestId(`collection-checked-${c1}`)).toHaveCount(0);
  await expect(page.getByTestId(`collection-checked-${c3}`)).toHaveCount(0);
  await page.getByTestId(`collection-option-${c1}`).click();

  // One undo toast per command (BulkActionToolbar.md §3) — NOT clicked; the
  // badge re-read lands WITHOUT any reload (notifier refresh on the batched
  // membership read).
  await expect(page.getByText(/Added to collection/i)).toBeVisible();
  await expect(page.getByTestId(`membership-badge-${ro1.nodeId}-${c1}`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId(`membership-badge-${ro2.nodeId}-${c1}`)).toBeVisible();
  await expect(page.locator(`[data-testid^="membership-badge-${ro1.nodeId}-"]`)).toHaveCount(2);

  // (f) ADMIN NEGATIVE (operator rule, pages/FileManager.md §7): the SAME tree
  //     under the admin session renders zero badges, zero bulk-add entry and
  //     issues ZERO /api/collections IO (inert gateway).
  const collectionsCalls: string[] = [];
  const monitor = (req: Request) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith('/api/collections')) {
      collectionsCalls.push(`${req.method()} ${url.pathname}`);
    }
  };
  await gotoAsAnonymous(page, '/login');
  page.on('request', monitor);
  await loginWithCredentials(page, TEST_USERS.admin.username, ADMIN_PASSWORD);
  await gotoNodePage(page, await resolveNodeId(request, operatorToken, `/${base}`));
  await expect(fileItem(page, fileA.path)).toBeVisible();
  await expect(page.locator('[data-testid^="membership-badge-"]')).toHaveCount(0);
  if (isMobile) {
    await longPressItem(page, fileA.path);
  } else {
    await fileItem(page, fileA.path).click();
  }
  await expect(page.getByTestId('bulk-action-move')).toBeVisible();
  await expect(page.getByTestId('bulk-collection-add')).toHaveCount(0);
  // Bounded settle so a late-firing collections read would land in the
  // counter before the assertion (infrastructure wait, not a latency claim).
  await page.waitForTimeout(2_000);
  page.off('request', monitor);
  expect(collectionsCalls, collectionsCalls.join('\n')).toEqual([]);

  // Restore the regular-user session so the afterEach purge runs collections
  // CRUD on its own identity (admin sessions are 403-gated there, §14 pivot).
  await gotoAsAnonymous(page, '/login');
  await loginWithCredentials(page, USER_CREDS.username, USER_CREDS.password);
});

// -- Collections MOBILE-ONLY interplay (the former standalone twin
// collections.mobile.spec.ts, absorbed into this dual-platform file at the
// format convergence): these cases exercise surfaces that exist ONLY on the
// mobile form factor (single-tap card open, the mobile detail-view
// restriction, the FileActionSheet like surface), so they skip on the desktop
// project with the reason-carrying skip idiom of E2E-BULK-006.

async function setupCollectionWithMember(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
  tag: string
) {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const file = await seedFile(request, token, base, testInfo, tag);
  const name = buildName(testInfo, tag);
  const collectionId = await createCollectionApi(request, token, name);
  await addItemsApi(request, token, collectionId, [file.nodeId]);
  return { base, token, file, name, collectionId };
}

test('E2E-S3-COLLECTION-015: mobile TAP opens a collection card directly into the members view (no double-tap) and the Collections crumb chip returns to the list', async ({
  page,
  request,
}, testInfo) => {
  test.skip(!isMobileProject(testInfo), 'E2E-S3-COLLECTION-015 is mobile-only');
  const { file, collectionId, name } = await setupCollectionWithMember(
    page,
    request,
    testInfo,
    'col015'
  );

  await page.goto('/files/__collections__');
  const card = page.locator('[data-testid^="collection-card-"]').filter({ hasText: name });
  await expect(card).toBeVisible({ timeout: 15_000 });

  // Mobile click resolution (CollectionsListView §2.4 + spec "Mobile: tap
  // opens directly"): ONE tap navigates — a second click would land INSIDE
  // the members surface, so any dblclick-era behavior would break this.
  await card.click();
  await expect(page.getByTestId('members-list')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/files/__collections__/collection/${collectionId}$`));
  await expect(page.getByTestId(`member-row-${file.nodeId}`)).toBeVisible();

  // Back to the collections list via the breadcrumb parent chip (M-9 trail:
  // Collections › <name> — the chip is the mobile-side "back to sidebar").
  const crumb = page.getByTestId('breadcrumb');
  await expect(crumb.getByText('Collections', { exact: true })).toBeVisible();
  await crumb.getByText('Collections', { exact: true }).click();
  await expect(page.getByTestId('collections-list-view')).toBeVisible();
  await expect(card).toBeVisible();
});

test('E2E-S3-COLLECTION-016: members surface on mobile keeps the GRID default, hides the detail toggle and forces LIST when the persisted member key is detail (mobile restriction, unchanged per useExplorerSession.md)', async ({
  page,
  request,
}, testInfo) => {
  test.skip(!isMobileProject(testInfo), 'E2E-S3-COLLECTION-016 is mobile-only');
  const { file, name } = await setupCollectionWithMember(page, request, testInfo, 'col016');

  await page.goto('/files/__collections__');
  const card = page.locator('[data-testid^="collection-card-"]').filter({ hasText: name });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click();
  await expect(page.getByTestId('members-list')).toBeVisible();

  // The spec does NOT force grid→list on mobile: the P-4 default (grid)
  // renders through FileGrid on mobile exactly as on desktop — a card shell
  // exists inside the member row.
  const row = page.getByTestId(`member-row-${file.nodeId}`);
  await expect(row).toBeVisible();
  await expect(row.locator('.MuiCard-root')).toBeVisible();

  // Toolbar (FileManagerControls §2 "isMobile: no detail view"): list + grid
  // toggles stay, the detail toggle is NOT rendered on mobile.
  await expect(page.getByTestId('view-mode-list')).toBeVisible();
  await expect(page.getByTestId('view-mode-grid')).toBeVisible();
  await expect(page.getByTestId('view-mode-detail')).toHaveCount(0);

  // The mobile detail→list restriction applies to the member key too
  // (useExplorerSession.md): seed the persisted key as `detail`, reload the
  // member route — the session hook falls back to LIST and persists the
  // correction (FileList rows, no card shell).
  await page.evaluate(() => window.localStorage.setItem('collectionMemberViewMode', 'detail'));
  await page.reload();
  await expect(page.getByTestId('members-list')).toBeVisible();
  await expect(page.getByTestId(`member-row-${file.nodeId}`)).toBeVisible();
  await expect(page.locator(`[data-testid="member-row-${file.nodeId}"] .MuiCard-root`)).toHaveCount(
    0
  );
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('collectionMemberViewMode')))
    .toBe('list');
});

test('E2E-S3-COLLECTION-017: file-side like via the mobile FileActionSheet flips optimistically and persists viewer-scoped (desktop E2E-S3-COLLECTION-007 bottom-sheet parity)', async ({
  page,
  request,
}, testInfo) => {
  test.skip(!isMobileProject(testInfo), 'E2E-S3-COLLECTION-017 is mobile-only');
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const file = await seedFile(request, token, base, testInfo, 'col017');
  await gotoFilesPath(page, request, `/${base}`);
  await expect(page.locator(`[data-file-path="${file.path}"]`)).toBeVisible({ timeout: 15_000 });

  // The mobile file action surface IS the bottom sheet (helpers seam parity
  // with core-flow.mobile): ⋮ on the row opens FileActionSheet.
  await openActionSheet(page, file.path);
  await expect(page.getByTestId('like-toggle')).toHaveText(/^like$/i);
  await page.getByTestId('like-toggle').click();

  // Sheet closes on the action; a REOPEN shows the flipped label straight
  // away — the optimistic client state (fileLikesRepository explicit set,
  // fileLikes.md §2.4), before any list refresh.
  await expect(page.getByTestId('file-action-rename')).toBeHidden();
  await openActionSheet(page, file.path);
  await expect(page.getByTestId('like-toggle')).toHaveText(/^unlike$/i);
  await closeActionSheet(page);

  // Server truth converges: the viewer-scoped like lists the node.
  await expect
    .poll(async () => {
      const res = await request.get('/api/file-likes', { headers: auth(token) });
      const body = await res.json();
      return (body.liked as number[]).includes(file.nodeId);
    })
    .toBe(true);
});
