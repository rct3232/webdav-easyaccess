import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cleanDir, runSeedDb } from './helpers/seedDb';
import { TEST_USERS } from './fixtures/test-data';

const rootDir = process.cwd();
const backendMode = process.env.E2E_BACKEND_MODE || 's3';

// E2E API server and client origin mirror `playwright.config.ts` webServer /
// baseURL. The login below runs in globalSetup, AFTER Playwright has booted the
// webServer (Playwright 1.58 task order: plugins/webServer -> globalSetup).
const E2E_API_ORIGIN = 'http://127.0.0.1:5002';
const E2E_APP_ORIGIN = 'http://localhost:3000';
const ADMIN_STATE_PATH = path.join(rootDir, 'e2e-data', 'state', 'admin.json');

// createRequire needs a module filename; we never rely on __filename so this
// works both under Playwright's CJS transpile and a direct Node ESM import.
const require = createRequire(path.join(rootDir, 'e2e', 'global-setup.ts'));

// Host-reachable service defaults. They mirror `.env.e2e` / `.env.e2e.webdav`;
// the global-setup process does not load those dotenv files itself, so we read
// process.env overrides but fall back to the same values.
const E2E_S3_ENDPOINT = 'http://127.0.0.1:9010';
const E2E_S3_REGION = process.env.AWS_REGION || 'us-east-1';
const E2E_S3_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || 'minioadmin';
const E2E_S3_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin';
const E2E_S3_BUCKET = process.env.S3_BUCKET || 'e2e-test-bucket';

// Dedicated MinIO bucket for the migration E2E suite. Migration targets blobs at
// this bucket (its spec passes it to helpers/minio.ts), never the shared
// platform bucket, so the suite can run concurrently with the s3 platform tests.
const E2E_MIGRATION_S3_BUCKET = 'e2e-migration-bucket';

const webdavBaseUrl = 'http://127.0.0.1:8090/';
const webdavAuth = Buffer.from('e2etest:e2etest123').toString('base64');

function waitForWebdav(timeoutMs: number) {
  const startedAt = Date.now();

  return new Promise<void>((resolve, reject) => {
    let done = false;

    const finishSuccess = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const finishFailure = (error: Error) => {
      if (done) return;
      done = true;
      reject(error);
    };

    const scheduleRetry = (error: Error) => {
      if (done) return;
      if (Date.now() - startedAt >= timeoutMs) {
        finishFailure(error);
        return;
      }
      setTimeout(attempt, 1000);
    };

    const attempt = () => {
      if (done) return;
      let attemptSettled = false;
      const settleAttempt = (handler: () => void) => {
        if (attemptSettled || done) return;
        attemptSettled = true;
        handler();
      };

      const request = http.request(
        webdavBaseUrl,
        {
          method: 'PROPFIND',
          headers: {
            Authorization: `Basic ${webdavAuth}`,
            Depth: '1',
          },
          timeout: 2000,
        },
        (response) => {
          response.resume();
          const statusCode = response.statusCode || 500;
          settleAttempt(() => {
            if (
              (statusCode >= 200 && statusCode < 300) ||
              statusCode === 207 ||
              statusCode === 403
            ) {
              finishSuccess();
              return;
            }
            scheduleRetry(new Error(`Unexpected WebDAV PROPFIND status: ${response.statusCode}`));
          });
        }
      );

      request.on('timeout', () => {
        settleAttempt(() => {
          request.destroy();
          scheduleRetry(new Error('Timed out waiting for WebDAV server'));
        });
      });

      request.on('error', (error) => {
        settleAttempt(() => {
          scheduleRetry(error);
        });
      });

      request.end();
    };

    attempt();
  });
}

function waitForMinio(timeoutMs: number) {
  const url = `${E2E_S3_ENDPOINT}/minio/health/ready`;
  const startedAt = Date.now();

  return new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      if (error) reject(error);
      else resolve();
    };

    const attempt = () => {
      if (done) return;
      const request = http.get(url, (response) => {
        response.resume();
        const statusCode = response.statusCode || 500;
        if (statusCode >= 200 && statusCode < 300) {
          finish();
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          finish(new Error(`MinIO health check returned status ${statusCode}`));
          return;
        }
        setTimeout(attempt, 1000);
      });

      request.on('error', (error) => {
        if (Date.now() - startedAt >= timeoutMs) {
          finish(error);
          return;
        }
        setTimeout(attempt, 1000);
      });
    };

    attempt();
  });
}

async function emptyS3Bucket(bucket: string) {
  const { emptyBucket } = require(path.join(rootDir, 'server/testing/minioTestUtils.js'));
  const deleted = await emptyBucket({
    endpoint: E2E_S3_ENDPOINT,
    region: E2E_S3_REGION,
    bucket,
    credentials: {
      accessKeyId: E2E_S3_ACCESS_KEY,
      secretAccessKey: E2E_S3_SECRET_KEY,
    },
  });
  console.log(`S3 bucket emptied: ${deleted} object(s) removed from ${bucket}`);
}

async function ensureS3Bucket(bucket: string) {
  const { ensureBucket } = require(path.join(rootDir, 'server/testing/minioTestUtils.js'));
  const result = await ensureBucket({
    endpoint: E2E_S3_ENDPOINT,
    region: E2E_S3_REGION,
    bucket,
    credentials: {
      accessKeyId: E2E_S3_ACCESS_KEY,
      secretAccessKey: E2E_S3_SECRET_KEY,
    },
    forcePathStyle: true,
  });
  console.log(`S3 bucket ready: ${result.bucket}`);
}

