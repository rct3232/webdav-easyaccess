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
import {
  ensureScratchRegularUser,
  loginScratchAdmin,
  type ScratchUserCreds,
} from './helpers/scratchUser';
import { buildName, flushPrivateWorkspaceCleanups } from './helpers/files';
import { loginAndOpenUserWorkspace, seedFile } from './helpers/collectionsWorkspace';
import { getSessionToken, gotoFilesPath } from './helpers/resolvePath';
import { closeActionSheet, openActionSheet } from './helpers/mobile-interactions';

/**
 * E2E-COLLECTION-015..017 — the collections MOBILE leg (P0 closeout item 2,
 * docs/E2E_COVERAGE_PLAN.md). Desktop twin: `e2e/collections.spec.ts`
 * (001..014, :5013); this file boots its OWN scratch server on
 * `e2ePorts.scratchCollectionsMobile` (base :5014, band-offset aware) so the
 * two legs never overlap each other's world.
 *
 * Scope: the mobile-only interplay the desktop suite structurally cannot
 * exercise (CollectionsListView.md §2.4 mobile click resolution,
 * useExplorerSession.md §"mobile detail→list restriction", the mobile
 * FileActionSheet parity of the desktop context menu per
 * FileManagerControls.md "no detail view on mobile").
 *
 * SCRATCH-HERMETIC + IDENTITY mirror the desktop suite (admin-operator pivot,
 * PLAN §14): every case acts as the provisioned REGULAR USER; the scratch
 * admin stays bootstrapped for OPERATOR duties only (provisioning +
 * perm-delete cleanup).
 */
const SCRATCH_PORT = e2ePorts.scratchCollectionsMobile;
const WEBDAV_BASE = webdavBase;
const CASE_ID = 'collections-mobile';
/** Scratch boot identity (ADMIN_DEFAULT_PASSWORD) — OPERATOR duties only (PLAN §14). */
const ADMIN_PASSWORD = 'CollectionsMobileE2e!123';
/** The provisioned regular user every case acts as. */
const USER_CREDS: ScratchUserCreds = {
  username: 'collections-mobile-e2e-user',
  password: 'CollectionsMobileE2eUser!123',
  email: 'collections-mobile-e2e-user@e2etest.com',
};

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// Collections created by the running case; afterEach purges them (case
// containment, desktop-spec parity).
const trackedCollections: string[] = [];

test.describe.configure({ mode: 'serial', timeout: 180_000 });

async function listCollections(request: APIRequestContext, token: string) {
  const res = await request.get('/api/collections?include=mine,shared,archived', {
    headers: auth(token),
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.collections as { collection_id: number; name: string; status: string }[];
}

async function createCollectionApi(
  request: APIRequestContext,
  token: string,
  name: string
): Promise<number> {
  trackedCollections.push(name);
  const res = await request.post('/api/collections', { headers: auth(token), data: { name } });
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

/** Members-world scaffold: one collection with exactly one seeded member file. */
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

let scratch: string;
let spawned: ReturnType<typeof spawnScratchServer> | null = null;
let operatorToken = '';

test.beforeAll(async ({ request }) => {
  scratch = scratchDirFor(CASE_ID);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  writeScratchEnv(scratch, {
    PORT: String(SCRATCH_PORT),
    WEA_FILE_STORAGE: 'webdav',
    WEBDAV_UPSTREAM_URL: WEBDAV_BASE,
    JWT_SECRET: 'collections-mobile-e2e-jwt-secret',
    ADMIN_DEFAULT_PASSWORD: ADMIN_PASSWORD,
  });
  await seedWebdavSettings(scratch);
  await ensureWebdavSubtree(CASE_ID);
  ensureClientBuild();
  spawned = spawnScratchServer(scratch, SCRATCH_PORT);
  await waitForScratchHealth(spawned, SCRATCH_PORT);
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
  // Case containment (desktop-spec parity): purge tracked collections with
  // the USER session token, then flush workspace folders (perm-delete needs
  // the OPERATOR token — admin-operator pivot, PLAN §14).
  const pending = trackedCollections.splice(0, trackedCollections.length);
  if (pending.length === 0) {
    await flushPrivateWorkspaceCleanups(request, operatorToken);
    return;
  }
  try {
    const token = await getSessionToken(page);
    for (const name of pending) {
      const rows = await listCollections(request, token);
      const row = rows.find((r) => r.name === name);
      if (!row) continue;
      if (row.status === 'active') {
        const archive = await request.post(`/api/collections/${row.collection_id}/archive`, {
          headers: auth(token),
        });
        expect(archive.ok()).toBeTruthy();
      }
      const del = await request.delete(`/api/collections/${row.collection_id}`, {
        headers: auth(token),
      });
      expect(del.status()).toBe(204);
    }
  } catch {
    // A failed setup leaves an incomplete world; afterAll's rm -rf removes
    // the whole scratch database anyway.
  }
  await flushPrivateWorkspaceCleanups(request, operatorToken);
});

test('E2E-COLLECTION-015: mobile TAP opens a collection card directly into the members view (no double-tap) and the Collections crumb chip returns to the list', async ({
  page,
  request,
}, testInfo) => {
  const { file, name, collectionId } = await setupCollectionWithMember(
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

test('E2E-COLLECTION-016: members surface on mobile keeps the GRID default, hides the detail toggle and forces LIST when the persisted member key is detail (mobile restriction, unchanged per useExplorerSession.md)', async ({
  page,
  request,
}, testInfo) => {
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

test('E2E-COLLECTION-017: file-side like via the mobile FileActionSheet flips optimistically and persists viewer-scoped (desktop 007 bottom-sheet parity)', async ({
  page,
  request,
}, testInfo) => {
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
