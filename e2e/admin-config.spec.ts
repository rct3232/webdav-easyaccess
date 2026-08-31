import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  ensureClientBuild,
  killScratch,
  queryScratchSqlite,
  readEnvFile,
  scratchDirFor,
  spawnScratchServer,
  waitForScratchHealth,
} from './helpers/setupScratch';

/**
 * Admin "Advanced settings" config editor UI/UX (PLAN.md §9, Q3).
 *
 * Hermetic by design: each case spawns its own fully-configured scratch server
 * on :5003 (own `.env`, own sqlite) so the config editor's field-state matrix
 * (source/tier → enabled/disabled), save feedback (applied vs restartRequired),
 * secret lifecycle and post-restart persistence are deterministic. The server
 * boots setup_complete=true (webdav file storage in `.env`, sqlite metadata) so
 * the admin config routes are reachable; the shared :5002 server is unused.
 *
 * Never touches the shared E2E state. Requires the docker infra (webdav :8090)
 * only for the scratch server's boot-time webdav probe, which warns on failure.
 */

const require = createRequire(__filename);

const SCRATCH_BASE = 'http://127.0.0.1:5003';
const WEBDAV_BASE = 'http://127.0.0.1:8090';

const CASE_ID = 'admin-config';
const ADMIN_PASSWORD = 'AdminConfigE2e!123';
// Deterministic 32-byte hex master key (also written into the scratch .env).
const ENCRYPT_KEY = 'a'.repeat(64);

const { decryptSecret } = require('../server/utils/configEncryption') as {
  decryptSecret: (payload: unknown, passphrase: string) => string;
};

type ConfigEntry = {
  value?: string;
  source: 'env' | 'db' | 'default';
  tier: 'T0' | 'T1' | 'T2';
  secret: boolean;
};

let scratch: string;
let spawned: ReturnType<typeof spawnScratchServer> | null = null;

function writeScratchEnv(dir: string): void {
  const lines = [
    'PORT=5003',
    'WEA_STORAGE_BACKEND=sqlite',
    'WEA_FILE_STORAGE=webdav',
    `WEBDAV_URL=${WEBDAV_BASE}`,
    `WEBDAV_UPSTREAM_URL=${WEBDAV_BASE}`,
    'WEBDAV_USERNAME=e2etest',
    'WEBDAV_PASSWORD=e2etest123',
    'WEBDAV_AUTH_TYPE=auto',
    'JWT_SECRET=admin-config-e2e-jwt-secret',
    `ADMIN_DEFAULT_PASSWORD=${ADMIN_PASSWORD}`,
    `encrypt_secret_key=${ENCRYPT_KEY}`,
    '',
  ];
  fs.writeFileSync(path.join(dir, '.env'), lines.join('\n'));
}

test.beforeEach(async () => {
  scratch = scratchDirFor(CASE_ID);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  writeScratchEnv(scratch);
  ensureClientBuild();
  spawned = spawnScratchServer(scratch);
  await waitForScratchHealth(spawned!);
});

