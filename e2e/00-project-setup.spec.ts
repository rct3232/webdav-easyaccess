import { test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Per-project data isolation.
 *
 * Playwright runs the `desktop` project before the `mobile` project against a
 * single shared PostgreSQL database. The suite creates many folders/files at
 * the admin root, and the app caps initial rendering at 50 items (folders
 * first). Once the root accumulates 50+ folders, a file uploaded later in the
 * mobile project sorts past the cap and is never rendered (no scroll →
 * IntersectionObserver never fires). Re-running the seed at the start of each
 * project truncates all app tables and re-seeds the deterministic baseline
 * (admin + user1/2/3 home nodes), so every project starts from a clean root.
 *
 * This spec is NOT matched by the mode-prefixed test projects. It runs from
 * dedicated setup projects (`<mode>-desktop-setup` / `<mode>-mobile-setup`)
 * declared as Playwright `dependencies` of the corresponding test project, so
 * it executes once per dependent project — never from one shared setup project
 * (a `dependencies` setup runs once per run, which would leave the second
 * project on a dirty DB). See docs/TESTING_STRATEGY.md "Per-project data
 * isolation via setup projects".
 *
 * Mirrors `e2e/global-setup.ts` `seedPostgresql()`: a spawned `node` child
 * process, direct to PostgreSQL, idempotent, and safe while the app server is
 * running (the server holds a pool but reads per request; global-setup does the
 * same after the server boots).
 */

const rootDir = process.cwd();
const backendMode = process.env.E2E_BACKEND_MODE || 's3';

const E2E_PG_HOST = '127.0.0.1';
const E2E_PG_PORT = process.env.WEA_PG_PORT || '5433';
const E2E_PG_DATABASE = process.env.WEA_PG_DATABASE || 'webdav_e2e';
const E2E_PG_USER = process.env.WEA_PG_USER || 'e2etest';
const E2E_PG_PASSWORD = process.env.WEA_PG_PASSWORD || 'e2etest';
const E2E_ADMIN_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || 'admin';

// Mirrors `e2e/global-setup.ts` SEED_USERS / `e2e/fixtures/test-data.ts`.
const SEED_USERS = [
  { username: 'user1', password: 'user1pass', email: 'user1@e2etest.com' },
  { username: 'user2', password: 'user2pass', email: 'user2@e2etest.com' },
  { username: 'user3', password: 'user3pass', email: 'user3@e2etest.com' },
];

test.describe('project data isolation', () => {
  test('reset PostgreSQL data for a clean project state', () => {
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
      seedEnv.WEBDAV_URL = process.env.WEBDAV_URL || 'http://127.0.0.1:8090';
      seedEnv.WEBDAV_UPSTREAM_URL = process.env.WEBDAV_UPSTREAM_URL || 'http://127.0.0.1:8090';
      seedEnv.WEBDAV_USERNAME = process.env.WEBDAV_USERNAME || 'e2etest';
      seedEnv.WEBDAV_PASSWORD = process.env.WEBDAV_PASSWORD || 'e2etest123';
    }

    execFileSync(process.execPath, [seedScript, JSON.stringify(SEED_USERS)], {
      cwd: rootDir,
      env: seedEnv,
      stdio: 'inherit',
    });
  });
});
