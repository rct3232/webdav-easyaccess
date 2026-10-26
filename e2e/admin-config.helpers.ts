import fs from 'node:fs';
import http from 'node:http';
import type { ChildProcess } from 'node:child_process';

import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { e2ePorts, webdavBase } from './helpers/ports';
import {
  ensureClientBuild,
  killScratch,
  openSystemSettings,
  prepareScratchStorage,
  prepareScratchWebdav,
  s3ScratchEnv,
  scratchDirFor,
  scratchRuntimeEnv,
  scratchWebdavUrl,
  spawnScratchServer,
  waitForScratchHealth,
  writeScratchEnv,
} from './helpers/setupScratch';

/**
 * Shared scratch harness for the split admin-config suites.
 *
 * `admin-config.s3.spec.ts` boots an S3-mode scratch (project bucket, no
 * WebDAV settings) and exercises the backend-agnostic config editor matrix.
 * `admin-config.webdav.spec.ts` keeps the WebDAV connection/health cases on the
 * case-scoped bytemark subtree.
 *
 * Every resource is project-scoped (scratch dir, S3 bucket, WebDAV root) and
 * the port follows the Playwright project platform, so the desktop and mobile
 * legs are independent siblings.
 */

export type AdminConfigBackend = 's3' | 'webdav';

export type AdminConfigScratch = {
  scratch: string;
  port: number;
  baseURL: string;
  backend: AdminConfigBackend;
  child: ChildProcess | null;
};

export type ConfigEntry = {
  value?: string;
  source: 'env' | 'db' | 'default';
  tier: 'T0' | 'T1' | 'T2';
  secret: boolean;
};

export const ADMIN_PASSWORD = 'AdminConfigE2e!123';
export const WEBDAV_BASE = webdavBase;

const WEBDAV_AUTH = Buffer.from('e2etest:e2etest123').toString('base64');
const JWT_SECRET = 'admin-config-e2e-jwt-secret';

/** The admin-config scratch port for the project's platform. */
export function adminConfigPort(projectName: string): number {
  return projectName.endsWith('-mobile')
    ? e2ePorts.scratchAdminConfigMobile
    : e2ePorts.scratchAdminConfig;
}

function caseIdFor(backend: AdminConfigBackend): string {
  return backend === 's3' ? 'admin-config-s3' : 'admin-config-webdav';
}

async function spawnAdminConfigServer(
  state: AdminConfigScratch,
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<void> {
  state.child = spawnScratchServer(state.scratch, state.port, scratchRuntimeEnv(extraEnv));
  await waitForScratchHealth(state.child, state.port);
}

/** Provision the project/case-scoped scratch and boot the admin-config server. */
export async function startAdminConfigScratch(
  backend: AdminConfigBackend,
  projectName: string
): Promise<AdminConfigScratch> {
  const caseId = caseIdFor(backend);
  const scratch = scratchDirFor(caseId, projectName);
  const port = adminConfigPort(projectName);
  const state: AdminConfigScratch = {
    scratch,
    port,
    baseURL: `http://127.0.0.1:${port}`,
    backend,
    child: null,
  };

  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });

  try {
    ensureClientBuild();

    if (backend === 's3') {
      const prepared = await prepareScratchStorage(scratch, caseId, 's3', projectName);
      if (!prepared.bucket) throw new Error('S3 scratch preparation returned no bucket');
      writeScratchEnv(scratch, {
        PORT: String(port),
        ...s3ScratchEnv(prepared.bucket),
        JWT_SECRET,
        ADMIN_DEFAULT_PASSWORD: ADMIN_PASSWORD,
      });
    } else {
      // The WebDAV connection keys are deliberately NOT in the .env: they are
      // seeded into the sqlite DB (prepareScratchWebdav) so the editor rows are
      // DB-sourced/editable and the D1 save-gating tests can exercise them.
      writeScratchEnv(scratch, {
        PORT: String(port),
        WEA_FILE_STORAGE: 'webdav',
        WEBDAV_UPSTREAM_URL: scratchWebdavUrl(caseId, projectName),
        JWT_SECRET,
        ADMIN_DEFAULT_PASSWORD: ADMIN_PASSWORD,
      });
      await prepareScratchWebdav(scratch, caseId, projectName);
    }

    await spawnAdminConfigServer(state);
    return state;
  } catch (err) {
    await stopAdminConfigScratch(state);
    throw err;
  }
}

