# RCA Log — Test-Failure Root Cause Analysis

> **Purpose**: Single dated log for test-failure incidents diagnosed under the mandatory RCA
> procedure (AGENTS.md §3.2). Every failure is classified and recorded here **before** any code
> is changed. Historical entries were removed on 2026-09-02 during consolidation; only new
> incidents are appended below.

## Procedure

1. **Diagnose** before modifying any code — collect the error output and cross-check spec docs.
2. **Classify**:
   - **Case A (Source Error)**: implementation violates spec → **STOP**, ask the user.
   - **Case B (Test Error)**: test misinterprets spec / asserts on internals → fix the test.
   - **Case C (Spec Error)**: spec is undefined or ambiguous → **STOP**, ask the user.
3. **Act** per the classification (do not modify code before classifying).
4. **Record**: append an entry below with date, summary, classification, and action taken.

## Entries

### 2026-09-04 — E2E guarded writes 503 `setup.incomplete` on sqlite+webdav scratch boots (Case A)

- **Summary**: 6 Playwright E2E failures (setup-wizard/admin-config/migration E2E-\*001,
  desktop+mobile) — login/health OK but the first guarded write (`POST /api/folders/create`,
  `PUT /api/admin/config`) returned `503 { errorCode: 'serverErrors.setup.incomplete' }`.
- **Diagnosis**: reproduced locally (standalone scratch-server boot with the same `.env`/seed).
  `configResolver.getEffectiveConfig()` masked **every** `secret` entry — including UNSET ones —
  to the literal `'****'` (configResolver.js `value: secret ? SECRET_MASK : value`). `setupStatus`
  `mergeEffective` copied that truthy mask into the derived view, so `metadataMissing`'s
  presence test saw `WEA_DB_PASSWORD='****'`, selected PostgreSQL, and reported
  `WEA_DB_HOST/DATABASE/USER` missing → boot `setup_complete=false` → setup mode → no
  `populateT1Env` → DB-seeded webdav keys never reached `process.env` → every guarded write 503.
  The wizard status path already applied a "mask-drop" helper (`normalizeEffectiveForStatus`,
  setupCore.js) so `/api/setup/status` disagreed with boot. Only sqlite-metadata boots (no
  `WEA_DB_*` env) were affected; PG-backed runs passed.
- **Classification**: **Case A (Source Error)** — masking an unset secret fabricates presence,
  violating the presence-based metadata-selection contract
  (docs/spec/server/store/storage.md §2.4, bootSequence.md step 5).
- **Action taken**: Option B — mask only secrets that actually have a value
  (server/infrastructure/configResolver.js); removed the now-redundant
  `normalizeEffectiveForStatus` and its call sites (setupCore.js, routes.js, scripts/setup.js);
  docs updated (configResolver spec §2.6, routes/config spec, api.md,
  config-source-resolution, bootSequence) + regression unit tests added. Verified end-to-end by
  a `-r` preload simulation (guarded PUT 200) and by the full unit + e2e suites.

### 2026-09-04 — E2E-ADMINCFG-001 expects the pre-Section-B row model (Case B)

- **Summary**: after the Case A fix landed, admin-config E2E-ADMINCFG-001 (desktop+mobile)
  failed at `expect(getByText('Set in .env (env takes precedence)')).toHaveCount(envRows)` with
  envRows=0 vs 18-19 caption elements. A migration-mobile run also flaked once (dialog timing).
- **Diagnosis**: the assertion was written for the pre-2026-09-03 editor where env-sourced rows
  rendered a disabled `config-input-*` in the editable list. Since W-B (Section A/B split,
  b3d1252) env/T0 rows are read-only `platform-config-row-*` summaries (spec
  SystemConfigEditor.md §"two top-level sections"; client jest test) and never render a
  `config-input`, so envRows was always 0 while Section B captions numbered >0. Latent since
  W-B and masked because (a) the Case A 503 previously aborted this test before the assertion,
  and (b) local e2e runs served a stale `client/build` (Sep 2) whose pre-Section-B UI made the
  stale assertion pass; CI builds fresh and exposed it.
- **Classification**: **Case B (Test Error)** — the client matches its spec; the e2e assertion
  was stale.
- **Action taken**: rewrote E2E-ADMINCFG-001's per-row loop to the Section model — env/T0 rows
  assert `config-input` absent + `platform-config-row-${key}` present, envRows counts displayed
  env-sourced Section B rows, Section A rows assert masked/disabled/toggle or enabled state as
  before; full e2e re-run on a fresh client build.

