import fs from 'node:fs';

import { APIRequestContext, expect, Page, test, TestInfo } from '@playwright/test';

import {
  ensureClientBuild,
  killScratch,
  prepareScratchS3,
  s3ScratchEnv,
  scratchDirFor,
  scratchRuntimeEnv,
  spawnScratchServer,
  waitForScratchHealth,
  writeScratchEnv,
} from './helpers/setupScratch';
import { e2ePorts } from './helpers/ports';
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
import { purgeTrashedItemByName } from './helpers/trash';
import { TEST_FILES } from './fixtures/test-data';

/**
 * E2E-S3-RETRIEVAL-001..011 — server-wide name search rendered INSIDE the explorer
 * surfaces: accordion zones + the breadcrumb-replacing query-chip bar (the
 * search UI rework — the standalone results overlay is gone). The family was
 * CONSOLIDATED from 21 to 11 cases for runtime efficiency: the former 019
 * (anonymous share-link) moved to `share-public.spec.ts` (E2E-SHARE-012) and
 * the former 021 (browse-filter highlight) folded into the EXP-011 assertions
 * of `core-flow.desktop.spec.ts`; the rest merged into the surviving cases
 * listed in docs/E2E_COVERAGE_PLAN.md.
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
 * own server per Playwright project (desktop :5015 / mobile :5020, own sqlite,
 * own project-scoped S3 bucket), never the shared :5002 pool. The serial file
 * owns the server lifecycle in each project; desktop and mobile are independent
 * siblings that each boot their own scratch world (no shared port, no
 * dependency edge). The scratch server runs with `WEA_SKIP_AI_WORKER=1`.
 *
 * IDENTITY (admin-operator pivot, PLAN §14): every case acts as a REGULAR USER
 * provisioned in `beforeAll`; the scratch admin stays OPERATOR-only
 * (provisioning + the perm-delete cleanup fallback). Case 010 seeds the
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
 * - E2E-S3-RETRIEVAL-010 gates the WRITE bulk actions: move/delete disable when a
 *   read-only row is selected (`bulkWritePermission` — FileManagerControls.md
 *   §2); copy stays available by that contract (it reads the source and writes
 *   into a destination the user picks, so it is not source-write-gated).
 * - E2E-S3-RETRIEVAL-003 also covers the empty-submit no-op contract (folded
 *   former case): FloatingSearchBar §2.6 rows 4–5 describe the controlled
 *   component ("results mode + empty input ⇒ Add overlay + no-op click"); in
 *   the integrated shell clearing the text IS the exit signal (§2.7), so the
 *   transient combination is unit-covered (SearchActionButton.test.js) and the
 *   E2E asserts the observable end — empty-text submit (button click AND
 *   Enter) fires ZERO additional POST /api/search.
 * - E2E-S3-RETRIEVAL-007 uses the two-point getBoundingClientRect sample (header
 *   pinned while its rows are in view; header leaves the pinned position once
 *   its zone bottom passes the container top). FLAKY-RISK: if it proves
 *   unstable across reruns, demote to the single pinned-sample observable.
 */
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
 * Request-listener based traffic tracker: collects requests whose method is
 * POST and URL path is exactly `/api/search` (the server-submit channel —
 * `/api/search/click` and every other endpoint are separate paths and are
 * tracked independently). Requests, unlike responses, are recorded as soon as
 * the browser issues them, so a missing response cannot hide a duplicate
 * submit.
 */
