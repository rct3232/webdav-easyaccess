import path from 'path';

import { defineConfig } from '@playwright/test';

import { e2ePorts, apiOrigin, appOrigin } from './e2e/helpers/ports';

// Ambient shell config is destructive to E2E isolation: the runner provisions
// its own Docker stack and seeds/empties project-scoped databases and buckets,
// so inherited WEA_DB_*/S3_*/AWS_* values could point seed or bucket operations
// at real infrastructure, and inherited file-backend/WebDAV values could select
// a backend other than the one the group provisions. E2E runtime values come
// from `.env.e2e` and the generated `data/e2e-runtime.env`, never the caller's
// shell. The escape hatch exists for explicit, non-default overrides (dedicated
// test accounts only).
const AMBIENT_DESTRUCTIVE_ENV_KEYS = [
  'WEA_DB_HOST',
  'WEA_DB_PORT',
  'WEA_DB_DATABASE',
  'WEA_DB_USER',
  'WEA_DB_PASSWORD',
  'S3_BUCKET',
  'S3_ENDPOINT',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'WEA_FILE_STORAGE',
  'WEBDAV_URL',
  'WEBDAV_UPSTREAM_URL',
  'WEBDAV_USERNAME',
  'WEBDAV_PASSWORD',
  'WEBDAV_AUTH_TYPE',
] as const;

const ambientDestructiveKeys = AMBIENT_DESTRUCTIVE_ENV_KEYS.filter(
  (key) => process.env[key] !== undefined
);
if (ambientDestructiveKeys.length > 0 && process.env.E2E_ALLOW_AMBIENT_ENV !== '1') {
  throw new Error(
    `Refusing to load the E2E config with ambient destructive environment: ${ambientDestructiveKeys.join(', ')}. ` +
      'The E2E stack uses .env.e2e/generated runtime values; unset these keys or set E2E_ALLOW_AMBIENT_ENV=1 to opt in.'
  );
}

const requestedMode = process.env.E2E_BACKEND_MODE || 's3';
if (requestedMode !== 's3' && requestedMode !== 'webdav') {
  throw new Error(`Invalid E2E_BACKEND_MODE "${requestedMode}". Expected "s3" or "webdav".`);
}

const requestedGroup =
  process.env.E2E_GROUP ||
  (process.env.E2E_CORE === '1' ? 'core' : requestedMode === 'webdav' ? 'webdav' : 'default');
if (!['default', 'core', 'webdav'].includes(requestedGroup)) {
  throw new Error(
    `Invalid E2E_GROUP "${requestedGroup}". Expected "default", "core", or "webdav".`
  );
}

// Every group is homogeneous by backend: default/core are hermetic S3 suites,
// webdav is the real-WebDAV smoke/hermetic group. Mixing modes would point the
// S3 scratch suites at a WebDAV server (or vice versa), so reject it outright.
const groupBackendMode = {
  default: 's3',
  core: 's3',
  webdav: 'webdav',
} as const;
const expectedMode = groupBackendMode[requestedGroup as keyof typeof groupBackendMode];
if (requestedMode !== expectedMode) {
  throw new Error(
    `E2E_GROUP=${requestedGroup} requires E2E_BACKEND_MODE=${expectedMode}; mixed-backend runs are not supported.`
  );
}

const backendMode = requestedMode;
const e2eGroup = requestedGroup;
const coreGroup = e2eGroup === 'core';
const webdavGroup = e2eGroup === 'webdav';
const defaultGroup = e2eGroup === 'default';
const isQuiet = process.env.E2E_QUIET === '1';

// Reusing a running server is an explicit developer opt-in only. An implicit
// reuse could silently attach an S3 suite to a stale WebDAV server (or a
// different checkout's band), so CI and plain local runs always start fresh.
const reuseExistingServer = !process.env.CI && process.env.E2E_REUSE_SERVER === '1';

// Platform-agnostic core suites plus the platform core-flow twins.
const sharedCoreSpec =
  'auth|share-public|core-flow\\.shared|mypage-user|share-internal|trash|versions';

const desktopSpecMatch = new RegExp(`(?:${sharedCoreSpec}|core-flow\\.desktop)\\.spec\\.ts$`);
const mobileSpecMatch = new RegExp(`(?:${sharedCoreSpec}|core-flow\\.mobile)\\.spec\\.ts$`);
const adminSpecMatch = /mypage-admin\.spec\.ts$/;

const desktopUse = {
  browserName: 'chromium' as const,
  viewport: { width: 1280, height: 720 },
};
const mobileUse = {
  browserName: 'webkit' as const,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
};

