import fs from 'node:fs';

import { APIRequestContext, expect, Page, TestInfo, test } from '@playwright/test';

import {
  ensureClientBuild,
  ensureWebdavSubtree,
  killScratch,
  scratchDirFor,
  seedWebdavSettings,
  spawnScratchServer,
  waitForScratchHealth,
  writeScratchEnv,
} from './helpers/setupScratch';
import { e2ePorts, webdavBase } from './helpers/ports';
import { loginWithCredentials } from './helpers/auth';
import {
  ensureScratchRegularUser,
  loginScratchAdmin,
  type ScratchUserCreds,
} from './helpers/scratchUser';
import { buildName, fileItem, flushPrivateWorkspaceCleanups } from './helpers/files';
import { loginAndOpenUserWorkspace, seedFile } from './helpers/collectionsWorkspace';
import { getSessionToken, gotoFilesPath, resolveNodeId } from './helpers/resolvePath';
import { rightClickItem } from './helpers/desktop-interactions';
import { setCollectionSort } from './helpers/explorer-controls';

/**
 * E2E-COLLECTION-001..014 + 018..020 — the P0 collections binding lifecycle
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
 * boots its OWN server on :5013 (own sqlite, webdav file backend) and never
 * touches the shared :5002 pool. One scratch server serves the whole (serial,
 * desktop-only) file — restart is not a behavior under test here. No AI
 * surfaces are expected (`semantic_available:false`): P0 only.
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
const SCRATCH_PORT = e2ePorts.scratchCollections;
const WEBDAV_BASE = webdavBase;
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
  const res = await request.get(`/api/collections?include=${include}`, { headers: auth(token) });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.collections as CollectionRow[];
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

async function openCardMenu(page: Page, name: string, action: string): Promise<void> {
  await expect(collectionCard(page, name)).toBeVisible({ timeout: 10_000 });
  await collectionCard(page, name).locator('[data-testid^="card-menu-button-"]').click();
  await page.getByTestId(`card-menu-option-${action}`).click();
}

/** File-parity open (P-3): double-click the card body (menu button sits top-right). */
async function openCollectionCard(page: Page, name: string): Promise<void> {
  const card = collectionCard(page, name);
  await expect(card).toBeVisible({ timeout: 10_000 });
  // dblclick the tile corner: the media area hosts the click target while the
  // ⋮ menu button keeps its own (stopPropagation) click region top-right.
  await card.dblclick({ position: { x: 8, y: 8 } });
}

/** File context menu → Add to collection → inline New collection (name + Enter). */
async function uiCreateCollectionWithFile(page: Page, filePath: string, name: string) {
  trackedCollections.push(name);
  await rightClickItem(page, filePath);
  await page.getByTestId('collection-add').click();
  await page.getByTestId('new-collection-row').click();
  await page.getByTestId('new-collection-input').fill(name);
  await page.keyboard.press('Enter');
}

