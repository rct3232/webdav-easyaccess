import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { ChildProcess } from 'node:child_process';

import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { TEST_FILES } from './fixtures/test-data';
import { readTestFileFixture } from './helpers/files';
import { e2ePorts, s3Endpoint } from './helpers/ports';
import {
  createScratchPgDb,
  dropScratchPgDb,
  ensureClientBuild,
  ensureWebdavSubtree,
  killScratch,
  prepareScratchStorage,
  queryScratchPg,
  queryScratchSqlite,
  readEnvFile,
  scratchDirFor,
  scratchProjectSlug,
  scratchRuntimeEnv,
  scratchWebdavUrl,
  spawnScratchServer,
  waitForScratchHealth,
  writeScratchEnv,
} from './helpers/setupScratch';

/**
 * Shared harness for the split first-run setup-wizard suites.
 *
 * `setup-wizard.s3.spec.ts` configures the default S3 backend. The WebDAV spec
 * keeps the inherently WebDAV-specific cases (sqlite+webdav, pg+webdav,
 * complete-state lockout).
 *
 * Hermetic by design: every case owns a project-scoped scratch directory, port
 * and WebDAV root (or S3 bucket), drives the wizard in the browser, asserts the
 * exact scratch `.env`, restarts the process (restart is the behavior under
 * test), then verifies the configured app. The shared :5002 server is unused.
 *
 * The wizard must write the storage settings itself, so the WebDAV root is
 * prepared with `ensureWebdavSubtree` instead of `prepareScratchWebdav`: seeding
 * WEBDAV_* into the scratch DB would make the wizard's DB assertions pass even
 * if apply never wrote them. The S3 path uses `prepareScratchStorage` only for
 * its project bucket (no DB seeding), preserving the same property.
 */

const require = createRequire(__filename);

export const WEBDAV_USERNAME = 'e2etest';
export const WEBDAV_PASSWORD = 'e2etest123';

export const PG_HOST = '127.0.0.1';
export const PG_PORT = String(e2ePorts.pg);
export const PG_USER = 'e2etest';
export const PG_PASSWORD = 'e2etest';
export const S3_ENDPOINT = s3Endpoint;
export const S3_REGION = 'us-east-1';
export const S3_ACCESS_KEY = 'minioadmin';
export const S3_SECRET_KEY = 'minioadmin';

const textFixture = readTestFileFixture(TEST_FILES.smallText);

export type MetadataConfig =
  | { backend: 'sqlite' }
  | {
      backend: 'postgresql';
      host: string;
      port: string;
      database: string;
      user: string;
      password: string;
    };

export type FileConfig =
  | {
      backend: 's3';
      bucket: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      endpoint: string;
    }
  | { backend: 'webdav'; url: string; username: string; password: string };

export type CaseConfig = {
  caseId: string;
  adminPassword: string;
  jwtSecret: string;
  metadata: MetadataConfig;
  file: FileConfig;
};

export type AfterRestartContext = {
  scratch: string;
  page: Page;
  request: APIRequestContext;
  config: CaseConfig;
  apiBaseURL: string;
};

/** The setup-wizard scratch port for the project's platform. */
export function setupWizardPort(projectName: string): number {
  return projectName.endsWith('-mobile') ? e2ePorts.scratchWizardMobile : e2ePorts.scratchWizard;
}

/**
 * Project-scoped scratch PG database. Desktop and mobile must never share a
 * database, and PG identifiers cannot contain hyphens unquoted.
 */
export function setupWizardPgDb(projectName: string): string {
  const slug = scratchProjectSlug(projectName).replace(/-/g, '_');
  return `webdav_e2e_setup_${slug}`;
}

/** The case's project-scoped WebDAV root URL. */
export function buildWebdavUrl(caseId: string, projectName: string): string {
  return scratchWebdavUrl(caseId, projectName);
}

async function clickNext(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Next' }).click();
}

