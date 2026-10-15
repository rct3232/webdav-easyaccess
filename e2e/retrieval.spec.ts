import fs from 'node:fs';

import { APIRequestContext, expect, Page, test } from '@playwright/test';

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
import { purgeTrashedItemByName } from './helpers/trash';
import { TEST_FILES } from './fixtures/test-data';

/**
 * E2E-RETRIEVAL-001..007 — server-wide name search + results-mode UI (T0.11).
 *
 * Contract sources: docs/spec/server/routes/search.md (POST /api/search P0
 * name branch — `name_matches[{node_id,name}]`, `semantic` ABSENT with
 * `semantic_available:false`; POST /search/click {node_id} → 204),
 * docs/spec/client/hooks/useSearchResults.md (two-stage rule: typing NEVER
 * fetches, Enter submits; inline re-filter of the LOADED set; chip dedup max
 * 8 newest-first in sessionStorage via `recentQueriesStorage` key
 * `wea.recentSearchQueries`, cleared on logout; save visibility
 * `semantic_available ∧ semantic.length>0` ⇒ never at P0),
 * docs/spec/client/components/file-manager/SearchBarResultsMode.md (header
 * grammar `· N results`, empty sections render nothing, both-empty ⇒
 * `search-no-results` line, chip ⋮ menu = re-search/Save — the Save item is
 * RENDERED per §2.7 but inert at P0: `saveChipQuery` re-runs the query and
 * bails on `semantic_available !== true` without any create call).
 * Result-row open (FileManager.handleSearchRowOpen): directory rows EXIT
 * results mode and navigate; file rows open the preview OVERLAY and KEEP
 * results mode — case 003 therefore opens a nested DIRECTORY match (the
 * spec-mandated "exit + location navigable" path).
 *
 * SCRATCH-HERMETIC per the destructive-case policy (docs/TESTING_STRATEGY.md):
 * own server on the `:5015` slot (own sqlite, webdav file backend — the
 * s3-mode run still exercises real WebDAV wiring; the webdav host-mode leg is
 * deferred, see playwright.config.ts), never the shared :5002 pool. One
 * scratch server serves the whole (serial, desktop-only) file. No AI surfaces
 * exist at P0, so every payload is the embed-absent degrade shape.
 *
 * IDENTITY (admin-operator pivot, PLAN §14): every case acts as a REGULAR
 * USER provisioned in `beforeAll`; the scratch admin stays OPERATOR-only
 * (provisioning + the perm-delete cleanup fallback). The suite creates NO
 * collections, so "no wired save action" is asserted as a zero-IO property
 * (no POST /api/collections) plus the API ground truth (empty list).
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

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const textFixtureBuffer = readTestFileFixture(TEST_FILES.smallText);

/** sessionStorage key owned by client/src/services/recentQueriesStorage.js. */
const RECENT_QUERIES_KEY = 'wea.recentSearchQueries';

test.describe.configure({ mode: 'serial', timeout: 180_000 });

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

/** Collects every POST to `/api/collections` (the save-to-collection channel). */
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

/** Seed one file directly under the case workspace by explicit name. */
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

/** Result rows as the client renders them (testid `search-result-row`). */
function resultRows(page: Page) {
  return page.getByTestId('search-result-row');
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
  // cleanup, admin-operator pivot PLAN §14). The suite creates no collections
  // and no persistent likes, so nothing else needs undoing; a case that
  // trashes an item purges it from the trash itself (E2E-RETRIEVAL-007).
  await flushPrivateWorkspaceCleanups(request, operatorToken);
});

