import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const rootDir = process.cwd();
const backendMode = process.env.E2E_BACKEND_MODE || 's3';

// createRequire needs a module filename; we never rely on __filename so this
// works both under Playwright's CJS transpile and a direct Node ESM import.
const require = createRequire(path.join(rootDir, 'e2e', 'global-setup.ts'));

// Host-reachable service defaults. They mirror `.env.e2e` / `.env.e2e.webdav`;
// the global-setup process does not load those dotenv files itself, so we read
// process.env overrides but fall back to the same values.
const E2E_PG_HOST = '127.0.0.1';
const E2E_PG_PORT = process.env.WEA_PG_PORT || '5433';
const E2E_PG_DATABASE = process.env.WEA_PG_DATABASE || 'webdav_e2e';
const E2E_PG_USER = process.env.WEA_PG_USER || 'e2etest';
const E2E_PG_PASSWORD = process.env.WEA_PG_PASSWORD || 'e2etest';
const E2E_S3_ENDPOINT = 'http://127.0.0.1:9010';
const E2E_S3_REGION = process.env.AWS_REGION || 'us-east-1';
const E2E_S3_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || 'minioadmin';
const E2E_S3_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin';
const E2E_S3_BUCKET = process.env.S3_BUCKET || 'e2e-test-bucket';
const E2E_ADMIN_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || 'admin';

// Base users pre-seeded for E2E. These mirror `e2e/fixtures/test-data.ts`
// (admin is bootstrapped by the server itself). Specs additionally
// self-provision suffixed users through the running server's admin API during
// the run, but a deterministic baseline avoids first-run races.
const SEED_USERS = [
  { username: 'user1', password: 'user1pass', email: 'user1@e2etest.com' },
  { username: 'user2', password: 'user2pass', email: 'user2@e2etest.com' },
  { username: 'user3', password: 'user3pass', email: 'user3@e2etest.com' },
];

const webdavBaseUrl = 'http://127.0.0.1:8090/';
const webdavAuth = Buffer.from('e2etest:e2etest123').toString('base64');

function cleanDir(relativePath: string) {
  const targetPath = path.join(rootDir, relativePath);
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'EACCES') {
      throw err;
    }

    console.warn(`Warning: Cannot remove ${relativePath} directly due to permissions. Retrying via Docker helper.`);
    execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${rootDir}:/workspace`,
        'alpine',
        'sh',
        '-c',
        `rm -rf /workspace/${relativePath}`,
      ],
      {
        cwd: rootDir,
        stdio: 'inherit',
      }
    );
  }
}

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
            if ((statusCode >= 200 && statusCode < 300) || statusCode === 207 || statusCode === 403) {
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

async function emptyS3Bucket() {
  const { emptyBucket } = require(path.join(rootDir, 'server/testing/minioTestUtils.js'));
  const deleted = await emptyBucket({
    endpoint: E2E_S3_ENDPOINT,
    region: E2E_S3_REGION,
    bucket: E2E_S3_BUCKET,
    credentials: {
      accessKeyId: E2E_S3_ACCESS_KEY,
      secretAccessKey: E2E_S3_SECRET_KEY,
    },
  });
  console.log(`S3 bucket emptied: ${deleted} object(s) removed from ${E2E_S3_BUCKET}`);
}

async function ensureS3Bucket() {
  const { ensureBucket } = require(path.join(rootDir, 'server/testing/minioTestUtils.js'));
  const result = await ensureBucket({
    endpoint: E2E_S3_ENDPOINT,
    region: E2E_S3_REGION,
    bucket: E2E_S3_BUCKET,
    credentials: {
      accessKeyId: E2E_S3_ACCESS_KEY,
      secretAccessKey: E2E_S3_SECRET_KEY,
    },
    forcePathStyle: true,
  });
  console.log(`S3 bucket ready: ${result.bucket}`);
}

function seedPostgresql() {
  const seedScript = path.join(rootDir, 'e2e', 'global-setup.seed-db.cjs');
  const seedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    WEA_STORAGE_BACKEND: 'postgresql',
    WEA_FILE_STORAGE: backendMode === 'webdav' ? 'webdav' : 's3',
    WEA_PG_HOST: E2E_PG_HOST,
    WEA_PG_PORT: E2E_PG_PORT,
    WEA_PG_DATABASE: E2E_PG_DATABASE,
    WEA_PG_USER: E2E_PG_USER,
    WEA_PG_PASSWORD: E2E_PG_PASSWORD,
    ADMIN_DEFAULT_PASSWORD: E2E_ADMIN_PASSWORD,
    NODE_ENV: 'test',
  };
  if (backendMode === 'webdav') {
    // Mirror .env.e2e.webdav so the seed's WebDAV MKCOL (home dir materialization)
    // can reach the bytemark container on its host port.
    seedEnv.WEBDAV_URL = process.env.WEBDAV_URL || 'http://127.0.0.1:8090';
    seedEnv.WEBDAV_UPSTREAM_URL = process.env.WEBDAV_UPSTREAM_URL || 'http://127.0.0.1:8090';
    seedEnv.WEBDAV_USERNAME = process.env.WEBDAV_USERNAME || 'e2etest';
    seedEnv.WEBDAV_PASSWORD = process.env.WEBDAV_PASSWORD || 'e2etest123';
  }

  try {
    execFileSync(process.execPath, [seedScript, JSON.stringify(SEED_USERS)], {
      cwd: rootDir,
      env: seedEnv,
      stdio: 'inherit',
    });
  } catch (error) {
    throw new Error(`PostgreSQL E2E seed failed: ${(error as Error).message}`);
  }
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

  if (backendMode === 'webdav') {
    // `cleanDir('data/webdav')` above deletes the host bind-mount source while
    // the bytemark container is running, which empties `/var/lib/dav` inside
    // the container (Apache then 403s every DAV method — MKCOL, PUT, DELETE).
    // Restart the container so its entrypoint re-creates `/var/lib/dav/data`.
    console.log('Recreating the WebDAV DAV root (restarting webdav-e2e-test)...');
    execFileSync('docker', ['restart', 'webdav-e2e-test'], { cwd: rootDir, stdio: 'inherit' });
  }

  if (backendMode === 's3') {
    await waitForMinio(30_000);
    await emptyS3Bucket();
    await ensureS3Bucket();
  }

  // Fresh data state WITHOUT killing the running server: the seed script
  // TRUNCATEs all app tables (preserving `_schema_migrations` so the schema is
  // not re-applied mid-run) and re-seeds the admin + base users with home
  // `file_nodes` roots.
  seedPostgresql();

  if (backendMode === 'webdav') {
    await waitForWebdav(60_000);
  }
}
