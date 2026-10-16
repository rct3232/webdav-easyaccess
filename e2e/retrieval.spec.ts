import fs from 'node:fs';

import { APIRequestContext, expect, Page, test, TestInfo } from '@playwright/test';

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
import {
  buildName,
  createFolderAt,
  fileItem,
  flushPrivateWorkspaceCleanups,
  readTestFileFixture,
  uploadFileAt,
  waitForBulkJobToComplete,
} from './helpers/files';
import { loginAndOpenUserWorkspace, seedFile } from './helpers/collectionsWorkspace';
import { getSessionToken, gotoFilesPath, resolveNodeId } from './helpers/resolvePath';
import { setSortMode } from './helpers/explorer-controls';
import { gotoAsAnonymous } from './helpers/auth';
import { createShareLink } from './helpers/shareLinks';
import { purgeTrashedItemByName } from './helpers/trash';
import { TEST_FILES } from './fixtures/test-data';

/**
 * E2E-RETRIEVAL-001..021 — server-wide name search rendered INSIDE the explorer
 * surfaces: accordion zones + the breadcrumb-replacing query-chip bar (the
 * search UI rework — the standalone results overlay is gone).
 *
 * Contract sources: docs/spec/server/routes/search.md (POST /api/search P0 name
 * branch — `name_matches[{node_id,name}]`, `semantic` ABSENT with
 * `semantic_available:false`; POST /search/click {node_id} → 204),
 * docs/spec/client/hooks/useSearchResults.md (mode machine browse/pending/results,
 * the committed `intersect-name` chain with per-step snapshots, live typing NEVER
 * hides rows — promotion + live color only, enrichment chunks ≤100, every exit
 * trigger routes through `exitResults`), docs/spec/client/components/
 * file-manager/FloatingSearchBar.md (no in-pill submit — Enter and the 56px
 * fab-slot ghost button; ✕ clears + blurs; share-link mode never mounts the
 * submit surface), docs/spec/client/components/file-manager/SearchQueryChipBar.md
 * (chips = committed chain terms oldest→newest; desktop hover-reveal / mobile
 * tap-reveal-then-tap-activate; the single chip is Exit; LibraryAdd targets the
 * FULL snapshot union), docs/spec/client/components/file-manager/FileManagerView.md
 * §3 (sticky zone headers, per-surface accordion persistence key
 * `wea.searchZonesCollapsed`, skeleton while pending, the no-results line when
 * every snapshot count is 0) and docs/spec/client/pages/FileManager.md §7
 * (selection union spans the zones, bulk read-only gating via the enriched
 * `hasWritePermission`, row-open browse parity: desktop double click / mobile
 * single tap opens).
 *
 * SCRATCH-HERMETIC per the destructive-case policy (docs/TESTING_STRATEGY.md):
 * own server on the `:5015` slot (own sqlite, webdav file backend), never the
 * shared :5002 pool. The serial file owns the server lifecycle; the
 * `retrieval-mobile` project depends on `retrieval-desktop` and re-boots its
 * own server on the same slot afterwards (pushHermetic shared-port rule,
 * exactly the admin-config/migration registration).
 *
 * IDENTITY (admin-operator pivot, PLAN §14): every case acts as a REGULAR USER
 * provisioned in `beforeAll`; the scratch admin stays OPERATOR-only
 * (provisioning + the perm-delete cleanup fallback). Case 016 seeds the
 * read-only server row through a SECOND regular user granting the actor `read`
 * on a folder of their own (the internal-share permission engine —
 * POST /api/permissions/grant, the share-internal precedent).
 *
 * DUAL PLATFORM (WP-E): ONE file runs under both projects with
 * `isMobileProject(testInfo)` seams — hover-reveal vs tap-reveal, permanent
 * sidebar vs drawer tree, double click vs single tap open, click-selection vs
 * long-press selection (the mobile-interactions long-press retry idiom keyed
 * by `[data-file-node-id]`, because Zone B rows carry an empty `data-file-path`).
 * Animation states are never asserted — final states only (FloatingSearchBar
 * §2.5).
 *
 * SCOPE NOTES:
 * - E2E-RETRIEVAL-016 gates the WRITE bulk actions: move/delete disable when a
 *   read-only row is selected (`bulkWritePermission` — FileManagerControls.md
 *   §2); copy stays available by that contract (it reads the source and writes
 *   into a destination the user picks, so it is not source-write-gated).
 * - E2E-RETRIEVAL-017: FloatingSearchBar §2.6 rows 4–5 ("results mode + empty
 *   input ⇒ Add overlay + no-op click") describe the controlled component; in
 *   the integrated shell clearing the text IS the exit signal (§2.7), so that
 *   transient combination is unit-covered (SearchActionButton.test.js). The
 *   E2E asserts the observable end of the same contract: empty-text submit
 *   (button click AND Enter) fires ZERO POST /api/search and mounts no surface.
 * - E2E-RETRIEVAL-011 uses the two-point getBoundingClientRect sample (header
 *   pinned while its rows are in view; header leaves the pinned position once
 *   its zone bottom passes the container top). FLAKY-RISK: if it proves
 *   unstable across reruns, demote to the single pinned-sample observable.
 */
const SCRATCH_PORT = e2ePorts.scratchRetrieval;
const WEBDAV_BASE = webdavBase;
const CASE_ID = 'retrieval';
/** Scratch boot identity (ADMIN_DEFAULT_PASSWORD) — OPERATOR duties only. */
const ADMIN_PASSWORD = 'RetrievalE2e!123';
/** The provisioned regular user every case acts as (home: `/retrieval-e2e-user`). */
const USER_CREDS: ScratchUserCreds = {
  username: 'retrieval-e2e-user',
  password: 'RetrievalE2eUser!123',
  email: 'retrieval-e2e-user@e2etest.com',
};
/** Second regular user — the read-only internal-share GRANTER (case 016 only). */
const OWNER_CREDS: ScratchUserCreds = {
  username: 'retrieval-e2e-owner',
  password: 'RetrievalE2eOwner!123',
  email: 'retrieval-e2e-owner@e2etest.com',
};

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const textFixtureBuffer = readTestFileFixture(TEST_FILES.smallText);

/** sessionStorage key owned by client/src/services/recentQueriesStorage.js. */
const RECENT_QUERIES_KEY = 'wea.recentSearchQueries';
/** localStorage key owned by client/src/utils/localStorage.js (zone accordion). */
const ZONES_COLLAPSED_KEY = 'wea.searchZonesCollapsed';

test.describe.configure({ mode: 'serial', timeout: 180_000 });

function isMobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name.endsWith('-mobile');
}

interface SearchPostRecord {
  url: string;
  body: { node_id?: number } | null;
}

/**
 * Response-listener based traffic tracker: collects POSTs whose URL path is
 * exactly `/api/search` (the server-submit channel — `/api/search/click` and
 * every other endpoint are separate paths and are tracked independently).
 */
function trackSearchPosts(page: Page): () => number {
  const posts: string[] = [];
  page.on('response', (res) => {
    const req = res.request();
    if (req.method() === 'POST' && new URL(res.url()).pathname === '/api/search') {
      posts.push(res.url());
    }
  });
  return () => posts.length;
}

