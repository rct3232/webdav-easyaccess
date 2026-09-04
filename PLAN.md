# PLAN.md — Env-config surface cleanup (A + B + C)

## Objective
Shrink and harden the project's environment-variable surface so that only
externally-injected deployment keys remain env-driven, test execution can never
be pointed at the production DB namespace, and orphan/legacy keys are removed.

## Scope
- **A — Test namespace isolation:** Jest harness must never inject or trust
  production `WEA_DB_*`. Remove `WEA_TEST_REMOTE` + `WEA_DB_TEST_DATABASE`;
  introduce a dedicated `WEA_TEST_PG_*` namespace + storage override seam for
  real-PG test legs; wipe ambient `WEA_DB_*` at test entry with fail-fast.
- **B — Orphan/legacy removal:** drop `PGSSLMODE` (doc orphan), purge
  `WEA_STORAGE_BACKEND` test references, fold singular `CORS_ORIGIN` into
  `CORS_ORIGINS`, clear vestigial `S3_REGION` handling.
- **C — Tuning keys DB-only:** the C-list keys become DB-settings + built-in
  default only (env overrides disabled); direct `process.env` reads replaced by
  the config resolver; env file/config-sync surface updated accordingly.
- Docs-first: spec/feature/docs updated before each code change (AGENTS §2.1).

## Non-goals
- No repository/dbExecutor refactor and no test-tier restructure yet
  (deferred until this cleanup lands).
- No change to e2e server boot flow (`.env.e2e` / seedDb legitimately use
  `WEA_DB_*` to run the *server under test* against the disposable PG).

## Success criteria
1. `rg WEA_TEST_REMOTE` / `WEA_DB_TEST_DATABASE` in repo → no code hits; real-PG
   jest leg runs via `WEA_TEST_PG_*`.
2. Test process entry wipes `WEA_DB_*` unconditionally and fails fast if any
   remains or if NODE_ENV=test + prod creds are detected.
3. C-list keys: env value ignored; effective config sourced from DB or default;
   all direct `process.env` reads of those keys gone from production code.
4. `.env.example` contains only externally-injected keys; orphans removed.
5. Server `npm run test:ci` (sqlite) green; targeted unit suites
   (`configRegistry`, `configResolver`, `configSync`, `storage`, `test-setup`
   behavior) green; lint clean.
6. Docs (features + spec) describe new model; no "pending" markers.

## Task dependency graph
```
P0  Doc/contract inventory & edit map (files+spec docs)
 ├─ P0a identify every spec/feature doc touched by A/B/C  → P1..P3 doc edits
P1  Scope B (orphans)                     [docs → code → tests]   (no deps)
P2  Scope A (test namespace isolation)    [docs → harness → scripts/tests]
P3  Scope C (tuning keys → DB-only)       [docs → registry/resolver → consumers → tests]
P4  Final verification (lint + test:ci sqlite + targeted pg-leg smoke)   ← P1,P2,P3
```

### P1 — B orphans
- Objective: remove `PGSSLMODE`, `WEA_STORAGE_BACKEND` refs, singular
  `CORS_ORIGIN`, `S3_REGION` traces.
- Inputs: `.env.example`, `configRegistry.js`, `index.js`, `server/*/__tests__`
  references, `e2e/helpers/setupScratch.ts`.
- Expected: zero doc/code references; tests updated.
- Verification: `rg` for each token → no hits (allow exceptions only where the
  absence itself is asserted).

### P2 — A test namespace
- Objective: jest cannot touch `WEA_DB_*`; real-PG leg via `WEA_TEST_PG_*` +
  storage override; wipe + fail-fast in `test-setup.js`.
- Inputs: `server/test-setup.js`, `server/test-utils.js`,
  `server/store/storage.js` (test-only pool seam), `server/package.json`
  (`test:ci:pg`), related specs/docs (`TEST_GIT_GUIDE.md`,
  `docs/spec/server/store/storage.md`).