### 2026-09-08 — Standard-user home duplicates the username in breadcrumb/folder-tree (Case C)

- **Summary**: for a standard (non-admin) user whose home is the top-level directory named after
  their username, the explorer rendered the home twice: the breadcrumb showed `Home > {username >
…` (home chip + the username node as the first ancestor chip), and the sidebar folder-tree home
  row was labeled with the raw username and displayed a generic open-folder icon (not a home icon)
  whenever it was expanded. Expected display is `Home > {folder…}`.
- **Diagnosis**: docs cross-check (docs/spec/client/components/file-manager/Breadcrumb.md,
  folder-tree/FolderTree.md, folder-tree/BaseFolderTreeItem.md, server/routes/auth.md, api.md).
  Documented concepts — user home = `/{username}` root node (`auth.md:49`), admin home =
  filesystem root `/`, breadcrumb = server ancestor chain chips (`Breadcrumb.md:7`),
  `icon`/`openIcon` are injectable props. Undocumented — the home-chip/home-row **label string**,
  whether the username ancestor is trimmed in favor of the home chip, and the home-row icon in the
  expanded state. Both the duplicate and the "home chip + trimmed chain" renderings are therefore
  consistent with the docs; the specific contract is undefined.
- **Classification**: **Case C (Spec Error — undefined/ambiguous)**. No explicit spec statement
  was violated.
- **Action taken**: spec defined first (docs-first) — `Breadcrumb.md` §1.1/§2.6-2.9 (home chip =
  `nav.home` for all roles; non-admin own-home node trimmed from the ancestor chips by nodeId with
  an `!is_admin` guard; admin untouched), `FolderTree.md` §2.7 (home row = `nav.home`, home icon in
  expanded state via `openIcon`). Then implemented client fix (Breadcrumb.js, FolderTree.js), unit
  tests (+ admin scenarios), and the E2E regression net `E2E-EXP-014` plus the `E2E-SHARE-007`
  locator update.

### 2026-09-09 — S1 TX2-failure test asserted the raw error message across the TX boundary (Case B)

- **Summary**: during S1 implementation (`fix/upload-overwrite-recovery`), the new
  `overwriteFile TX2 failure` unit test failed: it asserted
  `rejects.toThrow('TX2 overwrite failure')` on the error thrown inside the TX2 `withTx`, but the
  observed error differed.
- **Diagnosis**: `withSqliteTransaction`/`withTransaction` (server/store/storage.js:262-268,
  304-310) route every error thrown inside a transaction through `mapDatabaseError` before
  surfacing it, so the raw message is not observable at the service boundary. This is pre-existing,
  shared TX-boundary behavior, not introduced by S1; the sibling V4 test already asserts
  substring-less `rejects.toThrow()` for the same reason (uploadService.test.js:149-152). The S3
  PUT failure test keeps its message assertion because `uploadBlob` runs outside the TX and the raw
  error propagates directly.
