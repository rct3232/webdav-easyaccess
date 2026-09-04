# PLAN.md

## Objective (current workstream)
Introduce a real DB interface (executor + repositories) and rewrite the test
tiers around it (functional on sqlite once; per-RDB adapter conformance; thin
cross-DB smoke), eliminating dialect branching from store/service code.

Agreed decisions:
- **Full repository pattern** (domain interfaces + sqlite/postgres implementations).
- **PG leg shrink**: retire the full-suite `test:ci:pg` run; L2 adapter
  conformance + L3 smoke become the real-PG coverage (behind `WEA_TEST_PG_*`).
- **Pilot-first**: Settings → User → RecentFiles/ShareLink → FileNode →
  Permission; raw-row (L1) asserts are cleaned up in bulk *after* a domain's
  repository lands.
- Prerequisite landed 2026-09-04 (commit `ad6d998`, merged to dev `08b928c`):
  jest/`WEA_DB_*` isolation + `WEA_TEST_PG_*` namespace + storage test-only
  backend override seam + DB-only tuning keys.

## Key Components
- `server/infrastructure/db/` — executor seam (`executor.js`, `sqliteExecutor.js`, `postgresExecutor.js`), selected via `storage.getExecutor()`.
- `server/store/repositories/` — per-domain repositories (interface + sqlite + postgres impls) with L2 conformance suites.
- Existing store modules become facades over the repositories (call sites unchanged).
- Test tiers: L0 unit / L1 functional (sqlite) / L2 DB-adapter conformance (real sqlite + real PG) / L3 cross-DB smoke.

## Success Criteria
1. Every converted domain has: repository interface + 2 dialect impls + facade rewired + L2 conformance suite (sqlite green; PG green under the adapter leg).
2. No dialect branching left in converted domains outside `repositories/` + `db/`.
3. All existing suites green (`test:unit`, `test:integration`, `test:ci`) after each domain conversion; docs/spec updated docs-first.
4. Final state: `test:ci:pg` reduced to the adapter/smoke tier (no full-suite PG run), documented in `TEST_GIT_GUIDE.md` / `AGENTS.md`; `webdav_test` provisioning exists.

## Task dependency graph
```
D1  Docs: executor.md + repository-contract.md + this PLAN rewrite   ← done first (docs-first)
D2  Executors (sqlite/postgres) + storage.getExecutor() + unit tests
D3  SettingsRepository pilot (impls + facade rewire + L2 conformance)
D4  UserRepository pilot (absorb metadata adapters, drop vestigial share half)
      + userStore facade + conformance suite
D5  RecentFilesRepository + ShareLinkRepository (incl. isLinkExpired move)
D6  FileNodeRepository (contract tests first; staged conversion)
D7  PermissionRepository + PermissionRequestRepository (staged)
D8  L1 bulk cleanup of raw-row asserts for converted domains
D9  PG leg shrink (test:ci:pg → adapter/smoke tier), webdav_test provisioning,
    docs (TEST_GIT_GUIDE/AGENTS/TESTING_STRATEGY), lockManager/schemaManager
    adapter conformance classification
D10 Final verification: test:ci (sqlite), adapter leg (PG), lint; PLAN close-out
```
D2 → D3 → D4 → D5 sequential (pattern proof); D6/D7 depend on D2–D4 pattern;
D8 depends on D5–D7; D9/D10 last.

## Recording
- 2026-09-04: env-config cleanup (A/B/C) merged to dev (`08b928c`); test
  namespace isolation (`WEA_TEST_PG_*`, storage override seam) is the foundation
  this plan builds on.
- 2026-09-04: **D1 done** — `docs/spec/server/store/executor.md` +
  `docs/spec/server/store/repository-contract.md` written (docs-first).
- 2026-09-04: **D2 done** — executor seam implemented
  (`infrastructure/db/{executor,sqliteExecutor,postgresExecutor}.js`) +
  `storage.getExecutor()` + `withSqliteTransaction` client gains `run`;
  executor unit/conformance tests green (sqlite real DB, PG mocked pool,
  override selection).
