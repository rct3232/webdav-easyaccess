import { defineConfig } from '@playwright/test';

const requestedMode = process.env.E2E_BACKEND_MODE || 's3';
if (requestedMode !== 's3' && requestedMode !== 'webdav') {
  throw new Error(`Invalid E2E_BACKEND_MODE "${requestedMode}". Expected "s3" or "webdav".`);
}
const backendMode = requestedMode;

const laterWavesEnabled = process.env.E2E_LATER_WAVES === '1';
const isQuiet = process.env.E2E_QUIET === '1';

const desktopSpecMatch = laterWavesEnabled
  ? /(?:auth|share-public|core-flow\.shared|desktop-core-flow|mypage-user|share-internal|mypage-admin|explorer-advanced\.desktop|s3-pg-integration)\.spec\.ts$/
  : /(?:auth|share-public|core-flow\.shared|desktop-core-flow|mypage-user|share-internal|s3-pg-integration)\.spec\.ts$/;

const mobileSpecMatch = laterWavesEnabled
  ? /(?:auth|share-public|core-flow\.shared|mobile-core-flow|mypage-user|share-internal|mypage-admin|explorer-advanced\.mobile|s3-pg-integration)\.spec\.ts$/
  : /(?:auth|share-public|core-flow\.shared|mobile-core-flow|mypage-user|share-internal|s3-pg-integration)\.spec\.ts$/;

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
