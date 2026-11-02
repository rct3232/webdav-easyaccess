import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { APIRequestContext, expect, test } from '@playwright/test';

import { createFakeLlmServer, IMAGE_CAPTION } from './helpers/fakeLlm';
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
import { type ScratchUserCreds } from './helpers/scratchUser';
import { readTestFileFixture, uploadFileAt } from './helpers/files';
import { TEST_FILES } from './fixtures/test-data';

/**
 * E2E-S3-AI-003/006 — the process-level composition cases for the §4.12
 * capability matrix.
 *
 * API-ONLY by design: the project (`s3-ai-matrix-api`, scratch slot 5021)
 * uses `APIRequestContext` + direct sqlite reads and never touches `page`.
 *
 * Each case boots and tears down its own column: both columns share slot 5021,
 * so a single file-level `beforeAll` cannot own the boot.
 *
 * Why these two: they are the cases that exercise the production composition
 * root (boot-time dbOnly config → adapter install → one-shot probe → worker
 * loop → upload → embeddings) rather than a branch that a test can inject.
 * The None column pins the "no adapter" state (worker enabled, job parked, no
 * row); the media column pins the positive chain (probe → `media_direct` →
 * caption search hit).
 *
 * The remaining matrix legs are `non-e2e` and live in the server suites:
 * parser/cache/delta → `domains/ai/__tests__/search.test.js` (+
 * `searchService.test.js`); text-embed semantic/replay →
 * `searchService.test.js` plus this suite's AI-006 search leg; V0 →
 * `mediaSearchJoin.test.js` + `embedMediaPipeline.test.js`; V2 →
 * `captionPipeline.test.js` + `mediaDrainIntegration.test.js`.
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

const DOC_BODY = [
  'The banana harvest festival opens the season in the riverside valley.',
  'Every autumn the community gathers for the lantern parade and the fruit market.',
  'Farmers bring crates of bananas, mangoes and cassava to the riverside stalls.',
  'The festival closes with a night market and a fireworks display over the water.',
].join('\n');
const IMAGE_BYTES = readTestFileFixture(TEST_FILES.smallImage);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

interface SearchBody {
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

test("E2E-S3-AI-003: with no LLM configured public AI flags stay false, and an uploaded document's embed job parks at attempt 0 with no embeddings row", async ({
  request,
}, testInfo) => {
  const column = await boot(request, testInfo.project.name, 'none', {});
  try {
    expect(await publicAi(request)).toEqual({ embed: false, chat: false });
    expect(scratchScalar(column.scratch, 'SELECT COUNT(*) AS v FROM llm_models')).toBe(0);

    const nodeId = await uploadText(
      request,
      column.userToken,
      column.homeNodeId,
      `no-llm-${Date.now()}.txt`,
      DOC_BODY
    );

    await expect
      .poll(
        () =>
          scratchScalar(
            column.scratch,
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
      column.scratch,
      "SELECT status, attempt FROM ai_jobs WHERE node_id = ? AND kind = 'embed'",
      nodeId
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('pending');
    expect(Number(jobs[0].attempt)).toBe(0);
    expect(
      scratchScalar(
        column.scratch,
        'SELECT COUNT(*) AS v FROM embeddings WHERE node_id = ?',
        nodeId
      )
    ).toBe(0);
  } finally {
    await shutdownColumn(column);
  }
});

test('E2E-S3-AI-006: a media-capable fake embed drives an image through media_direct and finds it by its caption in semantic search', async ({
  request,
}, testInfo) => {
  const fake = await createFakeLlmServer({ mode: 'media-capable' });
  let column: ColumnScratch | undefined;
  try {
    column = await boot(request, testInfo.project.name, 'media', {
      ...EMBED_SETTINGS(fake.baseUrl),
    });
    await waitForEmbedProbeSettled(fake, 'media-capable');
    expect(fake.counters.kitCalls).toBeGreaterThan(0);
    await waitForAiFlags(request, { embed: true, chat: false });

    fake.resetCounters();
    const nodeId = await uploadImage(
      request,
      column.userToken,
      column.homeNodeId,
      `direct-image-${Date.now()}.jpg`
    );
    await waitForJob(column.scratch, nodeId, 'embed', 'done');

    const pooled = scratchRows<{ source: string; dim: number }>(
      column.scratch,
      'SELECT source, dim FROM embeddings WHERE node_id = ?',
      nodeId
    );
    expect(pooled).toHaveLength(1);
    expect(pooled[0]).toMatchObject({ source: 'media_direct', dim: 768 });
    expect(fake.counters.mediaCalls).toBeGreaterThan(0);
    expect(
      scratchScalar(
        column.scratch,
        'SELECT COUNT(*) AS v FROM embeddings_chunk WHERE node_id = ?',
        nodeId
      )
    ).toBeGreaterThan(0);

    // The fake image direction is the caption text direction: the real search
    // route must surface the uploaded image in the semantic section.
    await expect
      .poll(
        async () => {
          const body = await runSearch(request, column!.userToken, IMAGE_CAPTION);
          return (body.semantic ?? []).some((row) => Number(row.node_id) === nodeId);
        },
        { timeout: 30_000, intervals: [500, 1000] }
      )
      .toBe(true);
  } finally {
    await fake.close();
    await shutdownColumn(column);
  }
});
