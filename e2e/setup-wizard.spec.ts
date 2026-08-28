import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { TEST_FILES } from './fixtures/test-data';
import { readTestFileFixture } from './helpers/files';
import {
  createScratchPgDb,
  dropScratchPgDb,
  ensureClientBuild,
  ensureWebdavSubtree,
  killScratch,
  queryScratchPg,
  queryScratchSqlite,
  readEnvFile,
  scratchDirFor,
  scratchPort,
  spawnScratchServer,
  waitForScratchHealth,
} from './helpers/setupScratch';

/**
 * First-run setup wizard E2E (E2E-SETUP-001..004) — PLAN.md §7.
 *
 * Hermetic by design: this spec NEVER touches the shared E2E state. Each case
 * spawns its own scratch server on :5003 (own env file via DOTENV_CONFIG_PATH,
 * own sqlite path, own scratch PG database `webdav_e2e_setup`), drives the
 * wizard in the browser, asserts the exact scratch `.env`, restarts the process
 * (restart is the behavior under test), then verifies the configured app.
 *
 * The shared :5002 server and :3000 client still boot for the run (config-level
 * webServer) but are unused by these projects.
 *
 * Serial: cases share the scratch PG database lifecycle and the webdav subtree
 * namespace; they must not run concurrently (config-level webServer keeps
 * `--workers=1` for the suite; `serial` guards direct `--project` runs).
 */

const require = createRequire(__filename);

const backendMode = process.env.E2E_BACKEND_MODE || 's3';

const WEBDAV_BASE = 'http://127.0.0.1:8090';
const WEBDAV_USERNAME = 'e2etest';
const WEBDAV_PASSWORD = 'e2etest123';

const S3_BUCKET = 'e2e-test-bucket';
const S3_REGION = 'us-east-1';
const S3_ACCESS_KEY = 'minioadmin';
const S3_SECRET_KEY = 'minioadmin';
const S3_ENDPOINT = 'http://127.0.0.1:9010';

const PG_HOST = '127.0.0.1';
const PG_PORT = '5433';
const PG_USER = 'e2etest';
const PG_PASSWORD = 'e2etest';
const SCRATCH_PG_DB = 'webdav_e2e_setup';

const textFixture = readTestFileFixture(TEST_FILES.smallText);

// Wizard apply always emits these three keys (PORT prefilled from the running
// scratch PORT; EMAIL_PORT/EMAIL_SECURE come from the SMTP block defaults).
const COMMON_WRITTEN_KEYS = {
  PORT: String(scratchPort),
  EMAIL_PORT: '587',
  EMAIL_SECURE: 'false',
};

// Per-test scratch state, cleaned up in afterEach (PLAN.md §7.2 step 8).
let spawnedChild: ReturnType<typeof spawnScratchServer> | null = null;
let currentScratch: string | null = null;
let usedScratchPgDb = false;

test.describe.configure({ mode: 'serial' });

test.afterEach(async () => {
  if (spawnedChild) {
    await killScratch(spawnedChild);
    spawnedChild = null;
  }
  if (currentScratch) {
    fs.rmSync(currentScratch, { recursive: true, force: true });
    currentScratch = null;
  }
  if (usedScratchPgDb) {
    await dropScratchPgDb().catch(() => {});
    usedScratchPgDb = false;
  }
});

type MetadataConfig =
  | { backend: 'sqlite' }
  | {
      backend: 'postgresql';
      host: string;
      port: string;
      database: string;
      user: string;
      password: string;
    };

type FileConfig =
  | {
      backend: 's3';
      bucket: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      endpoint: string;
    }
  | { backend: 'webdav'; url: string; username: string; password: string };

type CaseConfig = {
  caseId: string;
  adminPassword: string;
  jwtSecret: string;
  metadata: MetadataConfig;
  file: FileConfig;
};

function buildWebdavUrl(caseId: string): string {
  return `${WEBDAV_BASE}/setup-e2e/${caseId}`;
}

async function clickNext(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Next' }).click();
}

/**
 * Drive the wizard end-to-end in the browser (all five steps) and land on the
 * "Restart required" screen. Preconditions: boot 1 healthy on :5003 in setup
 * mode; webdav subtree (webdav cases) and scratch PG DB (pg cases) ready.
 */
