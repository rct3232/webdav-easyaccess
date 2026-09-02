import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { TEST_FILES } from './fixtures/test-data';
import { loginWithCredentials } from './helpers/auth';
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
  writeScratchEnv,
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
 * D6/D7 (Phase B): the metadata DB connection is `.env`-owned, so each case
 * writes a scratch `.env` BEFORE boot 1 that declares the backend explicitly
 * (sqlite + WEA_SQLITE_PATH, or postgresql + full WEA_PG_*). The wizard serves
 * non-T0 only (no metadata step) and apply never writes WEA_STORAGE_BACKEND /
 * WEA_PG_* / WEA_SQLITE_PATH — the pre-written keys are asserted as present and
 * unmodified. The same file survives the boot1 → restart → boot2 sequence via
 * spawnScratchServer's DOTENV_CONFIG_PATH.
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
 * Drive the wizard end-to-end in the browser (file → admin → optional → apply)
 * and land on the "Restart required" screen. Preconditions: boot 1 healthy on
 * :5003 in setup mode with the metadata DB already connected via the pre-boot
 * scratch `.env` (D6/D7); webdav subtree (webdav cases) and scratch PG DB (pg
 * cases) ready. There is no metadata/DB-backend step — the wizard starts at
 * file storage.
 */
async function driveWizard(page: Page, config: CaseConfig): Promise<void> {
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'Server setup' })).toBeVisible();

  // Step 0 — file storage
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

  // Step 1 — admin password + JWT secret (fixed values for deterministic .env)
  await page.getByTestId('setup-admin-password').fill(config.adminPassword);
  await page.getByTestId('setup-jwt-secret').fill(config.jwtSecret);
  await clickNext(page);

  // Step 2 — optional settings (leave wizard defaults; PORT prefilled)
  await clickNext(page);

  // Step 3 — apply
  await page.getByRole('button', { name: 'Apply & finish' }).click();
  await expect(page.getByText('Restart required')).toBeVisible();
}

/**
 * The scratch `.env` written BEFORE boot 1 (D6/D7): the metadata DB connection
 * is `.env`-owned and must be declared up front — the wizard serves non-T0 only
 * and apply never writes WEA_STORAGE_BACKEND / WEA_PG_* / WEA_SQLITE_PATH.
 * PORT/NODE_ENV mirror what spawnScratchServer sets; JWT_SECRET and
 * encrypt_secret_key are pre-provisioned so apply keeps them (only-re-encrypt /
 * keep-existing master key). `encrypt_secret_key` is a fixed 64-hex value for
 * deterministic assertions.
 */
function buildPreBootEnv(scratch: string, config: CaseConfig): Record<string, string> {
  const env: Record<string, string> = {
    JWT_SECRET: config.jwtSecret,
    PORT: String(scratchPort),
    NODE_ENV: 'test',
    encrypt_secret_key: 'a'.repeat(64),
  };

  if (config.metadata.backend === 'postgresql') {
    Object.assign(env, {
      WEA_STORAGE_BACKEND: 'postgresql',
      WEA_PG_HOST: config.metadata.host,
      WEA_PG_PORT: config.metadata.port,
      WEA_PG_DATABASE: config.metadata.database,
      WEA_PG_USER: config.metadata.user,
      WEA_PG_PASSWORD: config.metadata.password,
    });
  } else {
    Object.assign(env, {
      WEA_STORAGE_BACKEND: 'sqlite',
      WEA_SQLITE_PATH: path.join(scratch, 'webdav.db'),
    });
  }

  return env;
}

/**
 * Quick PostgreSQL reachability probe (own short-timeout pool). Used to skip
 * the PG-dependent case when docker/PG is unavailable, so the suite stays green
 * in PG-less environments.
 */
