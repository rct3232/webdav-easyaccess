import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { APIRequestContext, expect, test, type Page } from '@playwright/test';

import { createFakeLlmServer, IMAGE_CAPTION, type FakeLlmServer } from './helpers/fakeLlm';
import {
  bootColumn,
  CHAT_SETTINGS,
  EMBED_SETTINGS,
  publicAi,
  shutdownColumn,
  waitForAiFlags,
  waitForChatProbeSettled,
  waitForEmbedProbeSettled,
  type ColumnScratch,
} from './helpers/aiMatrixColumn';
import { e2ePorts } from './helpers/ports';
import { loginWithCredentials } from './helpers/auth';
import { gotoFilesPath } from './helpers/resolvePath';
import { createFolderAt, fileItem, readTestFileFixture, uploadFileAt } from './helpers/files';
import { ensureClientBuild, openSystemSettings } from './helpers/setupScratch';
import { TEST_FILES, TEST_USERS } from './fixtures/test-data';

/**
 * E2E-S3-AI-008..012 — the §4.12 LLM capability degradation matrix driven
 * through the BROWSER search surface (T4.3 Wave 3). The API-only matrix
 * (`e2e/ai.matrix.spec.ts`) already pins the wire contract; this suite pins
 * the user-visible consequences: FAB glyph, Zone C header/rows, save chip,
 * parser predicate filtering, media findability and the admin health card.
 *
 * Hermetic scratch, one column per capability family, browser-safe slot `:5009`
 * (`s3-ai-matrix-ui-desktop`). The slot is NOT the API-only `:5021` matrix slot:
 * band 40 maps 5021 to the browser-restricted 5061, so a page-driving project
 * there would silently fail. The optional admin-AI mobile project that used
 * 5009 was dropped (mobile admin AI is not required).
 *
 * Every column boots with fake-LLM settings injected through pre-boot scratch
 * sqlite rows (dbOnly keys), so no real provider is ever configured. Columns:
 *   None      — no LLM: magnifier glyph, name-only results, no Zone C/save;
 *   embed     — fake text-only embed: wand, Zone C + save, V0 image negative;
 *   media     — fake media-capable embed: caption finds the image;
 *   parser    — fake embed+chat: parse atoms filter a name match, the kill
 *               switch restores parser-free name results.
 * Admin health legs ride the same embed/media columns (System Settings card).
 */

const SCRATCH_PORT = e2ePorts.scratchAiMatrixUi;
const ADMIN_PASSWORD = 'AiMatrixUi!123';

const NONE_USER = {
  username: 'ai-matrix-ui-none',
  password: 'AiMatrixUiNone!123',
  email: 'ai-matrix-ui-none@e2etest.com',
};
const EMBED_USER = {
  username: 'ai-matrix-ui-embed',
  password: 'AiMatrixUiEmbed!123',
  email: 'ai-matrix-ui-embed@e2etest.com',
};
const MEDIA_USER = {
  username: 'ai-matrix-ui-media',
  password: 'AiMatrixUiMedia!123',
  email: 'ai-matrix-ui-media@e2etest.com',
};
const PARSER_USER = {
  username: 'ai-matrix-ui-parser',
  password: 'AiMatrixUiParser!123',
  email: 'ai-matrix-ui-parser@e2etest.com',
};

const QUERY = 'banana harvest festival';
const DOC_BODY = [
  'The banana harvest festival opens the season in the riverside valley.',
  'Every autumn the community gathers for the lantern parade and the fruit market.',
  'Farmers bring crates of bananas, mangoes and cassava to the riverside stalls.',
  'The festival closes with a night market and a fireworks display over the water.',
].join('\n');
const IMAGE_BYTES = readTestFileFixture(TEST_FILES.smallImage);
const PARSER_QUERY = 'pdfs from last year over 10mb';

let stampSeq = 0;
const stamp = () => `${Date.now()}-${(stampSeq += 1)}`;

// One shared CRA build for every column (idempotent; a filtered run that
// starts at a later describe still builds before booting its scratch server).
let uiBuildReady = false;
function ensureUiBuild(): void {
  if (uiBuildReady) return;
  ensureClientBuild();
  uiBuildReady = true;
}