async function driveWizard(page: Page, config: CaseConfig): Promise<void> {
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'Server setup' })).toBeVisible();

  // Step 0 — metadata backend
  if (config.metadata.backend === 'postgresql') {
    await page.getByRole('radio', { name: 'PostgreSQL' }).check();
    await page.getByTestId('setup-pg-host').fill(config.metadata.host);
    await page.getByTestId('setup-pg-port').fill(config.metadata.port);
    await page.getByTestId('setup-pg-database').fill(config.metadata.database);
    await page.getByTestId('setup-pg-user').fill(config.metadata.user);
    await page.getByTestId('setup-pg-password').fill(config.metadata.password);
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('Connection successful.')).toBeVisible();
  }
  await clickNext(page);

  // Step 1 — file storage
  if (config.file.backend === 'webdav') {
    await page.getByRole('radio', { name: 'WebDAV' }).check();
    await page.getByTestId('setup-webdav-url').fill(config.file.url);
    await page.getByTestId('setup-webdav-username').fill(config.file.username);
    await page.getByTestId('setup-webdav-password').fill(config.file.password);
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('Connection successful.')).toBeVisible();
  } else {
    await page.getByRole('radio', { name: 'S3 (or S3-compatible)' }).check();
    await page.getByTestId('setup-s3-bucket').fill(config.file.bucket);
    await page.getByTestId('setup-s3-region').fill(config.file.region);
    await page.getByTestId('setup-s3-accessKeyId').fill(config.file.accessKeyId);
    await page.getByTestId('setup-s3-secretAccessKey').fill(config.file.secretAccessKey);
    await page.getByTestId('setup-s3-endpoint').fill(config.file.endpoint);
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('Connection successful.')).toBeVisible();
  }
  await clickNext(page);

  // Step 2 — admin password + JWT secret (fixed values for deterministic .env)
  await page.getByTestId('setup-admin-password').fill(config.adminPassword);
  await page.getByTestId('setup-jwt-secret').fill(config.jwtSecret);
  await clickNext(page);

  // Step 3 — optional settings (leave wizard defaults; PORT prefilled)
  await clickNext(page);

  // Step 4 — apply
  await page.getByRole('button', { name: 'Apply & finish' }).click();
  await expect(page.getByText('Restart required')).toBeVisible();
}

function buildExpectedEnv(config: CaseConfig): Record<string, string> {
  const expected: Record<string, string> = {
    WEA_STORAGE_BACKEND: config.metadata.backend,
    WEA_FILE_STORAGE: config.file.backend,
    JWT_SECRET: config.jwtSecret,
    JWT_EXPIRES_IN: '30m',
    ...COMMON_WRITTEN_KEYS,
  };

  if (config.metadata.backend === 'postgresql') {
    Object.assign(expected, {
      WEA_PG_HOST: config.metadata.host,
      WEA_PG_PORT: config.metadata.port,
      WEA_PG_DATABASE: config.metadata.database,
      WEA_PG_USER: config.metadata.user,
      WEA_PG_PASSWORD: config.metadata.password,
      WEA_PG_SSL: 'false',
      ADMIN_DEFAULT_PASSWORD: config.adminPassword,
    });
  }

  if (config.file.backend === 'webdav') {
    Object.assign(expected, {
      WEBDAV_URL: config.file.url,
      WEBDAV_USERNAME: config.file.username,
      WEBDAV_PASSWORD: config.file.password,
      WEBDAV_AUTH_TYPE: 'auto',
    });
  } else {
    Object.assign(expected, {
      S3_BUCKET: config.file.bucket,
      AWS_REGION: config.file.region,
      AWS_ACCESS_KEY_ID: config.file.accessKeyId,
      AWS_SECRET_ACCESS_KEY: config.file.secretAccessKey,
      S3_ENDPOINT: config.file.endpoint,
    });
  }

  return expected;
}

function assertScratchEnv(scratchDir: string, expected: Record<string, string>): void {
  const env = readEnvFile(scratchDir);
  expect(env).toEqual(expected);
}

