# PLAN — E2E Naming Normalization + Suite Consolidation

Status: IN PROGRESS.
Branch: `refactor/e2e-naming-and-consolidation` (base: `dev`).

## 1. Objective

Two deliverables on the Playwright e2e suite (`e2e/*.spec.ts`, `e2e/helpers/*`):

1. **Naming rules** — define and apply one convention for suite (`describe`) and case
   (`test`) titles, serialization, and conditional skips.
2. **Suite/case consolidation** — remove duplicated scenarios and helpers between
   specs/helpers, and align the `docs/E2E_COVERAGE_PLAN.md` inventory with reality.

Target filename style: `<name>.<platform>.spec.ts` (dot suffix). After consolidation the
platform-specific core-flow twins are absorbed into `core-flow.shared.spec.ts`, so the
remaining platform files (`explorer-advanced.{desktop,mobile}`, `core-flow.shared`) all
use the dot-suffix style; `desktop-core-flow.spec.ts` / `mobile-core-flow.spec.ts` are
deleted.

## 2. Naming convention (target — also written to `docs/TESTING_STRATEGY.md`)

- **Case title**: `E2E-<DOMAIN>-NNN: <third-person present declarative description>`.
  - Sentence case, no imperative/gerund, no `[Px]` priority tags, no literal backticks,
    no snake_case identifiers, no emojis.
  - Hermetic scenario labels stay as a parenthetical between ID and colon, normalized:
    setup-wizard `(Case N, both modes|s3 mode only)`, migration `(Flow <label>)` (no bare
    `(A5)`/`(B5)`/`(E3)`).
  - IDs declared in **numeric order** within each file.
- **Suite title**: lowercase sentence case; platform qualifier `(desktop)` / `(mobile)`
  when platform-owned; ID-range qualifier for hermetic families
  (`first-run setup wizard (E2E-SETUP-001..004)`).
- **Serial mode**: always `test.describe.configure({ mode: 'serial' })`; never the
  anonymous `test.describe.serial`.
- **Skips**: every `test.skip`/`test.fixme` carries a reason. Platform ownership via
  project/testMatch, not inline project skips — documented exception: mobile-only cases
  inside a both-platform spec (mypage-user 011/012) keep a reason-carrying skip.
- **ID coverage**: every `test()` carries an ID. `admin-config.spec.ts` gets the new
  `E2E-ADMINCFG-001..012` family; `00-project-setup.spec.ts` gets `E2E-SETUP-005`.

## 3. Consolidation targets

| #   | Target                                                                                                                                                                                                                    | Change                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `mypage-admin.spec.ts` desktop/mobile twins (16 tests, 8 scenarios)                                                                                                                                                       | One parameterized suite; platform navigation seam; `(mobile)` title suffixes removed                                                                                                                |
| C2  | Core-flow twins `E2E-EXP-006/008`, `E2E-BULK-001..004` (+ BULK-006 mobile-only, BULK-007 conflict dialog) duplicated in `desktop-core-flow`/`mobile-core-flow`/`explorer-advanced.*`                                      | Absorb into `core-flow.shared.spec.ts` with a platform interaction seam; delete `desktop-core-flow.spec.ts` + `mobile-core-flow.spec.ts`; remove BULK-007 from `explorer-advanced.{desktop,mobile}` |
| C3  | `E2E-AUTH-004` ≡ `E2E-EXP-001` identical landing smoke                                                                                                                                                                    | Remove `E2E-AUTH-004` test; mark inventory row `removed` (covered by E2E-EXP-001)                                                                                                                   |
| C4  | Helper re-implementations: UI uploadFile/createFolder ×3, folder-picker ×2, bulkDeleteSelected ×2, long-press ×2, path folder-create ×3, API login ×5, UI login ×4, share-link inline, openSystemSettings ×2, PROPFIND ×3 | Route into `helpers/files.ts`, `helpers/auth.ts`, `helpers/mobile-interactions.ts`, `helpers/shareLinks.ts`, `helpers/setupScratch.ts`                                                              |
| C5  | Hermetic scratch scaffolding: boot/teardown ×3, `writeScratchEnv` ×2 identical, `seedWebdavSettings` ×2                                                                                                                   | Extract shared boot/teardown + env/seed helpers into `setupScratch.ts`                                                                                                                              |
| C6  | Global files: `seedPostgresql()` caller + `SEED_USERS`, `cleanDir()`, S3/PG constants duplicated                                                                                                                          | Extract shared `runSeedDb`, `SEED_USERS`, `cleanDir`, constants module                                                                                                                              |
| C7  | `playwright.config.ts` testMatch + wave gating                                                                                                                                                                            | Update for removed files; drop redundant inline wave gate in `mypage-admin` (keep testMatch gate)                                                                                                   |
| C8  | Inventory drift                                                                                                                                                                                                           | Fix `covered`/`planned`/ownership rows; add `E2E-MIG-001..008` + `E2E-ADMINCFG-001..012` sections; note EXP-007 folded into EXP-006                                                                 |