test.describe.configure({ mode: 'serial', timeout: 300_000 });

function scratchScalar(
  scratchDir: string,
  query: string,
  ...params: Array<string | number>
): number {
  const db = new DatabaseSync(path.join(scratchDir, 'webdav.db'), { readOnly: true });
  try {
    const row = db.prepare(query).get(...params) as { v?: number | bigint } | undefined;
    return Number(row?.v ?? 0);
  } finally {
    db.close();
  }
}

async function waitForJob(
  scratchDir: string,
  nodeId: number,
  kind: string,
  status: string,
  timeoutMs = 240_000
): Promise<void> {
  await expect
    .poll(
      () =>
        scratchScalar(
          scratchDir,
          'SELECT COUNT(*) AS v FROM ai_jobs WHERE node_id = ? AND kind = ? AND status = ?',
          nodeId,
          kind,
          status
        ),
      { timeout: timeoutMs, intervals: [500, 1000] }
    )
    .toBeGreaterThan(0);
}

async function uploadText(
  request: APIRequestContext,
  token: string,
  parentNodeId: number,
  name: string,
  body: string
): Promise<number> {
  return uploadFileAt(request, token, parentNodeId, name, 'text/plain', Buffer.from(body, 'utf8'));
}

async function uploadImage(
  request: APIRequestContext,
  token: string,
  parentNodeId: number,
  name: string
): Promise<number> {
  return uploadFileAt(request, token, parentNodeId, name, 'image/png', IMAGE_BYTES);
}

async function openUserFiles(
  page: Page,
  request: APIRequestContext,
  creds: { username: string; password: string }
): Promise<void> {
  await loginWithCredentials(page, creds.username, creds.password);
  await gotoFilesPath(page, request, `/${creds.username}`);
}