/** Collects every POST to `/api/search/click` with its parsed body. */
function trackSearchClicks(page: Page): () => SearchPostRecord[] {
  const clicks: SearchPostRecord[] = [];
  page.on('response', (res) => {
    const req = res.request();
    if (req.method() === 'POST' && new URL(res.url()).pathname === '/api/search/click') {
      let body: { node_id?: number } | null = null;
      try {
        body = req.postDataJSON();
      } catch {
        body = null;
      }
      clicks.push({ url: res.url(), body });
    }
  });
  return () => clicks;
}

/** Collects every POST to `/api/collections` (the create-to-collection channel). */
function trackCollectionPosts(page: Page): () => number {
  const posts: string[] = [];
  page.on('response', (res) => {
    const req = res.request();
    if (req.method() === 'POST' && new URL(res.url()).pathname === '/api/collections') {
      posts.push(res.url());
    }
  });
  return () => posts.length;
}

/** Collects every POST to `/api/files/metadata` (the enrichment channel). */
function trackMetadataPosts(page: Page): () => number {
  const posts: string[] = [];
  page.on('response', (res) => {
    const req = res.request();
    if (req.method() === 'POST' && new URL(res.url()).pathname === '/api/files/metadata') {
      posts.push(res.url());
    }
  });
  return () => posts.length;
}

function searchBox(page: Page) {
  return page.getByRole('searchbox');
}

/** Enter-submit in the FloatingSearchBar and wait for the POST /api/search reply. */
async function submitSearch(page: Page, query: string): Promise<void> {
  const box = searchBox(page);
  await box.fill(query);
  const response = page.waitForResponse(
    (res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/search',
    { timeout: 15_000 }
  );
  await box.press('Enter');
  await response;
}

/** Seed one file directly under a parent node by explicit name; returns the id. */
async function seedNamedFile(
  request: APIRequestContext,
  token: string,
  parentNodeId: number,
  name: string
): Promise<number> {
  return uploadFileAt(request, token, parentNodeId, name, 'text/plain', textFixtureBuffer);
}

/** Create a sub/deep folder chain under the workspace; returns the leaf nodeId. */
async function seedNestedFolder(
  request: APIRequestContext,
  token: string,
  parentNodeId: number,
  names: string[]
): Promise<number> {
  let current = parentNodeId;
  for (const name of names) {
    current = await createFolderAt(request, token, current, name);
  }
  return current;
}

/** Canonical trash channel (DEF-16 P2): POST /api/files/batch-delete + job wait. */
async function apiTrashFile(
  request: APIRequestContext,
  token: string,
  nodeId: number
): Promise<void> {
  const res = await request.post('/api/files/batch-delete', {
    headers: auth(token),
    data: { nodeIds: [nodeId] },
  });
  expect(res.ok()).toBeTruthy();
  const { jobId } = await res.json();
  await waitForBulkJobToComplete(request, token, String(jobId));
}

/** API login of a scratch provisioned user — token + numeric id in one round. */
async function loginIdentity(
  request: APIRequestContext,
  creds: ScratchUserCreds
): Promise<{ token: string; userId: number }> {
  const res = await request.post('/api/auth/login', {
    data: { username: creds.username, password: creds.password },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { token: body.token as string, userId: body.user.id as number };
}

// ---------------------------------------------------------------------------
// Platform seams (dual-run idiom of mypage-admin / migration / mobile-interactions)
// ---------------------------------------------------------------------------

/** Explorer row of a node — `[data-file-node-id]` is present on every row. */
function rowNode(page: Page, nodeId: number) {
  return page.locator(`[data-file-node-id="${nodeId}"]`);
}

/** Zone B server row — `rowTestId = server-search-row-<id>` (list/grid/detail). */
function serverRow(page: Page, nodeId: number) {
  return page.getByTestId(`server-search-row-${nodeId}`);
}

function chipBar(page: Page) {
  return page.getByTestId('search-chip-bar');
}

function chips(page: Page) {
  return page.getByTestId('search-chip');
}

function zoneHeader(page: Page, zoneKey: 'a' | 'b' | 'c') {
  return page.getByTestId(`search-zone-header-${zoneKey}`);
}

/** The count `body2` Typography (`<p>`) — the label renders as `subtitle2` (`<h6>`). */
async function zoneHeaderCount(page: Page, zoneKey: 'a' | 'b' | 'c'): Promise<string> {
  return (await zoneHeader(page, zoneKey).locator('p').first().innerText()).trim();
}

/** Row open keeps browse parity: desktop double click, mobile single tap. */
async function openRow(page: Page, row: ReturnType<typeof rowNode>, isMobile: boolean) {
  if (isMobile) {
    await row.tap();
  } else {
    await row.dblclick();
  }
}

/** Clear the input focus without activating anything behind the bar. */
async function blurActive(page: Page) {
  await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el && typeof el.blur === 'function') el.blur();
  });
}

/**
 * Reveal a chip's action (hover on desktop, first tap on mobile) and activate
 * it (`search-chip-undo` for a chain step, `search-chip-exit` for the single
 * chip — SearchQueryChipBar.md §2).
 */
async function revealAndActivateChip(
  page: Page,
  index: number,
  kind: 'undo' | 'exit',
  isMobile: boolean
) {
  const chip = chips(page).nth(index);
  if (isMobile) {
    await chip.tap();
    await expect(page.getByTestId(`search-chip-${kind}`)).toBeVisible();
    await chip.tap();
  } else {
    await chip.hover();
    await expect(page.getByTestId(`search-chip-${kind}`)).toBeVisible();
    await page.getByTestId(`search-chip-${kind}`).click();
  }
}

/** ✕ clears the text AND blurs (the host exit signal in results mode). */
async function pressSearchClose(page: Page, isMobile: boolean) {
  const close = page.getByRole('button', { name: /Close search|검색 닫기/i });
  if (isMobile) {
    await close.tap();
  } else {
    await close.click();
  }
}

/**
 * Long-press a node row into selection mode (mobile), re-issuing the press
 * until the bulk toolbar appears — the `longPressItem` retry idiom of
 * helpers/mobile-interactions.ts, keyed by `[data-file-node-id]` because Zone B
 * rows carry an empty `data-file-path`.
 */