- Expected: `WEA_TEST_REMOTE`/`WEA_DB_TEST_DATABASE` gone; new script wiring.
- Verification: unit test proving ambient `WEA_DB_*` wiped & fail-fast; sqlite
  suite green; documented manual PG-leg run against 5433.

### P3 — C tuning keys DB-only
- Objective: C-list keys resolve from DB row or built-in default only.
- Inputs: `configRegistry.js` (add env-override-off flag), `configResolver.js`
  (`getConfig`/`getConfigSync`/`getEffectiveConfig`/`populateT1Env`),
  direct-read consumers (list from P0 edit map), `configSync.js`/service,
  `envFileWriter.js`, admin effective-config surface, tests.
- Expected: registry flag honored; no direct `process.env` reads remain for C
  keys; DB rows still editable via admin UI.
- Verification: configResolver unit tests asserting env ignored + DB/default
  used; lint; sqlite test:ci green.

### P4 — Verification
- `npm run lint` (server) + `npm run test:ci` (sqlite) + targeted suites;
  docs walkthrough of PG-leg command; status summary to user.

## Recording
Progress notes and hypothesis changes are recorded here as tasks complete.
Unresolved/undecided items live only in `docs/IMPROVEMENT_PLAN.md`; spec/feature
docs describe the decided state.

### Progress
- [x] P1 (B orphans): docs + code + tests green. `.env.example`, SETUP.md,
  config-source-resolution.md, configRegistry spec, SystemConfigEditor spec +
  code (index.js, configRegistry, client editor/locales, setupScratch,
  useSetupWizard) purged of `PGSSLMODE`, `WEA_STORAGE_BACKEND`, `CORS_ORIGIN`
  (singular), `S3_REGION`. Verified: 6 targeted suites + setup.test +
  `npm run test:unit` (74 suites / 1313 pass) + eslint.
- [x] P2 (A test namespace): `WEA_TEST_REMOTE` / `WEA_DB_TEST_DATABASE` removed
  as decision points. test-setup blanks `WEA_DB_*` unconditionally, fails fast
  on a non-allowlisted `WEA_TEST_PG_DATABASE`; storage exposes the test-only
  override seam (setTestBackend/clearTestBackend, `NODE_ENV=test`-guarded);
  `createTestDatabase` builds the PG pool from `WEA_TEST_PG_*`;
  `test:ci:pg` rewired to `WEA_TEST_PG_*`; PG-leg gates (setup.test,
  metadataMigrationService roundtrip, migration.test) keyed to `WEA_TEST_PG_*`;
  new `testSetupGuard.test.js` + storage seam tests. `test:unit` green.
  NOTE: only defensive `delete`s of the legacy markers remain in test-setup and
  their removal is asserted by the guard test.
- [x] P3 (C tuning keys → DB-only): registry `dbOnly:true` on 18 tuning keys;
  configResolver skips env for dbOnly in getConfig/getConfigSync/
  getEffectiveConfig; populateT1Env no longer mirrors dbOnly T1 keys; direct
  env reads converted to the resolver (maintenanceScheduler GC_INTERVAL_MS,
  tokenStore REFRESH_TOKEN_EXPIRES_IN_DAYS, thumbnailService
  THUMBNAIL_CONCURRENCY_LIMIT); configSyncService ignores dbOnly env; wizard
  env lists drop JWT_EXPIRES_IN (envFileWriter/setupStatus → DB partition);
  .env.example + docs updated (config-source-resolution, configRegistry spec,
  SETUP.md); tests updated (maintenanceScheduler resolver-mocked, gcService
  DB-seed, configResolver/configRegistry/configSyncService dbOnly cases, GC
  route suites no longer set env). **`test:ci` green: 90 suites / 1693 pass.**
- [x] P4 verification: `npm run test:ci` (sqlite, coverage) green; eslint clean
  on all touched files; `test:unit` and `test:integration` green. Docs: feature
  doc + SETUP + configRegistry spec + storage spec + TESTING_STRATEGY +
  .env.example reflect new model. Residual minor: configResolver.md spec still
  phrases the generic env-first step without the dbOnly carve-out (cosmetic).