async function uiAddToCollection(page: Page, filePath: string, collectionName: string) {
  await rightClickItem(page, filePath);
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

test.beforeAll(async ({ request }) => {
  scratch = scratchDirFor(CASE_ID);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  writeScratchEnv(scratch, {
    PORT: String(SCRATCH_PORT),
    WEA_FILE_STORAGE: 'webdav',
    WEBDAV_UPSTREAM_URL: WEBDAV_BASE,
    JWT_SECRET: 'collections-e2e-jwt-secret',
    ADMIN_DEFAULT_PASSWORD: ADMIN_PASSWORD,
  });
  await seedWebdavSettings(scratch);
  await ensureWebdavSubtree(CASE_ID);
  ensureClientBuild();
  spawned = spawnScratchServer(scratch, SCRATCH_PORT);
  await waitForScratchHealth(spawned, SCRATCH_PORT);
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

test('E2E-COLLECTION-001: Collections sidebar section expands to the archive node and routes to the collections list view', async ({
  page,
}) => {
  await loginWithCredentials(page, USER_CREDS.username, USER_CREDS.password);
  await page.goto('/files');

  const section = page.getByTestId('collections-section');
  await expect(section).toBeVisible();
  await expect(section).toContainText('Collections');

  await page.getByTestId('collections-toggle').click();
  await expect(page.getByTestId('collections-archive-node')).toBeVisible();

  await section.getByText('Collections', { exact: true }).click();
  await expect(page).toHaveURL(/__collections__/);
  await expect(page.getByTestId('collections-list-view')).toBeVisible();
  await expect(page.getByTestId('collections-list-region')).toBeVisible();
  // P-2: the single context-aware toolbar sort button owns collections sort.
  await expect(page.getByTestId('file-manager-sort')).toBeVisible();
});

test('E2E-COLLECTION-002: Add-to-collection submenu creates a collection inline, adds a second file through the collection row and the member view lists them', async ({
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
  await uiCreateCollectionWithFile(page, fileA.path, name);

  // One undo toast per command (spec §2.3): the create carries the pointer.
  await expect(page.getByText(/Collection created/i)).toBeVisible();
  await expect(page.getByTestId('undo-toast-action')).toBeVisible();

  await gotoFilesPath(page, request, `/${base}`);
  await uiAddToCollection(page, fileB.path, name);
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

  await openCollectionCard(page, name);
  await expect(page.getByTestId('members-list')).toBeVisible();
  await expect(page.locator('[data-testid^="member-row-"]')).toHaveCount(2);
});

test('E2E-COLLECTION-003: Re-opening a collection member view reports the digest of members added since the last visit', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const fileA = await seedFile(request, token, base, testInfo, 'col003-a');
  const fileB = await seedFile(request, token, base, testInfo, 'col003-b');
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, fileA.path)).toBeVisible();

  const name = buildName(testInfo, 'col');
  await uiCreateCollectionWithFile(page, fileA.path, name);
  // The create toast proves the collection exists before the API follow-ups.
  await expect(page.getByTestId('undo-toast-action')).toBeVisible();
  const created = await findCollectionByName(request, token, name);
  expect(created).toBeDefined();
  const collectionId = created!.collection_id;

  // First visit stores the client-side digest cursor for this collection.
  await page.goto('/files/__collections__');
  await openCollectionCard(page, name);
  await expect(page.getByTestId('members-list')).toBeVisible();
  await expect(page.getByTestId('digest-banner')).toHaveCount(0);

  await gotoFilesPath(page, request, `/${base}`);
  // `created_at` is second-granular on the scratch sqlite; wait past the
  // cursor second so the added member is strictly newer than the visit.
  await page.waitForTimeout(1500);
  await addItemsApi(request, token, collectionId, [fileB.nodeId]);

  await page.goto('/files/__collections__');
  await openCollectionCard(page, name);
  await expect(page.getByTestId('digest-banner')).toContainText(/\+1\s*\/\s*-0/);
  // Admin-operator pivot (PLAN §14): the acting regular user OWNS the whole
  // workspace subtree through the home-root ADMIN closure grant — a member
  // inside it is NOT foreign: no bogus `shared_excluded` lock badge. fileB is
  // unpublished ⇒ the publish-pending badge renders (R2 suppression applies
  // to excluded rows only).
  await expect(page.getByTestId(`member-excluded-badge-${fileB.nodeId}`)).toHaveCount(0);
  await expect(page.getByTestId(`member-publish-pending-badge-${fileB.nodeId}`)).toBeVisible();
});

test('E2E-COLLECTION-004: Card menu archive moves the collection into the archive view and restore returns it to the active list', async ({
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

test('E2E-COLLECTION-005: Undo toast reverses a collection archive', async ({
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

test('E2E-COLLECTION-006: Permanent delete is offered only in the archive view and purges the collection after two confirmations', async ({
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

test('E2E-COLLECTION-007: Like toggle from the file context menu persists the viewer-scoped like', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const fileA = await seedFile(request, token, base, testInfo, 'col007');
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, fileA.path)).toBeVisible();

  await rightClickItem(page, fileA.path);
  await expect(page.getByTestId('like-toggle')).toHaveText(/^like$/i);
  await page.getByTestId('like-toggle').click();

  // Re-opened menu reflects the flipped state (optimistic + server truth).
  await rightClickItem(page, fileA.path);
  await expect(page.getByTestId('like-toggle')).toHaveText(/^unlike$/i);

  await expect
    .poll(async () => {
      const res = await request.get('/api/file-likes', { headers: auth(token) });
      const body = await res.json();
      return (body.liked as number[]).includes(fileA.nodeId);
    })
    .toBe(true);
});

test('E2E-COLLECTION-008: Member row menu excludes a file with undo and exposes no file-mutating entries', async ({
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
  await openCollectionCard(page, name);
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
  await openCollectionCard(page, name);
  await expect(page.getByTestId(`member-row-${fileB.nodeId}`)).toBeVisible();
});

test('E2E-COLLECTION-009: Storage dashboard renders the collection journal feed and feed undo restores an archived collection', async ({
  page,
  request,
}, testInfo) => {
  const { token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const name = buildName(testInfo, 'col');
  const collectionId = await createCollectionApi(request, token, name);
  await archiveCollectionApi(request, token, collectionId);

  await page.goto('/mypage');
  await page.getByRole('button', { name: /^storage$/i }).click();
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
  // absent) and no suggestion checkboxes (`semantic_available:false`).
  await expect(page.getByTestId('capacity-sparkline')).toHaveCount(0);
  await expect(page.getByTestId('suggestion-checkbox')).toHaveCount(0);
});

test('E2E-COLLECTION-010: The toolbar sort button re-sorts the collections list by created (newest-first) and name (ASC)', async ({
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
  await uiCreateCollectionWithFile(page, file.path, nameA);
  await expect(page.getByText(/Collection created/i)).toBeVisible();
  await uiCreateCollectionWithFile(page, file.path, nameZ);

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

test('E2E-COLLECTION-011: members render the shared grid by default, the list toggle persists per-surface and double-click previews by nodeId', async ({
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
  await openCollectionCard(page, name);
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
  await openCollectionCard(page, name);
  await expect(row.locator('.MuiCard-root')).toHaveCount(0);

  // Double-click → preview through the SHARED click machinery (nodeId
  // metadata/blob channel — member rows carry path:'' by contract).
  await row.dblclick();
  const preview = page.getByTestId('file-preview-dialog');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(nameHead);
});

test('E2E-COLLECTION-012: the publish-all banner flips stored members through PUT /:id/items/publish and the owner per-row publish menu is reachable', async ({
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
  await openCollectionCard(page, name);
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

test('E2E-COLLECTION-013: the sidebar Likes child row lists liked files through the member machinery, persists its own view key, and unlike drops the row live without touching collections', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const fileA = await seedFile(request, token, base, testInfo, 'col013-a');

  // A collection the likes lifecycle must never touch (membership + sidebar).
  const collectionName = buildName(testInfo, 'col');
  const collectionId = await createCollectionApi(request, token, collectionName);
  await addItemsApi(request, token, collectionId, [fileA.nodeId]);

  // Like via the file context menu (same entry E2E-007 persists).
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, fileA.path)).toBeVisible();
  await rightClickItem(page, fileA.path);
  await expect(page.getByTestId('like-toggle')).toHaveText(/^like$/i);
  await page.getByTestId('like-toggle').click();

  // Open the Likes row through the SIDEBAR (Collections-section child, P-5
  // owner ruling — not a top-level virtual root).
  await page.getByTestId('collections-toggle').click();
  await expect(page.getByTestId('collections-liked-node')).toBeVisible();
  await page.getByTestId('collections-liked-node').click();
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
  await openCollectionCard(page, collectionName);
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
  await page.getByTestId('collections-liked-node').click();
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
  await expect(page.getByTestId(`collection-row-${collectionId}`)).toBeVisible();
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

test('E2E-COLLECTION-014: Likes-first/Archive-last tiles navigate, archive view shows no tiles under Collections › Archive crumb, collection opens as Collections › <name>', async ({
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
  await openCollectionCard(page, name);
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

test('E2E-COLLECTION-018: Card menu rename updates the card and the sidebar row, locks the name and is undoable', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const file = await seedFile(request, token, base, testInfo, 'col018');
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, file.path)).toBeVisible();

  const name = buildName(testInfo, 'col018');
  await uiCreateCollectionWithFile(page, file.path, name);
  await expect(page.getByText(/Collection created/i)).toBeVisible();
  const created = await findCollectionByName(request, token, name);
  expect(created).toBeDefined();
  const collectionId = created!.collection_id;

  // Card menu → Rename → RenameDialog submit (FileManager handleCardAction
  // 'rename' → collectionsApi.renameCollection → PUT /:id {name}).
  await page.goto('/files/__collections__');
  await openCardMenu(page, name, 'rename');
  const renameDialog = page.getByRole('dialog');
  await renameDialog.getByTestId('rename-name-input').fill('Q3 reports');
  await renameDialog.getByTestId('rename-submit').click();

  // Card shows the new name; PUT /:id with a `name` write sets
  // name_locked=true (routes/collections.md PUT + store §2 renameCollection).
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

  // Sidebar row reflects the rename through the collections notifier — on the
  // SAME page (the tree stays mounted under the collections overlay; the
  // section is collapsed after a reload, expand it first). Same-page also
  // keeps the 8 s undo-toast alive for the click below.
  await page.getByTestId('collections-toggle').click();
  await expect(page.getByTestId(`collection-row-${collectionId}`)).toContainText('Q3 reports');

  // One journaled command ⇒ one undo toast ("Collection renamed",
  // collections.undoRenamed); clicking Undo applies the inverse name.
  await expect(page.getByText(/Collection renamed/i)).toBeVisible();
  await expect(page.getByTestId('undo-toast-action')).toBeVisible();
  await page.getByTestId('undo-toast-action').click();

  await expect
    .poll(async () => Boolean(await findCollectionByName(request, token, name)), {
      timeout: 15_000,
    })
    .toBe(true);
  await page.goto('/files/__collections__');
  await expect(collectionCard(page, name)).toBeVisible();
  await expect(collectionCard(page, 'Q3 reports')).toHaveCount(0);
});

test('E2E-COLLECTION-019: The properties dialog header toggles the viewer-scoped like and the surfaces share the state', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const file = await seedFile(request, token, base, testInfo, 'col019');
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, file.path)).toBeVisible();

  // Dialog-scoped like toggle (FilePropertiesDialog §3.3 header IconButton —
  // aria-label Like/Unlike, not menu text).
  await rightClickItem(page, file.path);
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
  await rightClickItem(page, file.path);
  await page.getByTestId('file-action-properties').click();
  await expect(page.getByRole('dialog').getByTestId('like-toggle')).toHaveAttribute(
    'aria-label',
    'Unlike'
  );

  // Context-menu row reads the same state (optimistic row merge + notifier):
  // shared like state across surfaces, invariant 9 (viewer-scoped).
  await page.keyboard.press('Escape');
  await rightClickItem(page, file.path);
  await expect(page.getByTestId('like-toggle')).toHaveText(/^unlike$/i);
  await page.keyboard.press('Escape');
});

test('E2E-COLLECTION-020: The sidebar Archive node routes into the tile-free archive view with the Collections › Archive breadcrumb and the chip returns to the ordered active list', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const name = buildName(testInfo, 'col020');
  const collectionId = await createCollectionApi(request, token, name);
  await archiveCollectionApi(request, token, collectionId);

  // Sidebar routing (CLICK, not goto): expand the section, hit the Archive
  // node — FolderTree handleArchiveClick → /files/__collections__/__archive__.
  await page.getByTestId('collections-toggle').click();
  await expect(page.getByTestId('collections-archive-node')).toBeVisible();
  await page.getByTestId('collections-archive-node').click();
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
