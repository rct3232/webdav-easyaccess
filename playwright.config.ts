import { defineConfig } from '@playwright/test';

const laterWavesEnabled = process.env.E2E_LATER_WAVES === '1';

const desktopSpecMatch = laterWavesEnabled
  ? /(?:auth|share-public|desktop-core-flow|mypage-user|share-internal|mypage-admin|explorer-advanced\.desktop)\.spec\.ts$/
  : /(?:auth|share-public|desktop-core-flow|mypage-user|share-internal)\.spec\.ts$/;

const mobileSpecMatch = laterWavesEnabled
  ? /(?:auth|share-public|mobile-core-flow|mypage-user|share-internal|mypage-admin|explorer-advanced\.mobile)\.spec\.ts$/
  : /(?:auth|share-public|mobile-core-flow|mypage-user|share-internal)\.spec\.ts$/;

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
  projects: [
    {
      name: 'desktop',
      testMatch: desktopSpecMatch,
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'mobile',
      testMatch: mobileSpecMatch,
      use: {
        browserName: 'webkit',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