- **Classification**: **Case B (Test Error)** — the test asserted on a value the documented
  boundary does not preserve; the implementation matches spec (uploadService.md §2.7: "error
  propagated").
- **Action taken**: TX2 test changed to substring-less `rejects.toThrow()` (matches V4 idiom);
  rollback-outcome assertions (node active, previous row active, pending row deleted, blob deleted)
  unchanged. Targeted suites 3/3, server `test:ci` 98 suites / 1783 pass, PG adapter leg 203 pass.

### 2026-09-09 — S3 GC tests: guarded-category fixtures + object_map version_number collisions (Case B)

- **Summary**: during S3 implementation (`fix/gc-retention-foundation`), the first targeted run
  failed 6 tests: 4 pre-existing gcService Tier-1 tests (deletion now legitimately skipped) and 3
  new conformance/gcService fixtures (INSERT failures).
- **Diagnosis**: (1) the pre-existing Tier-1 tests built their orphaned rows on freshly
  `createNode`'d nodes (`sync_status='pending_upload'`, no active object_map row) — exactly the
  stuck-overwrite shape the new `guarded` category exempts (gcService.md §2), so "orphan deleted"
  outcomes could no longer hold; the tests' intent is the historical live-node-orphan deletion
  behavior. (2) `object_map` carries `UNIQUE (file_node_id, version_number)`
  (ddl/001_initial_normalized_schema.sql:64) and `insertObject`/`insertObjectMapRow` hardcode
  `version_number=1`, so multi-row-per-node fixtures collided.
- **Classification**: **Case B (Test Error)** both times — fixtures contradicted the (docs-first
  updated) spec / DB constraints; no source-spec violation.
- **Action taken**: (1) the 4 Tier-1 fixtures flipped their node to `sync_status='active'` via
  `updateSyncStatus` (live-node orphan → `version` category, historical behavior asserted);
  (2) `insertObjectMapRow` gained an optional `versionNumber = 1` param and multi-row fixtures pass
  distinct version numbers (conformance tests insert the second row via raw SQL with
  `version_number=2`). No assertions weakened. Targeted suites 4/4 (150 pass), server `test:ci`
  98 suites / 1802 pass / 5 skip.

### 2026-09-09 — P1 trash-schema tests: placeholder arity + per-connection PRAGMA (Case B ×2)

- **Summary**: during P1 implementation (`feature/trash`), two tests in the new
  `trashSoftDeleteSchema.test.js` failed on the first run.
- **Diagnosis**: (1) the root-uniqueness test's `countNodes(null, name)` helper used one SQL string
  with a two-element param array for the `parent_id IS NULL` branch (one placeholder) →
  `SQLITE_RANGE: column index out of range` (dbUtils `?`→`$n` conversion is arity-faithful). (2) the
  migrated-DB test asserted `PRAGMA foreign_keys = 1` on a raw second connection opened directly on
  the same file, while the boot-path migration (and its FK OFF→ON dance, schemaManager.js) runs on
  the storage-backed connection — sqlite PRAGMA state is per-connection, so the raw handle always
  reported the default 0.
- **Classification**: **Case B (Test Error)** both times — assertion/fixture bugs in the new tests;
  the schema, transpiler and schemaManager behave per spec (fileNodesStore.md §2.2,
  schemaManager.md §2.4).
- **Action taken**: (1) helper branches the SQL and param list together; (2) the FK assertion now
  queries the same storage-backed connection the migration ran on. No source changes; no assertions
  weakened. Targeted suites 46/46 + 20/20; server `test:ci` 99 suites / 1821 pass / 5 skip.

### 2026-09-09 — S2 repair tests: ancestry-less child fixture, version-colliding insert, stale webdav mock reference (Case B)

- **Summary**: during S2 implementation (`fix/upload-scan-repair`), the first targeted runs
  failed 5 tests across three suites.
- **Diagnosis**:
  (1) the D5a route/service fixture created a child node via raw `fileNodesStore.createNode`
  (no `node_ancestors` rows), so `fileNodeService.getNodePath(child)` returned `/` and the
  bottom-up remote deletion skipped the child blob — `retry-delete` itself behaved per spec; the
  fixture under-seeded the tree (fix: seed children via `fileNodeService.createFile`, which builds
  ancestry).
  (2) the `getObjectMapByNode` conformance fixture inserted a second row via `insertObject`, which
  hardcodes `version_number=1` and hit `UNIQUE (file_node_id, version_number)`
  (ddl/001*initial_normalized_schema.sql:64) — same constraint class as the S3 entry above; the
  realistic overwrite path is `upsertObjectMap` (computes `MAX(version_number)+1`), which the
  fixture now uses.
  (3) the new admin route tests patched `getFileMetadata` on the top-level `mockWebdav` instance,
  but the S3-mode GC describe earlier in the file had already rewired the composition via
  `__setCompositionForTests` with a \_fresh* `createWebdavMock()` in its `afterAll` — the patched
  instance was no longer the blob store behind `failSafeService`, so D5d refusals never triggered
  and `complete` got `contentLength: undefined` (NaN into filecache → 500). Fix: the new describe
  wires its own webdav mock + composition in `beforeAll` and restores via `useWebdavMode()`.
- **Classification**: **Case B (Test Error)** all three — implementation behavior matches the
  docs-first spec (uploadService.md §2.5.1); only fixtures/mocks were wrong.
- **Action taken**: fixtures fixed as above, no assertions weakened. Environment note: the
  worktree's symlinked `node_modules` resolves `@webdav-easyaccess/shared` to the main checkout, so
  the new shared error codes were invisible to tests; `server/jest.config.js` now maps
  `^@webdav-easyaccess/shared/(.*)$` to `<rootDir>/../shared/$1` (same repo layout in the canonical
  checkout — behavior-identical there). Targeted suites green (36 + 31 + 25), server `test:ci`
  98 suites / 1834 pass / 5 skip.

### 2026-09-09 — S2 route tests enshrined WebDAV-mode pending_upload repair; one-shot mock bleed (Case B)

- **Summary**: after the orchestrator gated `pending_upload` scan/repair to S3 mode (review finding:
  WebDAV-mode file nodes intentionally stay `pending_upload` for their lifetime — `fileService.md`
  §4 — so an ungated scan reports every healthy file and `auto` would `delete` healthy nodes), 5
  tests in `domains/admin/routes/__tests__/admin.test.js` failed.
- **Diagnosis**: (1) three route tests exercised `auto`/`complete` against a WebDAV-mode
  composition — they encoded the pre-gate design the gate supersedes; the docs-first spec
  (uploadService.md §2.5.1, admin.md §2.2.3) now mandates S3-mode-only. (2) the fourth failure
  (`complete` blob-missing expecting `repairUploadBlobMissing`) was the gate firing first —
  correct per spec. (3) the two `force-active` (D5d) tests inverted because the shared WebDAV
  mock's one-shot `getFileMetadata` queue went unconsumed once the gate short-circuited the
  `complete` test before its probe, shifting every later queued result by one.
- **Classification**: **Case B (Test Error)** — tests encoded the superseded design and a mock
  coupling that only held under the ungated flow; the gated implementation matches the spec.
- **Action taken**: the repair-sync describe was split — `pending_upload repair (S3 mode)` runs
  against a wired S3 mock (blob seeded via `uploadBlob` instead of a one-shot WebDAV mock), and
  `WebDAV orphaned_node remote checks + mode gate` keeps the D5d tests verbatim and adds a route
  level 409 gate assertion. No assertions weakened. failSafeService tests 38/38.

### 2026-09-09 — P1 merge dropped its two new files; restored from scratch (Case B)

- **Summary**: after merging `feature/trash` to dev, `sqliteSchemaInit.test.js` failed with
  `ENOENT: .../ddl/002_trash_soft_delete.sql` — the P1 branch's two NEW files (the ddl file and
  `trashSoftDeleteSchema.test.js`) were never committed: the slice was staged with `git add -u`
  (tracked-only), so untracked new files were omitted, and the worktree removal then deleted them.
  Tracked modifications merged fine, which is why the branch's own full-suite run (which ran
  against the worktree with the files present) had been green.