/**
 * Drive the wizard end-to-end in the browser (file → admin → optional → AI → apply)
 * and land on the "Restart required" screen. Preconditions: boot 1 healthy in
 * setup mode with the metadata DB already connected via the pre-boot scratch
 * `.env` (D6/D7); the project-scoped WebDAV subtree (webdav cases) and scratch
 * PG DB (pg cases) ready. There is no metadata/DB-backend step — the wizard
 * starts at file storage.
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

  // Step 3 — AI is optional and skippable; advance without configuring a role.
  await clickNext(page);

  // Step 4 — apply
  await page.getByRole('button', { name: 'Apply & finish' }).click();
  await expect(page.getByText('Restart required')).toBeVisible();
}

/**
 * The scratch `.env` written BEFORE boot 1 (D6/D7): the metadata DB connection
 * is `.env`-owned and must be declared up front — the wizard serves non-T0 only
 * and apply never writes the T0 metadata keys. Backend selection is
 * presence-based: postgresql cases write the full `WEA_DB_*` identity block;
 * sqlite cases write only WEA_SQLITE_PATH (no WEA_DB_* key → sqlite is the
 * default). PORT/NODE_ENV mirror what spawnScratchServer sets; JWT_SECRET is
 * pre-provisioned so apply keeps the existing value.
 */
