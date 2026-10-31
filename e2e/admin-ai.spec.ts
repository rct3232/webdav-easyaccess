import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import { APIRequestContext, expect, test, type Page } from '@playwright/test';

import { createFakeLlmServer, type FakeLlmServer } from './helpers/fakeLlm';
import { seedScratchSettings } from './helpers/scratchSettings';
import {
  ensureClientBuild,
  killScratch,
  prepareScratchS3,
  s3ScratchEnv,
  scratchDirFor,
  spawnScratchServer,
  waitForScratchHealth,
  writeScratchEnv,
} from './helpers/setupScratch';
import { e2ePorts } from './helpers/ports';
import { gotoAsAnonymous, loginWithCredentials } from './helpers/auth';
import { ensureScratchRegularUser, loginScratchAdmin } from './helpers/scratchUser';
import { resolveNodeId } from './helpers/resolvePath';
import { readTestFileFixture, uploadFileAt } from './helpers/files';
import { TEST_FILES, TEST_USERS } from './fixtures/test-data';

/**
 * E2E-ADMINAI-001..008 — the admin AI governance panel parity and launcher
 * suite (docs/spec/client/components/mypage/content/AiAdminContent.md,
 * docs/spec/server/routes/admin.md §2.2.7).
 *
 * Two Playwright projects own this file and split it with a per-project
 * `--grep` (`s3-admin-ai-model-desktop` / `E2E-ADMINAI-00[2-6]:`,
 * `s3-admin-ai-states-desktop` / `E2E-ADMINAI-00[178]:`). The split is safe
 * because `beforeEach` resets the scratch state, so declaration order is not
 * execution order for either project. Each project boots its own hermetic
 * scratch server:
 *   - model (`:5007`): fake media-capable embed injected through pre-boot
 *     settings, worker and scheduler disabled, so coverage/models/capabilities
 *     are real but the launcher leaves queued jobs for the queue/cancel legs;
 *   - states (`:5008`): no embed model, empty queue/journal/reports for the
 *     visibility, cross-link, empty and error/retry legs.
 * The former optional mobile model project was dropped (mobile admin AI is not
 * required); its `:5009` slot now hosts the browser AI degradation-matrix UI
 * project (`e2e/ai.matrix.ui.spec.ts`).
 *
 * Each case resets `ai_jobs`, `action_journal`, `AI_GEN_*`, `ai_usage_daily`
 * and `admin_reports` directly in the scratch sqlite before acting, so the
 * cases never depend on each other or on wall-clock state. The admin identity
 * is the OPERATOR; the regular user exists only for the role-visibility leg.
 */

const ADMIN_PASSWORD = 'AdminAi!123';
const USER = {
  username: 'admin-ai-user',
  password: 'AdminAiUser!123',
  email: 'admin-ai-user@e2etest.com',
};

const DOC_NAME = 'admin-ai-coverage.txt';
const IMAGE_NAME = 'admin-ai-coverage.png';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let scratch = '';
let spawned: ChildProcess | null = null;
let fake: FakeLlmServer | null = null;
let adminToken = '';
let userToken = '';
let homeNodeId = 0;
let mode: 'model' | 'states' = 'states';
let scratchPort = 0;

function scratchPath(): string {
  return path.join(scratch, 'webdav.db');
}

function scratchRows<T = Record<string, unknown>>(
  query: string,
  ...params: Array<string | number | null>
): T[] {
  const db = new DatabaseSync(scratchPath(), { readOnly: true });
  try {
    return db.prepare(query).all(...params) as T[];
  } finally {
    db.close();
  }
}

function scratchScalar(query: string, ...params: Array<string | number | null>): number {
  return Number(scratchRows<{ v: number | bigint }>(query, ...params)[0]?.v ?? 0);
}

function scratchExec(sql: string, ...params: Array<string | number | null>): void {
  const db = new DatabaseSync(scratchPath());
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}

async function resetAdminAiState(): Promise<void> {
  const db = new DatabaseSync(scratchPath());
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(`
      DELETE FROM ai_jobs;
      DELETE FROM action_journal;
      DELETE FROM ai_usage_daily;
      DELETE FROM admin_reports;
      DELETE FROM settings WHERE key LIKE 'AI_%' OR key = 'ARCHIVE_RETENTION_DAYS';
    `);
  } finally {
    db.close();
  }
}