/** Restart the scratch server with the same project/case state (T1 persistence cases). */
export async function restartAdminConfigScratch(state: AdminConfigScratch): Promise<void> {
  if (state.child) {
    await killScratch(state.child);
    state.child = null;
  }
  await spawnAdminConfigServer(state);
}

/** Kill the scratch server and remove the scratch directory. */
export async function stopAdminConfigScratch(state: AdminConfigScratch): Promise<void> {
  if (state.child) {
    await killScratch(state.child);
    state.child = null;
  }
  fs.rmSync(state.scratch, { recursive: true, force: true });
}

export async function loginToken(
  baseURL: string,
  request: APIRequestContext,
  username = 'admin',
  password = ADMIN_PASSWORD
): Promise<string> {
  const res = await request.post(`${baseURL}/api/auth/login`, {
    data: { username, password },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token as string;
}

export async function getConfig(
  baseURL: string,
  request: APIRequestContext
): Promise<Record<string, ConfigEntry>> {
  const token = await loginToken(baseURL, request);
  const res = await request.get(`${baseURL}/api/admin/config`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).config as Record<string, ConfigEntry>;
}

export async function putConfig(
  baseURL: string,
  request: APIRequestContext,
  values: Record<string, string>
): Promise<void> {
  const token = await loginToken(baseURL, request);
  const res = await request.put(`${baseURL}/api/admin/config`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { values },
  });
  expect(res.ok()).toBeTruthy();
}

// Use the UI-triggered PUT as the success signal; the editor clears dirty state
// on success, so Save becoming disabled is expected. Dismiss a transient
// Snackbar when present so it cannot intercept the next save action.
export async function saveConfig(page: Page): Promise<void> {
  const save = page.getByTestId('config-save');
  const snackbar = page.locator('.MuiSnackbar-root');

  // Wait for React to commit the fill's dirty state before firing the click;
  // otherwise handleSave reads a stale (empty) dirtyKeys and no-ops.
  await expect(save).toBeEnabled();

  const putResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname === '/api/admin/config'
  );
  await save.click();
  const response = await putResponse;
  expect(response.status(), 'config save PUT status').toBe(200);

  const close = snackbar.locator('[aria-label="Close"]');
  if ((await snackbar.isVisible().catch(() => false)) && (await close.count()) > 0) {
    await close.click({ force: true });
    await expect(snackbar)
      .toBeHidden({ timeout: 3000 })
      .catch(() => {});
  }
}

export async function openAdvancedSettings(page: Page): Promise<void> {
  await openSystemSettings(page);
  await page.locator('#advanced-settings-header').click();
  // The config editor lazy-fetches on expand; the Save button renders only after load.
  await expect(page.getByTestId('config-save')).toBeVisible({ timeout: 60_000 });
}

export const isLocked = (entry: ConfigEntry): boolean =>
  entry.source === 'env' || entry.tier === 'T0';

// PROPFIND :8090 (mirrors e2e/global-setup.ts): a 200/207 means the bytemark
// container answers directory listings, i.e. a webdav connection test would
// succeed. Retries for a few seconds because the container can still be
// settling right after a docker-compose recreate. Only a SUCCESS is memoized —
// the container may come up mid-suite, so a transient "unreachable" must not
// lock later callers out.
let webdavReachableCache: boolean | null = null;
export async function detectWebdavReachable(): Promise<boolean> {
  if (webdavReachableCache === true) return true;

  const probeOnce = (): Promise<boolean> =>
    new Promise((resolve) => {
      const req = http.request(
        `${WEBDAV_BASE}/`,
        {
          method: 'PROPFIND',
          headers: { Authorization: `Basic ${WEBDAV_AUTH}`, Depth: '1' },
          timeout: 5000,
        },
        (res) => {
          res.resume();
          const status = res.statusCode || 0;
          resolve(status === 200 || status === 207);
        }
      );
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => resolve(false));
      req.end();
    });

  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await probeOnce()) {
      webdavReachableCache = true;
      return true;
    }
    if (Date.now() - startedAt >= 15_000) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
