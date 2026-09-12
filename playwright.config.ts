import path from 'path';

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
const sharedCoreSpec =
  'auth|share-public|core-flow\\.shared|mypage-user|share-internal|trash|versions';

const desktopSpecMatch = new RegExp(
  `(?:${sharedCoreSpec}|registration-settings|core-flow\\.desktop)\\.spec\\.ts$`
);
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
  // trash-admin.spec.ts is EXCLUDED from the smoke: E2E-TRASH-007 is
  // scratch-hermetic (:5012, DEF-20) and runs only in the s3 full matrix.
  const smokeSpecMatch = new RegExp(
    '(core-flow\\.shared|share-public|share-internal|trash|webdav-reconcile)\\.spec\\.ts$'
  );
  const smokeTitleMatch = new RegExp(
    'E2E-(EXP-00[12458]|EXP-01[23]|SHARE-011|OVERLAY-011|TRASH-00[136]|RECON-001)[:\\s]'
  );
  projects.push({
    name: 'webdav-smoke-desktop',
    testMatch: smokeSpecMatch,
    grep: smokeTitleMatch,
    use: desktopUse,
  });
} else {
  // Platform core matrix: desktop → (full only: admin-desktop) → mobile →
  // (full only: admin-mobile). Each project boundary with mutable state gets
  // its own reset sibling. In core mode the mobile leg resets right after the
  // desktop core (as before).
  projects.push({
    name: `${backendMode}-desktop`,
    testMatch: desktopSpecMatch,
    use: desktopUse,
  });

  if (coreOnlyEnabled) {
    projects.push({
      name: `${backendMode}-mobile`,
      testMatch: mobileSpecMatch,
      use: mobileUse,
    });
  } else {
    // Suite projects are INDEPENDENT siblings (hermetic-dechain, 2026-09-11):
    // no per-project TRUNCATE resets and no ordering dependencies — ordering
    // via `dependencies` would cascade whole suites into partial runs and the
    // per-case containment + restore rules (docs/TESTING_STRATEGY.md) make the
    // resets unnecessary. mypage-admin still runs in its own dedicated
    // projects (B2) so its user/settings mutations never overlap the platform
    // cores' listings within one project.
    projects.push(
      { name: `${backendMode}-admin-desktop`, testMatch: adminSpecMatch, use: desktopUse },
      { name: `${backendMode}-mobile`, testMatch: mobileSpecMatch, use: mobileUse },
      { name: `${backendMode}-admin-mobile`, testMatch: adminSpecMatch, use: mobileUse }
    );

    // Additive, hermetic projects (setup-wizard / admin-config / migration).
    // They spawn their own scratch servers and are isolated per suite (Option A
    // Phase 1): each suite owns ONE distinct scratch port (:5003 wizard, :5010
    // admin-config, :5011 migration, :5012 trash-admin) mirrored by its
    // baseURL below, and the
    // migration suite targets its own dedicated MinIO bucket. Phase 2 lifted the
    // strict chain: the suites are now INDEPENDENT siblings, so they can overlap
    // the platform/admin projects and each other on idle workers. A suite's
    // mobile variant still depends on its desktop variant so one suite never
    // overlaps itself on the same port. Their scratch servers always boot a
    // webdav-mode file backend, so the s3 run still exercises real WebDAV wiring.
    const hermeticSpecs: Array<{
      name: string;
      spec: RegExp;
      use: typeof desktopUse | typeof mobileUse;
      baseURL: string;
    }> = [
      {
        name: 'setup-wizard-desktop',
        spec: /setup-wizard\.spec\.ts$/,
        use: desktopUse,
        baseURL: 'http://localhost:5003',
      },
      {
        name: 'setup-wizard-mobile',
        spec: /setup-wizard\.spec\.ts$/,
        use: mobileUse,
        baseURL: 'http://localhost:5003',
      },
      {
        name: 'admin-config-desktop',
        spec: /admin-config\.spec\.ts$/,
        use: desktopUse,
        baseURL: 'http://localhost:5010',
      },
      {
        name: 'admin-config-mobile',
        spec: /admin-config\.spec\.ts$/,
        use: mobileUse,
        baseURL: 'http://localhost:5010',
      },
      {
        name: 'migration-desktop',
        spec: /migration\.spec\.ts$/,
        use: desktopUse,
        baseURL: 'http://localhost:5011',
      },
      {
        name: 'migration-mobile',
        spec: /migration\.spec\.ts$/,
        use: mobileUse,
        baseURL: 'http://localhost:5011',
      },
      {
        // DEF-20: globally destructive trash case — scratch-hermetic on its
        // own server (:5012) so the "empty ALL trash" purge can never touch
        // the shared pool's in-flight trash cases.
        name: 'trash-admin-desktop',
        spec: /trash-admin\.spec\.ts$/,
        use: desktopUse,
        baseURL: 'http://localhost:5012',
      },
    ];
    for (const h of hermeticSpecs) {
      const dependencies = h.name.endsWith('-mobile')
        ? [h.name.replace(/-mobile$/, '-desktop')]
        : [];
      projects.push({
        name: h.name,
        testMatch: h.spec,
        dependencies,
        use: {
          ...h.use,
          baseURL: h.baseURL,
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
  reporter: [['list'], [path.join(__dirname, 'e2e', 'reporters', 'test-end-logger.js')]],
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
      // L3: serve the PRODUCTION client build (scripts/e2e-serve-client.js) —
      // builds once when client/build is missing, then serves it on :3000 with
      // an /api proxy to the E2E API server. Faster than the webpack dev server
      // and exercises the shipped bundle. Dev iteration uses `npm run e2e:client`.
      command: 'node scripts/e2e-serve-client.js',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: isQuiet ? 'ignore' : 'pipe',
      stderr: isQuiet ? 'ignore' : 'pipe',
    },
  ],
});