function seedQueueAndLedger(): void {
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const statuses = ['pending', 'running', 'done', 'failed', 'skipped', 'cancelled'] as const;
  const insertJob = `
    INSERT INTO ai_jobs
      (node_id, generation, kind, status, attempt, last_error, created_at, started_at, finished_at)
    VALUES (?, ?, 'embed', ?, ?, ?, ?, ?, ?)
  `;
  statuses.forEach((status, index) => {
    const finished = ['done', 'failed', 'skipped', 'cancelled'].includes(status) ? now : null;
    const started = status === 'pending' ? null : earlier;
    scratchExec(
      insertJob,
      homeNodeId,
      9000 + index,
      status,
      status === 'failed' ? 3 : 0,
      status === 'failed' ? 'sentinel-admin-ai-error' : null,
      earlier,
      started,
      finished
    );
  });

  const day = now.slice(0, 10);
  scratchExec(
    `INSERT INTO ai_usage_daily (day, role, calls, input_chars, cached, degraded, failed_429)
     VALUES (?, 'embed', 12, 3456, 3, 2, 1)`,
    day
  );
  scratchExec(
    `INSERT INTO admin_reports (kind, status, payload, created_at)
     VALUES ('night_eval', 'ok', ?, ?)`,
    JSON.stringify({
      passes: 'full',
      totals: { users: 7, collections: 9, merge_suggested: 2 },
    }),
    now
  );
}

function seedHistoryModel(): void {
  const existing = scratchScalar(
    "SELECT COUNT(*) AS v FROM llm_models WHERE model_name = 'admin-ai-history-model'"
  );
  if (existing > 0) return;
  scratchExec(
    `INSERT INTO llm_models
      (role, provider, engine, base_url_key, model_name, precision, model_revision, enabled)
     VALUES ('embed', 'history-provider', 'remote', 'LLM_EMBED_BASE_URL',
             'admin-ai-history-model', 'bf16', NULL, 0)`
  );
}

async function summaryBody(request: APIRequestContext): Promise<Record<string, any>> {
  const res = await request.get('/api/admin/ai/summary', { headers: auth(adminToken) });
  expect(res.status()).toBe(200);
  return (await res.json()) as Record<string, any>;
}

async function openAdminAiPanel(page: Page): Promise<void> {
  await page.goto('/mypage');
  const menuButton = page.locator('button[aria-label="My page"]');
  if ((await menuButton.count()) > 0) {
    await menuButton.click();
    await expect(page.locator('.MuiDrawer-paper')).toBeVisible();
  }
  const nav = page.getByRole('button', { name: /AI operations/i });
  await expect(nav).toBeVisible({ timeout: 20_000 });
  await nav.click();
  await expect(page.getByTestId('ai-admin-content')).toBeVisible({ timeout: 30_000 });
}

async function loginAdmin(page: Page): Promise<void> {
  await loginWithCredentials(page, TEST_USERS.admin.username, ADMIN_PASSWORD);
}