test('E2E-RETRIEVAL-001: Server search replaces the header with a results mode listing the name matches', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const searchPosts = trackSearchPosts(page);

  // Seed pair: lowercase `alpha-…` at the workspace root + capital `Alpha-One-…`
  // nested (sub/deep) — one case-insensitive server match each for `alpha`.
  const alphaFile = await seedFile(request, token, base, testInfo, 'alpha');
  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  const deepId = await seedNestedFolder(request, token, parentNodeId, [
    buildName(testInfo, 'sub'),
    buildName(testInfo, 'deep'),
  ]);
  const alphaOneName = `Alpha-One-${Date.now()}.txt`;
  await seedNamedFile(request, token, deepId, alphaOneName);
  const betaFile = await seedFile(request, token, base, testInfo, 'beta');
  for (let i = 1; i <= 9; i += 1) {
    await seedFile(request, token, base, testInfo, `dist${String(i).padStart(2, '0')}`);
  }
  await gotoFilesPath(page, request, `/${base}`);
  await expect(fileItem(page, betaFile.path)).toBeVisible();

  // Typing is the two-stage CLIENT leg (useSearchResults §2.5): keystrokes
  // only set the session filter — ZERO POST /api/search before submit.
  await searchBox(page).fill('al');
  await searchBox(page).pressSequentially('pha');
  expect(searchPosts(), 'typing must never hit the server').toBe(0);
  await expect(page.getByTestId('search-results-mode')).toHaveCount(0);

  await searchBox(page).press('Enter');
  await expect(page.getByTestId('search-results-mode')).toBeVisible();
  await expect.poll(() => searchPosts(), 'Enter submits exactly one server query').toBe(1);

  // Case-insensitive count over the seed pair (`alpha` vs `Alpha-One`).
  await expect(page.getByTestId('search-results-count')).toContainText('2 results');

  // Rows: name ASC as the server returned it (sqlite BINARY `ORDER BY name`
  // — capital `A` sorts before lowercase `a`; the client never re-sorts).
  const apiRes = await request.post('/api/search', {
    headers: auth(token),
    data: { query: 'alpha' },
  });
  expect(apiRes.ok()).toBeTruthy();
  const apiBody = await apiRes.json();
  const serverNames = (apiBody.name_matches as { node_id: number; name: string }[]).map(
    (row) => row.name
  );
  expect(serverNames).toEqual([alphaOneName, alphaFile.path.split('/').pop()]);
  await expect(resultRows(page)).toHaveCount(serverNames.length);
  const rowNames = await resultRows(page).allTextContents();
  expect(rowNames).toEqual(serverNames);
  // name section owns every row; no semantic surface exists at P0.
  await expect(page.getByTestId('search-section-name')).toBeVisible();
  await expect(page.getByTestId('search-section-semantic')).toHaveCount(0);
  await expect(page.getByTestId('search-semantic-row')).toHaveCount(0);
  // P0 save rule (useSearchResults §2.3): semantic empty ⇒ button ABSENT.
  await expect(page.getByTestId('search-results-save')).toHaveCount(0);

  // ✕ exits results mode: the replaced breadcrumb row + toolbar come back and
  // the normal listing returns (the searchbox text is a separate session
  // filter — clearing it restores the full listing, FloatingSearchBar §3.2).
  await page.getByTestId('search-results-exit').click();
  await expect(page.getByTestId('search-results-mode')).toHaveCount(0);
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
  await expect(page.getByTestId('file-manager-sort')).toBeVisible();
  await searchBox(page).fill('');
  await expect(fileItem(page, betaFile.path)).toBeVisible();
});

test('E2E-RETRIEVAL-002: Result rows highlight every matched fragment inside the full name', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);

  // Name carries the query fragment twice with different casing: the
  // highlight is case-insensitive all-occurrence (searchHighlight.js), while
  // the row text stays the FULL verbatim name (SearchBarResultsMode §2.7).
  const unique = buildName(testInfo, 'x');
  const fileName = `alpha-${unique}-ALPHA.txt`;
  await seedNamedFile(request, token, await resolveNodeId(request, token, `/${base}`), fileName);
  await seedFile(request, token, base, testInfo, 'beta');
  await gotoFilesPath(page, request, `/${base}`);

  await submitSearch(page, 'alpha');
  await expect(page.getByTestId('search-results-mode')).toBeVisible();
  await expect(resultRows(page)).toHaveCount(1);

  const row = resultRows(page).first();
  await expect(row).toHaveText(fileName);
  const highlights = row.getByTestId('search-highlight-range');
  await expect(highlights).toHaveCount(2);
  expect(await highlights.allTextContents()).toEqual(['alpha', 'ALPHA']);
});