let pgReachable: boolean | null = null;
async function isPgReachable(): Promise<boolean> {
  if (pgReachable !== null) return pgReachable;
  const { Pool } = require('pg') as {
    Pool: new (c: {
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
      connectionTimeoutMillis: number;
    }) => {
      query: (text: string) => Promise<{ rows: unknown[] }>;
      end: () => Promise<void>;
    };
  };
  const pool = new Pool({
    host: PG_HOST,
    port: Number(PG_PORT),
    database: 'postgres',
    user: PG_USER,
    password: PG_PASSWORD,
    connectionTimeoutMillis: 2000,
  });
  try {
    await pool.query('SELECT 1');
    pgReachable = true;
  } catch {
    pgReachable = false;
  } finally {
    await pool.end().catch(() => {});
  }
  return pgReachable;
}

/**
 * Non-T0 wizard values that must be upserted into the metadata DB `settings`
 * table (row key = raw env var name). Secrets are stored encrypted (asserted
 * separately as an aes-256-gcm payload, never plaintext).
 */
function buildExpectedDbSettings(config: CaseConfig): Record<string, string> {
  const expected: Record<string, string> = {
    WEA_FILE_STORAGE: config.file.backend,
    PORT: String(scratchPort),
    JWT_EXPIRES_IN: '30m',
    EMAIL_PORT: '587',
    EMAIL_SECURE: 'false',
  };

  if (config.file.backend === 'webdav') {
    Object.assign(expected, {
      WEBDAV_URL: config.file.url,
      WEBDAV_USERNAME: config.file.username,
      WEBDAV_AUTH_TYPE: 'auto',
    });
  } else {
    Object.assign(expected, {
      S3_BUCKET: config.file.bucket,
      AWS_REGION: config.file.region,
      AWS_ACCESS_KEY_ID: config.file.accessKeyId,
      S3_ENDPOINT: config.file.endpoint,
    });
  }

  return expected;
}

function secretKeysFor(config: CaseConfig): string[] {
  return config.file.backend === 'webdav' ? ['WEBDAV_PASSWORD'] : ['AWS_SECRET_ACCESS_KEY'];
}

/** sqlite stores secret rows raw (payload JSON string); PG jsonb returns the same JSON string. */
function tryParseJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Assert the scratch `.env` after apply. apply's only `.env` writes under D7
 * are JWT_SECRET (already pre-written with the same value) and
 * encrypt_secret_key when absent — both are pre-provisioned here, so the parsed
 * file must equal the pre-boot map exactly: the backend keys
 * (WEA_STORAGE_BACKEND, WEA_SQLITE_PATH / WEA_PG_*) are still present and
 * unmodified by apply.
 */
function assertScratchEnv(scratchDir: string, config: CaseConfig): void {
  const env = readEnvFile(scratchDir);
  expect(env).toEqual(buildPreBootEnv(scratchDir, config));
}