## 4. Success criteria

- Naming convention documented in `docs/TESTING_STRATEGY.md` and applied to every spec.
- No duplicate scenario bodies between specs/helpers (C1–C4); hermetic scaffolding shared (C5, C6).
- `docs/E2E_COVERAGE_PLAN.md` inventory matches the suite (C8).
- eslint (`npm run lint:ci`) + prettier (`npm run format:check`) clean.
- Playwright e2e green in both backend modes for the consolidated suite
  (`npm run test:e2e:s3` and `npm run test:e2e:webdav`, plus the hermetic projects).

## 5. Dependency graph

- **Task 1 (docs)**: naming rules in `TESTING_STRATEGY.md`; inventory rewrite in
  `E2E_COVERAGE_PLAN.md`; PLAN.md. No dependencies.
- **Task 2 (helpers, C4)**: depends on Task 1 (helper seams documented). Can run parallel
  with Task 3.
- **Task 3 (hermetic scaffolding, C5)**: independent of Task 2 (different helpers).
- **Task 4 (core-flow consolidation, C2)**: depends on Task 2 helpers (uploadFile/
  createFolder/folder-picker/bulk-delete/long-press shared first).
- **Task 5 (mypage-admin consolidation, C1)**: independent of Task 4; depends on Task 2's
  `createFolderViaApi` + auth helpers.
- **Task 6 (naming pass, C0)**: apply the convention to every spec title/skip; depends on
  Tasks 4+5 to avoid rework on moved tests.
- **Task 7 (config + cleanup)**: playwright.config.ts, delete twins, E2E-AUTH-004 removal,
  `E2E-ADMINCFG`/`E2E-SETUP-005` IDs. Depends on Tasks 4–6.
- **Task 8 (verification)**: lint, prettier, e2e runs. Depends on Task 7.

## 6. Progress log

- 2026-09-02: Analysis complete (two parallel surveys): full title/suite inventory + 8
  consolidation targets with file:line evidence. Scope confirmed with user: full refactor,
  dot-suffix filename style. Plan written.
- 2026-09-02: Docs-first done — naming rules in `docs/TESTING_STRATEGY.md` (new subsection),
  `docs/E2E_COVERAGE_PLAN.md` inventory rewritten (ownership table, EXP/BULK/OVERLAY rows,
  E2E-AUTH-004 removed, E2E-EXP-007 folded note, new E2E-MIG-001..008 + E2E-ADMINCFG-001..012 +
  E2E-SETUP-005 sections).
- 2026-09-02: Suite consolidation implemented. `core-flow.shared.spec.ts` now owns EXP-001..006,
  008, 012, 013 + BULK-001..004, 006, 007 with a platform interaction seam (click/Meta vs
  long-press/action-sheet); `desktop-core-flow.spec.ts` + `mobile-core-flow.spec.ts` deleted;
  `playwright.config.ts` testMatch updated. `mypage-admin.spec.ts` reduced from 16 twin tests to
  one parameterized serial suite (8 tests × both projects); inline platform/wave skips removed.
  `E2E-AUTH-004` removed (byte-identical to E2E-EXP-001).
