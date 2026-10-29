import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import { APIRequestContext, expect, test } from '@playwright/test';

import { createFakeLlmServer, type FakeLlmMode, type FakeLlmServer } from './helpers/fakeLlm';
import { seedScratchSettings } from './helpers/scratchSettings';
import {
  killScratch,
  prepareScratchS3,
  s3ScratchEnv,
  scratchDirFor,
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
import { resolveNodeId } from './helpers/resolvePath';
import { readTestFileFixture, uploadFileAt } from './helpers/files';
import { TEST_FILES } from './fixtures/test-data';

/**
 * E2E-S3-AI-003..007 — the §4.12 LLM capability degradation matrix (T4.3
 * Wave 1) over the in-process fake LLM harness.
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
 *   embed+chat+vision  — fake embed + chat + vision (V2 caption → E1 chain).
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

const WORKER_SETTINGS = { AI_WORKER_POLL_MS: '500' };
const EMBED_SETTINGS = (baseUrl: string) => ({
  LLM_EMBED_BASE_URL: baseUrl,
  LLM_EMBED_API_KEY: 'sk-fake-embed',
  LLM_EMBED_MODEL: 'embeddinggemma-2',
});
const CHAT_SETTINGS = (baseUrl: string) => ({
  LLM_CHAT_BASE_URL: baseUrl,
  LLM_CHAT_API_KEY: 'sk-fake-chat',
  LLM_CHAT_MODEL: 'gemma-4-12b-it',
});
const VISION_SETTINGS = (baseUrl: string) => ({
  LLM_VISION_BASE_URL: baseUrl,
  LLM_VISION_API_KEY: 'sk-fake-vision',
  LLM_VISION_MODEL: 'gemma-4-12b-it',
});

const QUERY = 'banana harvest festival';
const DOC_BODY = [
  'The banana harvest festival opens the season in the riverside valley.',
  'Every autumn the community gathers for the lantern parade and the fruit market.',
  'Farmers bring crates of bananas, mangoes and cassava to the riverside stalls.',
  'The festival closes with a night market and a fireworks display over the water.',
].join('\n');
const IMAGE_BYTES = readTestFileFixture(TEST_FILES.smallImage);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

interface ColumnScratch {
  scratch: string;
  child: ChildProcess;
  userToken: string;
  homeNodeId: number;
}

interface SearchBody {
  name_matches: Array<{ node_id: number; name: string }>;
  semantic?: Array<{ node_id: number; name: string; score: number }>;
  result_ref: string;
  counts: { name: number; semantic: number; total: number };
  semantic_unavailable_reason?: string;
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

async function bootColumn(
  request: APIRequestContext,
  projectName: string,
  column: string,
  settings: Record<string, string>
): Promise<ColumnScratch> {
  const scratch = scratchDirFor(`ai-matrix-${column}`, projectName);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  const bucket = await prepareScratchS3(projectName, `e2e-ai-matrix-${column}`);
  writeScratchEnv(scratch, {
    PORT: String(SCRATCH_PORT),
    ...s3ScratchEnv(bucket),
    JWT_SECRET: 'ai-matrix-jwt-secret',
    ADMIN_DEFAULT_PASSWORD: ADMIN_PASSWORD,
    WEA_SKIP_EMBED_MODEL: '1',
  });
  seedScratchSettings(scratch, { ...WORKER_SETTINGS, ...settings });
  const child = spawnScratchServer(scratch, SCRATCH_PORT);
  await waitForScratchHealth(child, SCRATCH_PORT);
  const operatorToken = await loginScratchAdmin(request, ADMIN_PASSWORD);
  const userToken = await ensureScratchRegularUser(request, operatorToken, USER_CREDS);
  const homeNodeId = await resolveNodeId(request, userToken, `/${USER_CREDS.username}`);
  return { scratch, child, userToken, homeNodeId };
}

async function shutdownColumn(column: ColumnScratch | undefined): Promise<void> {
  if (!column) return;
  await killScratch(column.child);
  fs.rmSync(column.scratch, { recursive: true, force: true });
}

async function publicAi(request: APIRequestContext): Promise<{ embed: boolean; chat: boolean }> {
  const res = await request.get('/api/settings/public');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ai: { embed: boolean; chat: boolean } };
  return body.ai;
}

async function waitForAiFlags(
  request: APIRequestContext,
  expected: { embed: boolean; chat: boolean }
): Promise<void> {
  await expect
    .poll(
      async () => {
        const ai = await publicAi(request);
        return `${ai.embed}/${ai.chat}`;
      },
      { timeout: 60_000, intervals: [200, 500] }
    )
    .toBe(`${expected.embed}/${expected.chat}`);
}

/** Wait until the one-shot activation probe has made its media calls. */
async function waitForEmbedProbeSettled(fake: FakeLlmServer, mode: FakeLlmMode): Promise<void> {
  const minimum = mode === 'media-capable' ? 6 : 4;
  await expect
    .poll(() => fake.counters.mediaCalls, { timeout: 60_000, intervals: [100, 250] })
    .toBeGreaterThanOrEqual(minimum);
  // The publish follows the last probe response; give it one event-loop turn.
  await new Promise((resolve) => setTimeout(resolve, 250));
}

/**
 * Vision probe = one image-bearing caption call + one plain chat call; it
 * starts after the chat probe (one plain call). Its publish follows the
 * second chat response.
 */
async function waitForVisionProbeSettled(fake: FakeLlmServer): Promise<void> {
  await expect
    .poll(() => fake.counters.visionCalls, { timeout: 60_000, intervals: [100, 250] })
    .toBeGreaterThan(0);
  await expect
    .poll(() => fake.counters.chatCalls, { timeout: 60_000, intervals: [100, 250] })
    .toBeGreaterThanOrEqual(2);
  await new Promise((resolve) => setTimeout(resolve, 250));
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
  query: string
): Promise<SearchBody> {
  const res = await request.post('/api/search', {
    headers: auth(token),
    data: { query },
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
    column = await bootColumn(request, testInfo.project.name, 'none', {});
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
    column = await bootColumn(request, testInfo.project.name, 'embed', {
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
    column = await bootColumn(request, testInfo.project.name, 'media', {
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
    column = await bootColumn(request, testInfo.project.name, 'vision', {
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