function trackSearchPosts(page: Page): () => number {
  const posts: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/search') {
      posts.push(req.url());
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
  // Hold through the minimum pending window: the commit (and the input clear)
  // lands only after one full orbit cycle; single-flight ignores further
  // submits until then.
  await expect(page.getByTestId('search-action-glyph-orbit')).toHaveCount(0, {
    timeout: 15_000,
  });
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

/** ✕ clears the text AND blurs (the host exit signal in results mode). A commit
 * clears the field, so with empty text the ✕ is not mounted — type hold text to
 * bring it back; the ✕ press clears it again while exiting results mode. */
async function pressSearchClose(page: Page, isMobile: boolean) {
  const close = page.getByRole('button', { name: /Close search|검색 닫기/i });
  if (!(await close.count())) {
    await searchBox(page).fill('exit-hold');
  }
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

test.beforeAll(async ({ request }, testInfo) => {
  const projectName = testInfo.project.name;
  // Independent desktop/mobile worlds: each project owns its port slot, its
  // scratch directory and its S3 bucket — never a shared scratch server.
  const port = isMobileProject(testInfo)
    ? e2ePorts.scratchRetrievalMobile
    : e2ePorts.scratchRetrieval;
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
    JWT_SECRET: 'retrieval-e2e-jwt-secret',
    ADMIN_DEFAULT_PASSWORD: ADMIN_PASSWORD,
  });
  ensureClientBuild();
  spawned = spawnScratchServer(scratch, port);
  await waitForScratchHealth(spawned, port);
  operatorToken = await loginScratchAdmin(request, ADMIN_PASSWORD);
  // This suite verifies the HONEST-DEGRADE stack: the semantic section
  // ABSENT (`semantic_available:false` + `semantic_unavailable_reason`).
  // The embed engine is a built-in DEFAULT provider, so in a checkout whose
  // shared model dir holds provisioned weights a plain scratch boot would
  // run the semantic leg and the section-absent premises below would not
  // hold (the skipped worker does not gate the query-time embed leg).
  // `AI_SEMANTIC_SEARCH_ENABLED` is the documented T2 kill switch
  // (configRegistry — dbOnly, env ignored): set through the admin config
  // API it pins the gate-off path, which emits the IDENTICAL wire shape to
  // the unconfigured role (searchService.md §2.3 step 3, §2.5).
  const killSwitchRes = await request.put('/api/admin/config', {
    headers: auth(operatorToken),
    data: { values: { AI_SEMANTIC_SEARCH_ENABLED: 'false' } },
  });
  expect(killSwitchRes.ok()).toBeTruthy();
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
  // it from the trash itself (E2E-S3-RETRIEVAL-007); case-created collections and
  // the owner-user share fixture are scratch-scoped and die with the instance.
  await flushPrivateWorkspaceCleanups(request, operatorToken);
});