async function longPressNode(page: Page, nodeId: number) {
  const item = rowNode(page, nodeId);
  await expect(item).toBeVisible();
  await item.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const box = await item.boundingBox();
    if (!box) throw new Error(`no bounding box for node ${nodeId}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    try {
      await page.getByTestId('bulk-action-move').waitFor({ state: 'visible', timeout: 2500 });
      return;
    } catch {
      // Selection mode did not engage; re-issue the long-press.
    }
  }
  await expect(page.getByTestId('bulk-action-move')).toBeVisible();
}

/** Enter selection mode on a node row per platform (click vs long-press). */
async function selectNodeRow(page: Page, nodeId: number, isMobile: boolean) {
  if (isMobile) {
    await longPressNode(page, nodeId);
    return;
  }
  await rowNode(page, nodeId).click();
}

/** Toolbar select-all / deselect-all (the desktop Buttons have no testid). */
async function clickSelectAll(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByTestId('bulk-action-select-all').click();
  } else {
    await page.getByRole('button', { name: /^Select all$|^전체 선택$/i }).click();
  }
}

async function clickDeselectAll(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByTestId('bulk-action-deselect-all').click();
  } else {
    await page.getByRole('button', { name: /^Deselect all$|^선택 해제$/i }).click();
  }
}

/**
 * Navigate to Home through the folder tree: permanent sidebar (desktop) vs
 * the mobile drawer (already open — the chip bar replaces the breadcrumb
 * expand toggle mid-results, and the open drawer survives the transition).
 */
async function navigateHomeViaTree(page: Page) {
  await page
    .getByTestId('folder-tree-item')
    .filter({ hasText: /Home|홈/ })
    .first()
    .click();
}

/**
 * FAB morph opacity — the controlled-mount fade/scale lives on the SpeedDial
 * ROOT (`file-actions-speed-dial`, FAB.js getMorphVisibilitySx), the inner
 * button keeps its own opacity; 0 while the search button owns the slot.
 */
async function fabOpacity(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="file-actions-speed-dial"]');
    return el ? parseFloat(getComputedStyle(el).opacity) : Number.NaN;
  });
}

/** Node ids of every mounted explorer row, document order, inside the container. */
function containerRowNodeIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="explorer-container"]');
    if (!container) return [];
    return Array.from(container.querySelectorAll('[data-file-node-id]')).map((el) =>
      el.getAttribute('data-file-node-id')
    ) as string[];
  });
}

let scratch: string;
let spawned: ReturnType<typeof spawnScratchServer> | null = null;
/** Scratch admin bearer — OPERATOR duties only (provisioning + perm-delete flush). */
let operatorToken = '';

test.beforeAll(async ({ request }) => {
  scratch = scratchDirFor(CASE_ID);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  writeScratchEnv(scratch, {
    PORT: String(SCRATCH_PORT),
    WEA_FILE_STORAGE: 'webdav',
    WEBDAV_UPSTREAM_URL: WEBDAV_BASE,
    JWT_SECRET: 'retrieval-e2e-jwt-secret',
    ADMIN_DEFAULT_PASSWORD: ADMIN_PASSWORD,
  });
  await seedWebdavSettings(scratch);
  await ensureWebdavSubtree(CASE_ID);
  ensureClientBuild();
  spawned = spawnScratchServer(scratch, SCRATCH_PORT);
  await waitForScratchHealth(spawned, SCRATCH_PORT);
  operatorToken = await loginScratchAdmin(request, ADMIN_PASSWORD);
  await ensureScratchRegularUser(request, operatorToken, USER_CREDS);
  await ensureScratchRegularUser(request, operatorToken, OWNER_CREDS);
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

test.afterEach(async ({ request }) => {
  // Case containment: perm-delete the case workspace subtree (the physical
  // purge is admin-only, hence the OPERATOR fallback token — dual-token
  // cleanup, admin-operator pivot PLAN §14). A case that trashes an item purges
  // it from the trash itself (E2E-RETRIEVAL-007); case-created collections and
  // the owner-user share fixture are scratch-scoped and die with the instance.
  await flushPrivateWorkspaceCleanups(request, operatorToken);
});

test('E2E-RETRIEVAL-001: Two result zones and the chip bar render while the breadcrumb row stays suppressed', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const searchPosts = trackSearchPosts(page);

  // Seed pair: lowercase `alpha-…` in the CURRENT folder (Zone A + snapshot)
  // and a capital `Alpha-One-…` nested under sub/deep (Zone B after dedup).
  const alphaFile = await seedFile(request, token, base, testInfo, 'alpha');
  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  const deepId = await seedNestedFolder(request, token, parentNodeId, [
    buildName(testInfo, 'sub'),
    buildName(testInfo, 'deep'),
  ]);
  const alphaOneId = await seedNamedFile(request, token, deepId, `Alpha-One-${Date.now()}.txt`);
  const betaFile = await seedFile(request, token, base, testInfo, 'beta');
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, betaFile.path)).toBeVisible();

  // Typing NEVER hits the server (useSearchResults §2.5): keystrokes only arm
  // the bar; no results surface mounts before the submit.
  await searchBox(page).fill('al');
  await searchBox(page).pressSequentially('pha');
  await page.waitForTimeout(500);
  expect(searchPosts(), 'typing must never hit the server').toBe(0);
  await expect(chipBar(page)).toHaveCount(0);
  await expect(zoneHeader(page, 'a')).toHaveCount(0);

  // Enter submits exactly ONE POST /api/search and mounts the results surface:
  // the chip bar replaces the breadcrumb, zones A + B render, and the degraded
  // semantic zone never exists (`semantic` omitted ⇒ Zone C renders nothing).
  await searchBox(page).press('Enter');
  await expect(chipBar(page)).toBeVisible();
  await expect.poll(() => searchPosts(), 'Enter submits exactly one server query').toBe(1);
  await expect(page.getByTestId('breadcrumb')).toHaveCount(0);

  await expect(zoneHeader(page, 'a')).toBeVisible();
  await expect(zoneHeader(page, 'b')).toBeVisible();
  await expect(zoneHeader(page, 'c')).toHaveCount(0);
  // Snapshot counts: Zone A = the current-folder match, Zone B = the FULL name
  // set (the deduped row still counts — the header is always honest).
  await expect(zoneHeader(page, 'a')).toContainText(base.split('/').pop() as string);
  expect(await zoneHeaderCount(page, 'a')).toBe('1');
  expect(await zoneHeaderCount(page, 'b')).toBe('2');
  await expect(zoneHeader(page, 'b')).toContainText(/All results|전체 결과/);
  await expect(rowNode(page, alphaFile.nodeId)).toBeVisible();
  await expect(serverRow(page, alphaOneId)).toBeVisible();
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page)).toContainText('alpha');

  // The skeleton is the pending-only surface — gone once the response lands.
  await expect(page.getByTestId('search-zone-skeleton')).toHaveCount(0);

  // Exit via the single chip returns the browse surfaces.
  await revealAndActivateChip(page, 0, 'exit', isMobile);
  await expect(chipBar(page)).toHaveCount(0);
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
  await searchBox(page).fill('');
  await expect(fileItem(page, betaFile.path)).toBeVisible();
});

test('E2E-RETRIEVAL-002: Result rows highlight every committed-term fragment inside the rendered name', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);

  // The name carries the query fragment twice with different casing — the
  // committed highlight is case-insensitive all-occurrence (searchHighlight),
  // while the row text stays the FULL verbatim name.
  const fileName = `alpha-${Date.now()}-ALPHA.txt`;
  const nodeId = await seedNamedFile(
    request,
    token,
    await resolveNodeId(request, token, `/${base}`),
    fileName
  );
  await gotoFilesPath(page, request, `/${base}`);

  await submitSearch(page, 'alpha');
  const row = rowNode(page, nodeId);
  await expect(row).toBeVisible();
  await expect(row).toContainText(fileName);

  const highlights = row.getByTestId('search-highlight-range');
  await expect(highlights).toHaveCount(2);
  expect(await highlights.allTextContents()).toEqual(['alpha', 'ALPHA']);
  // Committed color only — no live-term marks exist without typed text.
  await expect(row.getByTestId('filter-highlight-range')).toHaveCount(0);

  await revealAndActivateChip(page, 0, 'exit', isMobileProject(testInfo));
});

test('E2E-RETRIEVAL-003: Opening a directory result row navigates, exits results mode, and records exactly one click', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const clicks = trackSearchClicks(page);

  // Nested DIRECTORY match under sub/deep (+ one file inside) — the row-open
  // dispatch (FileManager §7): a directory open records the click, navigates
  // and EXITS results. Desktop reaches it with the browse-parity double click,
  // mobile with a single tap.
  const uniq = String(Date.now());
  const subName = `sub-${uniq}`;
  const deepName = `deep-${uniq}`;
  const folderName = `alpha-inside-${uniq}`;
  const innerName = `alpha-note-${uniq}.txt`;
  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  const folderId = await seedNestedFolder(request, token, parentNodeId, [
    subName,
    deepName,
    folderName,
  ]);
  await seedNamedFile(request, token, folderId, innerName);
  await seedFile(request, token, base, testInfo, 'beta');
  await gotoFilesPath(page, request, `/${base}`);

  await submitSearch(page, 'alpha');
  await expect(serverRow(page, folderId)).toBeVisible();
  await expect(serverRow(page, folderId)).toContainText(folderName);

  await openRow(page, rowNode(page, folderId), isMobile);

  // §3.4 list-entry-click signal: exactly ONE POST /api/search/click for that
  // node_id (fire-and-forget, absorbed 204) — nothing recorded for other rows.
  await expect
    .poll(() => clicks().filter((c) => c.body?.node_id === folderId).length, { timeout: 10_000 })
    .toBe(1);
  expect(clicks().filter((c) => c.body?.node_id !== folderId)).toEqual([]);

  // The directory open EXITS results mode and navigates into the location.
  await expect(chipBar(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/files/node/${folderId}$`));
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
  await expect(
    fileItem(page, `/${base}/${subName}/${deepName}/${folderName}/${innerName}`)
  ).toBeVisible();
});