- **Diagnosis**: staging-selection error, not a code defect — the tracked-path schema
  (`schemaManager.js`, transpiler, bootstrap) merged correctly; only the new files were missing.
  The recreated `trashSoftDeleteSchema.test.js` then failed 6/7 on first run for three test-side
  reasons: (1) `testing/dbUtils` returns `lastID` (and PG normalizes via RETURNING), not `lastId`
  — so UPDATE ... WHERE id = undefined matched nothing and unique violations surfaced on the
  following INSERT; (2) `convertPostgresToSqlite` is exported from `sqliteSchemaInit.js`, not
  `schemaManager.js`; (3) `_schema_migrations` has no `backend` column (per-DB ledger).
- **Classification**: **Case B (Test/process error)** — schema and boot-path behavior verified
  correct by direct inspection (pragma_table_info/sqlite_master/\_schema_migrations on a fresh
  boot); only the staging step and my test-side accessors were wrong.
- **Action taken**: recreated `ddl/002_trash_soft_delete.sql` (byte-identical contract) and the
  schema test suite (7 tests: live/trashed uniqueness incl. root variant, real-boot migration of a
  pre-002 sqlite DB with data-preservation/FK/AUTOINCREMENT/idempotency checks, schema-less
  explicit-connection target); staging now uses explicit `git add` of new files. 7/7 pass.

### 2026-09-10 — S7 conformance test asserted a two-active-rows state via a nondeterministic pick (Case B)

- **Summary**: the PG adapter leg failed
  `reactivateObjectMapRow flips a history row back to active (DEF-11 restore path)` — after
  reactivating the history row, `getActiveObject(node)` returned the OTHER (v2, active) row instead
  of the reactivated v1. SQLite leg passed 5/5 consecutive runs.
- **Diagnosis**: the test called `reactivateObjectMapRow(id)` ALONE, which correctly flipped the v1
  history row to `active` (`{changes:1}`, confirmed via xmin ordering) — but the current active row
  (v2) was never demoted, leaving TWO active rows. `getActiveObject` is
  `SELECT * ... AND status='active' LIMIT 1` with no ORDER BY, so which row it returns across two
  active rows is unspecified: sqlite returned v1 by insertion-order luck, PG returned v2. The
  production restore flow (`versionsService.restoreVersion`) pairs the reactivation with
  `demoteActiveToHistory(current.s3_key)` inside one TX, so the invariant (exactly one active row)
  holds there; only this conformance test asserted a primitive in isolation against an end-state
  that requires the pair.
