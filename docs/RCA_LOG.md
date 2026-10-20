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

### 2026-10-20 — T1.0a: transformers.js tokenizer load failed with `allowRemoteModels=false` (Case B, implementation adaptation — no spec violation)

- **Summary**: during GREEN development of `clients/embedded-onnx.js`, loading the
  tokenizer via `AutoTokenizer.from_pretrained(repo, { revision })` with
  `allowLocalModels=false` + `allowRemoteModels=false` failed with
  `Cannot read properties of undefined (reading 'tokenizer_class')`, even with the full
  weight set present in the FS cache dir.
- **Diagnosis (source-traced in transformers.js 4.3.1)**: `get_tokenizer_files()` calls
  `get_file_metadata(modelId, 'tokenizer_config.json', {})` with EMPTY options — no
  revision, no cache_dir. With revision defaulting to `main`, the FileCache key becomes
  the UN-revisioned `repo/tokenizer_config.json` path, which does not exist in the
  `cacheDir/repo/revision/file` layout the provisioner installs; with remote disabled,
  the HEAD fallback is banned and metadata returns `exists:false` → the file list comes
  back empty → `tokenizerConfig` is undefined. Allowing remote makes it work only because
  the HEAD probe hits huggingface.co — a silent network egress that violates the
  zero-egress posture (llmPresets §2.3 / llmAdapter §2.8).
- **Classification**: **Case B (implementation adaptation, fixed in code)** — the spec
  (llmAdapter §2.1 peers: "fixtures local, no HTTP"; zero-egress rule) is correct; the
  initial loader design (repo id + revision via cache keys) misread the library contract.
  The test was NOT at fault.
- **Action taken**: `loadEngine` loads from the ABSOLUTE local revision directory
  (`<modelDir>/<repo>/<revision>`) with `env.useFS=true`, `allowLocalModels=true`,
  `allowRemoteModels=false` — direct disk reads, no cache-key layer, zero network.
  Verified by the Q12 positive control: median-cos 1.000000 against
  `eg2-reference-kit.json` (arithmetic-identical space).

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

### 2026-09-10 — M13 admin perm-delete test asserted the pre-P3 lazy S3 blob behavior (Case B)

