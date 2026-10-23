import path from 'path';

import { defineConfig } from '@playwright/test';

import { e2ePorts, apiOrigin, appOrigin } from './e2e/helpers/ports';

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
if (requestedGroup === 'webdav' && requestedMode !== 'webdav') {
  throw new Error('E2E_GROUP=webdav requires E2E_BACKEND_MODE=webdav.');
}
if (requestedGroup === 'core' && requestedMode !== 's3') {
  throw new Error('E2E_GROUP=core is S3-only.');
}

const backendMode = requestedMode;
const e2eGroup = requestedGroup;
const coreGroup = e2eGroup === 'core';
const webdavGroup = e2eGroup === 'webdav';
const defaultGroup = e2eGroup === 'default';
const isQuiet = process.env.E2E_QUIET === '1';

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
    testMatch: /ai\.spec\.ts$/,
    use: desktopUse,
    baseURL: scratchBase(e2ePorts.scratchAi),
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
    'E2E-(EXP-00[12458]|EXP-01[23]|SHARE-011|OVERLAY-011|TRASH-00[136]|RECON-001)[:\\s]'
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
  // Scratch suites boot a server and can take longer than a pure UI case.
  // Assertions remain bounded by expect.timeout below.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : undefined,
  reporter: [['list'], [path.join(__dirname, 'e2e', 'reporters', 'test-end-logger.js')]],
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
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: isQuiet ? 'ignore' : 'pipe',
      stderr: isQuiet ? 'ignore' : 'pipe',
    },
    {
      command: 'node scripts/e2e-serve-client.js',
      url: `http://localhost:${e2ePorts.client}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: isQuiet ? 'ignore' : 'pipe',
      stderr: isQuiet ? 'ignore' : 'pipe',
    },
  ],
});