- **Classification**: **Case B (Test Error)** — the implementation matches the locked spec
  (fileNodesStore.md:99-101); the test asserted a nondeterministic pick over a state the primitive
  alone cannot guarantee.
- **Action taken**: the history-reactivate conformance test now asserts the targeted row's status
  is `active` (plus `{changes:1}`), not `getActiveObject`'s pick; the paired
  `demoteActiveToHistory` behavior is covered by the versionsService restore tests
  (`versionsService.test.js` "restore swap" assertions). PG leg re-run 3×: 25/25 pass.

### 2026-09-10 — P2 conformance: markSubtreeDeleted idempotency asserted via a net-mutation reading of `changes` (Case B)

- **Summary**: the new `markSubtreeDeleted` conformance test failed its "re-running marks nothing
  new" assertion — the second call reported `changes: 2` instead of `0` on sqlite.
- **Diagnosis**: the specification is a plain `UPDATE file_nodes SET deleted_at = NOW() WHERE id
IN (...)`; both sqlite (`sqlite3_changes`) and PG's default row-count mode report MATCHED rows,
  not net value-mutations. Re-running the marking re-matches the already-trashed rows, so a
  non-zero `changes` on a re-run is the engine's correct behavior — the statement is idempotent in
  EFFECT (deleted_at stays set, no state corruption) but not in its reported count.
- **Classification**: **Case B (Test Error)** — the test misread `changes` as a net-mutation count;
  the implementation follows the locked SQL contract (fileNodesStore.md §2.4).
- **Action taken**: the idempotency assertion now expects the matched-row count on re-run, and the
  spec row for `markSubtreeDeleted` documents "`changes` reports MATCHED rows".

### 2026-09-10 — P2 conformance A4: the restore cycle's `deleted_at = NULL` UPDATE is REJECTED while a live same-name sibling exists (Case B)

- **Summary**: the restore-cycle schema test failed with
  `UNIQUE constraint failed: file_nodes.parent_id, file_nodes.name` — thrown by the restore UPDATE
  itself, not by the follow-up INSERT the test expected to reject.
- **Diagnosis**: the trash model's live uniqueness is carried by PARTIAL unique indexes over
  `deleted_at IS NULL` (001). Clearing `deleted_at` modifies an indexed column, so the index
  constraint is checked at UPDATE time: with a live same-name sibling present, restoring the
  trashed row violates `file_nodes_unique_name_per_parent`. This is exactly the restore-into-
  collision hazard the locked P3 design resolves (name suffix / deepest live ancestor) — the
  schema correctly refuses an un-resolved restore. With no same-name live sibling, the restore
  UPDATE succeeds; re-trashing releases uniqueness again.
- **Classification**: **Case B (Test Error)** — the test expected the clearing to succeed in the
  colliding state; the schema matches the locked contract (fileNodesStore.md §2.2).
- **Action taken**: A4 now asserts the full cycle: trashed/live coexistence, collision-rejected
  restore, restore-after-sibling-trash succeeds, live-unique again after restore, release after
  re-trash.

### 2026-09-10 — Worktree client tests resolved a stale `@webdav-easyaccess/shared` through the symlinked node_modules (Case B)

- **Summary**: in the `feature/trash-p2p4` worktree, the client `validation.test.js` `.wea-`
  reservation cases failed with `null` — the shared `validateFileName` change was invisible to
  client tests, while server tests (which map the package to the checkout's own `shared/`)
  passed.
- **Diagnosis**: worktree `node_modules` (root and `client/`) are symlinks to the MAIN worktree's
  installed tree, so `@webdav-easyaccess/shared` resolved to the main worktree's `shared/`
  directory rather than this branch's checkout (which carries the new `.wea-` reservation). The
  server already handles this via a `jest.config.js` moduleNameMapper (added in S2 for exactly
  this need); the CRA client had no such mapping.
- **Classification**: **Case B (Test-environment error)** — production code was correct; only the
  client test resolution was stale in worktrees.
- **Action taken**: added `^@webdav-easyaccess/shared/(.*)$ → <rootDir>/../shared/$1` to the
  client's `package.json` `jest.moduleNameMapper` (same checkout-source resolution the server
  uses; a no-op in the main worktree, correct in linked worktrees).

