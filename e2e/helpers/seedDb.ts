import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const rootDir = process.cwd();

// Base users pre-seeded for E2E. These mirror `e2e/fixtures/test-data.ts`
// (admin is bootstrapped by the server itself). Specs additionally
// self-provision suffixed users through the running server's admin API during
// the run, but a deterministic baseline avoids first-run races.
export const SEED_USERS = [
  { username: 'user1', password: 'user1pass', email: 'user1@e2etest.com' },
  { username: 'user2', password: 'user2pass', email: 'user2@e2etest.com' },
  { username: 'user3', password: 'user3pass', email: 'user3@e2etest.com' },
];

// Host-reachable service defaults. They mirror `.env.e2e` / `.env.e2e.webdav`;
// the seed runs from spawned Node processes that do not load those dotenv
// files themselves, so we read process.env overrides but fall back to the same
// values. Shared by `e2e/global-setup.ts` (once per run) and
// `e2e/00-project-setup.spec.ts` (once per project, for data isolation).
//
// Backend selection is presence-based: the full `WEA_DB_*` identity block below
// (host/port/database/user/password) selects the remote PostgreSQL backend —
// there is no `WEA_STORAGE_BACKEND` key anymore.
//
// `envOverrides` is merged over the defaults so each caller can pass its own
// env bits without re-implementing the seed environment.
export function runSeedDb(envOverrides: NodeJS.ProcessEnv = {}) {
  const backendMode = process.env.E2E_BACKEND_MODE || 's3';
  const seedScript = path.join(rootDir, 'e2e', 'global-setup.seed-db.cjs');
  const seedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    WEA_FILE_STORAGE: backendMode === 'webdav' ? 'webdav' : 's3',
    WEA_DB_HOST: '127.0.0.1',
    WEA_DB_PORT: process.env.WEA_DB_PORT || '5433',
    WEA_DB_DATABASE: process.env.WEA_DB_DATABASE || 'webdav_e2e',
    WEA_DB_USER: process.env.WEA_DB_USER || 'e2etest',
    WEA_DB_PASSWORD: process.env.WEA_DB_PASSWORD || 'e2etest',
    ADMIN_DEFAULT_PASSWORD: process.env.ADMIN_DEFAULT_PASSWORD || 'admin',
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
  Object.assign(seedEnv, envOverrides);

  execFileSync(process.execPath, [seedScript, JSON.stringify(SEED_USERS)], {
    cwd: rootDir,
    env: seedEnv,
    stdio: 'inherit',
  });
}

export function cleanDir(relativePath: string) {
  const targetPath = path.join(rootDir, relativePath);
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'EACCES') {
      throw err;
    }

    console.warn(
      `Warning: Cannot remove ${relativePath} directly due to permissions. Retrying via Docker helper.`
    );
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