test.afterEach(async () => {
  if (spawned) {
    await killScratch(spawned);
    spawned = null;
  }
  if (scratch) {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

async function loginToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${SCRATCH_BASE}/api/auth/login`, {
    data: { username: 'admin', password: ADMIN_PASSWORD },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token as string;
}

async function getConfig(request: APIRequestContext): Promise<Record<string, ConfigEntry>> {
  const token = await loginToken(request);
  const res = await request.get(`${SCRATCH_BASE}/api/admin/config`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).config as Record<string, ConfigEntry>;
}

async function putConfig(request: APIRequestContext, values: Record<string, string>): Promise<void> {
  const token = await loginToken(request);
  const res = await request.put(`${SCRATCH_BASE}/api/admin/config`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { values },
  });
  expect(res.ok()).toBeTruthy();
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await expect(page.locator('input[name="username"]')).toBeVisible();
  await page.locator('input[name="username"]').fill('admin');
  await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/files(?:\/.*)?$/),
    page.locator('form button[type="submit"]').click(),
  ]);
}

// On narrow (mobile) viewports the transient success Snackbar (bottom-center)
// overlays the Save button, so a plain click is intercepted. Force-click Save
// and then dismiss the Snackbar so the next interaction is never blocked.
async function saveConfig(page: Page): Promise<void> {
  await page.getByTestId('config-save').click({ force: true });
  const snackbar = page.locator('.MuiSnackbar-root');
  await expect(snackbar).toBeVisible({ timeout: 3000 }).catch(() => {});
  const close = snackbar.locator('[aria-label="Close"]');
  if ((await close.count()) > 0) {
    await close.click({ force: true });
    await expect(snackbar).toBeHidden({ timeout: 3000 }).catch(() => {});
  }
}

async function openAdvancedSettings(page: Page): Promise<void> {
  await page.goto('/mypage');
  // Mobile renders the mypage categories in a drawer; open it only when the
  // target is not already visible (the toggle button would close an open drawer).
  const systemSettings = page.getByRole('button', { name: /system settings/i });
  if (!(await systemSettings.isVisible().catch(() => false))) {
    const menuButton = page.locator('button[aria-label="My page"]');
    if ((await menuButton.count()) > 0) {
      await menuButton.click();
      await expect(page.locator('.MuiDrawer-paper')).toBeVisible();
    }
  }
  await systemSettings.click();
  await expect(page.getByRole('heading', { level: 6, name: /system settings/i })).toBeVisible();
  await page.locator('#advanced-settings-header').click();
  // The config editor lazy-fetches on expand; the Save button renders only after load.
  await expect(page.getByTestId('config-save')).toBeVisible();
}

const isLocked = (entry: ConfigEntry): boolean => entry.source === 'env' || entry.tier === 'T0';

test.describe('Admin config editor (Advanced settings)', () => {
  test('field state matrix: source/tier drives enabled/disabled per row', async ({
    page,
    request,
  }) => {
    // Seed DB-sourced rows so the matrix has 'db' sources alongside env/default.
    await putConfig(request, { S3_BUCKET: 'db-bucket', GC_ORPHAN_TTL_DAYS: '7' });
    const config = await getConfig(request);

    await loginAsAdmin(page);
    await openAdvancedSettings(page);

    let envRows = 0;
    for (const [key, entry] of Object.entries(config)) {
      const input = page.getByTestId(`config-input-${key}`);
      if ((await input.count()) === 0) continue; // not displayed in the editor
      if (entry.source === 'env') envRows += 1;

      if (entry.secret) {
        // The masked display is always read-only; the "set new value" toggle is
        // the edit affordance and must be present only for editable secrets.
        await expect(input, `masked display ${key}`).toBeDisabled();
        const toggle = page.getByTestId(`config-secret-toggle-${key}`);
        if (isLocked(entry)) {
          await expect(toggle, `locked secret ${key}`).toHaveCount(0);
        } else {
          await expect(toggle, `editable secret ${key}`).toBeVisible();
        }
      } else if (isLocked(entry)) {
        await expect(input, `locked ${key}`).toBeDisabled();
      } else {
        await expect(input, `editable ${key}`).toBeEnabled();
      }
    }

    // registration_enabled lives in the main settings rows, never the editor.
    await expect(page.getByTestId('config-input-registration_enabled')).toHaveCount(0);

    // Every env-sourced row carries the "Set in .env" helper.
    await expect(page.getByText('Set in .env (env takes precedence)')).toHaveCount(envRows);
  });

  test('save feedback: T2 applied immediately, T1 flagged restart required', async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page);
    await openAdvancedSettings(page);

    const save = page.getByTestId('config-save');
    await expect(save).toBeDisabled(); // nothing dirty yet

    // Per-field tier badges (F5): shown while editing, before any save.
    await expect(page.getByTestId('config-tier-CORS_ORIGINS')).toContainText('Applies immediately');
    await expect(page.getByTestId('config-tier-S3_BUCKET')).toContainText('Restart required');

    // T2 (hot) + T1 (restart) edits.
    await page.getByTestId('config-input-CORS_ORIGINS').fill('https://app.test.local');
    await page.getByTestId('config-input-S3_BUCKET').fill('new-bucket');
    await expect(save).toBeEnabled();

    await saveConfig(page);
    await expect(page.getByTestId('config-applied-banner')).toBeVisible();
    await expect(page.getByTestId('config-applied-banner')).toContainText('CORS_ORIGINS');
    await expect(page.getByTestId('config-restart-banner')).toBeVisible();
    await expect(page.getByTestId('config-restart-banner')).toContainText('S3_BUCKET');
    await expect(page.getByTestId('config-restart-banner')).not.toContainText('CORS_ORIGINS');

    // Applied immediately for T2 (async resolver reads the DB fresh).
    await expect
      .poll(() => getConfig(request).then((c) => c.CORS_ORIGINS.value))
      .toBe('https://app.test.local');
    const config = await getConfig(request);
    expect(config.CORS_ORIGINS.source).toBe('db');
    expect(config.S3_BUCKET.value).toBe('new-bucket');
    expect(config.S3_BUCKET.source).toBe('db');
  });

  test('server rejects a PUT to an env-sourced key with 400 configEnvSourcedProtected', async ({
    request,
  }) => {
    // WEBDAV_URL is .env-owned (WEBDAV_* in the scratch .env) → source 'env'.
    const token = await loginToken(request);
    const res = await request.put(`${SCRATCH_BASE}/api/admin/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { values: { WEBDAV_URL: 'https://other.example.com' } },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.errorCode).toBe('serverErrors.admin.configEnvSourcedProtected');
    expect(body.params).toEqual({ key: 'WEBDAV_URL' });

    // A DB-sourced key stays writable.
    await putConfig(request, { S3_BUCKET: 'db-bucket' });
    const config = await getConfig(request);
    expect(config.S3_BUCKET.value).toBe('db-bucket');
    expect(config.S3_BUCKET.source).toBe('db');
  });

  test('key_lost_warning surfaces in the admin UI when the master key is missing', async ({
    page,
    request,
  }) => {
    // Create an encrypted settings row while the master key is present.
    await putConfig(request, { EMAIL_PASSWORD: 'initial-secret' });

    // Remove the master key from .env and restart the scratch server.
    await killScratch(spawned!);
    const envPath = path.join(scratch, '.env');
    const envLines = fs
      .readFileSync(envPath, 'utf8')
      .split('\n')
      .filter((line) => !line.startsWith('encrypt_secret_key='));
    fs.writeFileSync(envPath, envLines.join('\n'));
    spawned = spawnScratchServer(scratch);
    await waitForScratchHealth(spawned);

    await loginAsAdmin(page);
    await page.goto('/mypage');
    const systemSettings = page.getByRole('button', { name: /system settings/i });
    if (!(await systemSettings.isVisible().catch(() => false))) {
      const menuButton = page.locator('button[aria-label="My page"]');
      if ((await menuButton.count()) > 0) {
        await menuButton.click();
        await expect(page.locator('.MuiDrawer-paper')).toBeVisible();
      }
    }
    await systemSettings.click();

    await expect(page.getByTestId('key-lost-warning')).toBeVisible();
    await expect(page.getByTestId('key-lost-warning')).toContainText('Encryption key lost');
  });

  test('secret lifecycle: masked, unchanged kept, blank new value kept, new value stored encrypted', async ({
    page,
    request,
  }) => {
    await putConfig(request, { EMAIL_PASSWORD: 'initial-secret' });

    const env = readEnvFile(scratch);
    const masterKey = env.encrypt_secret_key;

    await loginAsAdmin(page);
    await openAdvancedSettings(page);

    const secretInput = page.getByTestId('config-input-EMAIL_PASSWORD');
    await expect(secretInput).toHaveValue('****'); // masked, never plaintext
    await expect(secretInput).toBeDisabled();

    const dbPath = path.join(scratch, 'webdav.db');
    const rawSecret = async (): Promise<string> => {
      const rows = await queryScratchSqlite<{ value: string }>(
        dbPath,
        "SELECT value FROM settings WHERE key = 'EMAIL_PASSWORD'"
      );
      return rows[0].value;
    };
    const decryptDbSecret = async (): Promise<string> => {
      const payload = JSON.parse(await rawSecret());
      return decryptSecret(payload, masterKey);
    };

    // 1) Leave the secret untouched, save another change → ciphertext kept byte-for-byte.
    const before1 = await rawSecret();
    await page.getByTestId('config-input-GC_ORPHAN_TTL_DAYS').fill('9');
    await saveConfig(page);
    await expect
      .poll(() => getConfig(request).then((c) => c.GC_ORPHAN_TTL_DAYS.value))
      .toBe('9');
    expect(await rawSecret()).toBe(before1);

    // 2) "Set new value" but leave it blank → still kept.
    await page.getByTestId('config-secret-toggle-EMAIL_PASSWORD').click();
    await page.getByTestId('config-input-GC_ORPHAN_TTL_DAYS').fill('10');
    await saveConfig(page);
    await expect
      .poll(() => getConfig(request).then((c) => c.GC_ORPHAN_TTL_DAYS.value))
      .toBe('10');
    expect(await rawSecret()).toBe(before1);

    // 3) "Set new value" and type → stored encrypted with the new plaintext.
    await page.getByTestId('config-secret-toggle-EMAIL_PASSWORD').click();
    await page.getByTestId('config-secret-new-EMAIL_PASSWORD').fill('new-secret');
    await page.getByTestId('config-input-GC_ORPHAN_TTL_DAYS').fill('11');
    await saveConfig(page);
    await expect
      .poll(() => getConfig(request).then((c) => c.GC_ORPHAN_TTL_DAYS.value))
      .toBe('11');
    await expect.poll(decryptDbSecret).toBe('new-secret');
    expect(await rawSecret()).not.toBe(before1);

    // 4) Re-save without touching the secret → ciphertext unchanged (no re-encrypt).
    const before4 = await rawSecret();
    await page.getByTestId('config-input-GC_ORPHAN_TTL_DAYS').fill('12');
    await saveConfig(page);
    await expect
      .poll(() => getConfig(request).then((c) => c.GC_ORPHAN_TTL_DAYS.value))
      .toBe('12');
    expect(await rawSecret()).toBe(before4);
    await expect.poll(decryptDbSecret).toBe('new-secret');
  });

  test('T1 change persists across a server restart (source db)', async ({ page, request }) => {
    await loginAsAdmin(page);
    await openAdvancedSettings(page);

    await page.getByTestId('config-input-S3_BUCKET').fill('restart-bucket');
    await saveConfig(page);
    await expect(page.getByTestId('config-restart-banner')).toContainText('S3_BUCKET');

    // Restart the scratch server (same .env + sqlite persist in the scratch dir).
    await killScratch(spawned!);
    spawned = spawnScratchServer(scratch);
    await waitForScratchHealth(spawned);

    const config = await getConfig(request);
    expect(config.S3_BUCKET.value).toBe('restart-bucket');
    expect(config.S3_BUCKET.source).toBe('db');

    await loginAsAdmin(page);
    await openAdvancedSettings(page);
    await expect(page.getByTestId('config-input-S3_BUCKET')).toHaveValue('restart-bucket');
  });
});