test('E2E-RETRIEVAL-004: Live typing hides no rows, promotes matches, and highlights them without a server call', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const searchPosts = trackSearchPosts(page);

  // Four current-folder matches (two carrying `deep`) + one nested `deep`
  // match → Zone A 4 rows, Zone B display 1 row (snapshot 5). Short seeded
  // names: the mobile name slot middle-truncates long strings and a truncated
  // live fragment would legitimately lose its highlight mark.
  const uniq = String(Date.now());
  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  const names = [
    `q4-${uniq}-a.txt`,
    `q4-${uniq}-b.txt`,
    `q4-${uniq}-deep1.txt`,
    `q4-${uniq}-deep2.txt`,
  ];
  const localIds: number[] = [];
  for (const name of names) {
    localIds.push(await seedNamedFile(request, token, parentNodeId, name));
  }
  const subId = await createFolderAt(request, token, parentNodeId, buildName(testInfo, 'sub'));
  const nestedId = await seedNamedFile(request, token, subId, `q4-${uniq}-deep9.txt`);
  await gotoFilesPath(page, request, `/${base}`);

  await submitSearch(page, 'q4');
  await expect(rowNode(page, localIds[0])).toBeVisible();
  await expect(serverRow(page, nestedId)).toBeVisible();
  const rowsBefore = await containerRowNodeIds(page);
  expect(rowsBefore.length).toBe(5);
  expect(searchPosts()).toBe(1);

  // Live typing NEVER hides (useSearchResults §2.3): the same five rows stay
  // mounted, matched rows promote to the top of their zone, live (yellow)
  // marks appear, the honest counts hold, and ZERO extra POSTs fire.
  await searchBox(page).fill('deep');
  await page.waitForTimeout(500);
  const rowsAfter = await containerRowNodeIds(page);
  expect(rowsAfter.length).toBe(5);
  expect(new Set(rowsAfter)).toEqual(new Set(rowsBefore));
  expect(searchPosts(), 'live typing never re-queries the server').toBe(1);
  expect(await zoneHeaderCount(page, 'a')).toBe('4');
  expect(await zoneHeaderCount(page, 'b')).toBe('5');

  await expect(page.getByTestId('filter-highlight-range')).toHaveCount(3);

  const zoneAOrder = await page.evaluate(() => {
    const container = document.querySelector('[data-testid="explorer-container"]');
    const zoneA = container?.querySelector('[data-testid="search-zone-header-a"]')?.parentElement;
    return Array.from(zoneA?.querySelectorAll('[data-file-path]') ?? []).map(
      (el) => el.getAttribute('data-file-path')?.split('/').pop() ?? ''
    );
  });
  expect(zoneAOrder).toEqual([
    `q4-${uniq}-deep1.txt`,
    `q4-${uniq}-deep2.txt`,
    `q4-${uniq}-a.txt`,
    `q4-${uniq}-b.txt`,
  ]);

  // Clearing the text is the host exit signal (FloatingSearchBar §2.7):
  // results mode leaves and the full browse listing returns with no filter.
  await searchBox(page).fill('');
  await expect(chipBar(page)).toHaveCount(0);
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
  expect(searchPosts()).toBe(1);
  await expect(fileItem(page, `/${base}/${names[0]}`)).toBeVisible();
});

test('E2E-RETRIEVAL-005: Recent queries persist in sessionStorage across searches and honor the cap and logout clear', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);

  await seedFile(request, token, base, testInfo, 'beta');
  await gotoFilesPath(page, request, `/${base}`);

  // Nine chained submits (all zero-match is fine — the recents record the
  // QUERY, not the result). The chip strip mirrors the COMMITTED CHAIN (nine
  // chips), independent of the recents list, which caps at 8 (newest first).
  for (let i = 1; i <= 9; i += 1) {
    await submitSearch(page, `ret${String(i).padStart(2, '0')}`);
  }
  await expect(chips(page)).toHaveCount(9);
  await expect(chips(page).first()).toContainText('ret01');

  const stored = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    RECENT_QUERIES_KEY
  );
  expect(stored).toBeTruthy();
  const recents = JSON.parse(stored as string) as { query: string }[];
  expect(recents.length).toBe(8);
  expect(recents.map((chip) => chip.query)).toEqual([
    'ret09',
    'ret08',
    'ret07',
    'ret06',
    'ret05',
    'ret04',
    'ret03',
    'ret02',
  ]);

  // A NEW search resets the chain (one chip — the previous chain is gone)
  // while the recents list survives as the sessionStorage mirror.
  await pressSearchClose(page, isMobile);
  await expect(chipBar(page)).toHaveCount(0);
  await submitSearch(page, 'ret09');
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page)).toContainText('ret09');

  const stored2 = (await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    RECENT_QUERIES_KEY
  )) as string;
  expect((JSON.parse(stored2) as { query: string }[]).map((chip) => chip.query)[0]).toBe('ret09');

  // Logout clears the chip store (useAuthSession.logout → clearRecentQueries).
  await page.goto('/mypage');
  await page.getByRole('button', { name: /log out/i }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  const afterLogout = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    RECENT_QUERIES_KEY
  );
  expect(afterLogout).toBeNull();
});