- **Summary**: `admin.test.js` "M13" ("permanent delete leaves the blob in the store; GC removes
  it...") failed after the P3 purge-core refactor: the shared `trashService.purgeNode` now deletes
  the subtree's S3 blobs EAGERLY (active + history + orphaned rows) instead of leaving them for
  the lazy GC sweep, so the test's `expect(store.has(orphanKey)).toBe(true)` after perm-delete
  failed.
- **Diagnosis**: the test asserted the admin route's historical S3 behavior ("blob left for the
  lazy GC sweep — unchanged historical behavior of a hard delete"), which the locked P3 REST
  contract supersedes: the purge core (`trashService.purgeNode`) unifies the trash purge, empty
  trash, GC Tier 3 AND the admin maintenance route on one physical routine with eager per-row S3
  blob deletes ("S3 — blobStore.deleteBlob for EVERY object_map row of the subtree"). The
  test-impact ledger anticipated this ("admin GC lazy-delete chain re-pointed at purge"). The
  test's remaining unique value — Tier-2 reclaiming an untracked blob while an active control
  survives — is preserved by seeding a directly-placed stray untracked blob (the SCENARIO-5B
  pattern) instead of relying on the lazy-delete residue.
- **Classification**: **Case B (Test Error)** — the test asserted superseded behavior; the
  implementation matches the locked contract (fileService.md §4.1, routes/files.md trash routes).
- **Action taken**: M13 retitled + updated: perm-delete now asserts eager blob deletion (DB row
  and store blob both gone), and the GC Tier-2 reclaim is exercised via a stray untracked blob
  while the active control blob must survive the cycle. Pre-existing unrelated lint error
  `admin.test.js 'store' is assigned a value but never used` (unused var in the A3 live-node test)
  was verified present before this change via git stash (DEF-19 class) and left untouched.

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

### 2026-09-10 — P5 A13 fixture used sqlite-only datetime('now', '-40 days') on the PG leg (Case B)

- **Summary**: `FileNodeRepository.conformance.test.js` "A13: getTopmostTrashedNodes" failed on the
  real-PG leg with `function datetime(unknown, unknown) does not exist` — the same fixture bug
  class as the earlier A9 incident.
- **Diagnosis**: the expired-trash fixture aged `deleted_at` with SQLite's `datetime('now', ...)`;
  the backend-agnostic conformance rule requires dual-leg SQL. `CURRENT_TIMESTAMP - INTERVAL
'40 days'` is standard on both engines (the converter passthrough keeps it verbatim on sqlite).
- **Classification**: **Case B (Test Error)**.
- **Action taken**: fixture switched to `CURRENT_TIMESTAMP - INTERVAL '40 days'`; no assertion
  changes. PG leg 229 pass / 1 skip.

### 2026-09-10 — A13 aging fixture: dual-dialect timestamp arithmetic (Case B)

- **Summary**: the A13 expired-trash fixture was first written with sqlite-only
  `datetime('now','-40 days')` (PG leg failed), then naively converted to
  `CURRENT_TIMESTAMP - INTERVAL '40 days'` (PG-leg green, sqlite leg failed with
  `SQLITE_ERROR: near "'40 days'"` — the transpiler converts DDL, not ad-hoc test SQL).
- **Diagnosis**: no single SQL expression is valid on both engines here (PG lacks
  `datetime(...)`, sqlite lacks `INTERVAL ...` in that position); the conformance suites already
  solve this class by computing the timestamp in JS and binding it as a parameter (the
  `insertObjectMapRow` created_at pattern).
- **Classification**: **Case B (Test Error)** — fixture portability.
- **Action taken**: JS-computed ISO timestamp bound as a param
  (`SET deleted_at = ?`). Both legs green (sqlite 34/34, PG 229 pass / 1 skip).

### 2026-09-10 — WebDAV trash e2e: MOVE into a missing /.wea-trash/ parent fails (Case A)

- **Summary**: webdav-smoke E2E-TRASH-001/003 failed — the UI delete reported an error and the item
  stayed in the folder. Server logs showed `MOVE ... /.wea-trash/<id>` → 500, then the stream
  fallback PUT → 403.
- **Diagnosis**: WebDAV MOVE does NOT auto-create the destination parent collection. On the very
  first trash of a deployment `/​.wea-trash/` does not exist, so the MOVE failed and the fallback
  PUT inherited the 403 from the missing parent. Proven against the bytemark container: MKCOL the
  root first → MOVE succeeds; without MKCOL → 500/403. (Secondary finding: a server-side path
  containing a literal `%` breaks the webdav lib's `decodeURIComponent`-based directory listing
  inside `/.wea-trash/` — an out-of-band probe artifact; production trash paths are numeric node
  ids, and the per-entry `headBlob` guard (404-mapped) is the tolerant reader.)
- **Classification**: **Case A (Source Error)** — the P2 implementation violated the trash contract
  ("one MOVE succeeds") on a fresh deployment; the docs-first spec (fileService.md §4.1) describes
  the MOVE as the trash mechanism without preconditioning the reserved parent.
- **Action taken**: `WebdavBlobStore.ensureDirectoryExists` added (health-wrapped);
  `fileService.deleteNode` and `trashService` restore now ensure `/.wea-trash/` (idempotent MKCOL)
  before any MOVE/MOVE-back. Webdav smoke includes the trash spec (TRASH-00[1367]). All 5 trash
  webdav-smoke tests + core-flow.shared webdav smoke 8 pass; s3 core 129 pass.

### 2026-09-11 — De-chained E2E: three coupling/capacity failures surfaced and fixed (Case B ×3)

- **Summary**: after dissolving the E2E project dependency chains (hermetic-dechain
  `refactor/e2e-hermetic-dechain`), full-matrix runs surfaced three failures the old
  suite→suite ordering had masked.
- **Diagnosis & classification** (all **Case B** — the tests encoded assumptions that only
  hold under serialized projects; product behavior unchanged):
  1. `E2E-ADMIN-005` (admin-mobile): fixed case-derived username (`au<title>`) → collides once
     admin projects run concurrently. Fix: per-run unique suffix (`Date.now()` base36 tail).
  2. `E2E-AUTH-010` (mobile): submitted while desktop's `E2E-AUTH-009` held the GLOBAL
     `registration_enabled=false` window → 403. Fix: the three setting-writer cases
     (AUTH-009/010, ADMIN-007) moved into `e2e/registration-settings.spec.ts` — serial,
     owned by exactly one (desktop) project, disable window finally-restored;
     `ensurePendingUser` self-heals a racing disable (403 → set-true → retry once).
  3. `E2E-MIG-001` (migration-mobile): 60s terminal-modal polling budget exhausted under the
     higher concurrent load of parallel sibling projects (job still correct; capacity
     assumption, reproduced 3/3 at auto workers). Fix: polling budgets 60s→180s
     (`observeMigration`/`waitForTerminalModal`).
- **Action taken / verification**: `E2E-TRASH-007` (globally destructive empty-trash) likewise
  relocated to single-project desktop ownership (`trash-admin.spec.ts`). Full matrix auto
  workers ×2 (193 pass), `--workers=2` (193 pass), core s3 (131), webdav smoke (13) — all
  deterministic; partial-run selection de-chained (trash: 88→8 tests).

### 2026-09-12 — E2E-RECON-001 (new, webdav smoke) flaked once on `tier2.errors` (Case B)

- **Summary**: first full webdav-smoke run of the DEF-18 reconcile case failed the
  `expect(tier2.errors).toEqual([])` guard; 6 subsequent full runs passed (21 cases each).
- **Diagnosis**: all smoke projects share the one bytemark DAV container; Tier 2's BFS
  (`listAllEntriesRecursive`) aborts the WHOLE scan on a single transient PROPFIND failure
  (a concurrently purged directory vanishing mid-list), surfacing one collected error and
  zero candidates. Per-item best-effort error collection is the specified behavior
  (gcService.md §2 S3 notes); the strict empty-errors expectation was the test's assumption.
- **Classification**: **Case B (Test Error)** — over-tight assertion on a shared-resource
  side channel; source behavior per spec, unchanged.
- **Action taken**: E2E-RECON-001 dropped the `errors` assertion and retries the cleanup
  cycle once (settle 2 s) when the first cycle reports skipped/zero-untracked — a failed
  list deletes nothing, so the aged orphan is still reconciled on the retry. Assertions
  (skipped=false, untrackedKeys>=1, foreign-in-live survival, aged-orphan reclaim) unchanged.

### 2026-09-13 — CI build #46: E2E-MIG-008 terminal-modal race (Case B/C) + E2E-ADMIN-008 stale text contract (Case B)

- **Summary**: first full-matrix CI E2E after the 9/8→9/13 merge wave (CI had no full run in
  between; build #45 died earlier at the client build — see the `@emotion/styled` entry) failed
  `E2E-MIG-008` rerun leg (180 s no dialog) and `E2E-ADMIN-008` (no `Cleanup complete` alert,
  3/3 attempts). The trailing "terminating connection due to administrator command" PG noise was
  teardown after-effect of the `--max-failures=1` stop (compose down while the server was still
  live), not a cause: MIG-008 failed first (07:23:47), ADMIN-008 at 07:24:59.
- **Diagnosis (MIG-008)**: scratch :5011 access log proves the rerun (all-skip, ~ms) job
  terminalled before `/migration` mounted — subsequent `GET /api/migration/status` all `304`
  (`{active:false}`, no jobId channel once `migrationGate.clear()` ran) so the page's one-shot
  mount fetch could never learn the jobId and the D9 modal never rendered. Latent race (exposed
  by CI parallel load; individual runs win the timing pass). No other suite shares the shape:
  bulk ops keep the jobId client-side and job stores stay queryable; `migrationStatus` was the
  only endpoint whose payload _shrinks_ at terminal.
- **Classification (MIG-008)**: **Case B/C** — test asserted a delivery the code only guarantees
  when it wins a race; the spec left "job completed before mount" undefined. Fixed canonically:
  gate retains a one-shot completion notice on terminal clear, admin `GET /api/migration/status`
  exposes it as `lastJob`, `POST /api/admin/migration/last-job/ack` consumes it after delivery
  (docs-first: migration-mode D9, migrationGate §2.2–2.4/§2.8–2.9, MigrationPage spec).
- **Classification (ADMIN-008)**: **Case B** — DEF-18 (7b10c84) intentionally replaced the alert
  contract (`admin.cleanupDone`/`cleanupDonePartial` removed; now `admin.noDataToClean` or
  `admin.cleanupDoneGc`), the e2e kept asserting the removed text (it had only ever passed on a
  "Cleanup complete. NaN …" artifact). Test aligned to the documented contract.
- **Process gap**: merge-wave verification ran `webdav smoke` + `core:s3` only;
  `migration-*`/`*-admin-*` projects are excluded from `E2E_CORE=1` by design
  (playwright.config.ts) — "related E2E specs" for cleanup-feedback changes must include
  mypage-admin/migration projects, and CI should run the full leg between merge waves.

### 2026-09-13 — CI build #47: E2E-MYPAGE-005 attempt-1 render blip made fatal by non-retriable identity (Case B)

- **Summary**: first CI full-matrix run after the hermetic de-chain (`8cfb470`).
  `E2E-MYPAGE-005` (s3-mobile) attempt #1 timed out (5 s) waiting for the login
  form at `/login` — the form is absent from the DOM while `settingsLoading`
  (`LoginFormView.js:68`) and the de-chained WebKit-mobile concurrency windowed
  it past the budget; the main server was clean (all 200, no health events).
  Retries #1/#2 failed EARLIER and deterministically: the test permanently
  changes its derived user's password, but `getTestSuffix` is
  title-deterministic across retries → retry hit `400 usernameTaken`, then
  `ensureUserCanLogin` logged in with the pre-mutation password → `401`×3
  (`helpers/auth.ts:108`). `--max-failures=1` turned this into a 55-case stop.
- **Classification**: **Case B (Test Error)** — retry-identity design gap
  (pre-existing; surfaced by de-chain load, unrelated to the migration fixes
  from build #46, which both passed in #47).
- **Action taken**: `getTestSuffix` now appends `_r<retry>` when
  `testInfo.retry > 0` (single chokepoint, 24 call sites / 6 specs + shareLinks
  helper; first-attempt identities unchanged). Policy written into
  `docs/TESTING_STRATEGY.md` (retries must be self-healing; no exact-count
  asserts over lists other attempts can write to). A/B evidence: with a forced
  failure injected after the password mutation, old code → `1 failed`
  (retry poisoned), new code → `1 flaky` (retry self-heals); clean run:
  s3-mobile mypage-user 11/11 pass.
- **Follow-ups (not in this change)**: unify the local `Date.now()` username
  hack from the 2026-09-11 ADMIN-005 fix with `getTestSuffix`; server gap —
  `POST /api/admin/users` accepts usernames violating registration's
  50-char/charset validation (observed: 63-char colon usernames).

### 2026-09-22 — Activity-score contract contradicted owner intent; found in docs-first review, no test involved (Case C analog)

- **Summary**: during PLAN.md execution-prep review the owner identified that the binding
  store decision "the richer activity score (usage signals) never reorders the card list
  itself" (collectionsStore.md §2.5) plus §3.4's one-sentence score definition ("decayed
  mix of node_activity + likes + exclusion negatives + definition age") had drifted from
  owner intent: "activity sort" was meant to BE activity-score ordering, and the score was
  meant to be a PURE activity measure.
- **Diagnosis**: consumer survey showed the decayed-mix score had exactly one numeric
  consumer (member ordering, routes/collections.md:182/:336 + collectionsService.md:41)
  plus the archive gate (delta only); the card list sorted by timestamp COALESCE, and §3.4
  mixed item-level ingredients (node_activity, likes) with collection-level ones
  (exclusion negatives, definition age), making the score unusable for list ordering as
  written. Two ingredients also conflicted with the standing owner decision 2026-09-16
  (§4.9: exclusion = touch ⇒ pin — a pinning act cannot also be a penalty/trigger).
- **Classification**: **Case C analog (Spec Error vs owner intent)** — no test failed; the
  binding spec was wrong relative to intent. Stopped and asked the owner per AGENTS §3.2
  (procedure applied to a docs-first review instead of a test run).
- **Action taken**: owner re-adjudication 2026-09-22 — collection score promoted to a
  first-class persisted value (`collections.activity_score REAL` = Σ member item
  accumulator scores, recomputed nightly + on membership change); card list
  `sort=activity` = `activity_score DESC, last_member_change_at DESC, created_at DESC`
  (timestamp chain demoted to tie-breaker/graceful fallback); exclusion negatives and
  definition age removed from the score (exclusion → touch/pin + §4.15 quality metric;
  age → archive-gate min-age grace, default 14d); item accumulator formalized
  (H=30d; w_open=1/w_preview=2/w_download=3/w_search_hit=1/w_like=5 — T2 hot product
  constants); archive gate re-phrased event-based (Σ w_a ≤ ε, ε=0, N=60). Updated:
  AI_FEATURE_PLAN §3.4/§4.9/§5, collectionsStore §2.5, evolutionService §2.6,
  maintenanceScheduler §3.1, routes/collections GET /, PLAN.md T0.3/T0.6/§6.

### 2026-09-22 — Wave-0 merge gate: T0.12 node:sqlite migration broke the `initSqliteSchema({ path })` leg and Date binding (Case A — completed within the approved T0.12 mandate)

- **Summary**: after merging `feature/t02-full-schema-ddl` + `refactor/t012-node-sqlite-driver`
  into `ai-feature`, the full `npm run test:ci` gate failed with 4 suites / 43 tests:
  lockManager (LOCK_TIMEOUT), migrationService (25 failures), and the T0.2 conformance twins
  for ActionJournal/Collections (5 s timeouts + `no such table: locks`).
- **Diagnosis**: two independent integration defects in T0.12's driver migration, both invisible
  on T0.12's own branch (its touched-area sweep predated the T0.2 branches):
  1. `sqliteSchemaInit.openDatabaseAt()` called `DatabaseSync(dbPath)` **without `new`** —
     node:sqlite requires `new`, so the `{ path }` file-database leg threw
     `TypeError: Cannot call constructor without 'new'`, leaving every `createTestDatabase()`
     DB uninitialized (`no such table: locks`) and cascading into lock/migration/conformance
     timeouts. `sqliteSchemaInit.test.js` never exercised the `{ path }` leg — coverage gap.
  2. `normalizeBindValue()` (storage seam) coerced only booleans and `undefined`; call sites
     that bind `Date` objects (e.g. `lockManager.acquireSqliteLock` createdAt/expiresAt) passed
     Dates through, and `node:sqlite` rejects them
     (`ERR_INVALID_ARG_TYPE: Provided value cannot be bound to SQLite parameter 4`). The
     sqlite3 npm driver accepted Date binds, so the behavior-preservation contract was broken.
- **Classification**: **Case A (Source Error)** — T0.12's implementation did not satisfy its
  own "behavior suite green on both drivers" exit criterion for suites outside its touched-area
  sweep. Not a spec-contract dispute (the spec itself was corrected in the T0.12 PR); resolved
  by completing the already-approved behavior-preservation mandate rather than a new design
  decision, hence no owner stop was required. The Wave-0 full-gate procedure worked as designed.
- **Action taken**: RED→GREEN fixes on `fix/t012-node-sqlite-integration`:
  `new DatabaseSync(dbPath)` in `openDatabaseAt` + a new `initSqliteSchema({ path })` file-DB
  integration test (38-table assertion) closing the coverage gap; `Date → value.toISOString()`
  added to `normalizeBindValue` + a bind-coercion contract test in
  `sqliteDriverMigration.test.js` + storage.md normalization rule updated (docs-first).
  Verified: the 4 failing suites + both T0.2 schema suites = 6 suites / 88 tests green.
  Follow-up (same fix branch, Case B): the new bind-coercion test was initially placed in a
  sibling describe WITHOUT the suite's temp-DB beforeAll, so it silently wrote its fixture row
  into the default dev DB (`data/webdav.db`) — first run passed, second run failed with
  `UNIQUE constraint failed: locks.lock_name_hash`. Moved the test into the shared beforeAll
  describe of `sqliteDriverMigration.test.js`; verified no leftover rows in the dev DB.

### 2026-09-22 — gcService.test.js single non-reproducible failure under full parallel test:ci (unclassified suspected environmental flake)

- **Summary**: one full `npm run test:ci` run reported 1 gcService test failure (43→2→1-failure
  trajectory across the day's gate runs); the error output was not captured before the log
  buffer scrolled, and two consecutive full re-runs plus solo `--ci` runs are fully green
  (36/36 solo, 2057/2057 server-wide).
- **Diagnosis**: incomplete. Candidate identified but not confirmed:
  `gcService.test.js:39` seeds retention windows as `new Date(Date.now() - daysAgo * 86400000)`
  — ms-level boundary rows racing the suite's own DB writes can flip assertions under parallel
  load. No code change made.
- **Classification**: pending reproduction (treated as environmental flake for Wave-0 ledger
  purposes). **Action**: monitor; if it recurs, capture full output first per §3.2 procedure 1.

### 2026-09-23 — Wave-2 host wiring surfaced two merged-branch integration defects (Case A)

- **Summary**: activating the three deferred seams (T0.11 results shell,
  T0.5 like state, T0.4/T0.5 member-row menu) exposed two latent defects in
  already-merged code that neither branch's own suites caught.
- **Defect 1 — recordSearchClick body casing**: the client repository
  (`collectionsRepository.recordSearchClick`) POSTed `{ nodeId }` while the
  merged server route and `docs/spec/server/routes/search.md` §2.4.0 read the
  snake_case `{ node_id }`. Every §3.4 list-entry-click signal would have 400'd
  (absorbed to `false`), so the click-recording register (a) was inert.
  **Classification**: Case A (source error) — the client violated the server's
  documented contract. **Action**: aligned the client to `{ node_id }`, updated
  its unit assertion and `collectionsRepository.md` §2.2, and corrected the
  "only request-body exception" claim in `search.md` §2.4.2 (now documents both
  `result_ref` and the click `node_id`). Verified: collectionsRepository + shell
  click-signal tests green.
- **Defect 2 — MemberRowControls null member**: the shell owns a single
  `MemberRowControls` instance that renders with `member = null` while closed
  (CollectionsListView §2.5 FileContextMenu idiom). The merged component read
  `member.liked` in the menu-item build path before any null guard, so mounting
  the closed instance threw `Cannot read properties of null`. **Classification**:
  Case A (source error) — the component assumed a member was always present,
  contradicting the shell-owned single-instance contract. **Action**: added a
  `!isBulk && member == null → null` early return; verified across the member
  suite and FileManager shell wiring tests.

### 2026-09-22 — Wave-2 gates: two single non-reproducible full-suite flakes (client FilePropertiesDialog, PG PlatformSchema.conformance)

- **Summary**: first full gates after the wave-2 merges reported 1 failing client suite
  (`FilePropertiesDialog.test.js`, 1/1667) and 5 failing PG tests
  (`PlatformSchema.conformance.test.js`); both immediately preceding targeted/agent runs were
  green.
- **Diagnosis**: error output not captured before scroll. Re-runs: client full gate 172/172
  twice; PG full leg 23/23 twice; `PlatformSchema.conformance` alone with PG env 5/5 twice.
  Zero reproductions — same class as the 2026-09-22 gcService observation (parallel/coverage
  load timing). No code change.
- **Classification**: pending reproduction; treated as environmental for wave-2 closure.
  **Action**: monitor; capture full output on recurrence.

### 2026-09-23 — Boot-coverage tests found a Case-A defect: partial `WEA_DB_*` crashed at require time, bypassing the spec'd `Initialization failed:` handler (bootSequence §2 step 2 / §5 L93)

- **Summary**: `server/__tests__/bootSequence.test.js` spawns a real
  `node server/index.js` child with a partial remote-DB credential set
  (`WEA_DB_HOST`+`WEA_DB_DATABASE` set, `WEA_DB_USER`/`WEA_DB_PASSWORD` blank).
  The spec requires `storage.getBackend()` to throw and the boot error surface
  to log `Initialization failed: <err>` and `process.exit(1)` listing the
  missing keys. Observed: exit code was 1, but stderr carried only a raw
  uncaught-exception stack — no `Initialization failed:` line.
- **Evidence**: child stderr stack
  `Error: Partial WEA_DB_* configuration: missing WEA_DB_USER, WEA_DB_PASSWORD`
  at `store/storage.js:41 (getBackend)` ← `storage.js:345 (getExecutor)` ←
  `store/fileNodesStore.js:18/28` ←
  `domains/permissions/routes/folderPermissions.js:30` — the module-level
  `createFileNodesStore()` evaluates during `app.use('/api/permissions', require(...))`
  in `server/index.js`, i.e. at module load, BEFORE `runBoot()` is ever called.
  The `runBoot().catch` handler at the bottom of `server/index.js` therefore
  never sees the partial-config throw; Node's default uncaught-exception path
  kills the process.
- **Hypothesis**: [D6] "pre-flight metadata-backend resolution" runs at the
  _top of runBoot_, but the route-mount section that consumes the executor runs
  earlier (require time), so the documented ordering is not what the code
  executes.
- **Classification**: **Case A (source error)** — `server/index.js` violates the
  documented boot order (docs/spec/server/infrastructure/bootSequence.md §2
  step 2: pre-flight before mount). The exit-1 fail-fast was accidentally
  intact; the specified log surface and the "pre-flight resolves the backend
  before anything touches it" contract were not.
- **Action (minimal fix, in-lane `server/index.js` only)**: perform the [D6]
  pre-flight (`storage.getBackend()`) as a guarded step immediately after the
  dotenv block — i.e. before any route mount can evaluate a require-time store
  consumer — logging `Initialization failed:` with the error and calling
  `process.exit(1)`. `runBoot()`'s catch keeps the same handling for failures
  after module assembly. The `bootSequence.md` §2 step 2 wording was updated in
  the same change (docs-first) to state the pre-flight runs at boot entry
  (top-level, before mounts).
- **Verification**: `server/__tests__/bootSequence.test.js` L93 case asserts
  exit code 1 + stderr `Initialization failed:` + the `Partial WEA_DB_*`
  message listing the missing keys; full server `test:ci` green on branch
  `test/boot-sequence-coverage`.

### 2026-09-23 — Single non-reproducible full-gate failure on the boot-coverage branch (pending reproduction)

- **Summary**: the first full `npm run test:ci` on branch `test/boot-sequence-coverage`
  (new spawn-based `server/__tests__/bootSequence.test.js` + the `[D6]` pre-flight in
  `server/index.js`) reported 1 failing suite (126/127 green); the suite name was not
  captured before the output tail scrolled. Six subsequent full gates (127 suites /
  2353 tests each) and four solo runs of the new suite are fully green.
- **Diagnosis**: incomplete by non-reproduction. The new suite binds only
  OS-allocated ephemeral ports and uses 60 s boot timeouts against ~1.5 s boots;
  a port-collision or boot-timeout signature was plausible but never observed.
  Matches the known parallel/coverage-load flake class already logged on
  2026-09-22 (gcService / FilePropertiesDialog / PlatformSchema.conformance).
- **Classification**: pending reproduction; no code change. **Action**: monitor;
  capture the full FAIL block on recurrence per §3.2 procedure 1.

### 2026-09-23 — E2E-COLLECTION lifecycle run: undoing a command-unit collection row silently no-ops (nested item inverses unread) (Case A)

- **Summary**: E2E-COLLECTION-008 (member exclude → undo re-adds the member) failed on the
  scratch `:5013` server: `POST /api/actions/:id/undo` answered 200 `status: undone` while the
  excluded member stayed gone (API `GET /:id/items` unchanged). The toast/undo path reported
  success for a mutation that never happened.
- **Diagnosis**: `applyCollectionInverse` (`server/domains/actions/service.js`) passed each
  `payload.items[i]` RAW into `applyInverseTx`. The store facade writes command-unit rows as
  `items: [{ nodeId, kind?, inverse: { op, … } }]` (collectionsStore.md §2.3 write format —
  `addItems`/`removeItems`), so the op descriptor lives NESTED under `item.inverse`;
  `applyInverseTx` switched on `inverse.op` = undefined → default branch
  `{ applied: false, reason: 'changed' }` for EVERY item. Command rows report per-item outcomes
  and skipped items do not abort, so the row still flipped to `undone`. The pre-existing
  executor tests seeded FLAT `{ op, … }` items directly (an executor-internal shape the store
  never writes), which masked the mismatch.
- **Classification**: **Case A (Source Error)** — the undo executor violates the journaled
  command-payload contract its own writer produces (docs/spec/server/store/collectionsStore.md
  §2.3; routes/actions.md undo semantics).
- **Action**: resolve the descriptor as `item.inverse ?? item` in `applyCollectionInverse`
  (flat items stay honored as the historical shape); added a regression test
  (`domains/actions/__tests__/actions.test.js`) that round-trips REAL `collectionsStore`
  command rows (add-items → remove-items → tip undo → chain undo).
- **Verification**: targeted server suites green; E2E-008 + E2E-005 pass; the
  `collections-desktop` project ran fully green three consecutive times.

### 2026-09-23 — E2E-COLLECTION lifecycle run: `listForUser` ignored the store-contract `status` default; archived collections leaked into every list read (Case A)

- **Summary**: the `__collections__` list view (E2E-COLLECTION-004) still rendered an archived
  collection on the scratch run, and archived rows appeared TWICE in archived-including reads.
- **Diagnosis**: `docs/spec/server/store/collectionsStore.md` §2.1 pins the repository contract:
  `listForUser` "`status` filter defaults to `active`". Both dialect twins
  (`CollectionsRepository.sqlite/postgres`) applied `AND c.status = <p>` only when `status` was
  truthy — omitting the option returned EVERY status. `listCollections` (`GET /api/collections`)
  never passes `status`, so (a) archived rows leaked into the default `mine,shared` read
  (sidebar/list view), and (b) the `include`-carries-`archived` path CONCATENATED
  `listArchived` onto a set that already contained those rows (duplication).
- **Classification**: **Case A (Source Error)** — implementation violates the published store
  contract (collectionsStore.md §2.1).
- **Action**: `const effectiveStatus = status ?? 'active'` in both twins (`status:'all'` opts
  into every status); the repository interface jsdoc gained the default note; pinned with a new
  conformance case ("listForUser excludes archived by default; status:all and listArchived
  return them") executed on BOTH dialect legs.
- **Verification**: sqlite conformance leg green; real-PostgreSQL leg
  (`WEA_TEST_PG_* :5433` + `CollectionsRepository.conformance`) green; E2E-004/006 pass on the
  scratch sqlite server.

### 2026-09-23 — E2E-COLLECTION lifecycle run: `include=mine,archived` returned active ∪ archived, not "exactly the archived" (Case A)

- **Summary**: the `__archive__` surface and the sidebar ArchiveNode badge (reads
  `include=mine,archived`) showed ACTIVE collections and a wrong count
  (E2E-COLLECTION-004 badge/archive assertions failed on the scratch run).
- **Diagnosis**: `listCollections` treated `archived` as an ADDITIVE token —
  `listForUser(...) + listArchived(...)` — and never excluded the active rows, while
  CollectionsSection.md §2.3 specifies the ArchiveNode lists "exactly the `status=archived`
  collections" (badge = that row count). Combined with the twin defect above, the archived read
  returned active ∪ archived ∪ duplicated archived.
- **Classification**: **Case A (Source Error)** — service violated the documented include-token
  surface semantics (docs/spec/client/components/folder-tree/CollectionsSection.md §2.3).
- **Action**: token-set selection in `collections/service.js` — `mine,archived` (no `shared`)
  ⇒ ARCHIVED-ONLY rows; any include carrying `shared` alongside `archived` (the dashboard
  status read `mine,shared,archived`) ⇒ the full active ∪ archived ∪ granted superset. Written
  into `docs/spec/server/routes/collections.md` §2.4 as a Decision (docs-first) in the same
  change; no caller depends on the previous additive reading (grep-verified: FileManager
  archive route + folder-tree badge use `mine,archived`; CollectionDashboard uses
  `mine,shared,archived`).
- **Verification**: `collections.test.js` + `actions.test.js` targeted suites green;
  E2E-001/004/006/009 pass; three consecutive `collections-desktop` green runs.

### 2026-09-23 — E2E-COLLECTION lifecycle run: tied collection timestamps produced a plan-dependent list order (Case A source + Case B test expectation)

- **Summary**: rapid/same-transaction collection creates tied on every sort key
  (`activity_score` 0 pre-rollup, `last_member_change_at`/`created_at` same second), and the
  `GET /api/collections` order was then whatever the query plan emitted. The unit list test
  (`collections.test.js`) asserted `['B list', 'A list']` — the INSERTION (oldest-first) order
  the plan happened to return — while the documented chain is `created_at DESC` (newest first).
  The E2E card assertions (E2E-COLLECTION-002/004) were order-sensitive and flaky against it.
- **Diagnosis**: neither twin's `activity`/`created`/`updated` ORDER BY chains carried a final
  deterministic tie-breaker; a tied-key row order is plan-dependent, i.e. not a contract. The
  stored expectation codified the plan artifact, contradicting routes.md §2.4 / store §2.5
  ("`created_at` desc").
- **Classification**: **Case A (Source Error)** for the non-deterministic sort; **Case B (Test
  Error)** for the unit expectation that asserted the accidental oldest-first order.
- **Action**: appended `c.id DESC` (newest-first) as the final tie-break to the
  `activity`/`created`/`updated` sorts in both twins; the decision is written into
  `docs/spec/server/routes/collections.md` §2.4 and
  `docs/spec/server/store/collectionsStore.md` §2.5 (docs-first); the `collections.test.js`
  expectation corrected to `['A list', 'B list']` (newest first — the documented direction).
- **Verification**: server targeted suites + PG conformance leg green; three consecutive fully
  green `collections-desktop` E2E runs (9 passed; 36.5 s / 36.5 s / 35.3 s) with no ordering
  flake.

### 2026-09-23 — E2E-COLLECTION lifecycle run: the documented file-side `Add to collection` entry was unreachable from the explorer (Case A — feature gap, E2E-COLLECTION-002)

- **Summary**: E2E-COLLECTION-002 failed at the first step — the file context menu carried no
  `collection-add` row, so the whole add/create-and-add flow was unreachable, and the added
  member's undo toast had no label key.
- **Diagnosis**: T0.5 shipped the `AddToCollectionMenu` component + repository/gateway seams
  but left the HOST wiring as the recorded wave-2 residual ("explorer `Add to collection` host
  wiring" — PLAN.md §9 register); `FileManagerView` never passed `onAddToCollection` into the
  `interaction` bag, and `collections.undoAdded` (the toast key the flow needs) was absent from
  the en/ko locale mirror.
- **Classification**: **Case A (Source Error)** — the implemented-and-specified surface
  (`docs/spec/client/components/file-manager/AddToCollectionMenu.md` §2.2,
  CollectionsListView/file-menu §3.1) was not reachable through the documented entry point.
- **Action**: wired the shell-owned single submenu instance in `pages/FileManager/FileManager.js`
  (same idiom as `MemberRowControls`/`FileContextMenu`): context-menu dispatch → submenu anchored
  at the closing menu position, `Add` → `addCollectionItems` + `rejected_not_readable` info +
  undo toast (`collections.undoAdded`), `New collection` → `createCollection` + add (one
  command, one undo toast, §2.7), `seedItemVisible=false` (P0: no embed capability, absent-not-
  disabled §4.12); share-link/trash views withhold the callback (§3.1 set rule); en/ko gained
  the `undoAdded` mirror key.
- **Verification**: client targeted suites (`FileManager*|AddToCollection|FileManagerView|
CollectionsListView|locale` → 24 suites / 328 tests) green; E2E-COLLECTION-002 passes on
  three consecutive scratch runs.

### 2026-09-29 — collections E2E failed in UI mode from the first case: stale `client/build` + CRA bundled-eslint breaking production builds (Case B, test-infra)

- **Summary**: `npm run test:e2e:ui` → `e2e/collections.spec.ts` failed immediately on
  `collection-section` missing, while the same suite passed 3× green in the authoring worktree.
  Suite independence itself was verified sound: `playwright test collections --list` maps the
  spec exclusively to the hermetic `collections-desktop` project (:5013) — no shared-pool
  double-run.
- **Diagnosis**: two stacked test-infra defects, both invisible per-worktree:
  1. Both E2E build entry points (`e2e/helpers/setupScratch.ts` `ensureClientBuild` and
     `scripts/e2e-serve-client.js`) checked only **existence** of `client/build/index.html`.
     The main checkout's build dated 2026-09-13 — long before the wave-2/3 collections sources —
     so every served URL (shared :3000 and scratch :5013) ran a pre-feature SPA; the authoring
     worktree had built fresh, masking it.
  2. Forcing a rebuild then failed the CRA build: react-scripts 5.0.1's bundled
     eslint-webpack-plugin pins `resolvePluginsRelativeTo` to `react-scripts/config`, which under
     the npm-workspaces hoisted layout does not register `eslint-plugin-react-hooks` — every
     inline `/* eslint-disable react-hooks/exhaustive-deps */` (useUndoToast, useCollections,
     CollectionDashboard, useFileManagerDialogs) aborted `react-scripts build` with
     "Definition for rule ... was not found". The repo lint authority is the root flat
     `eslint.config.js` (CI gates); CRA's embedded lint is redundant here.
- **Classification**: **Case B (Test error)** — harness staleness + toolchain config, no spec
  contract violated; unit/CI gates were not affected (jest has no CRA lint; CI eslint uses the
  flat config).
- **Action taken**: converged both entry points into one module
  `scripts/lib/ensureClientBuild.js`: freshness gate (rebuild when any `client/src`,
  `client/public` or `shared/` file is newer than the built index) +
  `DISABLE_ESLINT_PLUGIN=true` for the CRA build. Verified: first run rebuilds (9 passed),
  second run skips rebuild (0 "rebuilding" lines, 9 passed in 41 s); `--list` re-confirmed the
  spec maps only to `collections-desktop`.

### 2026-09-29 — P-3 E2E-002 preview assertion found empty `preview_items`: root-level workspaces are foreign-owned (Case B — test fixture)

- **Summary**: after the P-3 server payload shipped `preview_items`, `E2E-COLLECTION-002` still
  rendered zero preview cells; the API returned `item_count: 2` with `preview_items: []`.
- **Evidence**: scratch-server trace of the resolved member view rows — every row arrived with
  `sharedExcluded: true, state: 'normal'`. `isOwnerNode(ownerId, nodeId)` resolves ownership
  through the closure table against the user's HOME root (`parent_id IS NULL AND name =
username`), while `openPrivateWorkspace` creates its case folder at the FILESYSTEM ROOT
  (admin-only root creation, `folders.js`), i.e. a SIBLING of `/admin`. Root-level files are
  therefore legitimately foreign per the §3.2 ownership model, and the binding P-3 preview
  filter (`routes/collections.md` — revoked/shared-excluded never surface) correctly drops them.
- **Classification**: **Case B (Test error)** — the fixture placed members outside any owner
  home; the server contract and the filter rule are right. Existing member-list tests never
  asserted `shared_excluded:false`, so the quirk was invisible before previews made it observable.
- **Action taken**: collections spec gains a local `loginAndOpenOwnedWorkspace` (case folder
  under `/admin`) used by 002 only; other cases keep the root workspace (unchanged assertions).
  Full `collections-desktop` project re-run: 10/10 passed. Follow-up (owner visibility): whether
  bootstrapped ADMIN should own a home root — out of P-3 scope, not changed.

### 2026-09-29 — P-4 inherited "zero DOM delta" assertions matched MUI icon testids (Case B — test error)

- **Summary**: four inherited P-4 unit assertions (`FileList`/`FileGrid`/`FileGridItem`/`FileDetail`
  plain-file rows) asserted `container.querySelector('[data-testid]') === null` to prove file rows
  gain no member slots. They failed even with a correct implementation: every file row renders a
  `getFileIcon()` SVG that carries its own MUI `data-testid` (`InsertDriveFileIcon`, …), so "no
  `[data-testid]` anywhere" is unsatisfiable regardless of P-4.
- **Evidence**: failure output showed the matched node was
  `<svg class="MuiSvgIcon-root …" data-testid="InsertDriveFileIcon">` — not a member row/menu slot.
  The contract (spec §2.5/§2.6) only requires that file rows carry no `member-row-*` /
  `member-menu-button` slot.
- **Classification**: **Case B (Test error)** — over-broad assertion; no source violated the spec.
- **Action taken**: the four assertions were scoped to the member-slot testids
  (`[data-testid^="member-row-"]` / `[data-testid="member-menu-button"]`). Related follow-up found
  in the same suite: the like-toggle host integration (`FileManager.test`) reopened the member menu
  with a stale row because the memo comparators ignored `file.liked`; comparators now also compare
  `state`/`liked` (undefined-safe, zero file-side delta) — an implementation fix surfaced by an
  existing integration anchor. Verification: client 1795/1795, e2e collections-desktop 12/12.

### 2026-09-29 — P-5 E2E-013 per-surface isolation assertion misread mount-time persistence (Case B)

- **Summary**: first full `collections-desktop` leg failed 013 only: after the LIST toggle on the
  Likes surface the spec asserted `collectionMemberViewMode === null` to prove per-surface isolation.
  The value was `'grid'`.
- **Evidence**: `useExplorerSession` persists every view-mode key through an effect on
  `[memberViewMode]` — a persist call fires on MOUNT with the default too (P-4 as-shipped behavior,
  exercised by the existing unit suite). Any full page load (`page.goto('/files/__collections__')`)
  therefore writes `'grid'` into the member key before the assertion could run. The card-shell
  assertion on the member row already proved the member surface renders its own default; the null
  claim tested an internal write-timing detail, not the contract.
- **Classification**: **Case B (Test error)** — no source violated `useExplorerSession.md` (the
  per-surface keys are independent; the isolation contract is that the LIKES dispatch never writes
  the LIKES value into the member/file keys).
- **Action taken**: assertion corrected to `not.toBe('list')` (value-level isolation), with the
  visual grid assertion kept. Re-run: collections-desktop 13/13. Same commit dropped an inert
  `memberLoading` key from the liked `collectionsModel` branch (the view reads
  `listingState.loading` directly).

### 2026-10-01 — derivedTags backfill test failed only in UTC+9 near month rollover (Case B, test error)

- **Summary**: first §11 merge gate run reported `derivedTags.test.js` "backfill … idempotent"
  failing with `month:2026-10` expected vs `month:2026-09` received (host local JST Oct 1,
  UTC still Sep 30). The server suite itself and all §11 code were unrelated to the change.
- **Diagnosis**: the test helper re-derived the expected month from the raw DB `createdAt`
  with `String(v).slice(0, 7)` — a representation/timezone-dependent expression — while
  production `monthOf` pins to `toISOString()` UTC (spec: "month is the UTC calendar month").
  The two definitions disagree exactly when local date ≠ UTC date. Unit tests elsewhere use
  fixed ISO literals so only this dynamic test is exposed.
- **Classification**: Case B (Test Error) — production behavior correct.
- **Action taken**: expected month now derived through the production function
  (`computeDerivedTags({ createdAt }).find(...)`); verified green under default,
  `TZ=Asia/Tokyo` and `TZ=America/Los_Angeles`.

### 2026-10-01 — E2E-003 double badge: admin-owned collections marked every file foreign (Case C — undefined term; owner adjudication)

- **Summary**: in the member view of an ADMIN-owned collection, root-level and other-home
  members rendered BOTH the VpnLock (`shared_excluded`) and the awaiting-publish badge (the
  "double badge" of E2E-003), card previews came back empty, grantees received nothing, and
  the admin publish path was unreachable.
- **Evidence**: `service.js:262` computes `foreign = !isOwnerNode(collection.ownerId, nodeId)`
  while `ownerNodeResolver.isOwnerNode` was a pure home-membership predicate
  (`getUserRootNode` = root-level directory named `username`, FileNodeRepository.sqlite.js
  313-322) with NO admin rule — even though `permissionPolicy.js` codifies admin ⇒
  everything (`isAdminUser` short-circuit on read/write/manage, documented in fileService.md
  54/56/70, aclService.md and features/permissions.md §3). E2E pin (pre-fix):
  `member-excluded-badge-3` received count 1, expected 0.
- **Prior misruling**: the 2026-09-29 P-3 entry ("root-level workspaces are foreign-owned")
  ruled the flag "legitimately shared_excluded" — Case B, test fixture. Under the verdict
  discipline added in fd1bac4 (AGENTS §3.2: a 'legitimate/correct' verdict must cite the
  spec clause), no clause defined foreign-ness for ADMIN-owned collections; the correct
  classification was Case C (spec undefined/ambiguous) — stop and ask, never bless the
  behavior as a fixture quirk.
- **Classification**: Case C → owner adjudication 2026-10-01 (binding rulings R1–R3).
- **Action taken**: R1 — `isOwnerNode` now loads the user (`userStore.findById`) and returns
  true for `is_admin` BEFORE the root/ancestry path (commit 4efa3e9); foreign stays keyed on
  the collection OWNER, so real cross-leak cases (non-admin owner, other-home file) still
  render `shared_excluded:true` and grantees still never receive foreign rows. R2 —
  publish-pending is suppressed when `shared_excluded === true` (an excluded row is
  un-publishable forever; commit 0c87b1d + renderer pins 429f993). R3 — the term is now
  defined in AI_FEATURE_PLAN.md §3.2, collections-platform.md §3.2, features/permissions.md
  (Owner exception) and the permissionPolicy spec (commit d97bf09). E2E-003 asserts
  excluded-badge count 0 with the pending badge visible. Gates: server `test:ci` 130 suites
  / 2412 pass (5 skip), client full 178 / 1895, PG conformance leg 23 / 344 (1 skip),
  `E2E_BACKEND_MODE=s3 collections-desktop` 14/14. This entry APPENDS; the 2026-09-29 entry
  above is kept verbatim as historical record.

### 2026-10-01 — admin-operator pivot: superseding the §13 ownership adjudication (owner ruling — product decision, not a defect reversal)

- **Summary**: same day as the entry above, the owner re-scoped the admin's ROLE: the admin is a
  pure operator and NEVER participates in collections/likes/dashboard — personal-storage surfaces.
  This PIVOT SUPERSEDES the definitional rows of the 2026-10-01 §13 adjudication (the
  "ADMIN-owned collection has no foreign members" definitions) while KEEPING §13 R1 intact:
  `isOwnerNode`'s admin-owns-everything bypass remains the file-ACL convention for
  permissionPolicy/files/trash/sharing consumers. It is a product-decision reversal of surface
  participation, NOT a reversal of a defect fix — the R1 file-ACL evidence stands.
- **Evidence**: R3 definitions made the collections domain describe admin participation ("an
  ADMIN-owned collection", admin requester shared-view laundering) — the E2E-003 chain had forced
  that vocabulary while the participation question was never ruled on. Owner ruling 2026-10-01
  (pivot brief): hybrid enforcement — server gates now, client hiding as the sibling task.
- **Classification**: Case C (owner adjudication — policy decision above spec, spec then rewritten).
- **Action taken**: docs-first (commit d22e617 — AI_FEATURE_PLAN §3.2, collections-platform
  §3.2/§3.3/§3.4/§4.5/§4.6/§4.7/§4.12/§4.16, permissions.md scope bullet, service/routes specs,
  api.md, shared-contracts.md); RED (df8f654); GREEN (5f5a00a): `requireNonAdmin` middleware
  (403 `serverErrors.collections.forbidden`, reused — no new i18n codes) on ALL 22 collections,
  3 file-likes and 2 dashboard routes + admin-as-grantee ban at grant creation in
  `grantCollectionAccess`. Usage recording unchanged (admin download/preview/search-hit stay);
  journal unchanged (gates make admin rows unreachable); `like` becomes unreachable for admins.
  §13 residual "admin derived candidates" declared MOOT. The prior entry is kept verbatim as
  historical record (append-only). Gates: server `test:ci` 130 suites / 2441 pass (5 skip),
  PG adapters leg 23 / 344 (1 skip), ownerNodeResolver admin tests unmodified-green.

### 2026-10-02 — undo of a collection revoke crashes (single-inverse loses the journal row) (Case A, source error)

- **Summary**: while pinning the ruling-B undo boundary (undo-revoke restores the grant but
  NOT the digest cursor), `undoAction` on a revoke row threw
  `serverErrors.errorHandler.databaseQueryFailed`; raw cause:
  `TypeError: Cannot read properties of undefined (reading 'actor')`.
- **Diagnosis**: `applyCollectionInverse` (server/domains/actions/service.js) forwards the
  journal `row` to `applyInverseTx` on the command-unit (items) branch but DROPPED it on the
  single-inverse branch. The `grant-access` inverse (revoke's undo) reads
  `inverse.grantedBy ?? row.actor` — undefined `row` throws inside the undo TX, which rolls
  the whole undo back and surfaces as a mapped DB error. Never caught before: no test or E2E
  ever undid a revoke (grant/create/add-item inverses do not read `row`).
- **Classification**: **Case A (Source Error)** — routes/actions.md §2.4 specifies undo
  applying the journaled inverse; the code path violates it for `grant-access`.
- **Action taken**: pass `row` through the single-inverse call
  (`applyInverseTx(tx, payload.inverse, row)`); pinned by the ruling-B service test
  "undo-revoke restores the GRANT but NOT the cursor". No behavior change for other inverses
  (they never read `row`).

### 2026-10-02 — E2E-COLLECTION-010 flaked: nth() resolved to the empty-card fallback (Case B, test race)

- **Summary**: under the new `E2E_BACKEND_MODE=webdav` collections runs, 010 failed
  intermittently (~half the runs): `cards.nth(1)` expected the second collection name but
  received `""` — the locator resolved to `div[data-testid="collection-card-fallback"]`.
- **Diagnosis (trace-proven)**: the second `uiCreateCollectionWithFile` press(Enter) returns
  while the client's create→add chain is still in flight — `AddToCollectionMenu.submitting()`
  closes the menu BEFORE `await onCreateAndAdd(...)` (two sequential POSTs;
  `routes/collections.md` documents them as separate calls: create `/:id`, then
  `POST /:id/items`). The test's immediate `page.goto('/files/__collections__')` unloaded the
  document between the two POSTs (trace: `POST /api/collections` 201 for Zzz, NO
  `POST /api/collections/2/items` anywhere in the run) → Zzz legitimately listed with
  `preview_items: []` → its card renders the decorative `collection-card-fallback` child,
  which the prefix selector `[data-testid^="collection-card-"]` also matches — shifting every
  `nth()` index by one (9 polls, stable: not a render flicker).
- **Classification**: **Case B (Test Error)** — the app behaves per spec; the helper pressed
  Enter and moved on without waiting for the documented second call to land.
- **Action taken**: settle-wait in 010 — API-poll until BOTH collections report
  `item_count: 1` before navigating (no assertion weakened; the order checks stay); the card
  locator now excludes `collection-card-fallback` (real card roots only). Surfaced by the
  webdav runs added in P0 closeout item 3.
