import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { APIRequestContext, expect, test, type Page } from '@playwright/test';

import { createFakeLlmServer } from './helpers/fakeLlm';
import {
  bootColumn,
  EMBED_SETTINGS,
  publicAi,
  shutdownColumn,
  waitForAiFlags,
  waitForEmbedProbeSettled,
  type ColumnScratch,
} from './helpers/aiMatrixColumn';
import { e2ePorts } from './helpers/ports';
import { loginWithCredentials } from './helpers/auth';
import { gotoFilesPath } from './helpers/resolvePath';
import { fileItem, uploadFileAt } from './helpers/files';
import { ensureClientBuild } from './helpers/setupScratch';

/**
 * E2E-S3-AI-008..009 — the browser smoke for the §4.12 LLM capability matrix.
 *
 * This suite keeps only the real-client↔real-server consequences of the None
 * and embed columns: the FAB glyph, Zone C header/rows, the save chip, and the
 * honest empty state. The API-only matrix (`e2e/ai.matrix.spec.ts`) owns the
 * wire contract. Media findability (E2E-S3-AI-010), parser/name-section
 * independence (E2E-S3-AI-011) and the admin health card (E2E-S3-AI-012) are
 * `non-e2e`: they are owned by the server join/route suites and the client
 * `SystemSettingsContent` integration test.
 *
 * Hermetic scratch, one column per capability family, browser-safe slot `:5009`
 * (`s3-ai-matrix-ui-desktop`). The slot is NOT the API-only `:5021` matrix slot:
 * band 40 maps 5021 to the browser-restricted 5061, so a page-driving project
 * there would silently fail.
 *
 * Both cases share the slot, so each test owns its column boot and teardown.
 *
 * Every column boots with fake-LLM settings injected through pre-boot scratch
 * sqlite rows (dbOnly keys), so no real provider is ever configured. Columns:
 *   None  — no LLM: magnifier glyph, name-only results, no Zone C/save;
 *   embed — fake text-only embed: wand, Zone C + save chip.
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

const QUERY = 'banana harvest festival';
const DOC_BODY = [
  'The banana harvest festival opens the season in the riverside valley.',
  'Every autumn the community gathers for the lantern parade and the fruit market.',
  'Farmers bring crates of bananas, mangoes and cassava to the riverside stalls.',
  'The festival closes with a night market and a fireworks display over the water.',
].join('\n');

let stampSeq = 0;
const stamp = () => `${Date.now()}-${(stampSeq += 1)}`;

// One shared CRA build for every column (idempotent; a filtered run that
// selects only the embed case still builds before booting its scratch server).
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

test('E2E-S3-AI-008: with no LLM configured the search FAB keeps the magnifier glyph, name results work, no Zone C or save chip renders, and a zero-match query shows the honest empty state', async ({
  page,
  request,
}, testInfo) => {
  ensureUiBuild();
  const column = await bootColumn(
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
  try {
    expect(await publicAi(request)).toEqual({ embed: false, chat: false });

    const name = `harvest-notes-${stamp()}.txt`;
    const nodeId = await uploadText(request, column.userToken, column.homeNodeId, name, DOC_BODY);
    await openUserFiles(page, request, column.userCreds);

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

    // Zero-match query: no zone headers at all, only the honest empty line.
    const emptyBody = await submitSearch(page, `pluvio-${stamp()}`);
    expect(emptyBody.semantic).toBeUndefined();
    await expect(page.getByTestId('search-no-results')).toBeVisible();
    await expect(page.getByTestId('search-zone-header-a')).toHaveCount(0);
    await expect(page.getByTestId('search-zone-header-b')).toHaveCount(0);
    await expect(page.getByTestId('search-zone-header-c')).toHaveCount(0);
  } finally {
    await shutdownColumn(column);
  }
});

test('E2E-S3-AI-009: the embed column renders the wand glyph, Zone C header/rows and the save chip, while a non-matching query has no name section', async ({
  page,
  request,
}, testInfo) => {
  ensureUiBuild();
  const fake = await createFakeLlmServer({ mode: 'text-only' });
  let column: ColumnScratch | undefined;
  try {
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

    const name = `semantic-note-${stamp()}.txt`;
    const nodeId = await uploadText(request, column.userToken, column.homeNodeId, name, DOC_BODY);
    await waitForJob(column.scratch, nodeId, 'embed', 'done');
    await openUserFiles(page, request, column.userCreds);

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
  } finally {
    await fake.close();
    await shutdownColumn(column);
  }
});