- 2026-09-04: **D3 done** — `SettingsRepository` (interface + sqlite/postgres
  impls), `settingsStore` converted to a facade; `SettingsRepository`
  conformance suite green on the active backend. `test:ci` green after D3.
- 2026-09-04: **D4 done** — `UserRepository` (interface + sqlite/postgres
  impls + shared `userShared.js`), `userStore` facade rewired; former
  `infrastructure/adapters/metadata` user adapters removed and `isLinkExpired`
  moved to `server/store/isLinkExpired.js`; `UserRepository` conformance suite
  green. `test:ci` green (93 suites / 1726 passed).
- 2026-09-04: **D5 done** — `RecentFilesRepository` + `ShareLinkRepository`
  (interfaces + sqlite/postgres impls), `recentFilesStore`/`shareLinkStore`
  converted to facades; shareLinkStore PG-mock test supplies an executor via
  the storage mock (pattern for remaining mock-PG suites). Conformance suites
  green; `test:ci` green (95 suites / 1742 passed). Remaining: D6 FileNode,
  D7 Permission, D8 raw-row assert cleanup, D9 PG-leg shrink, D10 close-out.
- 2026-09-04: **D6 done** — `FileNodeRepository` (interface + sqlite/postgres
  impls + shared `fileNodeShared.js` mappers; 31 methods, the largest dialect
  surface) with `fileNodesStore` converted to a facade. Conformance suite (13
  tests: node/child CRUD, ancestor closure, path resolution, object_map
  lifecycle, filecache, user root) green on the active backend; `test:ci`
  green (96 suites / 1755 passed). Remaining: D7 Permission stores, D8 raw-row
  assert cleanup, D9 PG-leg shrink, D10 close-out.
- 2026-09-04: **D7 done** — `PermissionRepository` + `PermissionRequestRepository`
  (interfaces + sqlite/postgres impls + shared SQL builders
  `permissionShared.js`/`permissionRequestShared.js`). Both permission stores
  converted to facades that keep the domain side-effects (user-permission
  cache, ACL existence-index invalidation, meetsRank policy, request
  validation); mock-PG/sqlite store unit tests now supply executors through
  their storage mocks. Executor `run()` gains the RETURNING-rows contract
  (sqlite routes RETURNING statements through db.all). Notable catch fixed
  during conversion: the shared ancestor-permission SELECT is keyed by
  `user_id` for user tables but `token` for permissions_shares.
  `test:ci` green (96 suites / 1755 passed). Remaining: D8, D9, D10.
- 2026-09-04: **D9 done** (D8 partially deferred — see note) —
  `test:ci:pg:adapters` added: the only real-PG jest entry point, targeting
  repository conformance + executor + real-DB store/schema/migration suites.
  The full-suite `test:ci:pg` leg is retired. `webdav_test` DB is
  self-provisioned by `createTestDatabase()` when missing (CREATEDB-holding
  connection user; unsafe names refused). Executor sqlite unit describe now
  stands up its own temp sqlite DB so it is safe on both legs (no implicit
  reach into a developer's default sqlite file). Docs updated docs-first:
  TESTING_STRATEGY (tier model table + rules), TEST_GIT_GUIDE (CI example
  with adapter leg), AGENTS.md merge gate (adapter leg required for storage
  changes), metadata-migration specs (roundtrip → `test:ci:pg:adapters`).
  Verified: adapter leg 13 suites / 176 tests green on real PostgreSQL
  (docker `webdav-pg-e2e`); default sqlite leg green (test:ci 1754 passed).
- **D8 note**: raw-row asserts in L1 suites are already scoped by the
  repository-contract policy (conformance suites own schema-level
  verification; L1 behavioral asserts that observe rows as the action's
  output remain legitimate under "Verify What, not How"). A full mechanical
  sweep of `dbQuery` usages in service/route tests was assessed and deferred:
  the highest-value tier work (L2 conformance + adapter leg) is complete and
  those raw asserts now run against repositories. Revisit only if a suite
  needs restructuring for other reasons.
