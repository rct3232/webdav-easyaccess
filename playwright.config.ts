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
// W5 (2026-09-07): mypage-admin no longer runs inside the desktop/mobile core
// projects — it has dedicated post-reset projects so its shared-state mutations
// (users list, registration setting) never overlap auth.spec concurrently (B2).
const sharedCoreSpec = 'auth|share-public|core-flow\\.shared|mypage-user|share-internal';

const desktopSpecMatch = new RegExp(`(?:${sharedCoreSpec}|core-flow\\.desktop)\\.spec\\.ts$`);
const mobileSpecMatch = new RegExp(`(?:${sharedCoreSpec}|core-flow\\.mobile)\\.spec\\.ts$`);
const adminSpecMatch = /mypage-admin\.spec\.ts$/;

// Per-project data isolation (TESTING_STRATEGY.md "Per-project data isolation via
// setup projects"): the shared E2E DB must be reset once per dependent project.
// Each test project gets its OWN setup sibling that runs `00-project-setup.spec.ts`
// before it — never one shared setup (a dependencies setup runs once per run).
const setupSpecMatch = /00-project-setup\.spec\.ts$/;

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

// Project matrix by backend mode (Option A, 2026-09-07):
// - `E2E_BACKEND_MODE=s3` (default): the single canonical FULL UI matrix —
//   desktop/mobile platform cores + (full mode) dedicated mypage-admin projects
//   + the hermetic additive projects. `npm run test:e2e` runs these projects.
// - `E2E_BACKEND_MODE=webdav`: a thin backend-wiring SMOKE (chromium desktop)
//   that greps the real-webdav nets out of core-flow.shared/share-public/
//   share-internal. The full webdav UI duplicate is retired — the webdav server
//   mode is covered by the hermetic suites in the s3 run plus this smoke.
// The platform suffix keeps the specs' `testInfo.project.name.endsWith(
// '-desktop'|'-mobile')` checks working regardless of the mode prefix.
type PlaywrightProject = NonNullable<Parameters<typeof defineConfig>[0]['projects']>[number];

const projects: PlaywrightProject[] = [];

if (backendMode === 'webdav') {
  const smokeSpecMatch = new RegExp(
    '(core-flow\\.shared|share-public|share-internal)\\.spec\\.ts$'
  );
  const smokeTitleMatch = new RegExp('E2E-(EXP-00[12458]|EXP-01[23]|SHARE-011|OVERLAY-011)[:\\s]');
  projects.push(
    {
      name: 'webdav-smoke-setup',
      testMatch: setupSpecMatch,
    },
    {
      name: 'webdav-smoke-desktop',
      testMatch: smokeSpecMatch,
      grep: smokeTitleMatch,
      dependencies: ['webdav-smoke-setup'],
      use: desktopUse,
    }
  );
} else {
  // Platform core matrix: desktop → (full only: admin-desktop) → mobile →
  // (full only: admin-mobile). Each project boundary with mutable state gets
  // its own reset sibling. In core mode the mobile leg resets right after the
  // desktop core (as before).
  projects.push(
    {
      name: `${backendMode}-desktop-setup`,
      testMatch: setupSpecMatch,
    },
    {
      name: `${backendMode}-desktop`,
      testMatch: desktopSpecMatch,
      dependencies: [`${backendMode}-desktop-setup`],
      use: desktopUse,
    }
  );

  if (coreOnlyEnabled) {
    projects.push(
      {
        name: `${backendMode}-mobile-setup`,
        testMatch: setupSpecMatch,
        // Reset must happen AFTER the desktop core finished.
        dependencies: [`${backendMode}-desktop`],
      },
      {
        name: `${backendMode}-mobile`,
        testMatch: mobileSpecMatch,
        dependencies: [`${backendMode}-mobile-setup`],
        use: mobileUse,
      }
    );
  } else {
    const adminDesktopSetup = `${backendMode}-admin-desktop-setup`;
    const adminDesktop = `${backendMode}-admin-desktop`;
    const adminMobileSetup = `${backendMode}-admin-mobile-setup`;
    const adminMobile = `${backendMode}-admin-mobile`;

    projects.push(
      {
        name: adminDesktopSetup,
        testMatch: setupSpecMatch,
        dependencies: [`${backendMode}-desktop`],
      },
      {
        name: adminDesktop,
        testMatch: adminSpecMatch,
        dependencies: [adminDesktopSetup],
        use: desktopUse,
      },
      {
        name: `${backendMode}-mobile-setup`,
        testMatch: setupSpecMatch,
        dependencies: [adminDesktop],
      },
      {
        name: `${backendMode}-mobile`,
        testMatch: mobileSpecMatch,
        dependencies: [`${backendMode}-mobile-setup`],
        use: mobileUse,
      },
      {
        name: adminMobileSetup,
        testMatch: setupSpecMatch,
        dependencies: [`${backendMode}-mobile`],
      },
      {
        name: adminMobile,
        testMatch: adminSpecMatch,
        dependencies: [adminMobileSetup],
        use: mobileUse,
      }
    );

    // Additive, hermetic projects (setup-wizard / admin-config / migration).
    // They spawn their own scratch servers on the fixed :5003 port and their
    // migration suite empties the shared S3 bucket, so they can never overlap
    // the platform/admin projects OR each other. They are therefore chained in
    // strict project order AFTER the full platform chain (`adminMobile`), which
    // also keeps the s3 run safe when workers>1. Their scratch servers always
    // boot a webdav-mode file backend, so the s3 run still exercises real
    // WebDAV wiring.
    const hermeticSpecs: Array<{
      name: string;
      spec: RegExp;
      use: typeof desktopUse;
      dependsOn: string;
    }> = [
      {
        name: 'setup-wizard-desktop',
        spec: /setup-wizard\.spec\.ts$/,
        use: desktopUse,
        dependsOn: adminMobile,
      },
      {
        name: 'setup-wizard-mobile',
        spec: /setup-wizard\.spec\.ts$/,
        use: mobileUse,
        dependsOn: '',
      },
      {
        name: 'admin-config-desktop',
        spec: /admin-config\.spec\.ts$/,
        use: desktopUse,
        dependsOn: '',
      },
      {
        name: 'admin-config-mobile',
        spec: /admin-config\.spec\.ts$/,
        use: mobileUse,
        dependsOn: '',
      },
      { name: 'migration-desktop', spec: /migration\.spec\.ts$/, use: desktopUse, dependsOn: '' },
      { name: 'migration-mobile', spec: /migration\.spec\.ts$/, use: mobileUse, dependsOn: '' },
    ];
    hermeticSpecs[0].dependsOn = adminMobile;
    for (let i = 1; i < hermeticSpecs.length; i += 1) {
      hermeticSpecs[i].dependsOn = hermeticSpecs[i - 1].name;
    }
    for (const h of hermeticSpecs) {
      projects.push({
        name: h.name,
        testMatch: h.spec,
        dependencies: [h.dependsOn],
        use: {
          ...h.use,
          baseURL: 'http://localhost:5003',
        },
      });
    }
  }
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