/** Submit through the pill and return the parsed `POST /api/search` body. */
async function submitSearch(page: Page, query: string): Promise<Record<string, any>> {
  const box = page.getByRole('searchbox');
  const replyPromise = page.waitForResponse(
    (res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/search',
    { timeout: 90_000 }
  );
  await box.fill(query);
  await box.press('Enter');
  const reply = await replyPromise;
  expect(reply.status()).toBe(200);
  return (await reply.json()) as Record<string, any>;
}

/** The chip strip is the results-mode surface; ✕/empty text exits it. */
async function exitResults(page: Page): Promise<void> {
  // The host already clears the pill on commit; the single-chip ✕ is the
  // results-mode exit (the desktop action reveals on hover).
  const chip = page.getByTestId('search-chip').last();
  await chip.hover();
  await page.getByTestId('search-chip-exit').click();
  await expect(page.getByTestId('search-chip-bar')).toHaveCount(0);
}

/** T4.3 Wave 3 pins the ABSENCE: parsed atoms never render as chips. */
async function expectNoPredicateOrDeltaChips(page: Page): Promise<void> {
  await expect(
    page.locator(
      '[data-testid*="predicate-chip"], [data-testid*="delta-chip"], [data-testid="search-predicate"], [data-testid="search-delta"]'
    )
  ).toHaveCount(0);
}

test.describe('AI matrix UI — None column', () => {
  let column: ColumnScratch | undefined;

  test.beforeAll(async ({ request }, testInfo) => {
    ensureUiBuild();
    column = await bootColumn(
      request,
      testInfo.project.name,
      'ui-none',
      {},
      {
        port: SCRATCH_PORT,
        adminPassword: ADMIN_PASSWORD,
        userCreds: NONE_USER,
        jwtSecret: 'ai-matrix-ui-none-jwt-secret',
      }
    );
  });

  test.afterAll(async () => {
    await shutdownColumn(column);
  });

  test('E2E-S3-AI-008: with no LLM configured the search FAB keeps the magnifier glyph, name results work, no Zone C or save chip renders, and a zero-match query shows the honest empty state', async ({
    page,
    request,
  }) => {
    expect(await publicAi(request)).toEqual({ embed: false, chat: false });

    const name = `harvest-notes-${stamp()}.txt`;
    const nodeId = await uploadText(request, column!.userToken, column!.homeNodeId, name, DOC_BODY);
    await openUserFiles(page, request, column!.userCreds);

    // Magnifier glyph = the embed role is NOT configured (public ai.embed false).
    const box = page.getByRole('searchbox');
    await box.click();
    await expect(page.getByTestId('search-action-glyph-search')).toBeAttached();
    await expect(page.getByTestId('search-action-glyph-wand')).toHaveCount(0);

    // Name results still work: the query is a substring of the file name.
    const body = await submitSearch(page, name);
    expect(body.semantic).toBeUndefined();
    expect(body.semantic_unavailable_reason).toBe('not_configured');
    await expect(page.getByTestId('search-zone-header-a')).toBeVisible();
    await expect(fileItem(page, `/${NONE_USER.username}/${name}`)).toBeVisible();

    // No semantic surface and no save affordance without a configured embed role.
    await expect(page.getByTestId('search-zone-header-c')).toHaveCount(0);
    await expect(page.getByTestId('search-zone-glyph-c')).toHaveCount(0);
    await expect(page.getByTestId('search-chip-save')).toHaveCount(0);
    await expect(page.getByTestId(`server-search-row-${nodeId}`)).toHaveCount(0);
    await expectNoPredicateOrDeltaChips(page);

    // Zero-match query: no zone headers at all, only the honest empty line.
    const emptyBody = await submitSearch(page, `pluvio-${stamp()}`);
    expect(emptyBody.semantic).toBeUndefined();
    await expect(page.getByTestId('search-no-results')).toBeVisible();
    await expect(page.getByTestId('search-zone-header-a')).toHaveCount(0);
    await expect(page.getByTestId('search-zone-header-b')).toHaveCount(0);
    await expect(page.getByTestId('search-zone-header-c')).toHaveCount(0);
  });
});

test.describe('AI matrix UI — embed column', () => {
  let column: ColumnScratch | undefined;
  let fake: FakeLlmServer | undefined;

  test.beforeAll(async ({ request }, testInfo) => {
    ensureUiBuild();
    fake = await createFakeLlmServer({ mode: 'text-only' });
    column = await bootColumn(
      request,
      testInfo.project.name,
      'ui-embed',
      { ...EMBED_SETTINGS(fake.baseUrl) },
      {
        port: SCRATCH_PORT,
        adminPassword: ADMIN_PASSWORD,
        userCreds: EMBED_USER,
        jwtSecret: 'ai-matrix-ui-embed-jwt-secret',
      }
    );
    await waitForEmbedProbeSettled(fake, 'text-only');
    await waitForAiFlags(request, { embed: true, chat: false });
  });

  test.afterAll(async () => {
    await fake?.close();
    await shutdownColumn(column);
  });

  test('E2E-S3-AI-009: the embed column renders the wand glyph, Zone C header/rows and the save chip, while a non-matching query has no name section', async ({
    page,
    request,
  }) => {
    const name = `semantic-note-${stamp()}.txt`;
    const nodeId = await uploadText(request, column!.userToken, column!.homeNodeId, name, DOC_BODY);
    await waitForJob(column!.scratch, nodeId, 'embed', 'done');
    await openUserFiles(page, request, column!.userCreds);

    const box = page.getByRole('searchbox');
    await box.click();
    await expect(page.getByTestId('search-action-glyph-wand')).toBeAttached();
    await expect(page.getByTestId('search-action-glyph-search')).toHaveCount(0);

    const body = await submitSearch(page, QUERY);
    expect(Array.isArray(body.semantic)).toBe(true);
    expect(body.semantic.map((row: { node_id: number }) => row.node_id)).toContain(nodeId);

    await expect(page.getByTestId('search-zone-header-c')).toBeVisible();
    await expect(page.getByTestId('search-zone-header-c')).toContainText(
      /Suggested results|추천 결과/
    );
    await expect(page.getByTestId(`server-search-row-${nodeId}`)).toBeVisible();
    await expect(page.getByTestId('search-chip-save')).toBeVisible();
    // The body phrase is not in the file name: the name section stays absent.
    await expect(page.getByTestId('search-zone-header-a')).toHaveCount(0);
    await expect(page.getByTestId('search-zone-header-b')).toHaveCount(0);
    await expectNoPredicateOrDeltaChips(page);
  });

  test('E2E-S3-AI-010 (negative): the text-only fake leaves an image out of Zone C because no media vector exists', async ({
    page,
    request,
  }) => {
    const name = `bicycle-photo-${stamp()}.png`;
    const nodeId = await uploadImage(request, column!.userToken, column!.homeNodeId, name);
    await waitForJob(column!.scratch, nodeId, 'embed', 'done');
    await openUserFiles(page, request, column!.userCreds);

    const body = await submitSearch(page, IMAGE_CAPTION);
    expect(Array.isArray(body.semantic)).toBe(true);
    expect(body.semantic.map((row: { node_id: number }) => row.node_id)).not.toContain(nodeId);

    await expect(page.getByTestId('search-zone-header-c')).toHaveCount(0);
    await expect(page.getByTestId(`server-search-row-${nodeId}`)).toHaveCount(0);
    await expect(page.getByTestId('search-no-results')).toBeVisible();
  });

  test('E2E-S3-AI-012 (positive): a text-only embed capability reports Embed Partial with the probe hint on System Settings', async ({
    page,
  }) => {
    await loginWithCredentials(page, TEST_USERS.admin.username, ADMIN_PASSWORD);
    await openSystemSettings(page);

    const card = page.getByTestId('backend-health-card');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText(/Embed/);
    await expect(card).toContainText(/Partial/);
    await expect(card).toContainText(/AI provider probe failed/i);
  });
});

test.describe('AI matrix UI — media column', () => {
  let column: ColumnScratch | undefined;
  let fake: FakeLlmServer | undefined;

  test.beforeAll(async ({ request }, testInfo) => {
    ensureUiBuild();
    fake = await createFakeLlmServer({ mode: 'media-capable' });
    column = await bootColumn(
      request,
      testInfo.project.name,
      'ui-media',
      { ...EMBED_SETTINGS(fake.baseUrl) },
      {
        port: SCRATCH_PORT,
        adminPassword: ADMIN_PASSWORD,
        userCreds: MEDIA_USER,
        jwtSecret: 'ai-matrix-ui-media-jwt-secret',
      }
    );
    await waitForEmbedProbeSettled(fake, 'media-capable');
    await waitForAiFlags(request, { embed: true, chat: false });
  });

  test.afterAll(async () => {
    await fake?.close();
    await shutdownColumn(column);
  });

  test('E2E-S3-AI-010 (positive): a media-capable fake makes an uploaded image findable by its fake caption in Zone C', async ({
    page,
    request,
  }) => {
    const name = `garden-${stamp()}.png`;
    const nodeId = await uploadImage(request, column!.userToken, column!.homeNodeId, name);
    await waitForJob(column!.scratch, nodeId, 'embed', 'done');
    await openUserFiles(page, request, column!.userCreds);

    const body = await submitSearch(page, IMAGE_CAPTION);
    expect(body.semantic.map((row: { node_id: number }) => row.node_id)).toContain(nodeId);
    await expect(page.getByTestId('search-zone-header-c')).toBeVisible();
    await expect(page.getByTestId(`server-search-row-${nodeId}`)).toBeVisible();
    await expect(page.getByTestId('search-zone-header-a')).toHaveCount(0);
    await expect(page.getByTestId('search-zone-header-b')).toHaveCount(0);
  });

  test('E2E-S3-AI-012 (negative): a media-capable embed capability leaves no Embed warning row on System Settings', async ({
    page,
  }) => {
    await loginWithCredentials(page, TEST_USERS.admin.username, ADMIN_PASSWORD);
    const healthLoaded = page.waitForResponse(
      (res) => new URL(res.url()).pathname === '/api/admin/health',
      { timeout: 60_000 }
    );
    await openSystemSettings(page);
    await healthLoaded;
    await expect(page.getByTestId('backend-health-card')).toHaveCount(0);
  });
});

test.describe('AI matrix UI — parser column', () => {
  let column: ColumnScratch | undefined;
  let fake: FakeLlmServer | undefined;

  test.beforeAll(async ({ request }, testInfo) => {
    ensureUiBuild();
    fake = await createFakeLlmServer({ mode: 'text-only', chatParseMode: 'parse-ok' });
    column = await bootColumn(
      request,
      testInfo.project.name,
      'ui-parser',
      { ...EMBED_SETTINGS(fake.baseUrl), ...CHAT_SETTINGS(fake.baseUrl) },
      {
        port: SCRATCH_PORT,
        adminPassword: ADMIN_PASSWORD,
        userCreds: PARSER_USER,
        jwtSecret: 'ai-matrix-ui-parser-jwt-secret',
      }
    );
    await waitForEmbedProbeSettled(fake, 'text-only');
    await waitForChatProbeSettled(fake);
    await waitForAiFlags(request, { embed: true, chat: true });
  });

  test.afterAll(async () => {
    await fake?.close();
    await shutdownColumn(column);
  });

  test('E2E-S3-AI-011: parsed predicate atoms ride the search response without altering the name section, AI_NL_PARSE_ENABLED=false returns the parser-free shape, and no predicate/delta chips render', async ({
    page,
    request,
  }) => {
    const suffix = stamp();
    const folderId = await createFolderAt(
      request,
      column!.userToken,
      column!.homeNodeId,
      `parser-corpus-${suffix}`
    );

    const firstId = await uploadText(
      request,
      column!.userToken,
      folderId,
      `${PARSER_QUERY}-one.txt`,
      'first parser corpus note'
    );
    const secondId = await uploadText(
      request,
      column!.userToken,
      folderId,
      `${PARSER_QUERY}-two.txt`,
      'second parser corpus note'
    );
    // The current folder is the user root; the corpus lives in the subfolder,
    // so the name matches arrive as Zone B server rows.
    await openUserFiles(page, request, column!.userCreds);

    // Parser ON: the fake returns canonical size+date atoms on the wire. The
    // name section is computed independently of the parse (routes/search.md
    // §2.4) — both same-prefix files remain visible; the atoms are header
    // state only and never render as chips.
    const parsed = await submitSearch(page, PARSER_QUERY);
    expect(parsed.predicates).toEqual([
      { type: 'size', min: 10485760 },
      { type: 'date', withinDays: 365 },
    ]);
    expect((parsed.name_matches as Array<{ node_id: number }>).map((row) => row.node_id)).toEqual(
      [firstId, secondId].sort((a, b) => a - b)
    );
    await expect(page.getByTestId('search-zone-header-b')).toBeVisible();
    await expect(page.getByTestId(`server-search-row-${firstId}`)).toBeVisible();
    await expect(page.getByTestId(`server-search-row-${secondId}`)).toBeVisible();
    await expect(page.getByTestId('search-zone-header-a')).toHaveCount(0);
    await expectNoPredicateOrDeltaChips(page);

    // Kill switch OFF (hot admin config write): the parser-free response has
    // no `predicates` key; the committed name rows are unchanged.
    await exitResults(page);
    const off = await request.put('/api/admin/config', {
      headers: { Authorization: `Bearer ${column!.operatorToken}` },
      data: { values: { AI_NL_PARSE_ENABLED: false } },
    });
    expect(off.status()).toBe(200);

    const parserFree = await submitSearch(page, PARSER_QUERY);
    expect(parserFree.predicates).toBeUndefined();
    expect(
      (parserFree.name_matches as Array<{ node_id: number }>).map((row) => row.node_id)
    ).toEqual([firstId, secondId].sort((a, b) => a - b));
    await expect(page.getByTestId(`server-search-row-${firstId}`)).toBeVisible();
    await expect(page.getByTestId(`server-search-row-${secondId}`)).toBeVisible();
    await expectNoPredicateOrDeltaChips(page);
  });
});