test('E2E-RETRIEVAL-006: An unmatched query renders the honest no-results line without zone headers', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);

  const betaFile = await seedFile(request, token, base, testInfo, 'beta');
  await gotoFilesPath(page, request, `/${base}`);

  // A unique token no node carries — the server still answers 200 with a
  // zero-name payload, so EVERY zone count is 0: no zone headers render at
  // all, just the single no-results line inside the mounted results surface.
  await submitSearch(page, `pluvio-${Date.now()}`);
  await expect(chipBar(page)).toBeVisible();
  await expect(zoneHeader(page, 'a')).toHaveCount(0);
  await expect(zoneHeader(page, 'b')).toHaveCount(0);
  await expect(zoneHeader(page, 'c')).toHaveCount(0);
  await expect(page.getByTestId('search-zone-skeleton')).toHaveCount(0);
  await expect(page.getByTestId('search-no-results')).toHaveText(/No results|결과가 없습니다/i);
  await expect(page.locator('[data-testid="explorer-container"] [data-file-node-id]')).toHaveCount(
    0
  );

  // ✕ exits results mode and restores the listing.
  await pressSearchClose(page, isMobile);
  await expect(chipBar(page)).toHaveCount(0);
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
  await searchBox(page).fill('');
  await expect(fileItem(page, betaFile.path)).toBeVisible();
});

test('E2E-RETRIEVAL-007: Trashed files never surface in search results', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);

  // Unique-name file (searchNodesByName hides `deleted_at` rows; the suite
  // never restores, only purges — restore-free assertion per the plan).
  const file = await seedFile(request, token, base, testInfo, 'quarz');
  const fileName = file.path.split('/').pop() as string;
  await gotoFilesPath(page, request, `/${base}`);

  await submitSearch(page, 'quarz');
  await expect(rowNode(page, file.nodeId)).toBeVisible();

  // Canonical trash channel: batch-delete trashes the subtree (DEF-16 P2).
  await apiTrashFile(request, token, file.nodeId);

  // Reload the folder (the session listing re-reads WITHOUT the trashed node),
  // then re-submit: zero zone counts ⇒ no zone headers, no-results line only.
  await gotoFilesPath(page, request, `/${base}`);
  await submitSearch(page, 'quarz');
  await expect(zoneHeader(page, 'a')).toHaveCount(0);
  await expect(zoneHeader(page, 'b')).toHaveCount(0);
  await expect(page.getByTestId('search-no-results')).toBeVisible();
  await expect(rowNode(page, file.nodeId)).toHaveCount(0);

  await pressSearchClose(page, isMobile);
  // Containment parity: purge the trashed file (no restore in the suite).
  await purgeTrashedItemByName(request, token, fileName);
});

test('E2E-RETRIEVAL-008: The FAB spot morphs to the ghost search button on focus and restores on blur-empty and close', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  await gotoFilesPath(page, request, `/${base}`);

  const button = page.getByTestId('search-action-button');
  // Browse + no text: the FAB owns the slot, the ghost button does not exist.
  await expect(button).toHaveCount(0);
  await expect.poll(() => fabOpacity(page), 'FAB is solid in browse mode').toBe(1);

  // Focus arms the morph (FINAL states only — the fade/scale animation itself
  // is never asserted): the button mounts in the FAB spot, the FAB collapses,
  // the pill start-icon shrinks away.
  await searchBox(page).click();
  await expect(button).toBeVisible();
  await expect
    .poll(() => fabOpacity(page), 'FAB collapses while the button owns the slot')
    .toBeLessThan(0.01);
  await expect
    .poll(() =>
      page
        .getByTestId('search-start-icon')
        .evaluate((el) => parseFloat(getComputedStyle(el).opacity))
    )
    .toBeLessThan(0.01);

  // Blur with empty text in browse mode reverses the morph: the button
  // unmounts after its exit animation, the FAB returns.
  await blurActive(page);
  await expect(button).toHaveCount(0);
  await expect.poll(() => fabOpacity(page)).toBe(1);

  // Text expands again; ✕ clears AND blurs → full browse visuals restored.
  await searchBox(page).click();
  await searchBox(page).fill('morph');
  await expect(button).toBeVisible();
  await pressSearchClose(page, isMobile);
  await expect(button).toHaveCount(0);
  await expect.poll(() => fabOpacity(page)).toBe(1);
  await expect(searchBox(page)).toHaveValue('');
});

test('E2E-RETRIEVAL-009: Zone headers carry the folder path and All-results label with snapshot counts, and no node renders in two zones', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const metadataPosts = trackMetadataPosts(page);

  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  const localId = await seedNamedFile(request, token, parentNodeId, `mirr-${Date.now()}-a.txt`);
  const subId = await createFolderAt(request, token, parentNodeId, buildName(testInfo, 'sub'));
  const nestedId = await seedNamedFile(request, token, subId, `mirr-${Date.now()}-b.txt`);
  await gotoFilesPath(page, request, `/${base}`);

  await submitSearch(page, 'mirr');

  // Header labels: Zone A = the current folder path + its snapshot count;
  // Zone B = the All-results label + the FULL name-set count (dedup keeps the
  // snapshot honest: 2, while only the nested row displays).
  await expect(zoneHeader(page, 'a')).toContainText(base.split('/').pop() as string);
  expect(await zoneHeaderCount(page, 'a')).toBe('1');
  await expect(zoneHeader(page, 'b')).toContainText(/All results|전체 결과/);
  expect(await zoneHeaderCount(page, 'b')).toBe('2');

  // Dedup: the same node id never appears in both zones — every row exactly
  // once across the whole container, in zone order.
  const rowIds = await containerRowNodeIds(page);
  expect(rowIds.length).toBe(new Set(rowIds).size);
  expect(rowIds).toEqual([String(localId), String(nestedId)]);

  // Enrichment: the server row renders after POST /api/files/metadata merges
  // the chunk — the size caption appears (suppressed while unenriched).
  await expect
    .poll(() => metadataPosts(), 'rows enrich through the metadata seam')
    .toBeGreaterThan(0);
  await expect(serverRow(page, nestedId)).toContainText(/\d+(\.\d+)? (B|KB|MB|GB)/);

  await revealAndActivateChip(page, 0, 'exit', isMobile);
});

test('E2E-RETRIEVAL-010: Zone collapse state persists across folder navigation and reload under the per-surface key', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);

  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  await seedNamedFile(request, token, parentNodeId, `collapx-${Date.now()}-a.txt`);
  const subId = await createFolderAt(request, token, parentNodeId, buildName(testInfo, 'sub'));
  const nestedId = await seedNamedFile(request, token, subId, `collapx-${Date.now()}-b.txt`);
  await gotoFilesPath(page, request, `/${base}`);

  await submitSearch(page, 'collapx');
  await expect(serverRow(page, nestedId)).toBeVisible();

  // Collapse Zone B via its toggle (Collapse final state: the rows unmount,
  // the header stays with its honest count) — persisted under the dedicated
  // localStorage key.
  await page.getByTestId('search-zone-toggle-b').click();
  await expect(zoneHeader(page, 'b')).toBeVisible();
  await expect(serverRow(page, nestedId)).toHaveCount(0);
  await expect
    .poll(() => page.evaluate((key) => window.localStorage.getItem(key), ZONES_COLLAPSED_KEY))
    .toContain('"b":true');

  // Exit, folder-navigate through the tree (mobile: reopen the drawer first —
  // the toggle itself is replaced mid-results), then re-enter the same search:
  // the collapsed accordion comes back from localStorage.
  await pressSearchClose(page, isMobile);
  if (isMobile) {
    await page.getByTestId('breadcrumb-folder-tree-toggle').click();
  }
  await navigateHomeViaTree(page);
  await expect(page.getByTestId('breadcrumb')).toBeVisible();

  await gotoFilesPath(page, request, `/${base}`);
  await submitSearch(page, 'collapx');
  await expect(zoneHeader(page, 'b')).toBeVisible();
  await expect(serverRow(page, nestedId)).toHaveCount(0);

  // The key survives a reload of the scratch session too.
  await page.reload();
  await gotoFilesPath(page, request, `/${base}`);
  await submitSearch(page, 'collapx');
  await expect(zoneHeader(page, 'b')).toBeVisible();
  await expect(serverRow(page, nestedId)).toHaveCount(0);

  // Re-expand restores the rows and clears the persisted flag.
  await page.getByTestId('search-zone-toggle-b').click();
  await expect(serverRow(page, nestedId)).toBeVisible();
  const stored = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    ZONES_COLLAPSED_KEY
  );
  expect(JSON.parse(stored as string)).not.toHaveProperty('b', true);

  await revealAndActivateChip(page, 0, 'exit', isMobile);
});

