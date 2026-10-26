import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Single source of truth for every E2E host port (playwright.config.ts,
 * global setup/teardown, helpers and specs).
 *
 * Values resolve as: per-port `E2E_*_PORT` env override > persisted checkout
 * band (`data/e2e-runtime.json`, managed by scripts/lib/e2e-band.cjs) >
 * offset-0 defaults equal to the historical fixed contract (API :5002,
 * client :3000, scratch :5003/:5010-:5016, WebDAV :8090, PG :5433,
 * MinIO :9010/:9011). Loading this module ensures the checkout band exists
 * (allocating the first free band when none is persisted yet), so a plain
 * `playwright test` without a pre-run provisioning step still works — at
 * offset 0 nothing changes, and when the base ports are already busy a
 * parallel worktree transparently moves to its own band.
 */

const rootDir = process.cwd();
const require = createRequire(path.join(rootDir, 'e2e', 'helpers', 'ports.ts'));
const bandLib = require('../../scripts/lib/e2e-band.cjs') as {
  ensureBand: (rootDir: string) => number;
  effectivePorts: (rootDir: string) => Record<string, number>;
  readPersistedOffset: (rootDir: string) => number | null;
  composeProjectName: (offset: number) => string;
};

bandLib.ensureBand(rootDir);

export interface E2EPorts {
  client: number;
  api: number;
  scratchWizard: number;
  scratchWizardMobile: number;
  scratchRegset: number;
  scratchRegsetMobile: number;
  scratchAdminConfig: number;
  scratchAdminConfigMobile: number;
  scratchMigration: number;
  scratchMigrationMobile: number;
  scratchTrashAdmin: number;
  scratchTrashAdminMobile: number;
  scratchCollections: number;
  scratchCollectionsMobile: number;
  scratchRetrieval: number;
  scratchRetrievalMobile: number;
  scratchAi: number;
  webdav: number;
  pg: number;
  s3: number;
  s3Console: number;
}

// `effectivePorts` returns a plain Record<string, number>; the key set is
// fixed by PORT_BASES (e2e-band.cjs), so this narrows it for the callers.
export const e2ePorts = bandLib.effectivePorts(rootDir) as unknown as E2EPorts;

export const bandOffset: number = bandLib.readPersistedOffset(rootDir) ?? 0;
export const composeProject: string = (
  bandLib as unknown as {
    composeProjectName: (offset: number) => string;
  }
).composeProjectName(bandOffset);

export const apiOrigin = `http://127.0.0.1:${e2ePorts.api}`;
export const appOrigin = `http://localhost:${e2ePorts.client}`;
export const webdavBase = `http://127.0.0.1:${e2ePorts.webdav}`;
export const s3Endpoint = `http://127.0.0.1:${e2ePorts.s3}`;