test('E2E-RETRIEVAL-003: Opening a result records the click and leaves results mode', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const clicks = trackSearchClicks(page);

  // Nested DIRECTORY match under sub/deep (+ one file inside); the row-open
  // handler for directories exits results mode and navigates to the node
  // (FileManager.handleSearchRowOpen), the file row would instead open the
  // preview overlay and KEEP results mode — 003 asserts the directory leg.
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
  const folderRow = resultRows(page).filter({ hasText: folderName });
  await expect(folderRow).toBeVisible();
  await expect(resultRows(page)).toHaveCount(2);

  await folderRow.click();

  // §3.4 list-entry-click signal: exactly ONE POST /api/search/click for
  // that node_id (register (a) — fire-and-forget, absorbed 204).
  await expect
    .poll(() => clicks().filter((c) => c.body?.node_id === folderId).length, { timeout: 10_000 })
    .toBe(1);
  expect(clicks().filter((c) => c.body?.node_id !== folderId)).toEqual([]);

  // Directory open EXITS results mode and navigates into the location; the
  // nested file renders there (its name keeps the searchbox's inline filter
  // satisfied, so it is navigable AND visible in the restored listing).
  await expect(page.getByTestId('search-results-mode')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/files/node/${folderId}$`));
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
  await expect(
    fileItem(page, `/${base}/${subName}/${deepName}/${folderName}/${innerName}`)
  ).toBeVisible();
});

test('E2E-RETRIEVAL-004: Typing in results mode filters the loaded set without a server call', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const searchPosts = trackSearchPosts(page);

  const uniq = String(Date.now());
  const parentNodeId = await resolveNodeId(request, token, `/${base}`);
  for (let i = 1; i <= 5; i += 1) {
    await seedNamedFile(request, token, parentNodeId, `quart-${i}-${uniq}.txt`);
  }
  await seedNamedFile(request, token, parentNodeId, `quart-deep-1-${uniq}.txt`);
  await seedNamedFile(request, token, parentNodeId, `quart-deep-2-${uniq}.txt`);
  await gotoFilesPath(page, request, `/${base}`);

  // Broad submit: the loaded set is the 7 `quart` rows.
  await submitSearch(page, 'quart');
  await expect(resultRows(page)).toHaveCount(7);
  expect(searchPosts()).toBe(1);

  // Inline re-filter of the LOADED set (SearchBarResultsMode §2.3): typing in
  // `search-results-filter` shrinks the rows with ZERO extra POSTs.
  await page.getByTestId('search-results-filter').fill('deep');
  await expect(resultRows(page)).toHaveCount(2);
  await page.waitForTimeout(750);
  expect(searchPosts(), 'inline filter never re-queries the server').toBe(1);

  // Enter INSIDE the filter input is blur-only (§2.3: the Enter RE-SUBMIT
  // lives in FloatingSearchBar) — still no third POST.
  await page.getByTestId('search-results-filter').press('Enter');
  await page.waitForTimeout(750);
  expect(searchPosts()).toBe(1);

  // Enter in the header searchbox re-submits the query: exactly ONE new POST,
  // and the submit clears the filter (runQuery resets filterText — the full
  // loaded set re-renders).
  await searchBox(page).press('Enter');
  await expect.poll(() => searchPosts(), 'Enter submits exactly once more').toBe(2);
  await expect(resultRows(page)).toHaveCount(7);
});

test('E2E-RETRIEVAL-005: Recent query chips persist across searches, survive re-entry and expose no wired save action at P0', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);
  const collectionPosts = trackCollectionPosts(page);

  await seedFile(request, token, base, testInfo, 'beta');
  await gotoFilesPath(page, request, `/${base}`);

  // Two submits ⇒ two chips (upsert, newest-first; zero-match queries are
  // still SUCCESS payloads — the chip records the query, not the result).
  await submitSearch(page, 'chippy-two');
  await submitSearch(page, 'chippy-one');
  await expect(page.getByTestId('search-chip')).toHaveCount(2);
  await expect(page.getByTestId('search-chip').first()).toHaveText(/chippy-one/);

  // sessionStorage mirror (recentQueriesStorage key) — persistence source.
  const stored = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    RECENT_QUERIES_KEY
  );
  expect(stored).toBeTruthy();
  const chips = JSON.parse(stored as string) as { query: string }[];
  expect(chips.map((chip) => chip.query)).toEqual(['chippy-one', 'chippy-two']);

  // Exit + reopen: the chip row comes back from storage intact.
  await page.getByTestId('search-results-exit').click();
  await expect(page.getByTestId('search-chip')).toHaveCount(0);
  await submitSearch(page, 'chippy-two');
  await expect(page.getByTestId('search-chip')).toHaveCount(2);
  await expect(page.getByTestId('search-chip').first()).toHaveText(/chippy-two/);

  // Chip ⋮ menu (SearchBarResultsMode §2.7): re-search is the wired P0
  // action; the Save item renders but is NOT wired at P0 — `saveChipQuery`
  // (useSearchResults §2.3) re-runs the query and bails on
  // `semantic_available !== true`, so NO collection is ever created.
  await page.getByTestId('search-chip-menu').first().click();
  await expect(page.getByTestId('search-chip-research')).toBeVisible();
  await page.getByTestId('search-chip-save').click();
  await page.waitForTimeout(750);
  expect(collectionPosts(), 'chip save must not call POST /api/collections at P0').toBe(0);
  const collectionsRes = await request.get('/api/collections?include=mine,shared,archived', {
    headers: auth(token),
  });
  expect(collectionsRes.ok()).toBeTruthy();
  expect((await collectionsRes.json()).collections).toEqual([]);

  // Logout clears the chip store (useAuthSession.logout → clearRecentQueries).
  await page.goto('/mypage');
  await page
    .locator('.MuiList-root')
    .first()
    .getByRole('button', { name: /Account info/i })
    .click();
  await page.getByRole('button', { name: /^log out$/i }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  const afterLogout = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    RECENT_QUERIES_KEY
  );
  expect(afterLogout).toBeNull();
});

test('E2E-RETRIEVAL-006: An unmatched query renders an honest empty results state', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);

  const betaFile = await seedFile(request, token, base, testInfo, 'beta');
  await gotoFilesPath(page, request, `/${base}`);

  // 'pluvio' matches nothing in the scratch world (unique token, no node
  // carries it) — the server still answers 200 with a zero-name payload.
  await submitSearch(page, 'pluvio');
  await expect(page.getByTestId('search-results-mode')).toBeVisible();
  await expect(page.getByTestId('search-results-count')).toContainText('0 results');
  await expect(resultRows(page)).toHaveCount(0);
  await expect(page.getByTestId('search-section-name')).toHaveCount(0);
  await expect(page.getByTestId('search-results-save')).toHaveCount(0);
  await expect(page.getByTestId('search-no-results')).toHaveText(/No results found/i);

  // ✕ restores the normal listing surface.
  await page.getByTestId('search-results-exit').click();
  await expect(page.getByTestId('search-results-mode')).toHaveCount(0);
  await expect(page.getByTestId('breadcrumb')).toBeVisible();
  await searchBox(page).fill('');
  await expect(fileItem(page, betaFile.path)).toBeVisible();
});

test('E2E-RETRIEVAL-007: Trashed files never surface in search results', async ({
  page,
  request,
}, testInfo) => {
  const { base, token } = await loginAndOpenUserWorkspace(page, request, testInfo, USER_CREDS);

  // Unique-name file (searchNodesByName hides `deleted_at` rows; the suite
  // never restores, only purges — restore-free assertion per the plan).
  const file = await seedFile(request, token, base, testInfo, 'quarz');
  const fileName = file.path.split('/').pop() as string;
  await gotoFilesPath(page, request, `/${base}`);

  await submitSearch(page, 'quarz');
  await expect(resultRows(page)).toHaveCount(1);

  // Canonical trash channel: batch-delete trashes the subtree (DEF-16 P2).
  await apiTrashFile(request, token, file.nodeId);

  // Same query re-submitted: the trashed node is gone from the result set.
  await page.getByTestId('search-results-exit').click();
  await submitSearch(page, 'quarz');
  await expect(page.getByTestId('search-results-count')).toContainText('0 results');
  await expect(resultRows(page)).toHaveCount(0);

  // Containment parity: purge the trashed file (no restore in the suite).
  await purgeTrashedItemByName(request, token, fileName);
});
