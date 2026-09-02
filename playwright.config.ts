import { defineConfig } from '@playwright/test';

const requestedMode = process.env.E2E_BACKEND_MODE || 's3';
if (requestedMode !== 's3' && requestedMode !== 'webdav') {
  throw new Error(`Invalid E2E_BACKEND_MODE "${requestedMode}". Expected "s3" or "webdav".`);
}
const backendMode = requestedMode;

const laterWavesEnabled = process.env.E2E_LATER_WAVES === '1';
const isQuiet = process.env.E2E_QUIET === '1';

const desktopSpecMatch = laterWavesEnabled
  ? /(?:00-project-setup|auth|share-public|core-flow\.shared|desktop-core-flow|mypage-user|share-internal|mypage-admin|explorer-advanced\.desktop)\.spec\.ts$/
  : /(?:00-project-setup|auth|share-public|core-flow\.shared|desktop-core-flow|mypage-user|share-internal)\.spec\.ts$/;

const mobileSpecMatch = laterWavesEnabled
  ? /(?:00-project-setup|auth|share-public|core-flow\.shared|mobile-core-flow|mypage-user|share-internal|mypage-admin|explorer-advanced\.mobile)\.spec\.ts$/
  : /(?:00-project-setup|auth|share-public|core-flow\.shared|mobile-core-flow|mypage-user|share-internal)\.spec\.ts$/;

// Only the projects for the active E2E_BACKEND_MODE are defined, so
// `npm run test:e2e:s3` (E2E_BACKEND_MODE=s3) runs the s3-* projects only and
// `npm run test:e2e:webdav` runs the webdav-* projects only. The platform
// suffix keeps the specs' `testInfo.project.name.endsWith('-desktop'|'-mobile')`
// checks working regardless of the mode prefix.
type PlaywrightProject = NonNullable<Parameters<typeof defineConfig>[0]['projects']>[number];

const projects: PlaywrightProject[] = [
  {
    name: `${backendMode}-desktop`,
    testMatch: desktopSpecMatch,
    use: {
      browserName: 'chromium',
      viewport: { width: 1280, height: 720 },
    },
  },
  {
    name: `${backendMode}-mobile`,
    testMatch: mobileSpecMatch,
    use: {
      browserName: 'webkit',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    },
  },
  // Additive, hermetic setup-wizard projects (PLAN.md §7.2). They never reuse
  // the shared `.env.e2e` boot state: each test spawns its own scratch server
  // instance on :5003 (own env file, own sqlite path, own scratch PG DB) and
  // supervises its own process lifecycle because restart is the behavior under
  // test. The mode-prefixed projects above intentionally never match
  // `setup-wizard.spec.ts` (their testMatch regexes do not include it), so the
  // setup projects are the only ones that pick this spec up.
  {
    name: 'setup-wizard-desktop',
    testMatch: /setup-wizard\.spec\.ts$/,
    use: {
      browserName: 'chromium',
      viewport: { width: 1280, height: 720 },
      baseURL: 'http://localhost:5003',
    },
  },
  {
    name: 'setup-wizard-mobile',
    testMatch: /setup-wizard\.spec\.ts$/,
    use: {
      browserName: 'webkit',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      baseURL: 'http://localhost:5003',
    },
  },
  // Additive, hermetic admin-config projects: same scratch-server pattern as
  // setup-wizard — each test spawns its own fully-configured scratch server on
  // :5003 (own .env, own sqlite) so the config editor's source/tier matrix,
  // save feedback and secret lifecycle are deterministic.
  {
    name: 'admin-config-desktop',
    testMatch: /admin-config\.spec\.ts$/,
    use: {
      browserName: 'chromium',
      viewport: { width: 1280, height: 720 },
      baseURL: 'http://localhost:5003',
    },
  },
  {
    name: 'admin-config-mobile',
    testMatch: /admin-config\.spec\.ts$/,
    use: {
      browserName: 'webkit',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      baseURL: 'http://localhost:5003',
    },
  },
  // Additive, hermetic unified-migration-mode projects: same scratch-server
  // pattern as setup-wizard/admin-config — each test spawns its own fully
  // configured scratch server on :5003 (own .env, own sqlite, own scratch PG
  // target) and drives the migration dialogs / /migration page against it.
  {
    name: 'migration-desktop',
    testMatch: /migration\.spec\.ts$/,
    use: {
      browserName: 'chromium',
      viewport: { width: 1280, height: 720 },
      baseURL: 'http://localhost:5003',
    },
  },
  {
    name: 'migration-mobile',
    testMatch: /migration\.spec\.ts$/,
    use: {
      browserName: 'webkit',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      baseURL: 'http://localhost:5003',
    },
  },
];

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects,
  // Automatically start and stop the server/client for E2E tests
  webServer: [
    {
      command: 'npm run e2e:server',
      url: 'http://localhost:5002/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: isQuiet ? 'ignore' : 'pipe',
      stderr: isQuiet ? 'ignore' : 'pipe',
    },
    {
      command: 'npm run e2e:client',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: isQuiet ? 'ignore' : 'pipe',
      stderr: isQuiet ? 'ignore' : 'pipe',
    },
  ],
});