test('E2E-S3-RETRIEVAL-001: Results render as accordion zones with honest headers, cross-zone dedup and committed highlights', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const searchPosts = trackSearchPosts(page);
  const metadataPosts = trackMetadataPosts(page);

  // Seed trio: a twice-cased `alpha-…` name in the CURRENT folder (Zone A and
  // the committed-highlight target), a capital `Alpha-One-…` nested under
  // sub/deep (Zone B after dedup), and an unmatched `beta` browse baseline.
  const alphaFile = await seedFile(request, token, base, testInfo, 'alpha');
  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  const twiceName = `alpha-${Date.now()}-ALPHA.txt`;
  const twiceId = await seedNamedFile(request, token, parentNodeId, twiceName);
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
  await expect(searchBox(page)).toHaveValue('alpha');
  // The orbit is the observable pending state; it must be absent for a clean
  // first-Enter contract, so no single-flight submit can swallow the press.
  await expect(page.getByTestId('search-action-glyph-orbit')).toHaveCount(0);
  // Close any open action menu and restore focus to the search input before
  // the one submit. This is observable readiness, not a blind wait.
  await page.keyboard.press('Escape');
  await searchBox(page).focus();
  await expect(searchBox(page)).toBeFocused();
  expect(searchPosts(), 'typing must never hit the server').toBe(0);
  await expect(chipBar(page)).toHaveCount(0);
  await expect(zoneHeader(page, 'a')).toHaveCount(0);

  // Enter submits exactly ONE POST /api/search and mounts the results surface:
  // the chip bar replaces the breadcrumb, zones A + B render, and the degraded
  // semantic zone never exists (`semantic` omitted ⇒ Zone C renders nothing).
  // The first Enter is never retried; a missing/extra request fails the
  // exactly-one assertion below.
  await searchBox(page).press('Enter');
  await expect(chipBar(page)).toBeVisible();
  await expect.poll(() => searchPosts(), 'Enter submits exactly one server query').toBe(1);
  expect(searchPosts()).toBe(1);
  await expect(page.getByTestId('breadcrumb')).toHaveCount(0);

  await expect(zoneHeader(page, 'a')).toBeVisible();
  await expect(zoneHeader(page, 'b')).toBeVisible();
  await expect(zoneHeader(page, 'c')).toHaveCount(0);
  // The save affordance follows the §2.4 field-rule gate (routes/search.md):
  // with the semantic section unavailable the chip-bar Save button is ABSENT
  // from the DOM (hidden, never disabled).
  await expect(page.getByTestId('search-chip-save')).toHaveCount(0);
  // Header labels + snapshot counts: Zone A = the current folder path + its
  // match count; Zone B = the All-results label + the FULL name-set count (the
  // deduped rows still count — the header is always honest).
  await expect(zoneHeader(page, 'a')).toContainText(base.split('/').pop() as string);
  expect(await zoneHeaderCount(page, 'a')).toBe('2');
  expect(await zoneHeaderCount(page, 'b')).toBe('3');
  await expect(zoneHeader(page, 'b')).toContainText(/All results|전체 결과/);

  // Dedup: the same node id never appears in both zones — every row exactly
  // once across the container.
  const rowIds = await containerRowNodeIds(page);
  expect(rowIds.length).toBe(new Set(rowIds).size);
  expect(new Set(rowIds)).toEqual(
    new Set([String(alphaFile.nodeId), String(twiceId), String(alphaOneId)])
  );

  await expect(serverRow(page, alphaOneId)).toBeVisible();
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page)).toContainText('alpha');

  // The skeleton is the pending-only surface — gone once the response lands.
  await expect(page.getByTestId('search-zone-skeleton')).toHaveCount(0);

  // Enrichment: the server row renders after POST /api/files/metadata merges
  // the chunk — the size caption appears (suppressed while unenriched).
  await expect
    .poll(() => metadataPosts(), 'rows enrich through the metadata seam')
    .toBeGreaterThan(0);
  const enrichedRow = serverRow(page, alphaOneId);
  await enrichedRow.scrollIntoViewIfNeeded();
  await expect(enrichedRow).toContainText(/\d+(\.\d+)? (B|KB|MB|GB)/);

  // Committed-term highlight: the twice-cased name carries BOTH fragments as
  // `search-highlight-range` marks while the row text stays the FULL verbatim
  // name; no live marks exist without typed text.
  const twiceRow = rowNode(page, twiceId);
  await expect(twiceRow).toContainText(twiceName);
  const highlights = twiceRow.getByTestId('search-highlight-range');
  await expect(highlights).toHaveCount(2);
  expect(await highlights.allTextContents()).toEqual(['alpha', 'ALPHA']);
  await expect(twiceRow.getByTestId('filter-highlight-range')).toHaveCount(0);

  // Exit via the single chip returns the browse surfaces.
  await revealAndActivateChip(page, 0, 'exit', isMobile);
  await expect(chipBar(page)).toHaveCount(0);
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
  await expect(fileItem(page, betaFile.path)).toBeVisible();
});