### 2026-09-10 — P4 A9 conformance test used sqlite-only datetime('now') on the PG leg (Case B)

- **Summary**: `PermissionRepository.conformance.test.js` "A9: listSharedWithUser EXCLUDES trashed
  nodes" failed on the real-PG adapter leg with `function datetime(unknown) does not exist`.
- **Diagnosis**: the trashed-node fixture set `deleted_at = datetime('now')` — a SQLite-only
  function — unconditionally, violating the backend-agnostic conformance rule (TESTING_STRATEGY.md
  DB test tiers: L2 suites must run on both legs). The SQL-standard `CURRENT_TIMESTAMP` works on
  both engines.
- **Classification**: **Case B (Test Error)** — fixture bug; the gated join under test behaves
  per spec on both dialects (PG leg 224/224 pass after the fix).
- **Action taken**: fixture switched to `CURRENT_TIMESTAMP`; no assertions changed.

### 2026-09-10 — Trash UI (DEF-16 P9): FileManagerView TDZ error surfaced by FileManagerView suite (Case B)

- **Summary**: while implementing the trash view, the full client run failed 30 tests across
  `FileManagerView.test.js` + `FileManager.test.js` with
  `ReferenceError: Cannot access 'trashMode' before initialization` (FileManagerView.js).
- **Diagnosis**: the trash-state destructure from the new `trashState` prop group was placed
  below the `isTrashView` computation that reads `trashMode` — a temporal-dead-zone bug in the
  wiring, not a spec violation. The grouped-props tests rendered `FileManagerView` without
  `trashState`, which forced the `trashState ?? {}` fallback path and exposed the ordering issue.
- **Classification**: **Case B (Test Error, dev-time catch)** — the view spec
  (docs/spec/client/components/file-manager/FileManagerView.md) says the view renders from props
  only; the failure came from hook ordering inside the view, caught by the existing suite before
  any spec change.
- **Action taken**: moved the `trashState` destructure above `controlsState` (before first use of
  `trashMode`); full client suite re-run green (160 suites / 1479 tests).

### 2026-09-10 — Trash UI (DEF-16 P9): unit-test fixes for double-render DOM leakage and JSX `key` assertions (Case B)

- **Summary**: 5 new-test failures in `TrashSidebarItem` / `FileActionSheet` / `FileManagerControls`
  trash suites: (a) `fireEvent.click` on the `ListItem` wrapper did not reach the
  `ListItemButton`; (b) asserting the one-shot animation via JSX `key` attribute (React strips
  `key` from the DOM) and via `style.animation` (emotion applies animation through generated
  classes, not inline style); (c) two tests rendered a second component instance in the same test
  and then asserted absence — the first instance stayed attached, so `queryByTestId` matched the
  stale node; (d) a trash action-sheet case relied on `defaultProps` carrying live-item callbacks
  that the trash mode withholds.
- **Diagnosis**: all four were test-implementation mistakes against the documented component
  contracts (`TrashSidebarItem.md`, `FileActionSheet.md`, `FileManagerControls.md`); the source
  behavior matched the specs.
- **Classification**: **Case B (Test Error)**.
- **Action taken**: click via the `ListItemButton` role; assert the animation pulse by the
  re-rendered emotion class + lid path presence; split double-render tests into separate cases;
  pass explicit `undefined` callbacks for the withheld-rows case. Suites green.

### 2026-09-10 — useFileManager trash hierarchical tests vs mocked `useNavigate` (Case B)

- **Summary**: the new `useFileManager` trash-trail tests timed out expecting a listing reload
  after `openTrashFolder` navigation; `loadTrashEntries` was still called once.
- **Diagnosis**: `useFileManager.test.js` mocks `useNavigate` at module level
  (`mockNavigate`), so in-hook `navigate()` never changes the MemoryRouter URL — the existing
  suite's convention is to assert `mockNavigate` payloads instead of re-listing. Also a real bug
  was found by the derivation test: `fillTrashNameFromChildren` used `prev.map` (no-op on an empty
  trail) so a refresh-derived trashed-parent name never appeared; fixed to append the segment when
  absent (spec useFileManager.md §2.3.1 documents the cache/derivation contract).
- **Classification**: **Case B (Test Error)** for the navigation assertions; the `trashTrail`
  rebuild issue was a source bug caught by the new test and fixed per spec.
- **Action taken**: rewrote the navigation assertions to `mockNavigate` payloads; fixed
  `fillTrashNameFromChildren` to push the missing trail segment. Suite green (20 tests).