type PlaywrightProject = NonNullable<Parameters<typeof defineConfig>[0]['projects']>[number];

interface E2EProject {
  name: string;
  testMatch: RegExp;
  use: typeof desktopUse | typeof mobileUse;
  baseURL?: string;
  grep?: RegExp;
}

const projects: PlaywrightProject[] = [];

const pushProjects = (entries: E2EProject[]) => {
  for (const entry of entries) {
    projects.push({
      name: entry.name,
      testMatch: entry.testMatch,
      grep: entry.grep,
      use: {
        ...entry.use,
        ...(entry.baseURL ? { baseURL: entry.baseURL } : {}),
      },
    });
  }
};

const scratchBase = (port: number) => `http://localhost:${port}`;

const webdavHermetic: E2EProject[] = [
  {
    name: 'webdav-setup-wizard-desktop',
    testMatch: /setup-wizard\.webdav\.spec\.ts$/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchWizard),
  },
  {
    name: 'webdav-setup-wizard-mobile',
    testMatch: /setup-wizard\.webdav\.spec\.ts$/,
    use: mobileUse,
    baseURL: scratchBase(e2ePorts.scratchWizardMobile),
  },
  {
    name: 'webdav-migration-desktop',
    testMatch: /migration\.webdav\.spec\.ts$/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchMigration),
  },
  {
    name: 'webdav-migration-mobile',
    testMatch: /migration\.webdav\.spec\.ts$/,
    use: mobileUse,
    baseURL: scratchBase(e2ePorts.scratchMigrationMobile),
  },
  {
    name: 'webdav-admin-config-desktop',
    testMatch: /admin-config\.webdav\.spec\.ts$/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchAdminConfig),
  },
  {
    name: 'webdav-admin-config-mobile',
    testMatch: /admin-config\.webdav\.spec\.ts$/,
    use: mobileUse,
    baseURL: scratchBase(e2ePorts.scratchAdminConfigMobile),
  },
];

const s3Hermetic: E2EProject[] = [
  {
    name: 's3-collections-desktop',
    testMatch: /collections\.spec\.ts$/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchCollections),
  },
  {
    name: 's3-collections-mobile',
    testMatch: /collections\.spec\.ts$/,
    use: mobileUse,
    baseURL: scratchBase(e2ePorts.scratchCollectionsMobile),
  },
  {
    // Dedicated storage slots: the storage suite never shares a scratch port
    // with (and therefore never depends on) another project.
    name: 's3-storage-desktop',
    testMatch: /storage\.spec\.ts$/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchStorage),
  },
  {
    name: 's3-storage-mobile',
    testMatch: /storage\.spec\.ts$/,
    use: mobileUse,
    baseURL: scratchBase(e2ePorts.scratchStorageMobile),
  },
  {
    name: 's3-retrieval-desktop',
    testMatch: /retrieval\.spec\.ts$/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchRetrieval),
  },
  {
    name: 's3-retrieval-mobile',
    testMatch: /retrieval\.spec\.ts$/,
    use: mobileUse,
    baseURL: scratchBase(e2ePorts.scratchRetrievalMobile),
  },
  {
    name: 's3-ai-desktop',
    testMatch: /(?:^|\/)ai\.spec\.ts$/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchAi),
  },
  {
    // API-only: RequestContext + direct sqlite reads, never `page` (band 40
    // maps this slot to the browser-restricted 5061).
    name: 's3-ai-matrix-desktop',
    testMatch: /ai\.matrix\.spec\.ts$/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchAiMatrix),
  },
  {
    // Browser UI matrix: same fake-LLM columns, but every case drives `page`.
    // Owns the browser-safe slot 5009 (the optional admin-AI mobile project was
    // dropped to free it — mobile admin AI is not required).
    name: 's3-ai-matrix-ui-desktop',
    testMatch: /ai\.matrix\.ui\.spec\.ts$/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchAiMatrixUi),
  },
  {
    // Model-backed admin panel: summary/launcher/gates/cancel cases.
    name: 's3-admin-ai-model-desktop',
    testMatch: /admin-ai\.spec\.ts$/,
    grep: /E2E-ADMINAI-00[2-6]:/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchAdminAiModel),
  },
  {
    // Model-free/empty states: visibility, cross-links, error/retry.
    name: 's3-admin-ai-states-desktop',
    testMatch: /admin-ai\.spec\.ts$/,
    grep: /E2E-ADMINAI-00[178]:/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchAdminAiStates),
  },
  {
    name: 's3-trash-admin-desktop',
    testMatch: /trash-admin\.spec\.ts$/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchTrashAdmin),
  },
  {
    name: 's3-trash-admin-mobile',
    testMatch: /trash-admin\.spec\.ts$/,
    use: mobileUse,
    baseURL: scratchBase(e2ePorts.scratchTrashAdminMobile),
  },
  {
    name: 's3-admin-config-desktop',
    testMatch: /admin-config\.s3\.spec\.ts$/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchAdminConfig),
  },
  {
    name: 's3-admin-config-mobile',
    testMatch: /admin-config\.s3\.spec\.ts$/,
    use: mobileUse,
    baseURL: scratchBase(e2ePorts.scratchAdminConfigMobile),
  },
  {
    name: 's3-setup-wizard-desktop',
    testMatch: /setup-wizard\.s3\.spec\.ts$/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchWizard),
  },
  {
    name: 's3-setup-wizard-mobile',
    testMatch: /setup-wizard\.s3\.spec\.ts$/,
    use: mobileUse,
    baseURL: scratchBase(e2ePorts.scratchWizardMobile),
  },
  {
    name: 's3-migration-desktop',
    testMatch: /migration\.s3\.spec\.ts$/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchMigration),
  },
  {
    name: 's3-migration-mobile',
    testMatch: /migration\.s3\.spec\.ts$/,
    use: mobileUse,
    baseURL: scratchBase(e2ePorts.scratchMigrationMobile),
  },
];