async function waitForModelReady(request: APIRequestContext): Promise<void> {
  await expect
    .poll(
      async () => {
        const body = await summaryBody(request);
        return body.launcher?.active_model_id ?? null;
      },
      { timeout: 120_000, intervals: [500, 1000] }
    )
    .not.toBeNull();
  await expect
    .poll(() => fake?.counters.mediaCalls ?? 0, { timeout: 120_000, intervals: [250, 500] })
    .toBeGreaterThanOrEqual(6);
  await expect
    .poll(
      async () => {
        const body = await summaryBody(request);
        return body.pipeline?.capabilities?.find(
          (entry: { capability: string }) => entry.capability === 'image_embed'
        )?.enabled;
      },
      { timeout: 60_000, intervals: [250, 500] }
    )
    .toBe(true);
  // The capability publish follows the final probe response.
  await new Promise((resolve) => setTimeout(resolve, 250));
}

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ request }, testInfo) => {
  ensureClientBuild();
  mode = testInfo.project.name.includes('-model-') ? 'model' : 'states';
  scratchPort = mode === 'model' ? e2ePorts.scratchAdminAiModel : e2ePorts.scratchAdminAiStates;
  scratch = scratchDirFor(`admin-ai-${mode}`, testInfo.project.name);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });

  const bucket = await prepareScratchS3(testInfo.project.name, 'e2e-admin-ai');
  writeScratchEnv(scratch, {
    PORT: String(scratchPort),
    ...s3ScratchEnv(bucket),
    JWT_SECRET: 'admin-ai-e2e-jwt-secret',
    ADMIN_DEFAULT_PASSWORD: ADMIN_PASSWORD,
    WEA_SKIP_AI_WORKER: '1',
    WEA_SKIP_EVOLUTION_SCHEDULER: '1',
    WEA_SKIP_EMBED_MODEL: '1',
  });

  if (mode === 'model') {
    fake = await createFakeLlmServer({ mode: 'media-capable' });
    seedScratchSettings(scratch, {
      LLM_EMBED_BASE_URL: fake.baseUrl,
      LLM_EMBED_API_KEY: 'sk-fake-embed',
      LLM_EMBED_MODEL: 'embeddinggemma-2',
      AI_WORKER_POLL_MS: '500',
    });
  }

  spawned = spawnScratchServer(scratch, scratchPort);
  await waitForScratchHealth(spawned, scratchPort);
  adminToken = await loginScratchAdmin(request, ADMIN_PASSWORD);
  userToken = await ensureScratchRegularUser(request, adminToken, USER);
  homeNodeId = await resolveNodeId(request, userToken, `/${USER.username}`);

  if (mode === 'model') {
    await waitForModelReady(request);
    await uploadFileAt(
      request,
      userToken,
      homeNodeId,
      DOC_NAME,
      'text/plain',
      Buffer.from('The admin AI coverage document describes the re-embed plan.', 'utf8')
    );
    await uploadFileAt(
      request,
      userToken,
      homeNodeId,
      'admin-ai-coverage-second.txt',
      'text/plain',
      Buffer.from('A second text node keeps a pending job after the cancel leg.', 'utf8')
    );
    await uploadFileAt(
      request,
      userToken,
      homeNodeId,
      IMAGE_NAME,
      'image/png',
      readTestFileFixture(TEST_FILES.smallImage)
    );
    seedHistoryModel();
  }
  await resetAdminAiState();
});

