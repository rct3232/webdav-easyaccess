import path from 'path';

import { defineConfig } from '@playwright/test';

import { e2ePorts, apiOrigin, appOrigin } from './e2e/helpers/ports';

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

// Hermetic scratch-suite entry shape + the shared push rule (P0 closeout
// item 3 extracted this from the s3-only loop): a `-mobile` variant depends
// on its `-desktop` sibling only when they SHARE one scratch port; entries
// flagged `standalone` boot their own scratch server on their own port slot
// and stay independent siblings (hermetic-dechain rule).
interface HermeticEntry {
  name: string;
  spec: RegExp;
  use: typeof desktopUse | typeof mobileUse;
  baseURL: string;
  standalone?: boolean;
}

const pushHermetic = (entries: HermeticEntry[]) => {
  for (const h of entries) {
    const dependencies =
      h.name.endsWith('-mobile') && !h.standalone ? [h.name.replace(/-mobile$/, '-desktop')] : [];
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
};

// The collections legs run in BOTH backend modes (P0 closeout item 3): their
// scratch servers boot a webdav file backend UNCONDITIONALLY
// (`writeScratchEnv({ WEA_FILE_STORAGE: 'webdav' })` in the specs), never use
// the shared :5002 pool nor the MinIO bucket, so an s3 host stack adds nothing
// they depend on and a webdav host stack breaks nothing. Desktop (:5013) and
// mobile (:5014) own distinct slots ⇒ standalone siblings, no dependency link.
const collectionsSpecs: HermeticEntry[] = [
  {
    // P0 collections lifecycle (E2E-COLLECTION-001..014 + 018..020) — scratch-hermetic
    // on its own server (:5013) per the destructive-case policy: the suite
    // permanently deletes collections and rewrites the per-user undo-journal
    // chain, so it never runs against the shared :5002 pool. The spec boots
    // ONE scratch server for the file. Mobile leg (E2E-COLLECTION-015..017):
    // `collections.mobile.spec.ts` below on its OWN scratch server.
    name: 'collections-desktop',
    spec: /collections\.spec\.ts$/,
    use: desktopUse,
    baseURL: `http://localhost:${e2ePorts.scratchCollections}`,
  },
  {
    // Collections mobile leg (format convergence): the SAME dual-platform
    // file under the mobile project — it shares the ONE :5013 scratch slot
    // with the desktop sibling, so the pushHermetic rule wires
    // `dependencies: [collections-desktop]` (retrieval/admin-config shape).
    // The former standalone twin (collections.mobile.spec.ts on :5014) is
    // retired; its mobile-only interplay cases live in the shared file as
    // reason-carrying desktop skips.
    name: 'collections-mobile',
    spec: /collections\.spec\.ts$/,
    use: mobileUse,
    baseURL: `http://localhost:${e2ePorts.scratchCollections}`,
  },
];

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
  pushHermetic(collectionsSpecs);
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
    // Registration-settings pair (runs in BOTH core and full mode): the
    // `registration_enabled` value is ONE GLOBAL server setting that only
    // this file may disable, so the two projects must never overlap — the
    // mobile variant chains after the desktop one (every case restores the
    // ambient default, so the chained run starts enabled).
    projects.push(
      {
        name: `${backendMode}-regset-desktop`,
        testMatch: /registration-settings\.spec\.ts$/,
        use: desktopUse,
      },
      {
        name: `${backendMode}-regset-mobile`,
        testMatch: /registration-settings\.spec\.ts$/,
        use: mobileUse,
        dependencies: [`${backendMode}-regset-desktop`],
      }
    );
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
      { name: `${backendMode}-admin-mobile`, testMatch: adminSpecMatch, use: mobileUse },
      // Registration-settings pair (format convergence): the `registration_enabled`
      // value is ONE GLOBAL server setting that only this file may disable, so the
      // two projects must never overlap — the mobile variant chains after the
      // desktop one (every case restores the ambient default, so the chained run
      // starts enabled). mypage-admin W5 shape: dedicated projects keep the
      // global-value mutations out of the platform cores' concurrent workers.
      {
        name: `${backendMode}-regset-desktop`,
        testMatch: /registration-settings\.spec\.ts$/,
        use: desktopUse,
      },
      {
        name: `${backendMode}-regset-mobile`,
        testMatch: /registration-settings\.spec\.ts$/,
        use: mobileUse,
        dependencies: [`${backendMode}-regset-desktop`],
      }
    );

    // Additive, hermetic projects (setup-wizard / admin-config / migration /
    // trash-admin / retrieval); the collections legs are mode-agnostic and
    // pushed below (`collectionsSpecs`).
    // They spawn their own scratch servers and are isolated per suite (Option A
    // Phase 1): each suite owns ONE distinct scratch port slot
    // (`e2ePorts.scratch*` = base :5003 wizard, :5010 admin-config, :5011
    // migration, :5012 trash-admin, :5013 collections desktop, :5014
    // collections mobile — band offset 0) mirrored by its
    // baseURL, and the migration suite targets its own dedicated MinIO bucket.
    // Phase 2 lifted the strict chain: the suites are now INDEPENDENT siblings,
    // so they can overlap the platform/admin projects and each other on idle
    // workers. A suite's mobile variant still depends on its desktop variant so
    // one suite never overlaps itself on the same port (the `standalone` flag
    // exempts mobile variants that boot their own scratch server). Their scratch
    // servers always boot a webdav-mode file backend, so the s3 run still
    // exercises real WebDAV wiring.
    const hermeticSpecs: HermeticEntry[] = [
      {
        name: 'setup-wizard-desktop',
        spec: /setup-wizard\.spec\.ts$/,
        use: desktopUse,
        baseURL: `http://localhost:${e2ePorts.scratchWizard}`,
      },
      {
        name: 'setup-wizard-mobile',
        spec: /setup-wizard\.spec\.ts$/,
        use: mobileUse,
        baseURL: `http://localhost:${e2ePorts.scratchWizard}`,
      },
      {
        name: 'admin-config-desktop',
        spec: /admin-config\.spec\.ts$/,
        use: desktopUse,
        baseURL: `http://localhost:${e2ePorts.scratchAdminConfig}`,
      },
      {
        name: 'admin-config-mobile',
        spec: /admin-config\.spec\.ts$/,
        use: mobileUse,
        baseURL: `http://localhost:${e2ePorts.scratchAdminConfig}`,
      },
      {
        name: 'migration-desktop',
        spec: /migration\.spec\.ts$/,
        use: desktopUse,
        baseURL: `http://localhost:${e2ePorts.scratchMigration}`,
      },
      {
        name: 'migration-mobile',
        spec: /migration\.spec\.ts$/,
        use: mobileUse,
        baseURL: `http://localhost:${e2ePorts.scratchMigration}`,
      },
      {
        // DEF-20: globally destructive trash case — scratch-hermetic on its
        // own server (:5012) so the "empty ALL trash" purge can never touch
        // the shared pool's in-flight trash cases. Dual-platform (format
        // convergence): the mobile variant re-boots the same scratch after
        // the desktop leg (dependency chain) — the purge only ever affects
        // this isolated world, so the DEF-20 rationale is unaffected.
        name: 'trash-admin-desktop',
        spec: /trash-admin\.spec\.ts$/,
        use: desktopUse,
        baseURL: `http://localhost:${e2ePorts.scratchTrashAdmin}`,
      },
      {
        name: 'trash-admin-mobile',
        spec: /trash-admin\.spec\.ts$/,
        use: mobileUse,
        baseURL: `http://localhost:${e2ePorts.scratchTrashAdmin}`,
      },
      {
        // E2E-RETRIEVAL-001..021 — server-wide name search rendered inside
        // the explorer surfaces (zones + chip bar). Scratch-hermetic on its
        // own server (:5015, same destructive-suite pattern as collections):
        // own sqlite + webdav file backend, never the shared :5002 pool.
        // The serial file owns the scratch lifecycle. WEBDAV HOST-MODE LEG
        // DEFERRED (v1 = s3 runs only): the scratch server boots its own
        // webdav backend unconditionally, so the s3 project already
        // exercises real WebDAV wiring; enabling the entry in the webdav
        // branch is a follow-up if the smoke matrix ever owns it.
        name: 'retrieval-desktop',
        spec: /retrieval\.spec\.ts$/,
        use: desktopUse,
        baseURL: `http://localhost:${e2ePorts.scratchRetrieval}`,
      },
      {
        // The dual-platform leg of the same suite (WP-E): webkit + mobileUse
        // with in-test isMobileProject branching. NOT standalone — it shares
        // the ONE :5015 scratch slot with its desktop sibling, so the
        // pushHermetic rule wires `dependencies: [retrieval-desktop]` (the
        // desktop project boots+kills the server first, the mobile project
        // then re-boots it on the same port — admin-config/migration shape).
        name: 'retrieval-mobile',
        spec: /retrieval\.spec\.ts$/,
        use: mobileUse,
        baseURL: `http://localhost:${e2ePorts.scratchRetrieval}`,
      },
      {
        // E2E-AI-001 — semantic search over the embed-enabled engine
        // (routes/search.md §2.4). Scratch-hermetic on its OWN server
        // (:5016, own sqlite + webdav file backend, never the shared :5002
        // pool); the spec boots the scratch with `WEA_MODEL_DIR` pointing at
        // the pre-seeded EG2 weights directory so boot provisioning is a
        // zero-download no-op and the embed role is configured at boot.
        // Standalone sibling (own slot — no shared-port dependency chain).
        name: 'ai-desktop',
        spec: /ai\.spec\.ts$/,
        use: desktopUse,
        baseURL: `http://localhost:${e2ePorts.scratchAi}`,
      },
    ];
    pushHermetic(hermeticSpecs);
    pushHermetic(collectionsSpecs);
  }
}

export default defineConfig({
  // Production-build static assets and WebDAV-backed scratch stacks can take
  // >5 s on a cold CI/worktree disk; 15 s keeps assertions observable without
  // changing what they assert.
  expect: { timeout: 15_000 },
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], [path.join(__dirname, 'e2e', 'reporters', 'test-end-logger.js')]],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: appOrigin,
    trace: 'retain-on-failure',
  },
  projects,
  // Automatically start and stop the server/client for E2E tests
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
      // L3: serve the PRODUCTION client build (scripts/e2e-serve-client.js) —
      // builds once when client/build is missing, then serves it on :3000 with
      // an /api proxy to the E2E API server. Faster than the webpack dev server
      // and exercises the shipped bundle. Dev iteration uses `npm run e2e:client`.
      command: 'node scripts/e2e-serve-client.js',
      url: `http://localhost:${e2ePorts.client}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: isQuiet ? 'ignore' : 'pipe',
      stderr: isQuiet ? 'ignore' : 'pipe',
    },
  ],
});