const s3Regset: E2EProject[] = [
  {
    name: 's3-regset-desktop',
    testMatch: /registration-settings\.spec\.ts$/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchRegset),
  },
  {
    name: 's3-regset-mobile',
    testMatch: /registration-settings\.spec\.ts$/,
    use: mobileUse,
    baseURL: scratchBase(e2ePorts.scratchRegsetMobile),
  },
];

if (webdavGroup) {
  // One shared bytemark only. No per-project WebDAV containers.
  const smokeSpecMatch = new RegExp(
    '(core-flow\\.shared|share-public|share-internal|trash|webdav-reconcile)\\.spec\\.ts$'
  );
  const smokeTitleMatch = new RegExp(
    'E2E-(EXP-00[12458]|EXP-01[23]|SHARE-011|OVERLAY-011|TRASH-00[136]|WEBDAV-RECON-001)[:\\s]'
  );
  pushProjects([
    {
      name: 'webdav-smoke-desktop',
      testMatch: smokeSpecMatch,
      grep: smokeTitleMatch,
      use: desktopUse,
    },
    ...webdavHermetic,
  ]);
} else {
  const platformProjects: E2EProject[] = [
    {
      name: `${backendMode}-desktop`,
      testMatch: desktopSpecMatch,
      use: desktopUse,
    },
    {
      name: `${backendMode}-mobile`,
      testMatch: mobileSpecMatch,
      use: mobileUse,
    },
  ];
  if (!coreGroup) {
    platformProjects.push(
      { name: `${backendMode}-admin-desktop`, testMatch: adminSpecMatch, use: desktopUse },
      { name: `${backendMode}-admin-mobile`, testMatch: adminSpecMatch, use: mobileUse }
    );
  }
  pushProjects(platformProjects);
  pushProjects(s3Regset);
  if (defaultGroup) {
    pushProjects(s3Hermetic);
  }
}

export default defineConfig({
  // Sensitive baseline: a scratch boot plus a browser flow fits here. Suites
  // whose boot/restart is the behavior under test keep their own explicit
  // larger budgets (setup-wizard/migration 240s, AI 300s,
  // collections/retrieval 180s, targeted admin-config/trash-admin cases 180s).
  // Weak CI load is absorbed by retries/workers — never by global inflation.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : undefined,
  reporter: [
    ['list'],
    [path.join(__dirname, 'e2e', 'reporters', 'test-end-logger.js')],
    [path.join(__dirname, 'e2e', 'reporters', 'skip-budget.js')],
  ],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: appOrigin,
    trace: 'retain-on-failure',
  },
  projects,
  // Automatically start and stop the shared API/client for platform + WebDAV
  // smoke tests. Hermetic projects boot their own scratch servers.
  webServer: [
    {
      command: 'npm run e2e:server',
      url: `${apiOrigin}/api/health`,
      reuseExistingServer,
      timeout: 60_000,
      stdout: isQuiet ? 'ignore' : 'pipe',
      stderr: isQuiet ? 'ignore' : 'pipe',
    },
    {
      command: 'node scripts/e2e-serve-client.js',
      url: `http://localhost:${e2ePorts.client}`,
      reuseExistingServer,
      timeout: 120_000,
      stdout: isQuiet ? 'ignore' : 'pipe',
      stderr: isQuiet ? 'ignore' : 'pipe',
    },
  ],
});