test('E2E-RETRIEVAL-011: The zone header stays pinned at the scroll top while rows scroll under it', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);

  // Seed enough Zone A rows that Zone A alone overflows the viewport, plus a
  // Zone B tail that keeps the push-up sample reachable at max scroll.
  const uniq = String(Date.now());
  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  for (let i = 0; i < 20; i += 1) {
    await seedNamedFile(
      request,
      token,
      parentNodeId,
      `stickq-${uniq}-${String(i).padStart(2, '0')}.txt`
    );
  }
  const subId = await createFolderAt(request, token, parentNodeId, buildName(testInfo, 'sub'));
  for (let i = 0; i < 15; i += 1) {
    await seedNamedFile(
      request,
      token,
      subId,
      `stickq-z-${uniq}-${String(i).padStart(2, '0')}.txt`
    );
  }
  await gotoFilesPath(page, request, `/${base}`);

  await submitSearch(page, 'stickq');
  await expect(zoneHeader(page, 'a')).toBeVisible();
  await expect(zoneHeader(page, 'b')).toBeVisible();

  // Two-point bounding-rect sample inside the single scroll container (no CSS
  // style/animation assertions): while Zone A rows are still in view the
  // header is pinned at the container top; once the Zone A bottom passes, the
  // header moves UP with its zone (push-up stacking) and Zone B pins.
  const samples = await page.evaluate(() => {
    const container = document.querySelector(
      '[data-testid="explorer-container"]'
    ) as HTMLElement | null;
    const headerA = document.querySelector(
      '[data-testid="search-zone-header-a"]'
    ) as HTMLElement | null;
    const headerB = document.querySelector(
      '[data-testid="search-zone-header-b"]'
    ) as HTMLElement | null;
    if (!container || !headerA || !headerB) return null;
    const zoneA = headerA.parentElement as HTMLElement;
    // Sticky `top: 0` pins at the scroll container's CONTENT edge — the
    // container carries padding, so that is the pin reference line.
    const refTop =
      container.getBoundingClientRect().top + parseFloat(getComputedStyle(container).paddingTop);

    container.scrollTop = 200;
    const pinnedDelta = headerA.getBoundingClientRect().top - refTop;

    const maxScroll = container.scrollHeight - container.clientHeight;
    container.scrollTop = Math.min(zoneA.offsetHeight + 100, maxScroll);
    const pushedA = headerA.getBoundingClientRect().top - refTop;
    const pinnedB = headerB.getBoundingClientRect().top - refTop;

    return { pinnedDelta, pushedA, pinnedB, scrolled: container.scrollTop };
  });

  expect(samples, 'sticky sample elements mounted').not.toBeNull();
  expect(samples!.scrolled, 'the scroll actually moved').toBeGreaterThan(50);
  expect(
    Math.abs(samples!.pinnedDelta),
    'header A pinned at the container top while its rows are in view'
  ).toBeLessThanOrEqual(2);
  expect(
    samples!.pushedA,
    'header A leaves the pinned position once its zone bottom passes'
  ).toBeLessThan(-20);
  expect(
    Math.abs(samples!.pinnedB),
    'header B pinned after the stack hand-over'
  ).toBeLessThanOrEqual(2);

  await revealAndActivateChip(page, 0, 'exit', isMobile);
});

test('E2E-RETRIEVAL-012: A two-step chained refine intersects results and chip undo restores the earlier snapshot with zero extra calls', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const searchPosts = trackSearchPosts(page);

  const uniq = String(Date.now());
  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  const oneId = await seedNamedFile(request, token, parentNodeId, `alpha-${uniq}-one.txt`);
  const twoId = await seedNamedFile(request, token, parentNodeId, `alpha-${uniq}-two.txt`);
  const subId = await createFolderAt(request, token, parentNodeId, buildName(testInfo, 'sub'));
  const nestedId = await seedNamedFile(request, token, subId, `alpha-two-${uniq}-deep.txt`);
  await gotoFilesPath(page, request, `/${base}`);

  // Step 1: `alpha` — Zone A = both local rows, Zone B snapshot = 3 (2 deduped).
  await submitSearch(page, 'alpha');
  expect(await zoneHeaderCount(page, 'a')).toBe('2');
  expect(await zoneHeaderCount(page, 'b')).toBe('3');
  expect(searchPosts()).toBe(1);

  // Step 2 types `two` and submits: the intersect-name refiner narrows Zone B
  // to the ids also matching `two` (2), Zone A recomputes over BOTH committed
  // terms (1), and the chip strip grows to the committed chain [alpha, two].
  await submitSearch(page, 'two');
  await expect.poll(() => searchPosts()).toBe(2);
  expect(await zoneHeaderCount(page, 'a')).toBe('1');
  expect(await zoneHeaderCount(page, 'b')).toBe('2');
  await expect(chips(page)).toHaveCount(2);
  await expect(chips(page).first()).toContainText('alpha');
  await expect(chips(page).nth(1)).toContainText('two');
  await expect(rowNode(page, oneId)).toHaveCount(0);
  await expect(rowNode(page, twoId)).toBeVisible();
  await expect(serverRow(page, nestedId)).toBeVisible();

  // Chip 1 (`alpha`) Undo restores the step-1 snapshot PURELY client-side:
  // counts and rows come back, chip 2 is discarded, ZERO extra POSTs.
  await revealAndActivateChip(page, 0, 'undo', isMobile);
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page)).toContainText('alpha');
  expect(await zoneHeaderCount(page, 'a')).toBe('2');
  expect(await zoneHeaderCount(page, 'b')).toBe('3');
  await expect(rowNode(page, oneId)).toBeVisible();
  await page.waitForTimeout(500);
  expect(searchPosts(), 'undo never re-queries the server').toBe(2);

  await searchBox(page).fill('');
});

test('E2E-RETRIEVAL-013: The single chip reveals Exit and leaving results mode restores the breadcrumb and FAB', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);

  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  const bravoName = `bravo-${Date.now()}.txt`;
  await seedNamedFile(request, token, parentNodeId, bravoName);
  const distName = `dist-${Date.now()}.txt`;
  await seedNamedFile(request, token, parentNodeId, distName);
  await gotoFilesPath(page, request, `/${base}`);

  await submitSearch(page, 'bravo');
  await expect(chips(page)).toHaveCount(1);

  // The single chip reveals `Exit` + close icon (hover on desktop, tap-to-reveal
  // on mobile); activating it exits results mode entirely.
  await revealAndActivateChip(page, 0, 'exit', isMobile);

  await expect(chipBar(page)).toHaveCount(0);
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
  await expect(page.getByTestId('file-manager-sort')).toBeVisible();
  // The live text is KEPT and re-applies as the browse hiding filter.
  await expect(searchBox(page)).toHaveValue('bravo');
  await expect(fileItem(page, `/${base}/${bravoName}`)).toBeVisible();
  await expect(fileItem(page, `/${base}/${distName}`)).toHaveCount(0);

  // Clearing the filter collapses the bar back to the browse visuals (fill
  // re-focuses, so the blur is the collapse trigger): the ghost button
  // unmounts and the FAB owns its slot again.
  await searchBox(page).fill('');
  await blurActive(page);
  await expect(page.getByTestId('search-action-button')).toHaveCount(0);
  await expect.poll(() => fabOpacity(page), 'FAB owns the slot again').toBe(1);
});