test.afterAll(async () => {
  if (spawned) {
    await killScratch(spawned);
    spawned = null;
  }
  if (fake) {
    await fake.close();
    fake = null;
  }
  if (scratch) {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test.beforeEach(async () => {
  await resetAdminAiState();
});

test('E2E-ADMINAI-001: an admin sees the AI operations category while a regular user does not', async ({
  page,
}) => {
  await loginAdmin(page);
  await openAdminAiPanel(page);
  await expect(page.getByTestId('ai-admin-content')).toBeVisible();

  await gotoAsAnonymous(page, '/login');
  await loginWithCredentials(page, USER.username, USER.password);
  await page.goto('/mypage');
  await expect(page.getByRole('button', { name: 'Account info', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: /AI operations/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /System settings/i })).toHaveCount(0);
});

test('E2E-ADMINAI-002: the admin AI summary renders each governance section, sticky kill switches and the seeded queue/cost/evolution/model/coverage/gate data', async ({
  page,
}) => {
  seedQueueAndLedger();
  await loginAdmin(page);
  await openAdminAiPanel(page);

  for (const section of [
    'pipeline',
    'cost',
    'evolution',
    'models',
    'coverage',
    'gates',
    'launcher',
    'journal',
  ]) {
    await expect(page.getByTestId(`ai-section-${section}`)).toBeVisible();
    await expect(page.getByTestId(`ai-anchor-${section}`)).toBeVisible();
  }

  await expect(page.getByTestId('ai-generated-at')).toBeVisible();
  await expect(page.getByTestId('ai-kill-switches')).toBeVisible();
  expect(
    await page.getByTestId('ai-kill-switches').evaluate((node) => getComputedStyle(node).position)
  ).toBe('sticky');

  const pipeline = page.getByTestId('ai-section-pipeline');
  await expect(pipeline).toContainText(/Total/);
  await expect(pipeline).toContainText(/Finished \(24h\)/);
  await expect(page.getByTestId('failed-jobs-table')).toContainText('sentinel-admin-ai-error');
  await expect(page.getByTestId('failed-jobs-table')).toContainText('failed');
  await expect(pipeline).toContainText('image_embed');

  const cost = page.getByTestId('ai-section-cost');
  await expect(cost).toContainText('embed');
  await expect(cost).toContainText('12');
  await expect(cost).toContainText('2');

  const evolution = page.getByTestId('ai-section-evolution');
  await expect(evolution).toContainText('7');
  await expect(evolution).toContainText(/Pending merge suggestions: 0/);
  await expect(page.getByTestId('evolution-not-instrumented')).toContainText(/Survival curves/);

  const models = page.getByTestId('ai-section-models');
  await expect(models).toContainText('embeddinggemma-2');
  await expect(models).toContainText('admin-ai-history-model');
  await expect(models).toContainText(/dtype/);
  await expect(models).toContainText(/mrl 768/);
  await expect(models).toContainText(/Text prefixes/);

  await expect(page.getByTestId('coverage-text')).toContainText(/Total files/);
  await expect(page.getByTestId('coverage-text')).toContainText('2');
  await expect(page.getByTestId('coverage-text-by-source')).toBeVisible();
  await expect(page.getByTestId('coverage-media')).toContainText(/Total media/);
  await expect(page.getByTestId('coverage-media')).toContainText('1');
  await expect(page.getByTestId('coverage-media-by-media-kind')).toContainText('image');
  await expect(page.getByTestId('coverage-media-by-capability')).toBeVisible();
  await expect(page.getByTestId('coverage-media-by-corpus')).toBeVisible();

  await expect(page.getByTestId('gate-row-AI_EVOLUTION_INACTIVE_DAYS')).toContainText(
    /night-eval users: 7/
  );
  await expect(page.getByTestId('gate-row-AI_USAGE_EVENT_RETENTION_DAYS')).toContainText(
    /not instrumented/
  );
});

test('E2E-ADMINAI-003: a gate edit is journaled and its undo restores the prior value', async ({
  page,
  request,
}) => {
  await loginAdmin(page);
  await openAdminAiPanel(page);

  const row = page.getByTestId('gate-row-AI_EVOLUTION_INACTIVE_DAYS');
  const input = row.getByTestId('gate-input-AI_EVOLUTION_INACTIVE_DAYS');
  await input.fill('45');
  const saved = page.waitForResponse(
    (res) => res.request().method() === 'PUT' && new URL(res.url()).pathname === '/api/admin/config'
  );
  await row.getByRole('button', { name: /^Save$/i }).click();
  expect((await saved).status()).toBe(200);

  const journalRow = page
    .getByTestId('settings-journal-row')
    .filter({ hasText: 'settings:AI_EVOLUTION_INACTIVE_DAYS' });
  await expect(journalRow).toBeVisible({ timeout: 20_000 });
  await expect(journalRow).toContainText('applied');

  const actions = await request.get('/api/actions?domain=settings', { headers: auth(adminToken) });
  expect(actions.status()).toBe(200);
  const actionBody = (await actions.json()) as {
    actions: Array<{ action_id: number; subject: string; status: string }>;
  };
  const action = actionBody.actions.find(
    (entry) => entry.subject === 'settings:AI_EVOLUTION_INACTIVE_DAYS'
  );
  expect(action).toBeTruthy();

  const undone = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      /\/api\/actions\/\d+\/undo$/.test(new URL(res.url()).pathname)
  );
  await journalRow.getByRole('button', { name: /^Undo$/i }).click();
  expect((await undone).status()).toBe(200);
  await expect(journalRow).toContainText('undone', { timeout: 20_000 });

  await expect
    .poll(async () => {
      const body = await summaryBody(request);
      const value = body.gates.gates.find(
        (entry: { key: string }) => entry.key === 'AI_EVOLUTION_INACTIVE_DAYS'
      )?.value;
      return value === null || value === undefined ? null : String(value);
    })
    .toBe('30');
});

test('E2E-ADMINAI-004: preview → one confirmation → launch enqueues work, bumps the generation and points progress at the queue', async ({
  page,
  request,
}) => {
  await loginAdmin(page);
  await openAdminAiPanel(page);

  const previewReply = page.waitForResponse(
    (res) =>
      res.request().method() === 'GET' &&
      new URL(res.url()).pathname === '/api/admin/ai/reembed/preview'
  );
  await page.getByRole('button', { name: /^Preview$/i }).click();
  const previewResponse = await previewReply;
  expect(previewResponse.status()).toBe(200);
  const preview = (await previewResponse.json()) as {
    available: boolean;
    plan: { text_count: number; media_count: number; union_count: number };
  };
  expect(preview.available).toBe(true);
  expect(preview.plan.text_count).toBeGreaterThanOrEqual(2);
  expect(preview.plan.media_count).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('reembed-preview')).toContainText(/Text: /);
  await expect(page.getByTestId('reembed-preview')).toContainText(/Media: /);
  await expect(page.getByTestId('reembed-preview')).toContainText(/Union: /);

  await page.getByRole('button', { name: /Launch re-embed/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const launchReply = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/admin/ai/reembed'
  );
  await page.getByTestId('confirm-dialog-confirm').click();
  const launched = await launchReply;
  expect(launched.status()).toBe(200);
  const body = (await launched.json()) as {
    job_ids: number[];
    enqueued: number;
    generation: number;
    generations: Record<string, number>;
  };
  expect(body.enqueued).toBeGreaterThanOrEqual(3);
  expect(body.generation).toBe(2);
  expect(body.job_ids.length).toBeGreaterThanOrEqual(3);

  await expect(page.getByText(/Re-embed launched:/)).toBeVisible();
  const snackbar = page.locator('.MuiSnackbar-root');
  await expect(snackbar).toContainText(/generation 2/);
  await expect(snackbar).not.toContainText('job_ids');
  await expect(page.getByTestId('launcher-generations')).toContainText('2');

  await expect
    .poll(() => scratchScalar("SELECT COUNT(*) AS v FROM ai_jobs WHERE status = 'pending'"))
    .toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('ai-section-pipeline')).toContainText(/Pending/);
});

test('E2E-ADMINAI-005: the 15-minute cooldown returns 429 with the retry window and disables the launcher without preview counts', async ({
  page,
  request,
}) => {
  const first = await request.post('/api/admin/ai/reembed', {
    headers: auth(adminToken),
    data: {},
  });
  expect(first.status()).toBe(200);

  const second = await request.post('/api/admin/ai/reembed', {
    headers: auth(adminToken),
    data: {},
  });
  expect(second.status()).toBe(429);
  const limited = (await second.json()) as {
    errorCode: string;
    params: { retry_after_seconds: number };
  };
  expect(limited.errorCode).toBe('serverErrors.admin.reembedRateLimited');
  expect(limited.params.retry_after_seconds).toBeGreaterThan(0);
  expect(limited.params.retry_after_seconds).toBeLessThanOrEqual(900);

  await loginAdmin(page);
  await openAdminAiPanel(page);
  await expect(page.getByTestId('launcher-unavailable')).toContainText(/cooldown/i);
  await expect(page.getByRole('button', { name: /Launch re-embed/i })).toBeDisabled();

  await page.getByRole('button', { name: /^Preview$/i }).click();
  await expect(page.getByTestId('reembed-preview-unavailable')).toContainText(/cooldown/i);
  await expect(page.getByTestId('reembed-preview')).toHaveCount(0);
});

test('E2E-ADMINAI-006: the launcher undo cancels pending jobs only and leaves running and failed jobs untouched', async ({
  page,
  request,
}) => {
  const launchedRes = await request.post('/api/admin/ai/reembed', {
    headers: auth(adminToken),
    data: {},
  });
  expect(launchedRes.status()).toBe(200);
  const launched = (await launchedRes.json()) as { job_ids: number[]; undo: { action_id: number } };
  expect(launched.job_ids.length).toBeGreaterThanOrEqual(3);

  const [runningId, failedId, pendingId] = launched.job_ids;
  const now = new Date().toISOString();
  scratchExec("UPDATE ai_jobs SET status = 'running', started_at = ? WHERE id = ?", now, runningId);
  scratchExec(
    "UPDATE ai_jobs SET status = 'failed', started_at = ?, finished_at = ?, last_error = 'undo-leg' WHERE id = ?",
    now,
    now,
    failedId
  );
  expect(
    scratchRows<{ status: string }>('SELECT status FROM ai_jobs WHERE id = ?', pendingId)[0].status
  ).toBe('pending');

  await loginAdmin(page);
  await openAdminAiPanel(page);
  const journalRow = page
    .getByTestId('settings-journal-row')
    .filter({ hasText: 'settings:ai-reembed' });
  await expect(journalRow).toBeVisible({ timeout: 20_000 });

  const undone = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      /\/api\/actions\/\d+\/undo$/.test(new URL(res.url()).pathname)
  );
  await journalRow.getByRole('button', { name: /^Undo$/i }).click();
  expect((await undone).status()).toBe(200);

  const statuses = Object.fromEntries(
    scratchRows<{ id: number; status: string }>(
      'SELECT id, status FROM ai_jobs WHERE id IN (?, ?, ?)',
      runningId,
      failedId,
      pendingId
    ).map((row) => [Number(row.id), row.status])
  );
  expect(statuses[runningId]).toBe('running');
  expect(statuses[failedId]).toBe('failed');
  expect(statuses[pendingId]).toBe('cancelled');
  await expect(journalRow).toContainText('undone', { timeout: 20_000 });
});