async function loginToken(
  request: APIRequestContext,
  username: string,
  password: string
): Promise<string> {
  const res = await request.post('/api/auth/login', { data: { username, password } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.token as string;
}

/** Create folder at admin root, upload the text fixture, download, compare bytes. */
async function assertFileRoundTrip(
  request: APIRequestContext,
  token: string,
  prefix: string
): Promise<void> {
  const folderName = `${prefix}-${Date.now()}`;
  const folderRes = await request.post('/api/folders/create', {
    headers: { Authorization: `Bearer ${token}` },
    data: { parentNodeId: null, name: folderName },
  });
  expect(folderRes.ok()).toBeTruthy();
  const folderNodeId = (await folderRes.json()).nodeId as number;

  const fileName = `${folderName}.txt`;
  const uploadRes = await request.post('/api/files/upload', {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: fileName, mimeType: 'text/plain', buffer: textFixture },
      parentNodeId: String(folderNodeId),
      onConflict: 'overwrite',
    },
  });
  expect(uploadRes.ok()).toBeTruthy();
  const nodeId = (await uploadRes.json()).nodeId as number;

  const downloadRes = await request.get(`/api/files/download?nodeId=${nodeId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(downloadRes.ok()).toBeTruthy();
  const downloaded = await downloadRes.body();
  expect(downloaded).toEqual(textFixture);
}

async function loginViaUi(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login');
  await expect(page.locator('input[name="username"]')).toBeVisible();
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/files(?:\/.*)?$/),
    page.locator('form button[type="submit"]').click(),
  ]);
}

type AfterRestartContext = {
  scratch: string;
  page: Page;
  request: APIRequestContext;
  config: CaseConfig;
};

/**
 * Full per-case lifecycle (PLAN.md §7.2): scratch dir → build check → boot 1 →
 * wizard → exact .env assert → restart → boot 2 → case assertions.
 */
async function runSetupScenario(
  config: CaseConfig,
  page: Page,
  request: APIRequestContext,
  afterRestart: (ctx: AfterRestartContext) => Promise<void>
): Promise<void> {
  const scratch = scratchDirFor(config.caseId);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  currentScratch = scratch;

  ensureClientBuild();

  if (config.metadata.backend === 'postgresql') {
    await createScratchPgDb();
    usedScratchPgDb = true;
  }
  if (config.file.backend === 'webdav') {
    await ensureWebdavSubtree(config.caseId);
  }

  // Boot 1 — no .env yet → the server must come up in setup mode.
  const boot1 = spawnScratchServer(scratch);
  spawnedChild = boot1;
  await waitForScratchHealth(boot1);

  await driveWizard(page, config);
  assertScratchEnv(scratch, buildExpectedEnv(config));

  // Restart — the .env now exists; boot 2 must boot fully configured.
  await killScratch(boot1);
  spawnedChild = null;
  const boot2 = spawnScratchServer(scratch);
  spawnedChild = boot2;
  await waitForScratchHealth(boot2);

  await afterRestart({ scratch, page, request, config });
}

test.describe('First-run setup wizard (E2E-SETUP-001..004)', () => {
  test('E2E-SETUP-001 (Case 1, both modes): sqlite + webdav configure-and-restart', async ({
    page,
    request,
  }) => {
    const config: CaseConfig = {
      caseId: 'case-1-sqlite-webdav',
      adminPassword: 'SetupE2e!123',
      jwtSecret: 'e2e-setup-jwt-secret-case1',
      metadata: { backend: 'sqlite' },
      file: {
        backend: 'webdav',
        url: buildWebdavUrl('case-1-sqlite-webdav'),
        username: WEBDAV_USERNAME,
        password: WEBDAV_PASSWORD,
      },
    };

    await runSetupScenario(config, page, request, async ({ request: req, config: cfg }) => {
      // Login with the wizard-chosen admin works after restart.
      const token = await loginToken(req, 'admin', cfg.adminPassword);

      // Upload + download round-trip against the webdav subtree.
      await assertFileRoundTrip(req, token, 'setup-001');

      // Browser: admin login lands in the explorer.
      await loginViaUi(page, 'admin', cfg.adminPassword);
      await expect(page.getByTestId('file-actions-fab')).toBeVisible();

      // /setup is no longer reachable — it redirects to /login.
      await page.goto('/setup');
      await page.waitForURL(/\/login$/);
    });
  });

  test('E2E-SETUP-002 (Case 2, s3 mode only): sqlite + s3 writes S3_* keys', async ({
    page,
    request,
  }) => {
    test.skip(backendMode !== 's3', 'E2E-SETUP-002 runs only in s3 backend mode');

    const config: CaseConfig = {
      caseId: 'case-2-sqlite-s3',
      adminPassword: 'SetupE2e!123',
      jwtSecret: 'e2e-setup-jwt-secret-case2',
      metadata: { backend: 'sqlite' },
      file: {
        backend: 's3',
        bucket: S3_BUCKET,
        region: S3_REGION,
        accessKeyId: S3_ACCESS_KEY,
        secretAccessKey: S3_SECRET_KEY,
        endpoint: S3_ENDPOINT,
      },
    };

    await runSetupScenario(config, page, request, async ({ request: req, config: cfg }) => {
      const token = await loginToken(req, 'admin', cfg.adminPassword);
      await assertFileRoundTrip(req, token, 'setup-002');

      await loginViaUi(page, 'admin', cfg.adminPassword);
      await expect(page.getByTestId('file-actions-fab')).toBeVisible();

      await page.goto('/setup');
      await page.waitForURL(/\/login$/);
    });
  });

  test('E2E-SETUP-003 (Case 3, both modes): postgresql + webdav seeds scratch PG, not scratch sqlite', async ({
    page,
    request,
  }) => {
    const config: CaseConfig = {
      caseId: 'case-3-pg-webdav',
      adminPassword: 'SetupE2e!123',
      jwtSecret: 'e2e-setup-jwt-secret-case3',
      metadata: {
        backend: 'postgresql',
        host: PG_HOST,
        port: PG_PORT,
        database: SCRATCH_PG_DB,
        user: PG_USER,
        password: PG_PASSWORD,
      },
      file: {
        backend: 'webdav',
        url: buildWebdavUrl('case-3-pg-webdav'),
        username: WEBDAV_USERNAME,
        password: WEBDAV_PASSWORD,
      },
    };

    await runSetupScenario(
      config,
      page,
      request,
      async ({ scratch, request: req, config: cfg }) => {
        const token = await loginToken(req, 'admin', cfg.adminPassword);

        // The scratch PG database is the metadata store of record: schema
        // migrations applied and admin seeded with ADMIN_DEFAULT_PASSWORD.
        const migrations = await queryScratchPg<{ filename: string }>(
          SCRATCH_PG_DB,
          'SELECT filename FROM _schema_migrations'
        );
        expect(migrations.length).toBeGreaterThan(0);

        const admins = await queryScratchPg<{
          username: string;
          password: string;
          is_admin: boolean;
        }>(
          SCRATCH_PG_DB,
          "SELECT username, password, is_admin FROM users WHERE username = 'admin'"
        );
        expect(admins).toHaveLength(1);
        expect(admins[0].is_admin).toBeTruthy();
        const bcrypt = require('bcryptjs') as {
          compare: (plain: string, hash: string) => Promise<boolean>;
        };
        expect(await bcrypt.compare(cfg.adminPassword, admins[0].password)).toBeTruthy();

        // The scratch sqlite file exists (created during the default-sqlite boot
        // 1) but the wizard's postgresql apply did NOT seed the wizard admin into
        // it — it only holds the boot-time default admin, never the wizard's.
        const dbPath = path.join(scratch, 'webdav.db');
        expect(fs.existsSync(dbPath)).toBeTruthy();
        const sqliteAdmins = await queryScratchSqlite<{ username: string; password: string }>(
          dbPath,
          'SELECT username, password FROM users'
        );
        expect(sqliteAdmins).toHaveLength(1);
        expect(sqliteAdmins[0].username).toBe('admin');
        expect(await bcrypt.compare(cfg.adminPassword, sqliteAdmins[0].password)).toBeFalsy();

        // Post-restart upload/download round-trip and /setup lockout.
        await assertFileRoundTrip(req, token, 'setup-003');
        await loginViaUi(page, 'admin', cfg.adminPassword);
        await expect(page.getByTestId('file-actions-fab')).toBeVisible();
        await page.goto('/setup');
        await page.waitForURL(/\/login$/);
      }
    );
  });

  test('E2E-SETUP-004 (Case 4, both modes): complete-state gate locks the wizard and file APIs stay live', async ({
    page,
    request,
  }) => {
    // Self-contained: repeat the sqlite+webdav flow (the Case 1 shape) to reach
    // a completed setup, then assert the security gate. Per-case lifecycle is
    // preserved (PLAN.md §7.2 step 8 cleans up after every case).
    const config: CaseConfig = {
      caseId: 'case-4-security-webdav',
      adminPassword: 'SetupE2e!123',
      jwtSecret: 'e2e-setup-jwt-secret-case4',
      metadata: { backend: 'sqlite' },
      file: {
        backend: 'webdav',
        url: buildWebdavUrl('case-4-security-webdav'),
        username: WEBDAV_USERNAME,
        password: WEBDAV_PASSWORD,
      },
    };

    await runSetupScenario(config, page, request, async ({ request: req, config: cfg }) => {
      // apply/test are 403 once setup is complete.
      const applyRes = await req.post('/api/setup/apply', { data: {} });
      expect(applyRes.status()).toBe(403);
      const applyBody = await applyRes.json();
      expect(applyBody.errorCode).toBe('serverErrors.setup.complete');

      const testRes = await req.post('/api/setup/test', {
        data: {
          target: 'webdav',
          url: config.file.url,
          username: WEBDAV_USERNAME,
          password: WEBDAV_PASSWORD,
        },
      });
      expect(testRes.status()).toBe(403);

      // /setup redirects to /login.
      await loginViaUi(page, 'admin', cfg.adminPassword);
      await expect(page.getByTestId('file-actions-fab')).toBeVisible();
      await page.goto('/setup');
      await page.waitForURL(/\/login$/);

      // File APIs still work after the lockout.
      const token = await loginToken(req, 'admin', cfg.adminPassword);
      await assertFileRoundTrip(req, token, 'setup-004');
    });
  });
});