test('E2E-RETRIEVAL-014: The library-add button adds the FULL snapshot to an existing collection', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const collectionPosts = trackCollectionPosts(page);

  // Create a plain collection ahead of time (API), then search so the snapshot
  // spans Zone A (current-folder) and Zone B (nested) rows.
  const createRes = await request.post('/api/collections', {
    headers: auth(token),
    data: { name: `Retrieval Library ${Date.now()}` },
  });
  expect(createRes.ok()).toBeTruthy();
  const collectionId = (await createRes.json()).collection.collection_id as number;

  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  const localId = await seedNamedFile(request, token, parentNodeId, `kolex-${Date.now()}-a.txt`);
  const subId = await createFolderAt(request, token, parentNodeId, buildName(testInfo, 'sub'));
  const nestedId = await seedNamedFile(request, token, subId, `kolex-${Date.now()}-b.txt`);
  await gotoFilesPath(page, request, `/${base}`);

  await submitSearch(page, 'kolex');
  await expect(rowNode(page, localId)).toBeVisible();
  await expect(serverRow(page, nestedId)).toBeVisible();

  // A live term that matches NOTHING proves target independence: typing never
  // hides rows, and the LibraryAdd target is the FULL snapshot union.
  await searchBox(page).fill('kolex-nothing');
  await page.waitForTimeout(300);

  await page.getByTestId('search-library-add').click();
  const option = page.getByTestId(`collection-option-${collectionId}`);
  await expect(option).toBeVisible();
  // Set-target mode: the seed row is absent (AddToCollectionMenu.md §2.2).
  await expect(page.getByTestId('seed-create-row')).toHaveCount(0);
  await option.click();

  // Ground truth through the API: exactly the snapshot union A ∪ B (deduped),
  // independent of the live filter text; no NEW collection was created.
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/collections/${collectionId}/items`, {
          headers: auth(token),
        });
        const body = await res.json();
        return ((body.items as { node_id: number }[]) ?? [])
          .map((item) => item.node_id)
          .sort((x, y) => x - y) as number[];
      },
      { timeout: 15_000 }
    )
    .toEqual([localId, nestedId].sort((x, y) => x - y));
  expect(collectionPosts(), 'no new collection is created by the library add').toBe(0);

  await revealAndActivateChip(page, 0, 'exit', isMobile);
});

test('E2E-RETRIEVAL-015: Opening a file result row previews with the zones still mounted and records the click', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const clicks = trackSearchClicks(page);

  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  const openName = `openme-${Date.now()}.txt`;
  const openId = await seedNamedFile(request, token, parentNodeId, openName);
  await gotoFilesPath(page, request, `/${base}`);

  await submitSearch(page, 'openme');
  await expect(rowNode(page, openId)).toBeVisible();

  await openRow(page, rowNode(page, openId), isMobile);

  // FILE row: the preview dialog opens OVER the still-mounted results surface
  // (chip bar + zone header stay), and exactly one /search/click lands.
  await expect(page.getByTestId('file-preview-dialog')).toBeVisible();
  await expect(chipBar(page)).toBeVisible();
  await expect(zoneHeader(page, 'a')).toBeVisible();
  await expect
    .poll(() => clicks().filter((c) => c.body?.node_id === openId).length, { timeout: 10_000 })
    .toBe(1);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('file-preview-dialog')).toHaveCount(0);

  await revealAndActivateChip(page, 0, 'exit', isMobile);
});

test('E2E-RETRIEVAL-016: A read-only server row badges EditOff and disables the write bulk actions when selected', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);

  // Seed the read-only row through an internal share grant: a SECOND regular
  // user creates a folder in their own home and grants the actor `read`
  // (permission-engine parity with the share-internal suite).
  const owner = await loginIdentity(request, OWNER_CREDS);
  const actor = await loginIdentity(request, USER_CREDS);
  const ownerHomeId = await resolveNodeId(request, owner.token, `/${OWNER_CREDS.username}`);
  const shareFolderId = await createFolderAt(
    request,
    owner.token,
    ownerHomeId,
    buildName(testInfo, 'ro-share')
  );
  const roNodeId = await seedNamedFile(
    request,
    owner.token,
    shareFolderId,
    `kwarx-${Date.now()}.txt`
  );
  const grantRes = await request.post('/api/permissions/grant', {
    headers: auth(owner.token),
    data: { userId: actor.userId, nodeId: shareFolderId, permission: 'read' },
  });
  expect(grantRes.ok()).toBeTruthy();

  await gotoFilesPath(page, request, `/${base}`);
  await submitSearch(page, 'kwarx');
  await expect(serverRow(page, roNodeId)).toBeVisible();

  // The EditOff badge rides the metadata permission flags — assert it in both
  // the list corner and the grid thumbnail placements.
  await expect(page.getByTestId(`search-readonly-badge-${roNodeId}`)).toBeVisible();
  await page.getByTestId('view-mode-grid').click();
  await expect(page.getByTestId(`search-readonly-badge-${roNodeId}`)).toBeVisible();
  await page.getByTestId('view-mode-list').click();

  // Select the read-only row (desktop click / mobile long-press): the write
  // bulk actions gate out via the hasReadOnlyInSelection path of the existing
  // bulk gate (FileManager.md §7; copy reads the source and is not
  // source-write-gated — FileManagerControls.md §2).
  await selectNodeRow(page, roNodeId, isMobile);
  await expect(page.getByTestId('bulk-action-move')).toBeDisabled();
  await expect(page.getByTestId('bulk-action-delete')).toBeDisabled();
  await expect(page.getByText(/read-only|읽기 전용/i)).toBeVisible();

  await clickDeselectAll(page, isMobile);
  await expect(page.getByTestId('bulk-action-move')).toBeHidden();
});

test('E2E-RETRIEVAL-017: The search submit with empty input does nothing', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const searchPosts = trackSearchPosts(page);
  await gotoFilesPath(page, request, `/${base}`);

  // Empty-text submit is a no-op at every channel: the ghost button keeps its
  // enabled state, clicking it fires nothing, Enter fires nothing, and no
  // results surface ever mounts (see the 017 scope note in the file header
  // for why the transient "results + empty text" glyph state is unit-scoped).
  await (isMobile ? searchBox(page).tap() : searchBox(page).click());
  const button = page.getByTestId('search-action-button');
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await (isMobile ? button.tap() : button.click());
  await page.waitForTimeout(500);
  expect(searchPosts(), 'empty-text button submit never POSTs').toBe(0);
  await expect(chipBar(page)).toHaveCount(0);
  await expect(zoneHeader(page, 'a')).toHaveCount(0);

  await searchBox(page).press('Enter');
  await page.waitForTimeout(500);
  expect(searchPosts(), 'empty-text Enter never POSTs').toBe(0);
  await expect(chipBar(page)).toHaveCount(0);

  await blurActive(page);
  await expect(button).toHaveCount(0);
});

test('E2E-RETRIEVAL-018: Sidebar folder navigation exits results mode and keeps the recent list', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);

  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  await seedNamedFile(request, token, parentNodeId, `navx-${Date.now()}.txt`);
  await gotoFilesPath(page, request, `/${base}`);

  // Mobile: open the drawer tree BEFORE entering results mode (the chip bar
  // replaces the breadcrumb expand toggle mid-results; the open drawer itself
  // survives the transition).
  if (isMobile) {
    await page.getByTestId('breadcrumb-folder-tree-toggle').click();
  }

  await submitSearch(page, 'navx');
  await expect(chipBar(page)).toBeVisible();
  await expect(zoneHeader(page, 'a')).toBeVisible();

  // Folder navigation while results mode is active EXITS it (shell §7
  // exit-on-navigation): the zones unmount, the breadcrumb returns, the kept
  // text re-applies as the browse filter, and the sessionStorage recents
  // survive the transition.
  await navigateHomeViaTree(page);
  await expect(chipBar(page)).toHaveCount(0);
  await expect(zoneHeader(page, 'a')).toHaveCount(0);
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
  await expect(searchBox(page)).toHaveValue('navx');
  const stored = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    RECENT_QUERIES_KEY
  );
  expect(stored).toBeTruthy();
  expect((JSON.parse(stored as string) as { query: string }[])[0].query).toBe('navx');

  await searchBox(page).fill('');
});

test('E2E-RETRIEVAL-019: An anonymous share-link session cannot submit a server search', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const searchPosts = trackSearchPosts(page);

  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  const fileName = `sharex-${Date.now()}.txt`;
  await seedNamedFile(request, token, parentNodeId, fileName);
  const link = await createShareLink(request, {
    bearerToken: token,
    filePath: `/${base}/${fileName}`,
  });

  // Anonymous share browsing: the server-wide submit surface is an
  // authenticated-explorer feature (FloatingSearchBar §2.7) — the bar never
  // mounts for an anonymous visitor, so Enter/button cannot POST /api/search.
  // The shared gotoAsAnonymous helper performs the race-free context-level
  // session reset (see e2e/helpers/auth.ts).
  await gotoAsAnonymous(page, `/share/${link.token}`);
  await expect(searchBox(page)).toHaveCount(0);
  await expect(page.getByTestId('search-action-button')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  expect(searchPosts(), 'anonymous share visitors fire zero server searches').toBe(0);
});

test('E2E-RETRIEVAL-020: View-mode and sort toggles affect both zones and select-all spans zones', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);

  const uniq = String(Date.now());
  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  const a1 = await seedNamedFile(request, token, parentNodeId, `viewx-${uniq}-a.txt`);
  const a2 = await seedNamedFile(request, token, parentNodeId, `viewx-${uniq}-b.txt`);
  const subId = await createFolderAt(request, token, parentNodeId, buildName(testInfo, 'sub'));
  const b1 = await seedNamedFile(request, token, subId, `viewx-${uniq}-c.txt`);
  const b2 = await seedNamedFile(request, token, subId, `viewx-${uniq}-d.txt`);
  await gotoFilesPath(page, request, `/${base}`);

  await submitSearch(page, 'viewx');
  await expect(rowNode(page, a1)).toBeVisible();
  await expect(serverRow(page, b1)).toBeVisible();

  // The session viewMode applies to BOTH zones (same renderer family): the
  // grid re-renders the Zone A tiles AND the Zone B rows (the rowTestId
  // survives); the detail mode additionally exists on desktop only
  // (FileManagerControls.md — no detail button on mobile).
  await page.getByTestId('view-mode-grid').click();
  await expect(page.getByTestId(`server-search-row-${b1}`)).toBeVisible();
  expect((await containerRowNodeIds(page)).length).toBe(4);
  if (!isMobile) {
    await page.getByTestId('view-mode-detail').click();
    await expect(page.getByTestId(`server-search-row-${b2}`)).toBeVisible();
    expect((await containerRowNodeIds(page)).length).toBe(4);
  }
  await page.getByTestId('view-mode-list').click();

  // Sort flips the order inside BOTH zones (name_asc → name_desc).
  const zoneBAsc = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="server-search-row-"]')).map((el) =>
      el.getAttribute('data-file-node-id')
    )
  );
  await setSortMode(page, 'name-desc');
  const zoneBDesc = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="server-search-row-"]')).map((el) =>
      el.getAttribute('data-file-node-id')
    )
  );
  expect(zoneBDesc).toEqual([...zoneBAsc].reverse());

  const zoneADesc = await page.evaluate(() => {
    const container = document.querySelector('[data-testid="explorer-container"]');
    const zoneA = container?.querySelector('[data-testid="search-zone-header-a"]')?.parentElement;
    return Array.from(zoneA?.querySelectorAll('[data-file-node-id]') ?? []).map((el) =>
      el.getAttribute('data-file-node-id')
    );
  });
  expect(zoneADesc).toEqual([String(a2), String(a1)]);

  // Select-all spans the zones: the union selection marks the Zone A ++ Zone B
  // displayed rows (4 marked across both headers).
  await selectNodeRow(page, a2, isMobile);
  await clickSelectAll(page, isMobile);
  const selectedCount = await page.evaluate(
    () =>
      Array.from(
        document.querySelectorAll('[data-testid="explorer-container"] [aria-selected="true"]')
      ).length
  );
  expect(selectedCount).toBe(4);

  await clickDeselectAll(page, isMobile);
  await revealAndActivateChip(page, 0, 'exit', isMobile);
});

test('E2E-RETRIEVAL-021: Browse-mode filtering keeps hiding non-matches and adds the live fragment highlight', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);

  // No results session (EXP-011 path mirror): typing without submitting keeps
  // the browse HIDING filter and adds the yellow live-term mark to the
  // matched fragment inside each rendered name.
  const uniq = String(Date.now());
  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  for (const suffix of ['a', 'b', 'c']) {
    await seedNamedFile(request, token, parentNodeId, `quilt-${uniq}-${suffix}.txt`);
  }
  for (const suffix of ['x', 'y']) {
    await seedNamedFile(request, token, parentNodeId, `zinep-${uniq}-${suffix}.txt`);
  }
  await gotoFilesPath(page, request, `/${base}`);

  await searchBox(page).fill('quilt');
  await page.waitForTimeout(400);
  const visible = page.locator('[data-testid="explorer-container"] [data-file-path]');
  await expect(visible).toHaveCount(3);
  await expect(visible.filter({ hasNotText: /zinep/ })).toHaveCount(3);

  const liveMarks = page.getByTestId('filter-highlight-range');
  await expect(liveMarks).toHaveCount(3);
  expect(new Set(await liveMarks.allTextContents())).toEqual(new Set(['quilt']));
  // Nothing committed exists outside a results session.
  await expect(page.getByTestId('search-highlight-range')).toHaveCount(0);
  await expect(chipBar(page)).toHaveCount(0);

  await searchBox(page).fill('');
  await expect(visible).toHaveCount(5);
});
