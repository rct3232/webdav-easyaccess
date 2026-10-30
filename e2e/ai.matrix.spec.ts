import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { APIRequestContext, expect, test } from '@playwright/test';

import {
  createFakeLlmServer,
  FAKE_PARSE_DELTA_MIN_BYTES,
  type FakeLlmServer,
} from './helpers/fakeLlm';
import {
  bootColumn,
  CHAT_SETTINGS,
  EMBED_SETTINGS,
  publicAi,
  shutdownColumn,
  VISION_SETTINGS,
  waitForAiFlags,
  waitForChatProbeSettled,
  waitForEmbedProbeSettled,
  waitForVisionProbeSettled,
  type ColumnScratch,
} from './helpers/aiMatrixColumn';
import { e2ePorts } from './helpers/ports';
import { type ScratchUserCreds } from './helpers/scratchUser';
import { readTestFileFixture, uploadFileAt } from './helpers/files';
import { TEST_FILES } from './fixtures/test-data';

/**
 * E2E-S3-AI-002..007 — the §4.12 LLM capability degradation matrix plus the
 * `parse.nl` / §4.22 delta parser leg (T4.3 Wave 2) over the in-process fake
 * LLM harness.
 *
 * API-ONLY by design: the project (`s3-ai-matrix-desktop`, scratch slot 5021)
 * uses `APIRequestContext` + direct sqlite reads and never touches `page`.
 * Band 40 maps 5021 to the browser-restricted 5061; an API-only project is
 * immune to that restriction.
 *
 * One top-level describe per capability column, each with its own scratch
 * server lifecycle, scratch directory, and S3 bucket:
 *   None               — no LLM settings, built-in suppressed, worker enabled;
 *   embed              — fake text-only embed (semantic + V0 metadata_only);
 *   embed+media        — fake media-capable embed (image media_direct);
 *   embed+chat+vision  — fake embed + chat + vision (V2 caption → E1 chain);
 *   embed+chat parser  — fake embed + chat: AI-002 parse cache, kill switch,
 *                        invalid-output fallback, and the §4.22 delta leg.
 *
 * The fake endpoint is injected through pre-boot scratch sqlite `settings`
 * rows (`LLM_*` are dbOnly), so ambient env can never select a real provider.
 * `WEA_SKIP_AI_WORKER` is stripped from the child env by the scratch helper
 * and never set to '0'; `WEA_SKIP_EMBED_MODEL=1` suppresses only the built-in
 * engine (a remote fake override still takes precedence).
 */

const SCRATCH_PORT = e2ePorts.scratchAiMatrix;
const ADMIN_PASSWORD = 'AiMatrix!123';
const USER_CREDS: ScratchUserCreds = {
  username: 'ai-matrix-user',
  password: 'AiMatrixUser!123',
  email: 'ai-matrix-user@e2etest.com',
};

const QUERY = 'banana harvest festival';
const DOC_BODY = [
  'The banana harvest festival opens the season in the riverside valley.',
  'Every autumn the community gathers for the lantern parade and the fruit market.',
  'Farmers bring crates of bananas, mangoes and cassava to the riverside stalls.',
  'The festival closes with a night market and a fireworks display over the water.',
].join('\n');
const IMAGE_BYTES = readTestFileFixture(TEST_FILES.smallImage);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

type PredicateAtom = Record<string, unknown>;

interface DeltaInstruction {
  add: PredicateAtom[];
  replace: PredicateAtom[];
  exclude: PredicateAtom[];
  exclude_similar: boolean;
  $ref: 'latest' | null;
}

interface SearchBody {
  name_matches: Array<{ node_id: number; name: string }>;
  semantic?: Array<{ node_id: number; name: string; score: number }>;
  result_ref: string;
  counts: { name: number; semantic: number; total: number };
  semantic_unavailable_reason?: string;
  predicates?: PredicateAtom[];
  delta?: DeltaInstruction;
  session_predicates?: PredicateAtom[];
}

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

function scratchRows<T>(scratchDir: string, query: string, ...params: Array<string | number>): T[] {
  const db = new DatabaseSync(path.join(scratchDir, 'webdav.db'), { readOnly: true });
  try {
    return db.prepare(query).all(...params) as T[];
  } finally {
    db.close();
  }
}

/** This suite's API-only columns all share scratch slot `:5021`. */
function boot(
  request: APIRequestContext,
  projectName: string,
  column: string,
  settings: Record<string, string>
): Promise<ColumnScratch> {
  return bootColumn(request, projectName, column, settings, {
    port: SCRATCH_PORT,
    adminPassword: ADMIN_PASSWORD,
    userCreds: USER_CREDS,
    jwtSecret: 'ai-matrix-jwt-secret',
  });
}