- 2026-09-02: Helper consolidation. UI create/upload/folder-picker/bulk-delete/progress helpers
  added to `helpers/files.ts`; `loginAsUserApi`/`getAdminToken`/`loginWithCredentials` added to
  `helpers/auth.ts`; `writeScratchEnv`/`seedWebdavSettings`/`openSystemSettings` extracted to
  `helpers/setupScratch.ts`; new `helpers/seedDb.ts` (SEED_USERS + runSeedDb + cleanDir) dedupes
  global-setup/teardown/00-project-setup. All 6 hermetic projects verified green (webdav mode).
- 2026-09-02: Naming pass applied to all remaining specs via parallel sub-agents: [P0]/[P1]
  prefixes removed, dead E2E-SHARE-010 skip deleted, describe titles lowercased, serial idiom
  unified to `test.describe.configure`, all skips carry reasons, share-public reordered
  numerically, share-internal order preserved (load-bearing), admin-config got E2E-ADMINCFG-001..012,
  00-project-setup got E2E-SETUP-005, migration labels normalized to `(Flow X)`.
- 2026-09-02: Verification fixes. (1) mypage-admin `E2E-ADMIN-005` mobile flake root-caused to a
  locator bug I introduced (`dialog.getByText('Add').first()` matched the dialog heading "Add new
  user" instead of the submit button) — fixed with `dialog.getByRole('button', { name: 'Add',
exact: true })` + bounded re-dispatch until the 201 response. (2) Per-project data isolation
  ordering defect (pre-existing, exposed by later-waves data volume): Playwright runs all
  dependency-only setup projects before any test project, so the mobile project always ran on
  desktop-polluted data. Fixed in `playwright.config.ts` by making `${backendMode}-mobile-setup`
  depend on `${backendMode}-desktop`, so the reset runs right before mobile tests.
- 2026-09-02: VERIFICATION GREEN. `npm run lint:ci` + `npm run format:check` clean.
  - webdav default-waves (desktop+mobile): 105 passed / 3 skipped
  - webdav later-waves (all projects): 181 passed / 5 skipped
  - s3 default-waves (all projects): 153 passed / 3 skipped
  - s3 later-waves (all projects): 183 passed / 3 skipped
- 2026-09-02: Residual later-waves flake root-caused and fixed. Repeat runs of the migration
  spec exposed `E2E-MIG-001` failing 2/3 when the MinIO bucket was absent: every run's
  global-teardown `down -v` wipes the bucket, webdav-mode global-setup skipped
  `ensureS3Bucket`, and `emptyS3Bucket` crashed with `NoSuchBucket`. Fixed at two layers:
  (1) `global-setup.ts` now `waitForMinio` + `ensureS3Bucket` in BOTH modes (empty only in s3);
  (2) `e2e/helpers/minio.ts` `emptyS3Bucket` calls new `ensureS3BucketExists` first.
  Verified: migration-mobile 3/3 with the bucket wiped beforehand; full webdav later-waves
  re-run 181 passed.
- 2026-09-02: **Replaced `E2E_LATER_WAVES` with `E2E_CORE=1` (essential-only run).** The flag
  semantics inverted: default `npm run test:e2e` now runs the FULL suite; `E2E_CORE=1`
  (`npm run test:e2e:core[:s3|:webdav]`) runs only essential suites. `explorer-advanced.*`
  reclassified as ESSENTIAL (view/sort/search/recent/selection are core file-exploration flows,
  per user decision) and RENAMED to `core-flow.desktop.spec.ts` / `core-flow.mobile.spec.ts`
  (helper `explorer-advanced.ts` → `explorer-controls.ts`) so the suite family is
  `core-flow.<shared|desktop|mobile>`. Non-essential (excluded in core mode): `mypage-admin`
  - hermetic `setup-wizard` / `admin-config` / `migration` (now conditionally pushed only when
    `!coreOnlyEnabled`). Docs updated (E2E_COVERAGE_PLAN ownership/wave-gating section,
    TESTING_STRATEGY filename style, TEST_GIT_GUIDE, .env.e2e/.env.e2e.webdav).
    Verified: webdav core 119/3, s3 core 119/3, webdav full 181/5 (s3 full 183/5 pre-rename).
