import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { APIRequestContext, expect, test } from '@playwright/test';

import {
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
import { gotoFilesPath } from './helpers/resolvePath';
import {
  ensureScratchRegularUser,
  loginScratchAdmin,
  type ScratchUserCreds,
} from './helpers/scratchUser';
import { flushPrivateWorkspaceCleanups, uploadFileAt } from './helpers/files';
import { resolveNodeId } from './helpers/resolvePath';

/**
 * E2E-AI-001 — semantic search over the embed-enabled engine
 * (docs/spec/server/routes/search.md §2.4, searchService.md §2.3): the
 * scratch server boots with the built-in embed engine pointed at the
 * PRE-SEEDED EG2 weights (`WEA_MODEL_DIR`) so boot provisioning is a
 * zero-download no-op and the embed role is configured from the first
 * request. A text document is uploaded, the embed job is awaited through the
 * `ai_jobs` drain state, and a phrase that does NOT name-match the file
 * exercises the embed leg end-to-end.
 *
 * SCRATCH-HERMETIC per the destructive-case policy (docs/TESTING_STRATEGY.md):
 * own server on the `:5016` slot (own sqlite, webdav file backend), never the
 * shared :5002 pool. The file is serial and owns the server lifecycle. The
 * actor is a provisioned REGULAR USER; the scratch admin stays OPERATOR-only
 * (provisioning + the perm-delete cleanup fallback).
 *
 * WIRE SHAPE asserted at this stage (searchService.md §2.5a): the embed leg
 * RAN — `semantic_available:true`, the `semantic` key PRESENT,
 * `result_ref` shaped `sr1.<16 hex>` — and the run is proven REAL through the
 * scratch sqlite: the `query_parses` cache row carries a 768-dim vector
 * envelope and grows its `hit_count` on the identical replay. The
 * document-in-semantic-section assertion is staged behind
 * `SCORING_LANDED`: it passes only once the scoring leg
 * (searchService.md §2.3 steps 5–6) is wired behind the `semanticScorer`
 * seam — until then the section is returned HONESTLY EMPTY
 * (`counts.semantic:0`) and scores are never fabricated.
 */

const SCRATCH_PORT = e2ePorts.scratchAi;
const CASE_ID = 'ai';
const ADMIN_PASSWORD = 'AiE2e!123';
const USER_CREDS: ScratchUserCreds = {
  username: 'ai-e2e-user',
  password: 'AiE2eUser!123',
  email: 'ai-e2e-user@e2etest.com',
};

/**
 * Pre-seeded weights root (`WEA_MODEL_DIR`). The provisioner and the ONNX
 * client both resolve the tree as `<modelDir>/<repo>/<revision>/…`, where
 * repo/revision come from the checked-in `model.lock.json` — the pre-seeded
 * directory IS that root. Absent weights ⇒ reason-carrying skip: booting
 * without them would attempt a network download, which the hermetic-scratch
 * policy forbids.
 */
const MODEL_DIR_ROOT = process.env.WEA_E2E_MODEL_DIR || '/tmp/opencode/delta-base/models';
const MODEL_LOCK_PATH = path.join(
  process.cwd(),
  'server',
  'infrastructure',
  'adapters',
  'llm',
  'model.lock.json'
);
const modelLock = JSON.parse(fs.readFileSync(MODEL_LOCK_PATH, 'utf8')) as {
  repo: string;
  revision: string;
};
const WEA_MODEL_DIR = MODEL_DIR_ROOT;

/**
 * The scoring leg lands with the `semanticScorer` seam implementation; flip
 * this together with that landing (the staged block below then polls the
 * semantic section until the uploaded document appears).
 */
const SCORING_LANDED = true;

/** Document body deliberately shares NO token with the uploaded file NAME. */
const DOC_NAME_BASIS = `quarterly-summary-${Date.now()}.txt`;
const DOC_BODY = [
  'The banana harvest festival opens the season in the riverside valley.',
  'Every autumn the community gathers for the lantern parade and the fruit market.',
  'Farmers bring crates of bananas, mangoes and cassava to the riverside stalls.',
  'The festival closes with a night market and a fireworks display over the water.',
].join('\n');
/** A phrase that appears in the BODY but nowhere in the file name. */
const SEMANTIC_PHRASE = 'banana harvest festival';

test.describe.configure({ mode: 'serial', timeout: 300_000 });

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Readonly scalar query against the scratch sqlite metadata DB. */
function scratchScalar(scratchDir: string, query: string, ...params: (string | number)[]): number {
  const db = new DatabaseSync(path.join(scratchDir, 'webdav.db'), { readOnly: true });
  try {
    const row = db.prepare(query).get(...params) as { v?: number | bigint } | undefined;
    return Number(row?.v ?? 0);
  } finally {
    db.close();
  }
}

/** Poll until the uploaded node has ONE `done` embed job (the drain signal). */
async function waitForEmbedDrain(
  scratchDir: string,
  nodeId: number,
  timeoutMs: number
): Promise<void> {
  await expect
    .poll(
      () =>
        scratchScalar(
          scratchDir,
          "SELECT COUNT(*) AS v FROM ai_jobs WHERE node_id = ? AND kind = 'embed' AND status = 'done'",
          nodeId
        ),
      { timeout: timeoutMs, intervals: [2_000, 5_000] }
    )
    .toBeGreaterThan(0);
}

async function runSearch(
  request: APIRequestContext,
  token: string,
  query: string
): Promise<Record<string, unknown>> {
  const res = await request.post('/api/search', {
    headers: auth(token),
    data: { query },
    timeout: 90_000,
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

let scratch: string;
let spawned: ReturnType<typeof spawnScratchServer> | null = null;
/** Scratch admin bearer — OPERATOR duties only (provisioning + perm-delete). */
let operatorToken = '';
let userToken = '';
let homeNodeId = 0;

test.beforeAll(async ({ request }) => {
  test.skip(
    !fs.existsSync(
      path.join(WEA_MODEL_DIR, modelLock.repo, modelLock.revision, 'onnx', 'model_q4.onnx')
    ),
    `pre-seeded EG2 weights not found under ${WEA_MODEL_DIR} — a boot without them would attempt a network download, which the hermetic-scratch policy forbids`
  );

  scratch = scratchDirFor(CASE_ID);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  writeScratchEnv(scratch, {
    PORT: String(SCRATCH_PORT),
    WEA_FILE_STORAGE: 'webdav',
    WEBDAV_UPSTREAM_URL: webdavBase,
    JWT_SECRET: 'ai-e2e-jwt-secret',
    ADMIN_DEFAULT_PASSWORD: ADMIN_PASSWORD,
    WEA_MODEL_DIR,
  });
  await seedWebdavSettings(scratch);
  await ensureWebdavSubtree(CASE_ID);
  spawned = spawnScratchServer(scratch, SCRATCH_PORT);
  await waitForScratchHealth(spawned, SCRATCH_PORT);
  operatorToken = await loginScratchAdmin(request, ADMIN_PASSWORD);
  userToken = await ensureScratchRegularUser(request, operatorToken, USER_CREDS);
  homeNodeId = await resolveNodeId(request, userToken, `/${USER_CREDS.username}`);
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
  // Case containment (admin-operator pivot): perm-delete the case workspace
  // subtree with the OPERATOR fallback token.
  await flushPrivateWorkspaceCleanups(request, operatorToken);
});

test('E2E-AI-001: a semantic search returns an uploaded document no name matches and reports the section available', async ({
  page,
  request,
}) => {
  // Upload the text document; the write-side hook enqueues its embed job.
  const nodeId = await uploadFileAt(
    request,
    userToken,
    homeNodeId,
    DOC_NAME_BASIS,
    'text/plain',
    Buffer.from(DOC_BODY, 'utf8')
  );

  // Wait for the embed job to drain (semantic search available) — observed
  // through the scratch `ai_jobs` drain state, not through wall-clock sleep.
  await waitForEmbedDrain(scratch, nodeId, 240_000);

  // A phrase that does NOT name-match the file: the name section must NOT
  // return it, while the embed leg runs on the real engine.
  const first = await runSearch(request, userToken, SEMANTIC_PHRASE);

  expect(first.semantic_available).toBe(true);
  expect(Array.isArray(first.semantic)).toBe(true);
  expect(first.semantic_unavailable_reason).toBeUndefined();
  expect(first.result_ref).toMatch(/^sr1\.[0-9a-f]{16}$/);
  expect(first.counts).toMatchObject({ semantic_capped_segments: false });

  const nameIds = (first.name_matches as Array<{ node_id: number }>).map((row) => row.node_id);
  expect(nameIds).not.toContain(nodeId);

  // The embed leg is proven REAL through the scratch `query_parses` cache
  // row: the normalized phrase carries a 768-dim envelope in the EG2 space.
  const cacheDb = new DatabaseSync(path.join(scratch, 'webdav.db'), { readOnly: true });
  let cachedRow: { hit_count: number; vector: string } | undefined;
  try {
    cachedRow = cacheDb
      .prepare('SELECT hit_count, vector FROM query_parses WHERE normalized_query = ?')
      .get(SEMANTIC_PHRASE) as { hit_count: number; vector: string } | undefined;
  } finally {
    cacheDb.close();
  }
  expect(cachedRow).toBeDefined();
  const envelope = JSON.parse(cachedRow!.vector) as { space: string; dim: number; v: number[] };
  expect(envelope.space).toMatch(/^v1\|model:.+/);
  expect(envelope.dim).toBe(768);
  expect(envelope.v).toHaveLength(768);

  // The identical replay is a cache HIT: byte-identical result_ref, zero new
  // provider embeds, and the row's hit_count grows by exactly one.
  const second = await runSearch(request, userToken, `  ${SEMANTIC_PHRASE.toUpperCase()}  `);
  expect(second.result_ref).toBe(first.result_ref);
  expect(second.semantic_available).toBe(true);

  const hitsDb = new DatabaseSync(path.join(scratch, 'webdav.db'), { readOnly: true });
  try {
    cachedRow = hitsDb
      .prepare('SELECT hit_count FROM query_parses WHERE normalized_query = ?')
      .get(SEMANTIC_PHRASE) as { hit_count: number } | undefined;
  } finally {
    hitsDb.close();
  }
  expect(Number(cachedRow!.hit_count)).toBe(1);

  if (SCORING_LANDED) {
    // The document appears in the semantic section though no name contains
    // the phrase (scores 0–1, ordered); the honest-empty stage above keeps
    // the rest of the contract green meanwhile.
    await expect
      .poll(async () => {
        const body = await runSearch(request, userToken, SEMANTIC_PHRASE);
        return (body.semantic as Array<{ node_id: number }>).some((row) => row.node_id === nodeId)
          ? nodeId
          : 0;
      })
      .toBe(nodeId);
  }

  // ZONE C UI (the results surface): the committed search renders the
  // semantic section as the suggested-results accordion zone — the
  // semantically matched document appears there although no name contains
  // the phrase (FileManagerView.md §3; the phrase was chosen to name-match
  // nothing, so Zone A/Zone B stay empty and only Zone C renders).
  await loginWithCredentials(page, USER_CREDS.username, USER_CREDS.password);
  await gotoFilesPath(page, request, `/${USER_CREDS.username}`);
  const uiSearchBox = page.getByRole('searchbox');
  const uiSearchReply = page.waitForResponse(
    (res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/search',
    { timeout: 90_000 }
  );
  await uiSearchBox.fill(SEMANTIC_PHRASE);
  await uiSearchBox.press('Enter');
  await uiSearchReply;
  await expect(page.getByTestId('search-zone-header-c')).toBeVisible();
  await expect(page.getByTestId('search-zone-header-c')).toContainText(
    /Suggested results|추천 결과/
  );
  await expect(page.getByTestId(`server-search-row-${nodeId}`)).toBeVisible();
});
