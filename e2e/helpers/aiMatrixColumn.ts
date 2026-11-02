import fs from 'node:fs';
import type { ChildProcess } from 'node:child_process';

import { APIRequestContext, expect } from '@playwright/test';

import type { FakeLlmMode, FakeLlmServer } from './fakeLlm';
import { seedScratchSettings } from './scratchSettings';
import {
  killScratch,
  prepareScratchS3,
  s3ScratchEnv,
  scratchDirFor,
  spawnScratchServer,
  waitForScratchHealth,
  writeScratchEnv,
} from './setupScratch';
import { ensureScratchRegularUser, loginScratchAdmin, type ScratchUserCreds } from './scratchUser';
import { resolveNodeId } from './resolvePath';

/**
 * Shared fake-LLM scratch-column boot for the AI degradation matrix (T4.3).
 *
 * Both matrix suites own this shape:
 *   - `e2e/ai.matrix.spec.ts` — API-only columns on `:5021`;
 *   - `e2e/ai.matrix.ui.spec.ts` — browser columns on the browser-safe `:5009`.
 *
 * A column is one scratch server (own directory, own S3 bucket, own sqlite)
 * booted with pre-boot `settings` rows pointing at an in-process fake LLM. The
 * scratch child env strips `WEA_SKIP_AI_WORKER` (absence = enabled) and sets
 * `WEA_SKIP_EMBED_MODEL=1` so the built-in engine never provisions; a remote
 * fake override still takes precedence. `LLM_*` keys are dbOnly, so ambient
 * env can never select a real provider.
 */

export const WORKER_SETTINGS = { AI_WORKER_POLL_MS: '500' };

export const EMBED_SETTINGS = (baseUrl: string) => ({
  LLM_EMBED_BASE_URL: baseUrl,
  LLM_EMBED_API_KEY: 'sk-fake-embed',
  LLM_EMBED_MODEL: 'embeddinggemma-2',
});

export const CHAT_SETTINGS = (baseUrl: string) => ({
  LLM_CHAT_BASE_URL: baseUrl,
  LLM_CHAT_API_KEY: 'sk-fake-chat',
  LLM_CHAT_MODEL: 'gemma-4-12b-it',
});

export const VISION_SETTINGS = (baseUrl: string) => ({
  LLM_VISION_BASE_URL: baseUrl,
  LLM_VISION_API_KEY: 'sk-fake-vision',
  LLM_VISION_MODEL: 'gemma-4-12b-it',
});

export interface ColumnScratch {
  scratch: string;
  child: ChildProcess;
  /** Scratch admin bearer — OPERATOR duties only (config changes). */
  operatorToken: string;
  userToken: string;
  homeNodeId: number;
  /** The regular-user credentials provisioned for this column. */
  userCreds: ScratchUserCreds;
}

export interface ColumnBootOptions {
  /** Scratch HTTP port owned by the calling Playwright project. */
  port: number;
  /** ADMIN_DEFAULT_PASSWORD used for the operator login. */
  adminPassword: string;
  /** Regular-user identity every case acts as. */
  userCreds: ScratchUserCreds;
  /** Stable per-suite JWT secret (never shared with another suite). */
  jwtSecret: string;
}

export async function bootColumn(
  request: APIRequestContext,
  projectName: string,
  column: string,
  settings: Record<string, string>,
  options: ColumnBootOptions
): Promise<ColumnScratch> {
  const scratch = scratchDirFor(`ai-matrix-${column}`, projectName);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  const bucket = await prepareScratchS3(projectName, `e2e-ai-matrix-${column}`);
  writeScratchEnv(scratch, {
    PORT: String(options.port),
    ...s3ScratchEnv(bucket),
    JWT_SECRET: options.jwtSecret,
    ADMIN_DEFAULT_PASSWORD: options.adminPassword,
    WEA_SKIP_EMBED_MODEL: '1',
  });
  seedScratchSettings(scratch, { ...WORKER_SETTINGS, ...settings });
  const child = spawnScratchServer(scratch, options.port);
  await waitForScratchHealth(child, options.port);
  const operatorToken = await loginScratchAdmin(request, options.adminPassword);
  const userToken = await ensureScratchRegularUser(request, operatorToken, options.userCreds);
  const homeNodeId = await resolveNodeId(request, userToken, `/${options.userCreds.username}`);
  return {
    scratch,
    child,
    operatorToken,
    userToken,
    homeNodeId,
    userCreds: options.userCreds,
  };
}

export async function shutdownColumn(column: ColumnScratch | undefined): Promise<void> {
  if (!column) return;
  await killScratch(column.child);
  fs.rmSync(column.scratch, { recursive: true, force: true });
}

export async function publicAi(
  request: APIRequestContext
): Promise<{ embed: boolean; chat: boolean }> {
  const res = await request.get('/api/settings/public');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ai: { embed: boolean; chat: boolean } };
  return body.ai;
}

export async function waitForAiFlags(
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
export async function waitForEmbedProbeSettled(
  fake: FakeLlmServer,
  mode: FakeLlmMode
): Promise<void> {
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
export async function waitForVisionProbeSettled(fake: FakeLlmServer): Promise<void> {
  await expect
    .poll(() => fake.counters.visionCalls, { timeout: 60_000, intervals: [100, 250] })
    .toBeGreaterThan(0);
  await expect
    .poll(() => fake.counters.chatCalls, { timeout: 60_000, intervals: [100, 250] })
    .toBeGreaterThanOrEqual(2);
  await new Promise((resolve) => setTimeout(resolve, 250));
}

/** Wait until the one-shot chat probe has made its call. */
export async function waitForChatProbeSettled(fake: FakeLlmServer): Promise<void> {
  await expect
    .poll(() => fake.counters.chatCalls, { timeout: 60_000, intervals: [100, 250] })
    .toBeGreaterThan(0);
  // The publish follows the probe response; give it one event-loop turn.
  await new Promise((resolve) => setTimeout(resolve, 250));
}
