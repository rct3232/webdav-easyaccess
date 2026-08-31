import fs from 'node:fs';
import http from 'node:http';
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
 * boots setup_complete=true (webdav file storage, sqlite metadata) so the admin
 * config routes are reachable; the shared :5002 server is unused.
 *
 * The WebDAV connection keys (WEBDAV_URL/USERNAME/PASSWORD/AUTH_TYPE) are NOT in
 * the scratch `.env`: they are pre-seeded into the scratch sqlite DB before the
 * server's first boot, so they resolve as DB-sourced (editable) and setup stays
 * complete (Phase B D1 gating requires editable connection keys; the F4 guard
 * locks env-sourced rows). WEBDAV_PASSWORD is stored as plaintext (legacy row)
 * so the key_lost restart case (master key removed) still boots complete.
 *
 * Never touches the shared E2E state. Requires the docker infra (webdav :8090)
 * only for the success-path gating tests (guarded) and the scratch server's
 * boot-time webdav probe, which warns on failure.
 */

const require = createRequire(__filename);

const SCRATCH_BASE = 'http://127.0.0.1:5003';
const WEBDAV_BASE = 'http://127.0.0.1:8090';
const WEBDAV_AUTH = Buffer.from('e2etest:e2etest123').toString('base64');

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

// PROPFIND :8090 (mirrors e2e/global-setup.ts): a 200/207 means the bytemark
// container answers directory listings, i.e. a webdav connection test would
// succeed. Retries for a few seconds because the container can still be
// settling right after a docker-compose recreate; memoized for the worker run.
let webdavReachableCache: boolean | null = null;
async function detectWebdavReachable(): Promise<boolean> {
  if (webdavReachableCache !== null) return webdavReachableCache;

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
      webdavReachableCache = false;
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

type SqliteDatabase = {
  run: (sql: string, params: unknown[], cb: (err: Error | null) => void) => void;
  close: (cb?: (err: Error | null) => void) => void;
};

// Pre-seed the scratch metadata sqlite with DB-sourced WebDAV connection keys
// BEFORE the server's first boot so `setup_complete` derives true and the
// editor rows are editable (D1). The settings table schema mirrors the
// converted DDL (CREATE TABLE IF NOT EXISTS makes the boot re-init a no-op).
async function seedWebdavSettings(dir: string): Promise<void> {
  const dbPath = path.join(dir, 'webdav.db');
  const { Database } = require('sqlite3') as { Database: new (path: string) => SqliteDatabase };
  const db = new Database(dbPath);
  const exec = (sql: string, params: unknown[] = []): Promise<void> =>
    new Promise((resolve, reject) => {
      db.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
  try {
    await exec(
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
    const rows: Array<[string, string]> = [
      ['WEBDAV_URL', WEBDAV_BASE],
      ['WEBDAV_USERNAME', 'e2etest'],
      ['WEBDAV_PASSWORD', 'e2etest123'],
      ['WEBDAV_AUTH_TYPE', 'auto'],
    ];
    for (const [key, value] of rows) {
      await exec(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
    }
  } finally {
    await new Promise<void>((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
  }
}

let scratch: string;
let spawned: ReturnType<typeof spawnScratchServer> | null = null;

// The scratch harness binds a fixed port (:5003) and uses a single scratch dir,
// so the whole file must run in one worker (serial). Same convention as
// setup-wizard.spec.ts; without it Playwright's fullyParallel splits the file
// across workers and their :5003 scratch servers collide.
test.describe.configure({ mode: 'serial' });

function writeScratchEnv(dir: string): void {
  const lines = [
    'PORT=5003',
    'WEA_STORAGE_BACKEND=sqlite',
    'WEA_FILE_STORAGE=webdav',
    // WebDAV connection keys are deliberately NOT in the .env: they are seeded
    // into the sqlite DB (see seedWebdavSettings) so the editor rows are
    // DB-sourced/editable and the D1 save-gating tests can exercise them.
    'WEBDAV_UPSTREAM_URL=http://127.0.0.1:8090',
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
  await seedWebdavSettings(scratch);
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
  const save = page.getByTestId('config-save');
  const snackbar = page.locator('.MuiSnackbar-root');

  // Wait for React to commit the fill's dirty state before firing the click;
  // otherwise handleSave reads a stale (empty) dirtyKeys and no-ops.
  await expect(save).toBeEnabled();

  const clickAndExpectSnackbar = async (): Promise<void> => {
    await save.click({ force: true });
    await expect(snackbar).toBeVisible({ timeout: 4000 });
  };

  try {
    await clickAndExpectSnackbar();
  } catch {
    // The force-click can land on a just-disabled button (React re-renders
    // after the fill), which suppresses the click entirely and sends no PUT.
    // The dirty state is still pending, so retry once.
    await expect(save).toBeEnabled();
    await clickAndExpectSnackbar();
  }

  const close = snackbar.locator('[aria-label="Close"]');
  if ((await close.count()) > 0) {
    await close.click({ force: true });
    await expect(snackbar).toBeHidden({ timeout: 3000 }).catch(() => {});
  }
}

async function openSystemSettings(page: Page): Promise<void> {
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
}

async function openAdvancedSettings(page: Page): Promise<void> {
  await openSystemSettings(page);
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
    await expect(page.getByTestId('config-tier-FFMPEG_PATH')).toContainText('Restart required');

    // T2 (hot) + T1 (restart) edits. FFMPEG_PATH is a non-connection T1 key, so
    // Save is not gated behind a connection test (D1).
    await page.getByTestId('config-input-CORS_ORIGINS').fill('https://app.test.local');
    await page.getByTestId('config-input-FFMPEG_PATH').fill('/usr/bin/ffmpeg');
    await expect(save).toBeEnabled();

    await saveConfig(page);
    await expect(page.getByTestId('config-applied-banner')).toBeVisible();
    await expect(page.getByTestId('config-applied-banner')).toContainText('CORS_ORIGINS');
    await expect(page.getByTestId('config-restart-banner')).toBeVisible();
    await expect(page.getByTestId('config-restart-banner')).toContainText('FFMPEG_PATH');
    await expect(page.getByTestId('config-restart-banner')).not.toContainText('CORS_ORIGINS');

    // Applied immediately for T2 (async resolver reads the DB fresh).
    await expect
      .poll(() => getConfig(request).then((c) => c.CORS_ORIGINS.value))
      .toBe('https://app.test.local');
    const config = await getConfig(request);
    expect(config.CORS_ORIGINS.source).toBe('db');
    expect(config.FFMPEG_PATH.value).toBe('/usr/bin/ffmpeg');
    expect(config.FFMPEG_PATH.source).toBe('db');
  });

  test('server rejects a PUT to an env-sourced key with 400 configEnvSourcedProtected', async ({
    request,
  }) => {
    // PORT is .env-owned (PORT=5003 in the scratch .env, not DB-seeded) →
    // source 'env'. The WebDAV keys are DB-seeded here, so PORT stands in for
    // the env-sourced-row rejection (F4).
    const token = await loginToken(request);
    const res = await request.put(`${SCRATCH_BASE}/api/admin/config`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { values: { PORT: '5999' } },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.errorCode).toBe('serverErrors.admin.configEnvSourcedProtected');
    expect(body.params).toEqual({ key: 'PORT' });

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

    // FFMPEG_PATH is a non-connection T1 key (Save not gated by D1), so the
    // restart persistence is exercised deterministically.
    await page.getByTestId('config-input-FFMPEG_PATH').fill('/usr/bin/ffmpeg');
    await saveConfig(page);
    await expect(page.getByTestId('config-restart-banner')).toContainText('FFMPEG_PATH');

    // Restart the scratch server (same .env + sqlite persist in the scratch dir).
    await killScratch(spawned!);
    spawned = spawnScratchServer(scratch);
    await waitForScratchHealth(spawned);

    const config = await getConfig(request);
    expect(config.FFMPEG_PATH.value).toBe('/usr/bin/ffmpeg');
    expect(config.FFMPEG_PATH.source).toBe('db');

    await loginAsAdmin(page);
    await openAdvancedSettings(page);
    await expect(page.getByTestId('config-input-FFMPEG_PATH')).toHaveValue('/usr/bin/ffmpeg');
  });

  test('connection-key gating: editing WEBDAV_URL blocks Save and a failed test keeps it blocked', async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page);
    await openAdvancedSettings(page);

    // The WebDAV keys are DB-seeded → editable rows, not env-locked (D1 needs
    // an editable connection key).
    const config = await getConfig(request);
    expect(config.WEBDAV_URL.source).toBe('db');

    const save = page.getByTestId('config-save');
    const testButton = page.getByTestId('config-test-connection');
    const status = page.getByTestId('config-connection-test-status');

    // Re-enter the password so the probe actually reaches the network layer.
    await page.getByTestId('config-secret-toggle-WEBDAV_PASSWORD').click();
    await page.getByTestId('config-secret-new-WEBDAV_PASSWORD').fill('e2etest123');

    // Editing a connection key → Save disabled + Test control + gating hint.
    await page.getByTestId('config-input-WEBDAV_URL').fill('http://127.0.0.1:59999');
    await expect(save).toBeDisabled();
    await expect(testButton).toBeVisible();
    await expect(page.getByTestId('config-connection-test-required')).toBeVisible();

    // A failing connection test (unreachable port) leaves Save disabled. The
    // transport retries 5xx responses (httpClient retry-on-5xx), so the client
    // stays in the "Testing..." state for a few seconds before the error lands.
    const testResp = page.waitForResponse((r) => r.url().includes('/api/admin/config/test'));
    await testButton.click();
    await expect(status).toBeVisible();
    await testResp;
    await expect(status).not.toContainText('Testing...', { timeout: 20000 });
    await expect(save).toBeDisabled();
  });

  test('connection-key gating: a passing test enables Save, editing invalidates', async ({
    page,
  }) => {
    test.skip(!(await detectWebdavReachable()), 'WebDAV :8090 unreachable — skipping success path');

    await loginAsAdmin(page);
    await openAdvancedSettings(page);

    const save = page.getByTestId('config-save');
    const testButton = page.getByTestId('config-test-connection');
    const status = page.getByTestId('config-connection-test-status');

    await page.getByTestId('config-secret-toggle-WEBDAV_PASSWORD').click();
    await page.getByTestId('config-secret-new-WEBDAV_PASSWORD').fill('e2etest123');
    await page.getByTestId('config-input-WEBDAV_URL').fill(WEBDAV_BASE);
    await expect(save).toBeDisabled();

    const testResp = page.waitForResponse((r) => r.url().includes('/api/admin/config/test'));
    await testButton.click();
    await testResp;
    await expect(status).toContainText('Connection successful.');
    await expect(save).toBeEnabled();

    // Editing the connection key again invalidates the passing result.
    await page.getByTestId('config-input-WEBDAV_URL').fill(`${WEBDAV_BASE}/changed`);
    await expect(status).toHaveCount(0);
    await expect(save).toBeDisabled();
  });

  test('non-connection keys save without requiring a connection test', async ({
    page,
    request,
  }) => {
    await loginAsAdmin(page);
    await openAdvancedSettings(page);

    const save = page.getByTestId('config-save');
    await page.getByTestId('config-input-GC_ORPHAN_TTL_DAYS').fill('7');
    await expect(save).toBeEnabled();
    await expect(page.getByTestId('config-test-connection')).toHaveCount(0);
    await expect(page.getByTestId('config-connection-test-required')).toHaveCount(0);

    await saveConfig(page);
    await expect(page.getByTestId('config-applied-banner')).toContainText('GC_ORPHAN_TTL_DAYS');
    await expect
      .poll(() => getConfig(request).then((c) => c.GC_ORPHAN_TTL_DAYS.value))
      .toBe('7');
  });

  test('T0 metadata group is absent from Advanced settings (D5)', async ({ page }) => {
    await loginAsAdmin(page);
    await openAdvancedSettings(page);

    await expect(page.getByTestId('config-input-WEA_STORAGE_BACKEND')).toHaveCount(0);
    await expect(page.getByTestId('config-input-WEA_PG_HOST')).toHaveCount(0);
  });
});

test.describe('Phase B backend health & config/test API', () => {
  test('POST /api/admin/config/test returns the documented shape and rejects unknown targets', async ({
    request,
  }) => {
    const token = await loginToken(request);
    const headers = { Authorization: `Bearer ${token}` };

    // Documented contract (B3): `{ ok:true }` or `{ ok:false, errorCode,
    // message, reason? }`. Assert the shape, never the outcome.
    const res = await request.post(`${SCRATCH_BASE}/api/admin/config/test`, {
      headers,
      data: {
        target: 'webdav',
        WEBDAV_URL: WEBDAV_BASE,
        WEBDAV_USERNAME: 'e2etest',
        WEBDAV_PASSWORD: 'e2etest123',
      },
    });
    const body = await res.json();
    if (body.ok === true) {
      expect(res.status()).toBe(200);
      expect(body).toEqual({ ok: true });
    } else {
      expect(body.ok).toBe(false);
      expect(typeof body.errorCode).toBe('string');
      expect(body.errorCode.length).toBeGreaterThan(0);
      expect(typeof body.message).toBe('string');
      expect(body.message.length).toBeGreaterThan(0);
      if (body.reason !== undefined) expect(typeof body.reason).toBe('string');
    }

    // Unsupported target → 400 with the failure shape.
    const bad = await request.post(`${SCRATCH_BASE}/api/admin/config/test`, {
      headers,
      data: { target: 'ftp' },
    });
    expect(bad.status()).toBe(400);
    const badBody = await bad.json();
    expect(badBody.ok).toBe(false);
    expect(typeof badBody.errorCode).toBe('string');
  });

  test('System Settings renders the backend health card', async ({ page }) => {
    await loginAsAdmin(page);
    await openSystemSettings(page);

    const card = page.getByTestId('backend-health-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText(/postgresql|s3|webdav/);
  });

  test('file screen shows the admin backend-health banner when a backend is failing', async ({
    page,
    request,
  }) => {
    const token = await loginToken(request);
    const headers = { Authorization: `Bearer ${token}` };

    // The tracker is reset to 'unknown' after the boot probe, so its webdav
    // state settles only on a runtime access (D2). Seed it deterministically
    // with the connection probe, then read the settled status as ground truth
    // for what the banner must render.
    const probe = await request.post(`${SCRATCH_BASE}/api/admin/config/test`, {
      headers,
      data: {
        target: 'webdav',
        WEBDAV_URL: WEBDAV_BASE,
        WEBDAV_USERNAME: 'e2etest',
        WEBDAV_PASSWORD: 'e2etest123',
      },
    });
    await probe.json();

    const healthRes = await request.get(`${SCRATCH_BASE}/api/admin/health`, { headers });
    expect(healthRes.ok()).toBeTruthy();
    const webdavStatus = (await healthRes.json()).backends.webdav.status as string;
    expect(['ok', 'fail']).toContain(webdavStatus);

    await loginAsAdmin(page);
    const healthResp = page.waitForResponse((r) => r.url().includes('/api/health'));
    await page.goto('/files');
    await healthResp;

    const banner = page.getByTestId('backend-health-banner');
    if (webdavStatus === 'fail') {
      await expect(banner).toBeVisible();
    } else {
      await expect(banner).toHaveCount(0);
    }
  });
});