/** Assert the non-T0 wizard values landed in the metadata DB settings table. */
async function assertScratchDbSettings(scratch: string, config: CaseConfig): Promise<void> {
  const expected = buildExpectedDbSettings(config);
  const secretKeys = secretKeysFor(config);

  if (config.metadata.backend === 'postgresql') {
    const rows = await queryScratchPg<{ key: string; value: unknown }>(
      SCRATCH_PG_DB,
      'SELECT key, value FROM settings'
    );
    const settings = new Map(rows.map((r) => [r.key, r.value]));
    for (const [key, value] of Object.entries(expected)) {
      expect(settings.get(key), `settings.${key}`).toBe(value);
    }
    for (const key of secretKeys) {
      const raw = settings.get(key);
      expect(raw, `settings.${key} (encrypted)`).toBeDefined();
      expect(tryParseJson(raw), `settings.${key} (encrypted)`).toMatchObject({
        enc: 'aes-256-gcm',
      });
    }
    return;
  }

  const dbPath = path.join(scratch, 'webdav.db');
  const rows = await queryScratchSqlite<{ key: string; value: string }>(
    dbPath,
    'SELECT key, value FROM settings'
  );
  // sqlite stores values RAW (no JSON stringify): plaintext stays a plain
  // string (compare verbatim); a secret is the payload JSON string (parse once).
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  for (const [key, value] of Object.entries(expected)) {
    expect(byKey.get(key), `settings.${key}`).toBe(value);
  }
  for (const key of secretKeys) {
    const raw = byKey.get(key);
    expect(raw, `settings.${key} (encrypted)`).toBeDefined();
    expect(tryParseJson(raw), `settings.${key} (encrypted)`).toMatchObject({ enc: 'aes-256-gcm' });
  }
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

  // Pre-boot `.env` declaring the metadata backend (D6/D7): the DB connection
  // is `.env`-owned, so boot 1 already connects to it and the wizard serves
  // non-T0 only. The file survives the boot1 → restart → boot2 sequence via
  // spawnScratchServer's DOTENV_CONFIG_PATH.
  writeScratchEnv(scratch, buildPreBootEnv(scratch, config));

  if (config.metadata.backend === 'postgresql') {
    await createScratchPgDb();
    usedScratchPgDb = true;
  }
  if (config.file.backend === 'webdav') {
    await ensureWebdavSubtree(config.caseId);
  }

  // Boot 1 — DB already connected via the pre-written .env; the server must
  // come up in setup mode because the non-T0 (file-storage) config is missing.
  const boot1 = spawnScratchServer(scratch);
  spawnedChild = boot1;
  await waitForScratchHealth(boot1);

  await driveWizard(page, config);
  assertScratchEnv(scratch, config);
  await assertScratchDbSettings(scratch, config);

  // Restart — the .env now exists; boot 2 must boot fully configured.
  await killScratch(boot1);
  spawnedChild = null;
  const boot2 = spawnScratchServer(scratch);
  spawnedChild = boot2;
  await waitForScratchHealth(boot2);

  await afterRestart({ scratch, page, request, config });
}

test.describe('first-run setup wizard (E2E-SETUP-001..004)', () => {
  test('E2E-SETUP-001 (Case 1, both modes): Sqlite + webdav configure-and-restart', async ({
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
      await loginWithCredentials(page, 'admin', cfg.adminPassword);
      await expect(page.getByTestId('file-actions-fab')).toBeVisible();

      // /setup is no longer reachable — it redirects to /login.
      await page.goto('/setup');
      await page.waitForURL(/\/login$/);
    });
  });

  test('E2E-SETUP-002 (Case 2, s3 mode only): Sqlite + s3 writes S3_* keys', async ({
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

      await loginWithCredentials(page, 'admin', cfg.adminPassword);
      await expect(page.getByTestId('file-actions-fab')).toBeVisible();

      await page.goto('/setup');
      await page.waitForURL(/\/login$/);
    });
  });

  test('E2E-SETUP-003 (Case 3, both modes): Postgresql + webdav seeds scratch PG, not scratch sqlite', async ({
    page,
    request,
  }) => {
    test.skip(
      !(await isPgReachable()),
      'E2E-SETUP-003 requires reachable scratch PostgreSQL (:5433)'
    );

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

        // Under D6/D7 the default-sqlite fallback boot no longer exists: the
        // pre-boot .env declared postgresql, so the scratch sqlite file is never
        // created.
        const dbPath = path.join(scratch, 'webdav.db');
        expect(fs.existsSync(dbPath)).toBeFalsy();

        // Post-restart upload/download round-trip and /setup lockout.
        await assertFileRoundTrip(req, token, 'setup-003');
        await loginWithCredentials(page, 'admin', cfg.adminPassword);
        await expect(page.getByTestId('file-actions-fab')).toBeVisible();
        await page.goto('/setup');
        await page.waitForURL(/\/login$/);
      }
    );
  });

  test('E2E-SETUP-004 (Case 4, both modes): Complete-state gate locks the wizard and file APIs stay live', async ({
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
      await loginWithCredentials(page, 'admin', cfg.adminPassword);
      await expect(page.getByTestId('file-actions-fab')).toBeVisible();
      await page.goto('/setup');
      await page.waitForURL(/\/login$/);

      // File APIs still work after the lockout.
      const token = await loginToken(req, 'admin', cfg.adminPassword);
      await assertFileRoundTrip(req, token, 'setup-004');
    });
  });
});