function seedPostgresql() {
  try {
    runSeedDb();
  } catch (error) {
    throw new Error(`PostgreSQL E2E seed failed: ${(error as Error).message}`);
  }
}

/**
 * L1 (authenticated-session reuse): perform ONE admin login against the running
 * E2E API server (started by Playwright's webServer before globalSetup) and
 * persist the tokens as a Playwright storageState file. Playwright cannot seed
 * sessionStorage through storageState, so the file seeds NON-app localStorage
 * keys (`e2e.accessToken` / `e2e.refreshToken`) that the shared
 * `e2e/fixtures/authenticated.ts` init-script copies into sessionStorage when a
 * page first loads. If the login fails we throw: a stale/empty state must never
 * silently unauthenticate the admin-actor suites.
 */
async function seedAdminStorageState() {
  const loginResponse = await fetch(`${E2E_API_ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: TEST_USERS.admin.username,
      password: TEST_USERS.admin.password,
    }),
  });

  if (!loginResponse.ok) {
    const errorBody = await loginResponse.text();
    throw new Error(
      `E2E admin login for storageState failed with status ${loginResponse.status}: ${errorBody}`
    );
  }

  const body = await loginResponse.json();
  const accessToken = body?.token;
  const refreshToken = body?.refreshToken ?? '';
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error(
      `E2E admin login returned no access token (response shape: ${JSON.stringify(body)})`
    );
  }

  const state = {
    cookies: [],
    origins: [
      {
        origin: E2E_APP_ORIGIN,
        localStorage: [
          { name: 'e2e.accessToken', value: accessToken },
          { name: 'e2e.refreshToken', value: refreshToken },
        ],
      },
    ],
  };

  fs.mkdirSync(path.dirname(ADMIN_STATE_PATH), { recursive: true });
  fs.writeFileSync(ADMIN_STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`E2E admin storageState seeded at ${ADMIN_STATE_PATH}`);
}

export default async function globalSetup() {
  cleanDir('test-results');
  cleanDir('playwright-report');
  cleanDir('e2e-data');
  cleanDir('data/e2e-metadata');
  cleanDir('data/webdav');
  fs.mkdirSync(path.join(rootDir, 'e2e-data'), { recursive: true });

  // The `e2e:server` webServer command provisions the Docker stack before the
  // app server boots. Re-run the same helper idempotently as belt-and-braces:
  // this covers the `reuseExistingServer` developer loop, where Playwright
  // reuses a previously started server and skips the webServer command. It
  // must NOT tear the stack down — `down -v` would wipe the Postgres volume
  // out from under the already-running app server (unhandled `pg.Pool` error).
  console.log(`Ensuring the E2E Docker stack is up (${backendMode} mode)...`);
  execFileSync(process.execPath, [path.join(rootDir, 'scripts', 'e2e-wait-healthy.mjs')], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  // `cleanDir('data/webdav')` above deletes the host bind-mount source while
  // the bytemark container is running, which empties `/var/lib/dav` inside the
  // container (Apache then 403s every DAV method — MKCOL, PUT, DELETE).
  // Restart the container so its entrypoint re-creates `/var/lib/dav/data`.
  // This runs in BOTH modes: the s3-mode run also hosts the hermetic
  // setup-wizard / admin-config / migration suites, whose scratch servers boot
  // a webdav-mode file backend against this container's subtree. Restarting
  // once up-front removes the mid-run lazy restarts the scratch helpers used
  // to perform in s3 mode.
  console.log('Recreating the WebDAV DAV root (restarting webdav-e2e-test)...');
  execFileSync('docker', ['restart', 'webdav-e2e-test'], { cwd: rootDir, stdio: 'inherit' });

  // MinIO runs in both modes and both the webdav-mode app (some blob writes)
  // and the migration E2E target the S3 buckets, so the buckets must exist in
  // both modes. s3 mode additionally empties the platform bucket for a
  // deterministic baseline; the dedicated migration bucket is not emptied here
  // (its spec empties it per case).
  await waitForMinio(30_000);
  if (backendMode === 's3') {
    await emptyS3Bucket(E2E_S3_BUCKET);
  }
  await ensureS3Bucket(E2E_S3_BUCKET);
  await ensureS3Bucket(E2E_MIGRATION_S3_BUCKET);

  // Fresh data state WITHOUT killing the running server: the seed script
  // TRUNCATEs all app tables (preserving `_schema_migrations` so the schema is
  // not re-applied mid-run) and re-seeds the admin + base users with home
  // `file_nodes` roots.
  seedPostgresql();

  // The restart above briefly drops the container; wait until the DAV root is
  // reachable again so no later suite (webdav mode or the hermetic scratch
  // suites in s3 mode) has to perform a lazy mid-run restart.
  await waitForWebdav(60_000);

  // Last step: the DB seed above guarantees admin exists (ADMIN_DEFAULT_PASSWORD
  // = 'admin', see `e2e/fixtures/test-data.ts`), so a login now yields the
  // seeded admin session the admin-actor suites share via storageState.
  await seedAdminStorageState();
}