test('E2E-S3-RETRIEVAL-002: Result rows open — files preview over the mounted zones, directories navigate and exit', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const clicks = trackSearchClicks(page);

  // A nested DIRECTORY match (+ one file inside) and a current-folder FILE
  // match under one query: the row-open dispatch (FileManager §7) sends files
  // to the preview OVER the still-mounted zones and directories to navigation
  // with a results-mode exit. Desktop reaches rows with the browse-parity
  // double click, mobile with a single tap.
  const uniq = String(Date.now());
  const subName = `sub-${uniq}`;
  const deepName = `deep-${uniq}`;
  const folderName = `alpha-inside-${uniq}`;
  const innerName = `alpha-note-${uniq}.txt`;
  const openName = `alpha-openme-${uniq}.txt`;
  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  const folderId = await seedNestedFolder(request, token, parentNodeId, [
    subName,
    deepName,
    folderName,
  ]);
  await seedNamedFile(request, token, folderId, innerName);
  const openId = await seedNamedFile(request, token, parentNodeId, openName);
  await seedFile(request, token, base, testInfo, 'beta');
  await gotoFilesPath(page, request, `/${base}`);

  await submitSearch(page, 'alpha');
  await expect(serverRow(page, folderId)).toBeVisible();
  await expect(serverRow(page, folderId)).toContainText(folderName);
  await expect(rowNode(page, openId)).toBeVisible();

  // FILE leg: the preview dialog opens OVER the still-mounted results surface
  // (chip bar + zone header stay), and exactly one /search/click lands.
  await openRow(page, rowNode(page, openId), isMobile);
  await expect(page.getByTestId('file-preview-dialog')).toBeVisible();
  await expect(chipBar(page)).toBeVisible();
  await expect(zoneHeader(page, 'a')).toBeVisible();
  await expect
    .poll(() => clicks().filter((c) => c.body?.node_id === openId).length, { timeout: 10_000 })
    .toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('file-preview-dialog')).toHaveCount(0);

  // DIRECTORY leg: opening it records the click, navigates and EXITS results.
  await openRow(page, rowNode(page, folderId), isMobile);
  await expect
    .poll(() => clicks().filter((c) => c.body?.node_id === folderId).length, { timeout: 10_000 })
    .toBe(1);
  expect(
    clicks().filter((c) => c.body?.node_id !== openId && c.body?.node_id !== folderId)
  ).toEqual([]);
  await expect(chipBar(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/files/node/${folderId}$`));
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
  await expect(
    fileItem(page, `/${base}/${subName}/${deepName}/${folderName}/${innerName}`)
  ).toBeVisible();
});

test('E2E-S3-RETRIEVAL-003: Live typing hides no rows, promotes matches, and highlights them without a server call', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const isMobile = isMobileProject(testInfo);
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

  // Empty-text submit is a no-op at every channel (folded former case): the
  // ghost button keeps its enabled state, clicking it fires nothing, Enter
  // fires nothing, and no results surface ever mounts. The transient
  // "results + empty text" glyph state is unit-scoped (FloatingSearchBar §2.6).
  await (isMobile ? searchBox(page).tap() : searchBox(page).click());
  const button = page.getByTestId('search-action-button');
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await (isMobile ? button.tap() : button.click());
  await page.waitForTimeout(500);
  expect(searchPosts(), 'empty-text button submit never POSTs').toBe(1);
  await expect(chipBar(page)).toHaveCount(0);
  await expect(zoneHeader(page, 'a')).toHaveCount(0);

  await searchBox(page).press('Enter');
  await page.waitForTimeout(500);
  expect(searchPosts(), 'empty-text Enter never POSTs').toBe(1);
  await expect(chipBar(page)).toHaveCount(0);

  await blurActive(page);
  await expect(button).toHaveCount(0);
});
test('E2E-S3-RETRIEVAL-004: Recent queries persist in sessionStorage across searches and honor the cap and logout clear', async ({
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

test('E2E-S3-RETRIEVAL-005: Zero-result queries render the honest empty state and trashed nodes never surface', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);

  const betaFile = await seedFile(request, token, base, testInfo, 'beta');
  // Unique-name file for the trash leg (searchNodesByName hides `deleted_at`
  // rows; the suite never restores, only purges — restore-free per the plan).
  const quarzFile = await seedFile(request, token, base, testInfo, 'quarz');
  const quarzName = quarzFile.path.split('/').pop() as string;
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
  // ✕ exits results mode and restores the listing.
  await pressSearchClose(page, isMobile);
  await expect(chipBar(page)).toHaveCount(0);
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
  await expect(fileItem(page, betaFile.path)).toBeVisible();

  // Trash leg: submit a match, trash it through the canonical batch-delete
  // channel, reload the folder (the session listing re-reads WITHOUT the
  // trashed node), then re-submit: zero zone counts ⇒ no headers, the
  // no-results line only, and no row for the trashed node anywhere.
  await submitSearch(page, 'quarz');
  await expect(rowNode(page, quarzFile.nodeId)).toBeVisible();
  await apiTrashFile(request, token, quarzFile.nodeId);
  await gotoFilesPath(page, request, `/${base}`);
  await submitSearch(page, 'quarz');
  await expect(zoneHeader(page, 'a')).toHaveCount(0);
  await expect(zoneHeader(page, 'b')).toHaveCount(0);
  await expect(page.getByTestId('search-no-results')).toBeVisible();
  await expect(rowNode(page, quarzFile.nodeId)).toHaveCount(0);

  await pressSearchClose(page, isMobile);
  // Containment parity: purge the trashed file (no restore in the suite).
  await purgeTrashedItemByName(request, token, quarzName);
});

test('E2E-S3-RETRIEVAL-006: The FAB spot morphs to the ghost search button on focus and restores on blur-empty and close', async ({
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

test('E2E-S3-RETRIEVAL-007: Zone chrome — the collapse persists across navigation and the active header stays pinned', async ({
  page,
  request,
}, testInfo) => {
  const isMobile = isMobileProject(testInfo);
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);

  // Volume seed: 20 current-folder rows (Zone A alone overflows the viewport)
  // + a sub folder with 26 rows — the Zone B tail must EXCEED the viewport
  // height so the push-up sample is reachable at max scroll on the 390x844
  // mobile viewport too (15 rows sat right at the boundary and flaked) — and
  // it gives the accordion a nested row to hide.
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
  const nestedId = await seedNamedFile(request, token, subId, `stickq-z-${uniq}-mark.txt`);
  for (let i = 0; i < 25; i += 1) {
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
  await expect(serverRow(page, nestedId)).toBeVisible();

  // STICKY (two-point bounding-rect sample inside the single scroll container,
  // no CSS style/animation assertions): while Zone A rows are still in view the
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

  // ACCORDION: collapse Zone B via its toggle (Collapse final state: the rows
  // unmount, the header stays with its honest count) — persisted under the
  // dedicated localStorage key.
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
  await submitSearch(page, 'stickq');
  await expect(zoneHeader(page, 'b')).toBeVisible();
  await expect(serverRow(page, nestedId)).toHaveCount(0);

  // The key survives a reload of the scratch session too.
  await page.reload();
  await gotoFilesPath(page, request, `/${base}`);
  await submitSearch(page, 'stickq');
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

test('E2E-S3-RETRIEVAL-008: The chip chain refines, reverts to snapshots, and every exit resets the input field', async ({
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

  // SINGLE-CHIP EXIT: with the chain back at one step the chip reveals `Exit` +
  // close icon (hover on desktop, tap-to-reveal on mobile); activating it exits
  // results mode entirely — the breadcrumb and toolbar return and the input
  // field is reset (browse starts unfiltered).
  await revealAndActivateChip(page, 0, 'exit', isMobile);
  await expect(chipBar(page)).toHaveCount(0);
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
  await expect(page.getByTestId('file-manager-sort')).toBeVisible();
  await expect(searchBox(page)).toHaveValue('');
  await expect(rowNode(page, oneId)).toBeVisible();
  await expect(rowNode(page, twoId)).toBeVisible();

  // NAVIGATION EXIT: re-enter results, then folder-navigate through the tree —
  // mobile opens the drawer in browse first (the chip bar replaces the
  // breadcrumb expand toggle mid-results; the open drawer survives). The zones
  // unmount, the breadcrumb returns, the input resets and the sessionStorage
  // recents survive the transition.
  if (isMobile) {
    await page.getByTestId('breadcrumb-folder-tree-toggle').click();
  }
  await submitSearch(page, 'alpha');
  await expect(chipBar(page)).toBeVisible();
  await expect(zoneHeader(page, 'a')).toBeVisible();
  await navigateHomeViaTree(page);
  await expect(chipBar(page)).toHaveCount(0);
  await expect(zoneHeader(page, 'a')).toHaveCount(0);
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
  await expect(searchBox(page)).toHaveValue('');
  const stored = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    RECENT_QUERIES_KEY
  );
  expect(stored).toBeTruthy();
  expect((JSON.parse(stored as string) as { query: string }[])[0].query).toBe('alpha');
});

test('E2E-S3-RETRIEVAL-009: The library-add button adds the FULL snapshot to an existing collection', async ({
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

test('E2E-S3-RETRIEVAL-010: A read-only server row badges EditOff and disables the write bulk actions when selected', async ({
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

test('E2E-S3-RETRIEVAL-011: View-mode and sort toggles affect both zones and select-all spans zones', async ({
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