/**
 * Hot T2 config write through the admin API (resolver cache invalidated by the
 * route, so the next search observes the value — no TTL wait).
 */
async function setT2Config(
  request: APIRequestContext,
  operatorToken: string,
  key: string,
  value: string | boolean
): Promise<void> {
  const res = await request.put('/api/admin/config', {
    headers: auth(operatorToken),
    data: { values: { [key]: value } },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { applied: string[] };
  expect(body.applied).toContain(key);
}

/** Read the stored `query_parses.predicates` cell for the normalized query. */
function readParseCell(scratchDir: string, normalizedQuery: string): unknown {
  const rows = scratchRows<{ predicates: string }>(
    scratchDir,
    'SELECT predicates FROM query_parses WHERE normalized_query = ?',
    normalizedQuery
  );
  expect(rows).toHaveLength(1);
  return JSON.parse(rows[0].predicates);
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

async function runSearch(
  request: APIRequestContext,
  token: string,
  query: string,
  resultRef?: string
): Promise<SearchBody> {
  const res = await request.post('/api/search', {
    headers: auth(token),
    data: { query, ...(resultRef ? { result_ref: resultRef } : {}) },
    timeout: 90_000,
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as SearchBody;
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

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.describe('degradation matrix — None column', () => {
  let column: ColumnScratch | undefined;

  test.beforeAll(async ({ request }, testInfo) => {
    column = await boot(request, testInfo.project.name, 'none', {});
  });

  test.afterAll(async () => {
    await shutdownColumn(column);
  });

  test('E2E-S3-AI-003: with no LLM configured the semantic section is absent, public AI flags stay false, and embed jobs park at attempt 0', async ({
    request,
  }) => {
    expect(await publicAi(request)).toEqual({ embed: false, chat: false });
    expect(scratchScalar(column!.scratch, 'SELECT COUNT(*) AS v FROM llm_models')).toBe(0);

    const nodeId = await uploadText(
      request,
      column!.userToken,
      column!.homeNodeId,
      `no-llm-${Date.now()}.txt`,
      DOC_BODY
    );

    await expect
      .poll(
        () =>
          scratchScalar(
            column!.scratch,
            "SELECT COUNT(*) AS v FROM ai_jobs WHERE node_id = ? AND kind = 'embed'",
            nodeId
          ),
        { timeout: 30_000, intervals: [100, 250] }
      )
      .toBe(1);

    // The worker is enabled (the scratch child env strips WEA_SKIP_AI_WORKER);
    // the unconfigured embed role parks the job. Two+ poll intervals prove no
    // claim happened, and attempt stays 0 (no inflation).
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const jobs = scratchRows<{ status: string; attempt: number }>(
      column!.scratch,
      "SELECT status, attempt FROM ai_jobs WHERE node_id = ? AND kind = 'embed'",
      nodeId
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('pending');
    expect(Number(jobs[0].attempt)).toBe(0);
    expect(
      scratchScalar(
        column!.scratch,
        'SELECT COUNT(*) AS v FROM embeddings WHERE node_id = ?',
        nodeId
      )
    ).toBe(0);

    const body = await runSearch(request, column!.userToken, QUERY);
    expect(body.semantic).toBeUndefined();
    expect(body.semantic_unavailable_reason).toBe('not_configured');
    expect(body.result_ref).toMatch(/^sr1\.[0-9a-f]{16}$/);
    expect(body.counts.semantic).toBe(0);
  });
});

test.describe('degradation matrix — embed column', () => {
  let column: ColumnScratch | undefined;
  let fake: FakeLlmServer | undefined;

  test.beforeAll(async ({ request }, testInfo) => {
    fake = await createFakeLlmServer({ mode: 'text-only' });
    column = await boot(request, testInfo.project.name, 'embed', {
      ...EMBED_SETTINGS(fake.baseUrl),
    });
    await waitForEmbedProbeSettled(fake, 'text-only');
    expect(fake.counters.kitCalls).toBeGreaterThan(0);
    await waitForAiFlags(request, { embed: true, chat: false });
  });

  test.afterAll(async () => {
    await fake?.close();
    await shutdownColumn(column);
  });

  test('E2E-S3-AI-004: the fake text-only embed runs semantic search, embeds the document, and replays the query with zero extra embed calls', async ({
    request,
  }) => {
    fake!.resetCounters();
    const nodeId = await uploadText(
      request,
      column!.userToken,
      column!.homeNodeId,
      `embed-doc-${Date.now()}.txt`,
      DOC_BODY
    );
    await waitForJob(column!.scratch, nodeId, 'embed', 'done');

    const pooled = scratchRows<{ source: string; dim: number }>(
      column!.scratch,
      'SELECT source, dim FROM embeddings WHERE node_id = ?',
      nodeId
    );
    expect(pooled).toHaveLength(1);
    expect(pooled[0]).toMatchObject({ source: 'chunk_pool', dim: 768 });
    expect(fake!.counters.embedCalls).toBeGreaterThan(0);

    const first = await runSearch(request, column!.userToken, QUERY);
    expect(first.semantic_unavailable_reason).toBeUndefined();
    expect(Array.isArray(first.semantic)).toBe(true);
    expect(first.result_ref).toMatch(/^sr1\.[0-9a-f]{16}$/);

    await expect
      .poll(
        async () => {
          const body = await runSearch(request, column!.userToken, QUERY);
          return (body.semantic ?? []).some((row) => Number(row.node_id) === nodeId);
        },
        { timeout: 30_000, intervals: [500, 1000] }
      )
      .toBe(true);

    const embedCallsBeforeReplay = fake!.counters.embedCalls;
    const replay = await runSearch(request, column!.userToken, `  ${QUERY.toUpperCase()}  `);
    expect(replay.result_ref).toBe(first.result_ref);
    expect(fake!.counters.embedCalls).toBe(embedCallsBeforeReplay);
  });

  test('E2E-S3-AI-005: with media capabilities absent an image falls back to the V0 metadata-only floor', async ({
    request,
  }) => {
    fake!.resetCounters();
    const nodeId = await uploadImage(
      request,
      column!.userToken,
      column!.homeNodeId,
      `metadata-image-${Date.now()}.jpg`
    );
    await waitForJob(column!.scratch, nodeId, 'embed', 'done');

    const pooled = scratchRows<{ source: string; dim: number }>(
      column!.scratch,
      'SELECT source, dim FROM embeddings WHERE node_id = ?',
      nodeId
    );
    expect(pooled).toHaveLength(1);
    expect(pooled[0]).toMatchObject({ source: 'metadata_only', dim: 768 });
    expect(fake!.counters.mediaCalls).toBe(0);
  });
});

test.describe('degradation matrix — embed+media column', () => {
  let column: ColumnScratch | undefined;
  let fake: FakeLlmServer | undefined;

  test.beforeAll(async ({ request }, testInfo) => {
    fake = await createFakeLlmServer({ mode: 'media-capable' });
    column = await boot(request, testInfo.project.name, 'media', {
      ...EMBED_SETTINGS(fake.baseUrl),
    });
    await waitForEmbedProbeSettled(fake, 'media-capable');
    expect(fake.counters.kitCalls).toBeGreaterThan(0);
    await waitForAiFlags(request, { embed: true, chat: false });
  });

  test.afterAll(async () => {
    await fake?.close();
    await shutdownColumn(column);
  });

  test('E2E-S3-AI-006: a media-capable fake embed drives the image through the direct media path', async ({
    request,
  }) => {
    fake!.resetCounters();
    const nodeId = await uploadImage(
      request,
      column!.userToken,
      column!.homeNodeId,
      `direct-image-${Date.now()}.jpg`
    );
    await waitForJob(column!.scratch, nodeId, 'embed', 'done');

    const pooled = scratchRows<{ source: string; dim: number }>(
      column!.scratch,
      'SELECT source, dim FROM embeddings WHERE node_id = ?',
      nodeId
    );
    expect(pooled).toHaveLength(1);
    expect(pooled[0]).toMatchObject({ source: 'media_direct', dim: 768 });
    expect(fake!.counters.mediaCalls).toBeGreaterThan(0);
    expect(
      scratchScalar(
        column!.scratch,
        'SELECT COUNT(*) AS v FROM embeddings_chunk WHERE node_id = ?',
        nodeId
      )
    ).toBeGreaterThan(0);
  });
});

test.describe('degradation matrix — embed+chat+vision column', () => {
  let column: ColumnScratch | undefined;
  let fake: FakeLlmServer | undefined;

  test.beforeAll(async ({ request }, testInfo) => {
    fake = await createFakeLlmServer({ mode: 'text-only' });
    column = await boot(request, testInfo.project.name, 'vision', {
      ...EMBED_SETTINGS(fake.baseUrl),
      ...CHAT_SETTINGS(fake.baseUrl),
      ...VISION_SETTINGS(fake.baseUrl),
    });
    await waitForEmbedProbeSettled(fake, 'text-only');
    expect(fake.counters.kitCalls).toBeGreaterThan(0);
    await waitForVisionProbeSettled(fake);
    await waitForAiFlags(request, { embed: true, chat: true });
  });

  test.afterAll(async () => {
    await fake?.close();
    await shutdownColumn(column);
  });

  test('E2E-S3-AI-007: with media embedding absent the fake VLM caption feeds the chained text embed (V2 fallback)', async ({
    request,
  }) => {
    fake!.resetCounters();
    const nodeId = await uploadImage(
      request,
      column!.userToken,
      column!.homeNodeId,
      `caption-image-${Date.now()}.jpg`
    );

    await waitForJob(column!.scratch, nodeId, 'caption', 'done');
    await waitForJob(column!.scratch, nodeId, 'embed', 'done');

    const enrichments = scratchRows<{ caption: string | null }>(
      column!.scratch,
      'SELECT caption FROM ai_enrichments WHERE node_id = ?',
      nodeId
    );
    expect(enrichments).toHaveLength(1);
    expect(String(enrichments[0].caption ?? '').trim().length).toBeGreaterThan(0);

    const pooled = scratchRows<{ source: string; dim: number }>(
      column!.scratch,
      'SELECT source, dim FROM embeddings WHERE node_id = ?',
      nodeId
    );
    expect(pooled).toHaveLength(1);
    expect(pooled[0]).toMatchObject({ source: 'chunk_pool', dim: 768 });
    expect(fake!.counters.visionCalls).toBeGreaterThan(0);
  });
});

test.describe('parser delta leg — fake embed+chat', () => {
  let column: ColumnScratch | undefined;
  let fake: FakeLlmServer | undefined;

  test.beforeAll(async ({ request }, testInfo) => {
    fake = await createFakeLlmServer({ mode: 'text-only', chatParseMode: 'parse-ok' });
    column = await boot(request, testInfo.project.name, 'parser', {
      ...EMBED_SETTINGS(fake.baseUrl),
      ...CHAT_SETTINGS(fake.baseUrl),
    });
    await waitForEmbedProbeSettled(fake, 'text-only');
    expect(fake.counters.kitCalls).toBeGreaterThan(0);
    await waitForChatProbeSettled(fake);
    await waitForAiFlags(request, { embed: true, chat: true });
  });

  test.afterAll(async () => {
    await fake?.close();
    await shutdownColumn(column);
  });

  test('E2E-S3-AI-002: a parsed NL search caches its canonical atoms with zero replay chat calls, degrades silently on the kill switch and invalid output, and replays a $ref delta under the current ACL', async ({
    request,
  }) => {
    const token = column!.userToken;
    const scratch = column!.scratch;
    const stamp = Date.now();

    // Three documents so the delta/fallback queries have a deterministic,
    // fully name-matched corpus (semantic rows dedup to empty in both the
    // parser-free and invalid-output responses). Only the keep document is
    // above the fake delta size floor.
    const corpusToken = `harvestnotes${stamp}`;
    const largeBody = DOC_BODY.repeat(20);
    const smallBody = 'small harvest note';
    const keepNodeId = await uploadText(
      request,
      token,
      column!.homeNodeId,
      `${corpusToken}-keep.txt`,
      largeBody
    );
    const dropNodeId = await uploadText(
      request,
      token,
      column!.homeNodeId,
      `${corpusToken}-drop.txt`,
      smallBody
    );
    const invalidNodeId = await uploadText(
      request,
      token,
      column!.homeNodeId,
      `${corpusToken}-invalid.txt`,
      smallBody
    );
    for (const nodeId of [keepNodeId, dropNodeId, invalidNodeId]) {
      await waitForJob(scratch, nodeId, 'embed', 'done');
    }
    fake!.resetCounters();

    // (a) Parser-on first search: canonical predicates on the wire, the nl1
    // envelope in query_parses.predicates, one chat call, no error.
    const parserQuery = 'pdfs from last year over 10mb';
    const expectedAtoms: PredicateAtom[] = [
      { type: 'size', min: 10485760 },
      { type: 'date', withinDays: 365 },
    ];
    const first = await runSearch(request, token, parserQuery);
    expect(first.predicates).toEqual(expectedAtoms);
    expect(first.delta).toBeUndefined();
    expect(first.session_predicates).toBeUndefined();
    expect(first.result_ref).toMatch(/^sr1\.[0-9a-f]{16}$/);
    expect(fake!.counters.chatCalls).toBe(1);
    expect(readParseCell(scratch, parserQuery)).toEqual({
      grammar: 'nl1',
      atoms: expectedAtoms,
      vectorQuery: null,
    });

    // (b) Cache replay (case/whitespace variation normalizes to the same key):
    // same signature, zero additional chat or embed calls, cache hit recorded.
    const chatBeforeReplay = fake!.counters.chatCalls;
    const embedBeforeReplay = fake!.counters.embedCalls;
    const replay = await runSearch(request, token, `  ${parserQuery.toUpperCase()}  `);
    expect(replay.predicates).toEqual(first.predicates);
    expect(replay.result_ref).toBe(first.result_ref);
    expect(fake!.counters.chatCalls).toBe(chatBeforeReplay);
    expect(fake!.counters.embedCalls).toBe(embedBeforeReplay);
    expect(
      scratchRows<{ hit_count: number }>(
        scratch,
        'SELECT hit_count FROM query_parses WHERE normalized_query = ?',
        parserQuery
      )[0].hit_count
    ).toBe(1);

    // (c) Kill switch off: parser-free shape, zero parse calls.
    await setT2Config(request, column!.operatorToken, 'AI_NL_PARSE_ENABLED', false);
    const chatBeforeKillSwitch = fake!.counters.chatCalls;
    const parserFree = await runSearch(request, token, corpusToken);
    expect(parserFree.predicates).toBeUndefined();
    expect(parserFree.delta).toBeUndefined();
    expect(parserFree.session_predicates).toBeUndefined();
    expect(fake!.counters.chatCalls).toBe(chatBeforeKillSwitch);
    expect(parserFree.name_matches.map((row) => Number(row.node_id)).sort()).toEqual(
      [keepNodeId, dropNodeId, invalidNodeId].sort()
    );

    // (d) Invalid fake output with the switch back on: byte-identical
    // parser-free response and no parse envelope write (row keeps the []).
    await setT2Config(request, column!.operatorToken, 'AI_NL_PARSE_ENABLED', true);
    fake!.setChatParseMode('parse-invalid');
    const chatBeforeInvalid = fake!.counters.chatCalls;
    const invalid = await runSearch(request, token, corpusToken);
    expect(invalid).toEqual(parserFree);
    expect(JSON.stringify(invalid)).toBe(JSON.stringify(parserFree));
    expect(fake!.counters.chatCalls).toBe(chatBeforeInvalid + 1);
    expect(readParseCell(scratch, corpusToken)).toEqual([]);

    // (e) §4.22 delta leg: the fake chat supplies $ref:"latest" + a size
    // filter on the follow-up utterance; the base is re-executed under the
    // current ACL and filtered deterministically.
    fake!.setChatParseMode('parse-ok');
    const base = await runSearch(request, token, corpusToken);
    expect(base.result_ref).toMatch(/^sr1\.[0-9a-f]{16}$/);
    expect(base.name_matches.map((row) => Number(row.node_id)).sort()).toEqual(
      [keepNodeId, dropNodeId, invalidNodeId].sort()
    );

    fake!.setChatParseMode('parse-delta');
    const deltaQuery = `only the ones over ${FAKE_PARSE_DELTA_MIN_BYTES} bytes ${stamp}`;
    const delta = await runSearch(request, token, deltaQuery, base.result_ref);
    const expectedDeltaAtom = { type: 'size', min: FAKE_PARSE_DELTA_MIN_BYTES };
    expect(delta.delta).toEqual({
      add: [expectedDeltaAtom],
      replace: [],
      exclude: [],
      exclude_similar: false,
      $ref: 'latest',
    });
    expect(delta.session_predicates).toEqual([expectedDeltaAtom]);
    expect(delta.predicates).toEqual([]);
    expect(delta.result_ref).toMatch(/^sr1\.[0-9a-f]{16}$/);
    expect(delta.result_ref).not.toBe(base.result_ref);
    expect(delta.name_matches.map((row) => Number(row.node_id))).toEqual([keepNodeId]);

    // Deterministic replay: the cached delta envelope + registry material
    // reproduce the same ref and rows with zero extra chat/embed calls.
    const chatBeforeDeltaReplay = fake!.counters.chatCalls;
    const embedBeforeDeltaReplay = fake!.counters.embedCalls;
    const deltaReplay = await runSearch(request, token, deltaQuery, base.result_ref);
    expect(deltaReplay.delta).toEqual(delta.delta);
    expect(deltaReplay.session_predicates).toEqual(delta.session_predicates);
    expect(deltaReplay.result_ref).toBe(delta.result_ref);
    expect(deltaReplay.name_matches.map((row) => Number(row.node_id))).toEqual([keepNodeId]);
    expect(fake!.counters.chatCalls).toBe(chatBeforeDeltaReplay);
    expect(fake!.counters.embedCalls).toBe(embedBeforeDeltaReplay);
  });
});