function buildPreBootEnv(
  scratch: string,
  config: CaseConfig,
  port: number
): Record<string, string> {
  const env: Record<string, string> = {
    JWT_SECRET: config.jwtSecret,
    PORT: String(port),
    NODE_ENV: 'test',
  };

  if (config.metadata.backend === 'postgresql') {
    Object.assign(env, {
      WEA_DB_HOST: config.metadata.host,
      WEA_DB_PORT: config.metadata.port,
      WEA_DB_DATABASE: config.metadata.database,
      WEA_DB_USER: config.metadata.user,
      WEA_DB_PASSWORD: config.metadata.password,
    });
  } else {
    Object.assign(env, {
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
export async function isPgReachable(): Promise<boolean> {
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
 * table (row key = raw env var name). Secrets are stored as plaintext
 * (app-layer encryption was removed) and asserted verbatim against the value
 * the wizard wrote.
 */
function buildExpectedDbSettings(config: CaseConfig, port: number): Record<string, string> {
  const expected: Record<string, string> = {
    WEA_FILE_STORAGE: config.file.backend,
    PORT: String(port),
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

/** The secret DB rows the wizard writes, as [row key, plaintext value] pairs. */
function secretRowsFor(config: CaseConfig): Array<[string, string]> {
  if (config.file.backend === 'webdav') {
    return [['WEBDAV_PASSWORD', config.file.password]];
  }
  return [['AWS_SECRET_ACCESS_KEY', config.file.secretAccessKey]];
}

/**
 * Assert the scratch `.env` after apply. apply's only `.env` writes under D7
 * are JWT_SECRET (already pre-written with the same value) — it is
 * pre-provisioned here, so the parsed file must equal the pre-boot map exactly:
 * the T0 metadata keys (the WEA_DB_* identity block / WEA_SQLITE_PATH) are
 * still present and unmodified by apply.
 */
function assertScratchEnv(scratchDir: string, config: CaseConfig, port: number): void {
  const env = readEnvFile(scratchDir);
  expect(env).toEqual(buildPreBootEnv(scratchDir, config, port));
}

/** Assert the non-T0 wizard values landed in the metadata DB settings table. */
async function assertScratchDbSettings(
  scratch: string,
  config: CaseConfig,
  port: number
): Promise<void> {
  const expected = buildExpectedDbSettings(config, port);
  const secretRows = secretRowsFor(config);

  if (config.metadata.backend === 'postgresql') {
    const rows = await queryScratchPg<{ key: string; value: unknown }>(
      config.metadata.database,
      'SELECT key, value FROM settings'
    );
    const settings = new Map(rows.map((r) => [r.key, r.value]));
    for (const [key, value] of Object.entries(expected)) {
      expect(settings.get(key), `settings.${key}`).toBe(value);
    }
    for (const [key, value] of secretRows) {
      expect(settings.get(key), `settings.${key} (plaintext)`).toBe(value);
    }
    return;
  }

  const dbPath = path.join(scratch, 'webdav.db');
  const rows = await queryScratchSqlite<{ key: string; value: string }>(
    dbPath,
    'SELECT key, value FROM settings'
  );
  // sqlite stores values RAW: plaintext stays a plain string (compare verbatim).
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  for (const [key, value] of Object.entries(expected)) {
    expect(byKey.get(key), `settings.${key}`).toBe(value);
  }
  for (const [key, value] of secretRows) {
    expect(byKey.get(key), `settings.${key} (plaintext)`).toBe(value);
  }
}

export async function loginToken(
  apiBaseURL: string,
  request: APIRequestContext,
  username: string,
  password: string
): Promise<string> {
  const res = await request.post(`${apiBaseURL}/api/auth/login`, {
    data: { username, password },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.token as string;
}

/** Create folder at admin root, upload the text fixture, download, compare bytes. */
export async function assertFileRoundTrip(
  request: APIRequestContext,
  token: string,
  prefix: string,
  apiBaseURL: string
): Promise<void> {
  const folderName = `${prefix}-${Date.now()}`;
  const folderRes = await request.post(`${apiBaseURL}/api/folders/create`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { parentNodeId: null, name: folderName },
  });
  expect(folderRes.ok()).toBeTruthy();
  const folderNodeId = (await folderRes.json()).nodeId as number;

  const fileName = `${folderName}.txt`;
  const uploadRes = await request.post(`${apiBaseURL}/api/files/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: fileName, mimeType: 'text/plain', buffer: textFixture },
      parentNodeId: String(folderNodeId),
      onConflict: 'overwrite',
    },
  });
  expect(uploadRes.ok()).toBeTruthy();
  const nodeId = (await uploadRes.json()).nodeId as number;

  const downloadRes = await request.get(`${apiBaseURL}/api/files/download?nodeId=${nodeId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(downloadRes.ok()).toBeTruthy();
  const downloaded = await downloadRes.body();
  expect(downloaded).toEqual(textFixture);
}

/**
 * Full per-case lifecycle: project-scoped scratch dir → storage provisioning →
 * build check → boot 1 → wizard → exact .env/DB assert → restart → boot 2 →
 * case assertions. Cleanup (server, scratch PG DB, scratch dir) runs even when
 * an assertion or the wizard fails.
 */
export async function runSetupScenario(
  config: CaseConfig,
  page: Page,
  request: APIRequestContext,
  projectName: string,
  afterRestart: (ctx: AfterRestartContext) => Promise<void>
): Promise<void> {
  const port = setupWizardPort(projectName);
  const apiBaseURL = `http://127.0.0.1:${port}`;
  const scratch = scratchDirFor(config.caseId, projectName);
  let child: ChildProcess | null = null;
  let createdPgDb: string | null = null;

  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });

  try {
    ensureClientBuild();

    if (config.file.backend === 's3') {
      const prepared = await prepareScratchStorage(scratch, config.caseId, 's3', projectName);
      if (!prepared.bucket) throw new Error('S3 scratch preparation returned no bucket');
      if (prepared.bucket !== config.file.bucket) {
        throw new Error(
          `S3 scratch bucket ${prepared.bucket} does not match the case bucket ${config.file.bucket}`
        );
      }
    } else {
      await ensureWebdavSubtree(`${scratchProjectSlug(projectName)}/${config.caseId}`);
    }

    // Pre-boot `.env` declaring the metadata backend (D6/D7): the DB connection
    // is `.env`-owned, so boot 1 already connects to it and the wizard serves
    // non-T0 only. The file survives the boot1 → restart → boot2 sequence via
    // spawnScratchServer's DOTENV_CONFIG_PATH.
    writeScratchEnv(scratch, buildPreBootEnv(scratch, config, port));

    if (config.metadata.backend === 'postgresql') {
      createdPgDb = config.metadata.database;
      await createScratchPgDb(createdPgDb);
    }

    // Boot 1 — DB already connected via the pre-written .env; the server must
    // come up in setup mode because the non-T0 (file-storage) config is missing.
    child = spawnScratchServer(scratch, port, scratchRuntimeEnv());
    await waitForScratchHealth(child, port);

    await driveWizard(page, config);
    assertScratchEnv(scratch, config, port);
    await assertScratchDbSettings(scratch, config, port);

    // Restart — the .env now exists; boot 2 must boot fully configured.
    await killScratch(child);
    child = spawnScratchServer(scratch, port, scratchRuntimeEnv());
    await waitForScratchHealth(child, port);

    await afterRestart({ scratch, page, request, config, apiBaseURL });
  } finally {
    if (child) await killScratch(child);
    if (createdPgDb) await dropScratchPgDb(createdPgDb).catch(() => {});
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
