import { defineConfig } from '@playwright/test';

const requestedMode = process.env.E2E_BACKEND_MODE || 's3';
if (requestedMode !== 's3' && requestedMode !== 'webdav') {
  throw new Error(`Invalid E2E_BACKEND_MODE "${requestedMode}". Expected "s3" or "webdav".`);
}
const backendMode = requestedMode;

const coreOnlyEnabled = process.env.E2E_CORE === '1';
const isQuiet = process.env.E2E_QUIET === '1';

// Platform-agnostic core suites plus the platform core-flow twins. `mypage-admin`
// (admin user management/settings) is non-essential — it changes independently of
// the core file-exploration flows — so it is excluded when E2E_CORE=1 (essential
// run: `npm run test:e2e:core`). The hermetic projects below (setup-wizard,
// admin-config, migration) are likewise non-essential and are skipped in core mode.
const sharedCoreSpec = 'auth|share-public|core-flow\\.shared|mypage-user|share-internal';

const desktopSpecMatch = coreOnlyEnabled
  ? new RegExp(`(?:${sharedCoreSpec}|core-flow\\.desktop)\\.spec\\.ts$`)
  : new RegExp(`(?:${sharedCoreSpec}|core-flow\\.desktop|mypage-admin)\\.spec\\.ts$`);

const mobileSpecMatch = coreOnlyEnabled
  ? new RegExp(`(?:${sharedCoreSpec}|core-flow\\.mobile)\\.spec\\.ts$`)
  : new RegExp(`(?:${sharedCoreSpec}|core-flow\\.mobile|mypage-admin)\\.spec\\.ts$`);

// Per-project data isolation (TESTING_STRATEGY.md "Per-project data isolation via
// setup projects"): the shared E2E DB must be reset once per dependent project.
// Each test project gets its OWN setup sibling that runs `00-project-setup.spec.ts`
// before it — never one shared setup (a dependencies setup runs once per run).
const setupSpecMatch = /00-project-setup\.spec\.ts$/;

// Only the projects for the active E2E_BACKEND_MODE are defined, so
// `npm run test:e2e:s3` (E2E_BACKEND_MODE=s3) runs the s3-* projects only and
// `npm run test:e2e:webdav` runs the webdav-* projects only. The platform
// suffix keeps the specs' `testInfo.project.name.endsWith('-desktop'|'-mobile')`
// checks working regardless of the mode prefix.
type PlaywrightProject = NonNullable<Parameters<typeof defineConfig>[0]['projects']>[number];

const projects: PlaywrightProject[] = [
  {
    name: `${backendMode}-desktop-setup`,
    testMatch: setupSpecMatch,
  },
  {
    name: `${backendMode}-desktop`,
    testMatch: desktopSpecMatch,
    dependencies: [`${backendMode}-desktop-setup`],
    use: {
      browserName: 'chromium',
      viewport: { width: 1280, height: 720 },
    },
  },
  {
    name: `${backendMode}-mobile-setup`,
    testMatch: setupSpecMatch,
    // The mobile project's data reset must happen AFTER the desktop project's
    // tests (Playwright runs all dependency-only setup projects first, so a
    // plain `dependencies: [desktop-setup]` would reset before desktop tests
    // and leave the mobile project running on desktop-polluted data). Depending
    // on the desktop project orders the reset right before mobile runs.
    dependencies: [`${backendMode}-desktop`],
  },
  {
    name: `${backendMode}-mobile`,
    testMatch: mobileSpecMatch,
    dependencies: [`${backendMode}-mobile-setup`],
    use: {
      browserName: 'webkit',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    },
  },
];

// Additive, hermetic projects (setup-wizard / admin-config / migration). They
// spawn their own scratch servers on :5003 and are NON-essential: they test
// first-run/config/migration tooling that changes independently of the core
// file-exploration flows, so they are skipped in essential mode (E2E_CORE=1).
if (!coreOnlyEnabled) {
  projects.push(
    // Hermetic setup-wizard projects (PLAN.md §7.2). They never reuse the
    // shared `.env.e2e` boot state: each test spawns its own scratch server
    // instance on :5003 (own env file, own sqlite path, own scratch PG DB) and
    // supervises its own process lifecycle because restart is the behavior
    // under test. The mode-prefixed projects never match `setup-wizard.spec.ts`
    // (their testMatch regexes do not include it).
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
    // Hermetic admin-config projects: same scratch-server pattern as
    // setup-wizard — each test spawns its own fully-configured scratch server
    // on :5003 (own .env, own sqlite) so the config editor's source/tier
    // matrix, save feedback and secret lifecycle are deterministic.
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
    // Hermetic unified-migration-mode projects: same scratch-server pattern as
    // setup-wizard/admin-config — each test spawns its own fully configured
    // scratch server on :5003 (own .env, own sqlite, own scratch PG target)
    // and drives the migration dialogs / /migration page against it.
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
    }
  );
}

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