test('E2E-ADMINAI-007: the settings cross-links round-trip and leaving the panel stops the summary poll', async ({
  page,
}) => {
  await loginAdmin(page);
  await openAdminAiPanel(page);

  await page.getByRole('button', { name: /Open system settings/i }).click();
  await expect(page.getByTestId('open-ai-panel')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('open-ai-panel').click();
  await expect(page.getByTestId('ai-admin-content')).toBeVisible({ timeout: 30_000 });

  let summaryRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/admin/ai/summary') summaryRequests += 1;
  });
  await page
    .getByRole('button', { name: /Refresh/i })
    .first()
    .click();
  await expect.poll(() => summaryRequests).toBeGreaterThanOrEqual(1);
  const beforeLeave = summaryRequests;

  await page.getByRole('button', { name: 'Account info', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account info', exact: true })).toBeVisible();
  await page.waitForTimeout(16_000);
  expect(summaryRequests).toBe(beforeLeave);
});

test('E2E-ADMINAI-008: an empty no-model panel shows reasons instead of zeros, and a failed read retries into the empty state', async ({
  page,
}) => {
  let failSummary = true;
  await page.route(/\/api\/admin\/ai\/summary$/, async (route) => {
    if (failSummary) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ errorCode: 'serverErrors.api.internal' }),
      });
      return;
    }
    await route.continue();
  });

  await loginAdmin(page);
  await page.goto('/mypage');
  await page.getByRole('button', { name: /AI operations/i }).click();
  await expect(page.getByRole('button', { name: /^Retry$/i })).toBeVisible({ timeout: 20_000 });

  failSummary = false;
  await page.getByRole('button', { name: /^Retry$/i }).click();
  await expect(page.getByTestId('ai-admin-content')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/No failed jobs/i)).toBeVisible();
  await expect(page.getByText(/No settings journal rows/i)).toBeVisible();
  await expect(page.getByTestId('coverage-unavailable')).toContainText(
    /No active embedding model/i
  );
  await expect(page.getByTestId('launcher-unavailable')).toContainText(
    /No active embedding model/i
  );

  await page.getByRole('button', { name: /^Preview$/i }).click();
  await expect(page.getByTestId('reembed-preview-unavailable')).toContainText(
    /No active embedding model/i
  );
  await expect(page.getByTestId('reembed-preview')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Launch re-embed/i })).toBeDisabled();
});
