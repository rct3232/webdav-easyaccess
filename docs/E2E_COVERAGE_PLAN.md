# E2E Coverage Plan

## Purpose

This document is the canonical planning and inventory document for browser-level end-to-end coverage in WebDAV EasyAccess.

Use it to:

- track which user-visible flows should be covered by Playwright
- keep E2E scope aligned with product behavior rather than with the current test suite
- separate true browser flows from scenarios that are better covered by route integration, RTL/MSW, or unit tests
- define rollout order and ownership when expanding the `e2e/` suite

This document does **not** replace feature docs, route specs, or test summaries.

## Relationship to Other Docs

Use the following split consistently:

| Document                                           | Role                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `docs/TESTING_STRATEGY.md`                         | Testing principles, layer decisions, mocking policy, and E2E policy rules                                                |
| `docs/E2E_COVERAGE_PLAN.md` (this document)        | Canonical E2E flow inventory, rollout order, and ownership map                                                           |
| `docs/features/*.md`                               | Product behavior, domain intent, and feature-specific testing anchors such as selector policy or platform-split guidance |
| `docs/spec/client/**/*.md`                         | Client runtime/view/controller contracts                                                                                 |
| `docs/spec/server/routes/*.md`                     | Route-level HTTP behavior and error contracts                                                                            |
| `client/TEST_SUMMARY.md`, `server/TEST_SUMMARY.md` | Current implemented test state and coverage results                                                                      |

When these documents differ, treat runtime behavior and the most specific contract doc as the source of truth. If a documentation mismatch affects planning, record it here in the notes column instead of silently inventing a new contract.

## Scope

This document covers **browser-observable** flows that a real user can perform through the app UI:

- public auth routes
- protected routing
- file explorer flows
- share-link flows
- MyPage user/admin flows
- desktop-only and mobile-only interaction differences

This document does **not** attempt to fully catalogue:

- every server-side ACL or error matrix
- every API branch that has no meaningful browser entry point
- internal implementation details

Those scenarios should still be tested, but often outside Playwright.

## Ownership Rules

### Platform ownership

- Keep desktop and mobile E2E interactions in separate spec ownership when the interaction surface differs.
- Do not centralize desktop context-menu interactions and mobile action-sheet interactions behind a single conditional-heavy helper.
- Platform-agnostic core flows may live in a shared spec that runs under both desktop and mobile projects, as long as the exercised user path and assertions remain the same across projects.
- Shared helpers may contain only platform-agnostic seams:
  - login/auth setup
  - deterministic resource naming
  - fixture loading
  - stable item locators such as `data-file-path`
  - common explorer entry seams such as opening the FAB menu or an item's shared "More actions" trigger before platform-specific actions diverge

### Selector policy

- Prefer semantic selectors first.
- Use `data-file-path` for concrete explorer items.
- Use `data-testid` only for documented unstable seams such as FAB roots, icon-only action entries, or dialog fields/buttons whose semantic access is not stable enough for E2E.
- For SpeedDial-style menus, prefer visible `menuitem` names when that accessibility surface is stable in the E2E environment.

### Assertion policy

- Verify user-visible outcomes, not implementation details.
- Prefer navigation result, visible UI state, rendered text, disabled/enabled state, dialog presence, and item visibility over internal request inspection.
- Use request inspection only when the interaction itself is the behavior under test and there is no clearer user-visible anchor.

### Feature-doc anchors

- Use `docs/features/*.md` for feature-specific E2E guidance that other contributors need at the product boundary, such as:
  - selectors that are intentionally stable for that feature
  - desktop/mobile interaction ownership unique to that feature
  - feature-local testing constraints that would be too vague in the global plan
- Do not duplicate the full inventory table, rollout order, or status tracking inside feature docs.
- If a feature has no such special E2E guidance, it is acceptable for that feature doc to link here without adding a dedicated E2E subsection beyond representative testing anchors.

## Test Environment Assumptions

The first coverage pass should assume the current E2E baseline environment:

### Users

| Role                    | Seed user             |
| ----------------------- | --------------------- |
| Admin                   | `admin` / `admin`     |
| Standard approved user  | `user1` / `user1pass` |
| Secondary approved user | `user2` / `user2pass` |
| Anonymous               | no session            |

Source: `e2e/fixtures/test-data.ts`

Planning note:

- Auth-related Playwright setup may provision the approved standard-user fixtures through the admin API when a local E2E environment does not actually pre-seed `user1` / `user2`.
- Shared auth helpers should expose an explicit anonymous-session setup path so protected-route redirect checks do not accidentally reuse an authenticated browser state. A fresh browser context is preferred; clearing cookies and storage in the current context is an acceptable fallback when test ergonomics require it.

### File fixtures

| Fixture     | File                                        |
| ----------- | ------------------------------------------- |
| Small text  | `e2e/fixtures/test-files/test-file.txt`     |
| Small image | `e2e/fixtures/test-files/test-image.jpg`    |
| PDF         | `e2e/fixtures/test-files/test-document.pdf` |

### Naming and locators

- Use deterministic, collision-resistant names based on test title and project name.
- Reuse the current helper patterns in `e2e/helpers/files.ts` for generated file and folder names.
- Reuse `data-file-path` item targeting for explorer assertions.

### Runtime assumptions

- App origin is the local client used by the E2E environment.
- WebDAV and metadata backends are initialized for repeatable test runs.
- The baseline `.env.e2e` setup provides a local WebDAV target and a deterministic admin password.
- The E2E Docker stack is provisioned by the `e2e:server` webServer command before the app server boots: `scripts/e2e-wait-healthy.mjs` runs an idempotent `docker compose -f docker-compose.e2e.yml up -d` and waits for the mode's required containers to be healthy. There is no manual `dev:webdav:start` prerequisite.
- `e2e/global-setup.ts` never tears the stack down (that would wipe the Postgres volume out from under the running server). It resets the data state instead: TRUNCATE all app tables (preserving `_schema_migrations`) + re-seed admin and base users with home `file_nodes` roots, and (s3 mode) empty then ensure the MinIO bucket. `e2e/global-teardown.ts` empties the bucket (s3 mode) and stops the stack (`down -v`).
- **Setup-wizard runtime assumption (hermetic):** the setup spec is fully isolated from the shared E2E state above. It spawns its own scratch server instance on `:5003` (own env file via `DOTENV_CONFIG_PATH`, own sqlite path, own scratch PG DB) and supervises its own process lifecycle because restart is the behavior under test (PLAN.md §7). The shared `:5002` server and `:3000` client still boot for the run but are unused by the setup projects.

## Scenario Classification

Each flow row should use the following dimensions.

### Priority

| Value | Meaning                                              |
| ----- | ---------------------------------------------------- |
| `P0`  | Required for the first meaningful browser safety net |
| `P1`  | Strongly recommended after `P0` is stable            |
| `P2`  | Useful but deferrable or infra-sensitive             |

### Recommended layer

| Value        | Meaning                                           |
| ------------ | ------------------------------------------------- |
| `playwright` | Best verified through full browser E2E            |
| `rtl-msw`    | Better as client integration with mocked API      |
| `supertest`  | Better as server route integration                |
| `unit`       | Better as unit or hook/service-level verification |

### Viewport

| Value     | Meaning                                    |
| --------- | ------------------------------------------ |
| `both`    | Same observable flow on desktop and mobile |
| `desktop` | Desktop-specific surface or behavior       |
| `mobile`  | Mobile-specific surface or behavior        |

### Status

| Value      | Meaning                                         |
| ---------- | ----------------------------------------------- |
| `covered`  | Implemented in the current E2E suite            |
| `planned`  | Accepted target for future implementation       |
| `deferred` | Intentionally postponed                         |
| `non-e2e`  | Tracked here but recommended outside Playwright |

Status discipline:

- Keep `covered` reserved for scenarios that already exist in committed Playwright specs.
- Use `planned` for the current expansion wave until the owning spec lands.

## Planned Spec Ownership

This is the target ownership map for future Playwright growth.

| Spec file                       | Intended ownership                                                                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/auth.spec.ts`              | public auth, protected-route redirects, and login outcomes shared by desktop and mobile projects                                                                             |
| `e2e/core-flow.shared.spec.ts`  | shared ownership for core explorer CRUD, navigation, and bulk interactions that run under both desktop and mobile projects via a platform interaction seam                   |
| `e2e/share-public.spec.ts`      | public share success/error, add-to-my-permissions, leave-share                                                                                                               |
| `e2e/share-internal.spec.ts`    | internal permission-request lifecycle, approved-user `__shared__` access, and visible read-only vs write-capable outcomes                                                    |
| `e2e/mypage-user.spec.ts`       | account, sharing inbox/outbox/share-links, preferences                                                                                                                       |
| `e2e/mypage-admin.spec.ts`      | admin user management and settings flows (single parameterized suite for desktop and mobile projects)                                                                        |
| `e2e/core-flow.desktop.spec.ts` | desktop core-flow interactions: pointer selection, context menu, view/sort/search, multi-download, `__recent__`                                                              |
| `e2e/core-flow.mobile.spec.ts`  | mobile core-flow interactions: long-press selection, action sheet, folder-tree toggle                                                                                        |
| `e2e/setup-wizard.spec.ts`      | first-run setup wizard cases 1–4 (hermetic scratch instance on `:5003`, sqlite/PG-scratch isolation); runs in both `setup-wizard-desktop` and `setup-wizard-mobile` projects |
| `e2e/admin-config.spec.ts`      | admin config editor source/tier matrix, secret lifecycle, backend-health (hermetic `admin-config-desktop`/`admin-config-mobile` projects)                                    |
| `e2e/migration.spec.ts`         | unified migration mode flows A–E (hermetic `migration-desktop`/`migration-mobile` projects)                                                                                  |
| `00-project-setup.spec.ts`      | per-project DB reset infrastructure, executed only from `${backendMode}-{desktop,mobile}-setup` dependency projects                                                          |

The shared core-flow coverage lives in `e2e/core-flow.shared.spec.ts`, including the
previously platform-duplicated explorer and bulk scenario bodies, which run under both
desktop and mobile projects through a platform interaction seam. The former
`e2e/desktop-core-flow.spec.ts` and `e2e/mobile-core-flow.spec.ts` twins were absorbed
into it and removed (refactor branch `refactor/e2e-naming-and-consolidation`).

## Flow Inventory

### Inventory schema

| Column              | Meaning                                         |
| ------------------- | ----------------------------------------------- |
| `ID`                | Stable planning identifier                      |
| `Domain`            | Functional area                                 |
| `Flow`              | User-visible scenario                           |
| `Role`              | Primary actor                                   |
| `Entry route`       | Main route or browser entry point               |
| `Viewport`          | `desktop`, `mobile`, or `both`                  |
| `Preconditions`     | Required state/data                             |
| `Expected outcome`  | Observable result                               |
| `Priority`          | `P0`, `P1`, `P2`                                |
| `Recommended layer` | `playwright`, `rtl-msw`, `supertest`, or `unit` |
| `Planned spec file` | Expected spec ownership                         |
| `Status`            | `covered`, `planned`, `deferred`, or `non-e2e`  |
| `Notes`             | Mismatch, constraint, or special planning notes |

Current expansion note:

- Suite and case naming rules are defined in `docs/TESTING_STRATEGY.md` (§ "Naming convention (suites and cases)") and apply to every spec: `E2E-<DOMAIN>-NNN: <third-person present declarative description>`, numeric ID order, lowercase describe titles, `test.describe.configure({ mode: 'serial' })`, reason-carrying skips.
- `e2e/auth.spec.ts` now owns the committed browser coverage for `E2E-AUTH-001` to `E2E-AUTH-010`; `E2E-AUTH-004` is `removed` (byte-identical to `E2E-EXP-001`, see its inventory row).
- All core explorer and bulk scenario bodies live in `e2e/core-flow.shared.spec.ts` (platform interaction seam), replacing the former desktop/mobile core-flow twins.
- The rows for `E2E-SHARE-001` through `E2E-SHARE-009` and `E2E-SHARE-011` are `covered` in `e2e/share-public.spec.ts`; `E2E-SHARE-010` stays `deferred`.
- `E2E-OVERLAY-001` through `E2E-OVERLAY-007` and `E2E-OVERLAY-011` are `covered` in `e2e/share-internal.spec.ts`.
- `E2E-OVERLAY-008` is `covered` in `e2e/core-flow.desktop.spec.ts` (desktop only); `E2E-OVERLAY-009` stays `planned` and `E2E-OVERLAY-010` is `covered` (desktop only).
- `E2E-S3PG-001` through `E2E-S3PG-008` were covered in `e2e/s3-pg-integration.spec.ts` (S3-mode only). The suite has been consolidated (refactor branch `refactor/s3pg-e2e-consolidation`): S3-internal behaviors (copy-on-write, GC reconciliation, DB/blob agreement) moved to server integration tests, and the backend-agnostic user-observable flows (rename/move content integrity, permission inheritance depth, share-link survival) were ported to webdav-capable specs as `E2E-EXP-012`, `E2E-EXP-013`, `E2E-OVERLAY-011`, and `E2E-SHARE-011` so they run in both backend modes. The `e2e/s3-pg-integration.spec.ts` spec and its MinIO/PostgreSQL-only helpers were removed.
- `E2E-MYPAGE-004` through `E2E-MYPAGE-009` are now covered in `e2e/mypage-user.spec.ts`.
- `E2E-SETUP-001` through `E2E-SETUP-004` are now covered in `e2e/setup-wizard.spec.ts`, running in the dedicated `setup-wizard-desktop`/`setup-wizard-mobile` projects. The spec is fully hermetic (PLAN.md §7): each case spawns its own scratch server on `:5003` (own env file, own sqlite path, own scratch PG DB `webdav_e2e_setup`), supervises its own restart, and cleans up in `afterEach`. `E2E-SETUP-002` is s3-mode only (`test.skip` when `E2E_BACKEND_MODE=webdav`). `E2E-SETUP-005` is the per-project DB reset infrastructure test in `00-project-setup.spec.ts`.
- Internal user-to-user sharing plus `__shared__` coverage is reserved for `e2e/share-internal.spec.ts`, because those journeys cross explorer entry, MyPage request management, and granted-access outcomes.
- `__recent__` rows stay with the platform-owned core-flow specs because they are explorer-visible virtual-collection behaviors rather than MyPage-only flows.
- Root Playwright project ownership is handled in `playwright.config.ts`, which uses a shared `baseURL`, `e2e/global-setup.ts`, and `e2e/global-teardown.ts`, and assigns desktop/mobile ownership through project-level `testMatch`.
- Platform-agnostic explorer menu helpers live in `e2e/helpers/explorer.ts`; desktop-only context-menu behavior and mobile-only action-sheet behavior stay in their owning helpers (`e2e/helpers/desktop-interactions.ts`, `e2e/helpers/mobile-interactions.ts`).

### Auth and protected routing

| ID           | Domain | Flow                                                                                          | Role          | Entry route             | Viewport | Preconditions                                       | Expected outcome                                                 | Priority | Recommended layer | Planned spec file              | Status  | Notes                                                                                                                                       |
| ------------ | ------ | --------------------------------------------------------------------------------------------- | ------------- | ----------------------- | -------- | --------------------------------------------------- | ---------------------------------------------------------------- | -------- | ----------------- | ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| E2E-AUTH-001 | Auth   | Redirect unauthenticated user from `/files` to `/login`                                       | anonymous     | `/files`                | both     | no session                                          | login page is shown                                              | P0       | playwright        | `e2e/auth.spec.ts`             | covered | Protected-route baseline                                                                                                                    |
| E2E-AUTH-002 | Auth   | Redirect unauthenticated user from `/mypage` to `/login`                                      | anonymous     | `/mypage`               | both     | no session                                          | login page is shown                                              | P0       | playwright        | `e2e/auth.spec.ts`             | covered | Protected-route baseline                                                                                                                    |
| E2E-AUTH-003 | Auth   | Login page loads and renders form                                                             | anonymous     | `/login`                | both     | public settings reachable                           | username/password inputs visible                                 | P0       | playwright        | `e2e/auth.spec.ts`             | covered |                                                                                                                                             |
| E2E-AUTH-004 | Auth   | Successful admin login lands in explorer                                                      | admin         | `/login`                | both     | seeded admin exists                                 | browser navigates to `/files...` and explorer UI is visible      | P0       | playwright        | `e2e/core-flow.shared.spec.ts` | removed | Removed in the naming/consolidation refactor — byte-identical to `E2E-EXP-001` (`Explorer loads after login`), which is the canonical owner |
| E2E-AUTH-005 | Auth   | Successful standard-user login lands in user-owned explorer path                              | approved user | `/login`                | both     | seeded approved user exists                         | browser navigates to `/files/<username>` or equivalent home path | P0       | playwright        | `e2e/auth.spec.ts`             | covered | Distinct from admin landing                                                                                                                 |
| E2E-AUTH-006 | Auth   | Invalid credentials show login failure                                                        | anonymous     | `/login`                | both     | invalid password or username                        | visible login error                                              | P0       | playwright        | `e2e/auth.spec.ts`             | covered |                                                                                                                                             |
| E2E-AUTH-007 | Auth   | Pending account login shows warning                                                           | pending user  | `/login`                | both     | pending user fixture available                      | visible pending approval message                                 | P1       | playwright        | `e2e/auth.spec.ts`             | covered | May need deterministic fixture setup                                                                                                        |
| E2E-AUTH-008 | Auth   | Rejected account login shows rejection error                                                  | rejected user | `/login`                | both     | rejected user fixture available                     | visible rejected message                                         | P1       | playwright        | `e2e/auth.spec.ts`             | covered | May need deterministic fixture setup                                                                                                        |
| E2E-AUTH-009 | Auth   | Register page availability follows public settings                                            | anonymous     | `/login` or `/register` | both     | registration enabled/disabled variant               | register affordance is shown or hidden accordingly               | P0       | playwright        | `e2e/auth.spec.ts`             | covered |                                                                                                                                             |
| E2E-AUTH-010 | Auth   | Registration success with pending approval shows success state instead of explorer navigation | anonymous     | `/register`             | both     | registration enabled, pending policy path available | success UI is shown and user stays out of protected explorer     | P0       | playwright        | `e2e/auth.spec.ts`             | covered |                                                                                                                                             |

### Explorer core and CRUD

| ID          | Domain   | Flow                                                        | Role  | Entry route     | Viewport | Preconditions                         | Expected outcome                                                                                                                 | Priority | Recommended layer | Planned spec file               | Status  | Notes                                                                                                                             |
| ----------- | -------- | ----------------------------------------------------------- | ----- | --------------- | -------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------- | ------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| E2E-EXP-001 | Explorer | Explorer loads after login                                  | admin | `/files`        | both     | authenticated session                 | explorer shell and FAB are visible                                                                                               | P0       | playwright        | `e2e/core-flow.shared.spec.ts`  | covered | Canonical owner; absorbs the former `E2E-AUTH-004` landing smoke                                                                  |
| E2E-EXP-002 | Explorer | Direct route entry loads a nested folder path               | admin | `/files/<path>` | both     | target path exists                    | nested folder contents are visible                                                                                               | P0       | playwright        | `e2e/core-flow.shared.spec.ts`  | covered | Direct path entry                                                                                                                 |
| E2E-EXP-003 | Explorer | Breadcrumb navigation changes current folder                | admin | `/files/*`      | both     | at least one nested folder exists     | visible contents update to selected breadcrumb path                                                                              | P0       | playwright        | `e2e/core-flow.shared.spec.ts`  | covered | Breadcrumb chip navigation                                                                                                        |
| E2E-EXP-004 | Explorer | Create folder from FAB                                      | admin | `/files`        | both     | writable current path                 | created folder appears in explorer                                                                                               | P0       | playwright        | `e2e/core-flow.shared.spec.ts`  | covered | Also asserts the created folder never surfaces in `__shared__`                                                                    |
| E2E-EXP-005 | Explorer | Upload file from dialog                                     | admin | `/files`        | both     | writable current path                 | uploaded file appears in explorer                                                                                                | P0       | playwright        | `e2e/core-flow.shared.spec.ts`  | covered |                                                                                                                                   |
| E2E-EXP-006 | Explorer | Rename item from platform-specific actions                  | admin | `/files`        | both     | existing file or folder               | renamed item appears and old item disappears                                                                                     | P0       | playwright        | `e2e/core-flow.shared.spec.ts`  | covered | Runs under both projects via the shared platform interaction seam                                                                 |
| E2E-EXP-007 | Explorer | Delete item from platform-specific actions                  | admin | `/files`        | both     | existing file or folder               | item disappears after confirm                                                                                                    | P0       | playwright        | `e2e/core-flow.shared.spec.ts`  | covered | Folded into `E2E-EXP-006` (the rename test deletes the renamed folder and asserts absence); no separate test ID                   |
| E2E-EXP-008 | Explorer | Open previewable file                                       | admin | `/files`        | both     | previewable file exists               | preview dialog opens                                                                                                             | P0       | playwright        | `e2e/core-flow.shared.spec.ts`  | covered | Preview action and dialog visibility asserted under both projects                                                                 |
| E2E-EXP-009 | Explorer | View mode switch changes visible layout                     | admin | `/files`        | both     | list contains visible items           | list/grid/detail layout changes                                                                                                  | P1       | playwright        | `e2e/core-flow.desktop.spec.ts` | covered | Desktop only today; mobile counterpart not yet implemented                                                                        |
| E2E-EXP-010 | Explorer | Sort mode changes displayed order                           | admin | `/files`        | both     | sortable list with distinct ordering  | visible ordering changes                                                                                                         | P1       | playwright        | `e2e/core-flow.desktop.spec.ts` | covered | Desktop only today; mobile counterpart not yet implemented                                                                        |
| E2E-EXP-011 | Explorer | Search filters current listing                              | admin | `/files`        | both     | list contains multiple distinct names | non-matching items disappear or matching items remain only                                                                       | P1       | playwright        | `e2e/core-flow.desktop.spec.ts` | covered | Desktop only today; mobile counterpart not yet implemented                                                                        |
| E2E-EXP-012 | Explorer | Rename a file keeps its content byte-identical              | admin | `/files`        | both     | uploaded file exists in a folder      | renamed file resolves at the new path, old path is gone, download bytes equal the original fixture                               | P0       | playwright        | `e2e/core-flow.shared.spec.ts`  | covered | Ported from E2E-S3PG-002; single-node rename API + content integrity; backend-agnostic (regression net for WebDAV re-upload sync) |
| E2E-EXP-013 | Explorer | Move a file across folders keeps its content byte-identical | admin | `/files`        | both     | source and destination folders exist  | file resolves at the new path, old path is gone, download bytes equal the original fixture, listing shows it only in destination | P0       | playwright        | `e2e/core-flow.shared.spec.ts`  | covered | Ported from E2E-S3PG-003; single-node move API + content integrity; backend-agnostic                                              |

### Bulk operations and progress

| ID           | Domain | Flow                                                            | Role  | Entry route | Viewport | Preconditions                                           | Expected outcome                                        | Priority | Recommended layer | Planned spec file                                               | Status   | Notes                                                                                                       |
| ------------ | ------ | --------------------------------------------------------------- | ----- | ----------- | -------- | ------------------------------------------------------- | ------------------------------------------------------- | -------- | ----------------- | --------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| E2E-BULK-001 | Bulk   | Enter selection mode and show bulk toolbar                      | admin | `/files`    | both     | list contains selectable items                          | bulk action toolbar becomes visible                     | P0       | playwright        | `e2e/core-flow.shared.spec.ts`                                  | covered  | Selection entry differs by platform (click vs long-press) via the shared seam                               |
| E2E-BULK-002 | Bulk   | Move selected items to another folder                           | admin | `/files`    | both     | at least two items and a valid destination folder exist | items appear in destination and disappear from source   | P0       | playwright        | `e2e/core-flow.shared.spec.ts`                                  | covered  | Wait for the job-backed operation to reach a visible completed state before asserting destination contents. |
| E2E-BULK-003 | Bulk   | Copy selected items to another folder                           | admin | `/files`    | both     | at least one item and a valid destination folder exist  | copied item appears in destination while source remains | P0       | playwright        | `e2e/core-flow.shared.spec.ts`                                  | covered  | Wait for the job-backed operation to reach a visible completed state before asserting destination contents. |
| E2E-BULK-004 | Bulk   | Delete selected items                                           | admin | `/files`    | both     | selected items exist                                    | items disappear after confirm                           | P0       | playwright        | `e2e/core-flow.shared.spec.ts`                                  | covered  |                                                                                                             |
| E2E-BULK-005 | Bulk   | Desktop multi-download is available                             | admin | `/files`    | desktop  | multiple items selected                                 | download action is enabled                              | P0       | playwright        | `e2e/core-flow.desktop.spec.ts`                                 | covered  | Browser download assertion may need minimal smoke only                                                      |
| E2E-BULK-006 | Bulk   | Mobile multi-download is disabled                               | admin | `/files`    | mobile   | multiple items selected                                 | download action is visibly disabled                     | P0       | playwright        | `e2e/core-flow.shared.spec.ts`                                  | covered  | Product rule is client-side; mobile-only skip inside the shared spec                                        |
| E2E-BULK-007 | Bulk   | Conflict resolution dialog appears when move/copy would collide | admin | `/files`    | both     | conflicting destination already exists                  | conflict dialog is shown                                | P0       | playwright        | `e2e/core-flow.shared.spec.ts`                                  | covered  | Selection entry differs by platform; consolidated into the shared suite                                     |
| E2E-BULK-008 | Bulk   | Long-running operation exposes progress UI                      | admin | `/files`    | both     | operation long enough to surface progress               | progress chip or drawer becomes visible                 | P1       | playwright        | `e2e/core-flow.desktop.spec.ts`, `e2e/core-flow.mobile.spec.ts` | planned  | Infra-sensitive                                                                                             |
| E2E-BULK-009 | Bulk   | Cancel bulk operation from progress UI                          | admin | `/files`    | both     | cancellable long-running operation exists               | UI reflects cancelled state                             | P1       | playwright        | `e2e/core-flow.desktop.spec.ts`, `e2e/core-flow.mobile.spec.ts` | deferred | High flake risk compared with API coverage                                                                  |

### Public share and share-link mode

| ID            | Domain | Flow                                                                             | Role                       | Entry route     | Viewport | Preconditions                                                      | Expected outcome                                                                                                 | Priority | Recommended layer | Planned spec file          | Status   | Notes                                                                                                   |
| ------------- | ------ | -------------------------------------------------------------------------------- | -------------------------- | --------------- | -------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------- | ----------------- | -------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| E2E-SHARE-001 | Share  | Invalid or expired share token shows error state                                 | anonymous                  | `/share/:token` | both     | invalid or expired token                                           | share error UI is shown                                                                                          | P0       | playwright        | `e2e/share-public.spec.ts` | covered  | Current implementation behavior should win if docs drift                                                |
| E2E-SHARE-002 | Share  | Directory share loads read-only explorer view                                    | anonymous                  | `/share/:token` | both     | valid directory share link exists                                  | shared explorer renders with restricted actions                                                                  | P0       | playwright        | `e2e/share-public.spec.ts` | covered  |                                                                                                         |
| E2E-SHARE-003 | Share  | Single-file share loads full-screen preview view                                 | anonymous                  | `/share/:token` | both     | valid single-file share link exists                                | single-file preview UI renders                                                                                   | P0       | playwright        | `e2e/share-public.spec.ts` | covered  |                                                                                                         |
| E2E-SHARE-004 | Share  | Anonymous user can open login flow from shared directory                         | anonymous                  | `/share/:token` | both     | valid directory share link exists                                  | login dialog opens                                                                                               | P0       | playwright        | `e2e/share-public.spec.ts` | covered  |                                                                                                         |
| E2E-SHARE-005 | Share  | Logged-in user can add shared content to own permissions                         | approved user              | `/share/:token` | both     | valid directory share link exists, user logged in                  | add-to-my-permissions confirmation flow succeeds                                                                 | P0       | playwright        | `e2e/share-public.spec.ts` | covered  |                                                                                                         |
| E2E-SHARE-006 | Share  | Successful add-to-my-permissions transitions to regular `/files` path            | approved user              | `/share/:token` | both     | add-to-my-permissions succeeds                                     | browser ends in normal explorer route with access                                                                | P0       | playwright        | `e2e/share-public.spec.ts` | covered  |                                                                                                         |
| E2E-SHARE-007 | Share  | Leaving share scope requires confirmation                                        | approved user              | `/share/:token` | both     | user is inside shared directory explorer                           | leave-share confirm appears, then regular explorer opens on confirm                                              | P0       | playwright        | `e2e/share-public.spec.ts` | covered  |                                                                                                         |
| E2E-SHARE-008 | Share  | Share mode hides or disables write actions                                       | anonymous or approved user | `/share/:token` | both     | valid directory share link exists                                  | upload/create/rename/delete/share actions are absent or disabled                                                 | P0       | playwright        | `e2e/share-public.spec.ts` | covered  |                                                                                                         |
| E2E-SHARE-009 | Share  | Shared directory still allows file preview                                       | anonymous or approved user | `/share/:token` | both     | previewable file exists inside shared scope                        | preview dialog opens from shared explorer                                                                        | P1       | playwright        | `e2e/share-public.spec.ts` | covered  |                                                                                                         |
| E2E-SHARE-010 | Share  | Logged-in user opening a single-file share remains in preview/download-only mode | approved user              | `/share/:token` | both     | valid single-file share link exists and user already has a session | single-file view renders preview/download only and does not expose directory-share-only actions                  | P2       | playwright        | `e2e/share-public.spec.ts` | deferred | Candidate guardrail while single-file share intentionally omits login and add-to-my-permissions actions |
| E2E-SHARE-011 | Share  | Single-file share link survives a file rename (nodeId reference, not path)       | anonymous                  | `/share/:token` | both     | valid single-file share link exists on a file that is then renamed | after the rename the share link still renders the preview and serves the (unchanged) content via `X-Share-Token` | P1       | playwright        | `e2e/share-public.spec.ts` | covered  | Ported from E2E-S3PG-007; creates its own file + token (parallel-safe), never reuses shared fixtures    |

### Internal sharing and virtual collections

| ID              | Domain             | Flow                                                                                               | Role          | Entry route                        | Viewport | Preconditions                                                                | Expected outcome                                                                                                                                      | Priority | Recommended layer | Planned spec file               | Status  | Notes                                                                                            |
| --------------- | ------------------ | -------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------- | -------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------- | ------------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| E2E-OVERLAY-001 | Virtual collection | Approved user can enter `__shared__` from the explorer tree                                        | approved user | `/files`                           | both     | non-admin has at least one shared folder or file permission                  | browser navigates into the shared collection and the approved target node renders as a shared entry                                                   | P0       | playwright        | `e2e/share-internal.spec.ts`    | covered | Distinct from public share-link browsing                                                         |
| E2E-OVERLAY-002 | Virtual collection | Approved user can navigate from `__shared__` root into a nested shared folder                      | approved user | `/files/__shared__`                | both     | shared folder permission exists                                              | the shared listing shows the approved target node as the shared entry and selecting it navigates into the shared folder                               | P0       | playwright        | `e2e/share-internal.spec.ts`    | covered | Browser-visible counterpart to shared tree expansion/navigation behavior                         |
| E2E-OVERLAY-003 | Internal share     | Requests access to another user's content from protected UI                                        | approved user | `/files/*`                         | both     | requestable target exists and requester lacks direct permission              | request success UI appears and the request becomes visible in outbox/inbox surfaces                                                                   | P0       | playwright        | `e2e/share-internal.spec.ts`    | covered | Covers request creation, not the full permission matrix                                          |
| E2E-OVERLAY-004 | Internal share     | Owner approves a pending request and requester can open the shared content                         | approved user | `/mypage` then `/files/__shared__` | both     | pending request exists between requester and owner                           | approval UI updates and the approved target node renders as a shared entry under the requester's `__shared__` root, where the requester can browse it | P0       | playwright        | `e2e/share-internal.spec.ts`    | covered | End-to-end request -> approve -> access journey                                                  |
| E2E-OVERLAY-005 | Internal share     | Owner rejects a pending request and requester stays blocked from the target                        | approved user | `/mypage`                          | both     | pending request exists between requester and owner                           | rejection UI updates and requester still lacks usable explorer access                                                                                 | P1       | playwright        | `e2e/share-internal.spec.ts`    | covered | Browser scope is visible blocked access, not server permission internals                         |
| E2E-OVERLAY-006 | Internal share     | Shared target remains read-only when the granted permission is read                                | approved user | `/files/__shared__`                | both     | shared target exists with read-only permission                               | browsing works but write actions are absent or disabled                                                                                               | P0       | playwright        | `e2e/share-internal.spec.ts`    | covered | Visible capability difference only                                                               |
| E2E-OVERLAY-007 | Internal share     | Shared target exposes write-capable actions when the granted permission is write                   | approved user | `/files/__shared__`                | both     | shared target exists with write permission                                   | create/upload/rename/delete affordances are available                                                                                                 | P1       | playwright        | `e2e/share-internal.spec.ts`    | covered | Complements read-only outcome without duplicating ACL matrix                                     |
| E2E-OVERLAY-008 | Virtual collection | Approved user can enter `__recent__` and see recent entries                                        | approved user | `/files`                           | both     | recent entries exist                                                         | browser navigates into the recent collection and the entries render with recent metadata                                                              | P0       | playwright        | `e2e/core-flow.desktop.spec.ts` | covered | Desktop only today; mobile counterpart not yet implemented                                       |
| E2E-OVERLAY-009 | Virtual collection | Recent entry can reopen a previewable item from `__recent__`                                       | approved user | `/files/__recent__`                | both     | recent list contains a previewable file                                      | preview opens from the recent entry without leaving the browser in a broken state                                                                     | P1       | playwright        | `e2e/core-flow.desktop.spec.ts` | planned | Representative preview and recovery smoke                                                        |
| E2E-OVERLAY-010 | Virtual collection | Stale recent entry is removed or recovered with visible UI feedback                                | approved user | `/files/__recent__`                | both     | recent list contains a stale or moved entry                                  | item is cleaned up or rerouted visibly and the list no longer presents a broken stale target                                                          | P1       | playwright        | `e2e/core-flow.desktop.spec.ts` | covered | Desktop only; implements the "removed after its file is deleted" branch                          |
| E2E-OVERLAY-011 | Internal share     | Permission grant reaches content 2 levels below the grant point and the grandchild is downloadable | approved user | `/files/__shared__`                | both     | owner folder tree (parent → child → file) with a READ grant to a second user | requester browses the granted parent, opens the child, and downloads the grandchild file with byte-identical content                                  | P0       | playwright        | `e2e/share-internal.spec.ts`    | covered | Ported from E2E-S3PG-006; closure-table inheritance depth observable only by descending 2 levels |

### MyPage user flows

| ID             | Domain      | Flow                                                                      | Role          | Entry route | Viewport | Preconditions                              | Expected outcome                                                                      | Priority | Recommended layer | Planned spec file         | Status  | Notes                                                                                        |
| -------------- | ----------- | ------------------------------------------------------------------------- | ------------- | ----------- | -------- | ------------------------------------------ | ------------------------------------------------------------------------------------- | -------- | ----------------- | ------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| E2E-MYPAGE-001 | MyPage user | Authenticated user can open MyPage                                        | approved user | `/mypage`   | both     | authenticated session                      | MyPage shell renders                                                                  | P0       | playwright        | `e2e/mypage-user.spec.ts` | covered |                                                                                              |
| E2E-MYPAGE-002 | MyPage user | Close button returns user to file area                                    | approved user | `/mypage`   | both     | authenticated session                      | browser returns to `/files...`                                                        | P0       | playwright        | `e2e/mypage-user.spec.ts` | covered |                                                                                              |
| E2E-MYPAGE-003 | MyPage user | Logout clears session                                                     | approved user | `/mypage`   | both     | authenticated session                      | protected routes redirect back to login                                               | P0       | playwright        | `e2e/mypage-user.spec.ts` | covered |                                                                                              |
| E2E-MYPAGE-004 | MyPage user | Email update succeeds                                                     | approved user | `/mypage`   | both     | authenticated session                      | success UI appears and updated email is reflected                                     | P0       | playwright        | `e2e/mypage-user.spec.ts` | covered | API-based email update due to MUI form submit handler not being reliably triggerable via E2E |
| E2E-MYPAGE-005 | MyPage user | Password change invalidates current session                               | approved user | `/mypage`   | both     | authenticated session                      | user must log in again after password change flow completes                           | P0       | playwright        | `e2e/mypage-user.spec.ts` | covered | API-based password update; verifies session invalidation and re-login via UI                 |
| E2E-MYPAGE-006 | MyPage user | Sharing inbox approve flow works                                          | approved user | `/mypage`   | both     | pending permission request exists in inbox | request status changes and UI updates                                                 | P0       | playwright        | `e2e/mypage-user.spec.ts` | covered | File target uses direct "Approved" button                                                    |
| E2E-MYPAGE-007 | MyPage user | Sharing inbox reject flow works                                           | approved user | `/mypage`   | both     | pending permission request exists in inbox | request status changes and UI updates                                                 | P0       | playwright        | `e2e/mypage-user.spec.ts` | covered |                                                                                              |
| E2E-MYPAGE-008 | MyPage user | Sharing outbox cancel flow works                                          | approved user | `/mypage`   | both     | pending outgoing request exists            | request is removed or status changes to cancelled                                     | P0       | playwright        | `e2e/mypage-user.spec.ts` | covered |                                                                                              |
| E2E-MYPAGE-009 | MyPage user | Share links list supports copy/extend/delete                              | approved user | `/mypage`   | both     | existing share link exists                 | list actions succeed and UI updates                                                   | P0       | playwright        | `e2e/mypage-user.spec.ts` | covered | Clipboard permission grant skipped on mobile/WebKit                                          |
| E2E-MYPAGE-010 | MyPage user | Language selection updates visible UI text                                | approved user | `/mypage`   | both     | authenticated session                      | visible translated UI changes after language switch                                   | P1       | playwright        | `e2e/mypage-user.spec.ts` | planned |                                                                                              |
| E2E-MYPAGE-011 | MyPage user | Mobile menu button opens and closes the category drawer                   | approved user | `/mypage`   | mobile   | authenticated session                      | drawer visibility toggles and current content stays stable until a category is chosen | P1       | playwright        | `e2e/mypage-user.spec.ts` | covered | Browser-visible mobile shell contract                                                        |
| E2E-MYPAGE-012 | MyPage user | Selecting a category from the mobile drawer closes it and updates content | approved user | `/mypage`   | mobile   | authenticated session                      | chosen category content renders and drawer closes                                     | P1       | playwright        | `e2e/mypage-user.spec.ts` | covered | Applies to the prepared user-visible categories for the current role                         |

### MyPage admin flows

| ID            | Domain       | Flow                                                      | Role  | Entry route | Viewport | Preconditions                  | Expected outcome                                                             | Priority | Recommended layer | Planned spec file          | Status  | Notes |
| ------------- | ------------ | --------------------------------------------------------- | ----- | ----------- | -------- | ------------------------------ | ---------------------------------------------------------------------------- | -------- | ----------------- | -------------------------- | ------- | ----- |
| E2E-ADMIN-001 | MyPage admin | `/admin` redirects to admin MyPage category               | admin | `/admin`    | both     | authenticated admin session    | admin-focused MyPage content is shown                                        | P0       | playwright        | `e2e/mypage-admin.spec.ts` | covered |       |
| E2E-ADMIN-002 | MyPage admin | Admin sees user-management and system-settings categories | admin | `/mypage`   | both     | authenticated admin session    | admin categories are visible and sharing category is hidden                  | P0       | playwright        | `e2e/mypage-admin.spec.ts` | covered |       |
| E2E-ADMIN-003 | MyPage admin | Approve pending signup                                    | admin | `/mypage`   | both     | pending user exists            | user moves out of pending state and UI updates                               | P0       | playwright        | `e2e/mypage-admin.spec.ts` | covered |       |
| E2E-ADMIN-004 | MyPage admin | Reject pending signup                                     | admin | `/mypage`   | both     | pending user exists            | user is rejected and UI updates                                              | P0       | playwright        | `e2e/mypage-admin.spec.ts` | covered |       |
| E2E-ADMIN-005 | MyPage admin | Create user from admin UI                                 | admin | `/mypage`   | both     | authenticated admin session    | new user appears in admin user list                                          | P0       | playwright        | `e2e/mypage-admin.spec.ts` | covered |       |
| E2E-ADMIN-006 | MyPage admin | Delete standard user from admin UI                        | admin | `/mypage`   | both     | deletable standard user exists | user disappears from admin list                                              | P0       | playwright        | `e2e/mypage-admin.spec.ts` | covered |       |
| E2E-ADMIN-007 | MyPage admin | Toggle registration-related settings                      | admin | `/mypage`   | both     | authenticated admin session    | settings save succeeds and the next public auth visit reflects the new state | P0       | playwright        | `e2e/mypage-admin.spec.ts` | covered |       |
| E2E-ADMIN-008 | MyPage admin | Cleanup actions show confirmation and completion feedback | admin | `/mypage`   | both     | authenticated admin session    | cleanup flow completes with visible result                                   | P1       | playwright        | `e2e/mypage-admin.spec.ts` | covered |       |

### First-run setup wizard

| ID            | Domain       | Flow                                                             | Role      | Entry route | Viewport | Preconditions                                                            | Expected outcome                                                                                                                                                                                          | Priority | Recommended layer | Planned spec file          | Status  | Notes                                                                                      |
| ------------- | ------------ | ---------------------------------------------------------------- | --------- | ----------- | -------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------- | -------------------------- | ------- | ------------------------------------------------------------------------------------------ |
| E2E-SETUP-001 | Setup wizard | First-run sqlite+webdav configure-and-restart                    | anonymous | `/setup`    | both     | no `.env`, scratch instance on `:5003`                                   | wizard writes the scratch `.env`; after restart login with the wizard-chosen admin works, upload/download round-trip succeeds, and `/setup` redirects to `/login`                                         | P0       | playwright        | `e2e/setup-wizard.spec.ts` | covered | Case 1; both modes (webdav container always-up)                                            |
| E2E-SETUP-002 | Setup wizard | First-run sqlite+s3 configure-and-restart writes `S3_*` keys     | anonymous | `/setup`    | both     | no `.env`, scratch instance on `:5003`, MinIO `:9010`                    | scratch `.env` contains the expected `S3_*`/`AWS_*` keys; restart lands in a configured app                                                                                                               | P0       | playwright        | `e2e/setup-wizard.spec.ts` | covered | Case 2; s3 mode only (`test.skip` pattern)                                                 |
| E2E-SETUP-003 | Setup wizard | First-run postgresql+webdav seeds scratch PG, not scratch sqlite | anonymous | `/setup`    | both     | no `.env`, scratch instance on `:5003`, scratch PG DB `webdav_e2e_setup` | after restart `_schema_migrations` + users exist in the scratch PG DB; the scratch sqlite file holds only the boot-time default admin (the wizard's postgresql apply never seeds/updates users in sqlite) | P0       | playwright        | `e2e/setup-wizard.spec.ts` | covered | Case 3; both modes                                                                         |
| E2E-SETUP-004 | Setup wizard | Complete-state gate locks wizard and admin writes                | anonymous | `/setup`    | both     | completed setup (post-restart)                                           | `POST /api/setup/apply` → 403; `/setup` redirects to `/login`; file APIs work                                                                                                                             | P0       | playwright        | `e2e/setup-wizard.spec.ts` | covered | Case 4 (security); both modes                                                              |
| E2E-SETUP-005 | Setup infra  | Reset shared DB per dependent project for data isolation         | system    | n/a         | both     | shared E2E DB has accumulated state across projects                      | TRUNCATE app tables (preserving `_schema_migrations`) + re-seed admin/base users + home roots; runs once per dependent project via `dependencies`                                                         | P0       | playwright        | `00-project-setup.spec.ts` | covered | Infrastructure spec; runs from `${backendMode}-{desktop,mobile}-setup` dependency projects |

### Migration mode (hermetic)

| ID          | Domain    | Flow                                                                             | Status  | Planned spec file       | Notes                                                                      |
| ----------- | --------- | -------------------------------------------------------------------------------- | ------- | ----------------------- | -------------------------------------------------------------------------- |
| E2E-MIG-001 | Migration | Flow A: blob dry-run then apply happy path                                       | covered | `e2e/migration.spec.ts` | hermetic `migration-desktop`/`migration-mobile` projects (scratch `:5003`) |
| E2E-MIG-002 | Migration | Flow B: blob cancel mid-copy, resume via shouldSkip, no duplicate blobs          | covered | `e2e/migration.spec.ts` |                                                                            |
| E2E-MIG-003 | Migration | Flow C: gate hold — app-guard redirect, `/login` allow-list, 409 on second start | covered | `e2e/migration.spec.ts` |                                                                            |
| E2E-MIG-004 | Migration | Flow D-1: metadata scan → empty target → seeded target wipe alert                | covered | `e2e/migration.spec.ts` |                                                                            |
| E2E-MIG-005 | Migration | Flow D-2: metadata complete → env-cutover guidance → target rows/ids             | covered | `e2e/migration.spec.ts` |                                                                            |
| E2E-MIG-006 | Migration | A5: env-sourced blob destination → completed modal shows manual `.env` guidance  | covered | `e2e/migration.spec.ts` |                                                                            |
| E2E-MIG-007 | Migration | B5: metadata cancel → job cancelled, gate cleared, target rolled back            | covered | `e2e/migration.spec.ts` |                                                                            |
| E2E-MIG-008 | Migration | E3: native webdav file (no `object_map`) snapshotted + migrated; rerun skipped   | covered | `e2e/migration.spec.ts` |                                                                            |

### Admin config editor (hermetic)

| ID               | Domain       | Flow                                                                                  | Status  | Planned spec file          | Notes                                                                            |
| ---------------- | ------------ | ------------------------------------------------------------------------------------- | ------- | -------------------------- | -------------------------------------------------------------------------------- |
| E2E-ADMINCFG-001 | Admin config | Field state matrix: source/tier drives enabled/disabled per row                       | covered | `e2e/admin-config.spec.ts` | hermetic `admin-config-desktop`/`admin-config-mobile` projects (scratch `:5003`) |
| E2E-ADMINCFG-002 | Admin config | Save feedback: T2 applied immediately, T1 flagged restart required                    | covered | `e2e/admin-config.spec.ts` |                                                                                  |
| E2E-ADMINCFG-003 | Admin config | `key_lost_warning` surfaces when the master key is missing                            | covered | `e2e/admin-config.spec.ts` |                                                                                  |
| E2E-ADMINCFG-004 | Admin config | Secret lifecycle: masked, unchanged kept, blank kept, new stored encrypted            | covered | `e2e/admin-config.spec.ts` |                                                                                  |
| E2E-ADMINCFG-005 | Admin config | T1 change persists across a server restart (source db)                                | covered | `e2e/admin-config.spec.ts` |                                                                                  |
| E2E-ADMINCFG-006 | Admin config | Connection-key gating: editing `WEBDAV_URL` blocks Save; failed test keeps it blocked | covered | `e2e/admin-config.spec.ts` |                                                                                  |
| E2E-ADMINCFG-007 | Admin config | Connection-key gating: passing test enables Save, editing invalidates                 | covered | `e2e/admin-config.spec.ts` |                                                                                  |
| E2E-ADMINCFG-008 | Admin config | Non-connection keys save without requiring a connection test                          | covered | `e2e/admin-config.spec.ts` |                                                                                  |
| E2E-ADMINCFG-009 | Admin config | T0 metadata group is absent from Advanced settings (D5)                               | covered | `e2e/admin-config.spec.ts` |                                                                                  |
| E2E-ADMINCFG-010 | Admin config | System Settings backend-health card lists only failing backends                       | covered | `e2e/admin-config.spec.ts` |                                                                                  |
| E2E-ADMINCFG-011 | Admin config | No backend-health card when nothing is failing                                        | covered | `e2e/admin-config.spec.ts` |                                                                                  |
| E2E-ADMINCFG-012 | Admin config | File screen shows admin backend-health banner when a backend fails                    | covered | `e2e/admin-config.spec.ts` |                                                                                  |

### S3+PostgreSQL new-architecture integration

Coverage relocated in refactor branch `refactor/s3pg-e2e-consolidation`: the standalone S3-mode-only
e2e suite `e2e/s3-pg-integration.spec.ts` was removed. User-observable flows moved to webdav-capable
e2e specs (`E2E-EXP-012`, `E2E-EXP-013`, `E2E-OVERLAY-011`, `E2E-SHARE-011` — see their inventory
rows), and S3-storage-internal behavior (copy-on-write, delete→GC, untracked-blob reconciliation,
DB/blob agreement) moved to server integration tests:
`server/domains/files/routes/__tests__/files.integration.test.js` and
`server/domains/admin/routes/__tests__/admin.test.js`. The previously required
`GC_ORPHAN_TTL_DAYS=0.00002` tuning in `.env.e2e` is no longer needed by the e2e suite.

| ID           | Domain | Flow                                                                                     | Status  | New home                                       |
| ------------ | ------ | ---------------------------------------------------------------------------------------- | ------- | ---------------------------------------------- |
| E2E-S3PG-001 | S3+PG  | Upload → list → download → downloaded content equals original                            | removed | fully redundant: E2E-EXP-005 + E2E-SETUP-001   |
| E2E-S3PG-002 | S3+PG  | Rename keeps content (DB-only, no blob copy)                                             | removed | E2E-EXP-012 (e2e, both modes)                  |
| E2E-S3PG-003 | S3+PG  | Move file across folders keeps content                                                   | removed | E2E-EXP-013 (e2e, both modes)                  |
| E2E-S3PG-004 | S3+PG  | Copy-on-write: copy shares blob; overwrite copy leaves original unchanged                | removed | server integration (files.integration.test.js) |
| E2E-S3PG-005 | S3+PG  | Delete → orphaned blob → GC cleans it while active blobs survive                         | removed | server integration (admin.test.js S3 mode)     |
| E2E-S3PG-006 | S3+PG  | Permission inheritance: grant folder read → child/grandchild accessible via `__shared__` | removed | E2E-OVERLAY-011 (e2e, both modes)              |
| E2E-S3PG-007 | S3+PG  | Share link survives file rename (nodeId reference, not path)                             | removed | E2E-SHARE-011 (e2e, both modes)                |
| E2E-S3PG-008 | S3+PG  | S3 bucket reconciliation: untracked blob deleted by GC                                   | removed | server integration (files.integration.test.js) |
| E2E-S3PG-009 | S3+PG  | DB/blob agreement: delete removes node + DB rows while physical blob stays (lazy)        | removed | server integration (files.integration.test.js) |

### Desktop core-flow interactions

| ID              | Domain           | Flow                                                                                     | Role                   | Entry route | Viewport | Preconditions                                                | Expected outcome                                                                                                            | Priority | Recommended layer | Planned spec file               | Status   | Notes                                                                         |
| --------------- | ---------------- | ---------------------------------------------------------------------------------------- | ---------------------- | ----------- | -------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------- | ------------------------------- | -------- | ----------------------------------------------------------------------------- |
| E2E-DESKTOP-001 | Desktop explorer | Double-click opens folder or preview                                                     | admin                  | `/files`    | desktop  | visible item exists                                          | double-click opens target instead of only selecting it                                                                      | P1       | playwright        | `e2e/core-flow.desktop.spec.ts` | covered  |                                                                               |
| E2E-DESKTOP-002 | Desktop explorer | Ctrl/Meta-click toggles multi-selection                                                  | admin                  | `/files`    | desktop  | at least two items exist                                     | selection set updates as expected                                                                                           | P1       | playwright        | `e2e/core-flow.desktop.spec.ts` | covered  |                                                                               |
| E2E-DESKTOP-003 | Desktop explorer | Shift-click performs range selection                                                     | admin                  | `/files`    | desktop  | at least three items exist                                   | contiguous visible selection range is created                                                                               | P1       | playwright        | `e2e/core-flow.desktop.spec.ts` | covered  |                                                                               |
| E2E-DESKTOP-004 | Desktop explorer | Clicking empty area exits selection mode                                                 | admin                  | `/files`    | desktop  | selection mode active                                        | selection mode is cleared                                                                                                   | P1       | playwright        | `e2e/core-flow.desktop.spec.ts` | covered  |                                                                               |
| E2E-DESKTOP-005 | Desktop explorer | Context menu opens per-item actions                                                      | admin                  | `/files`    | desktop  | item exists                                                  | desktop context menu is visible and actionable                                                                              | P1       | playwright        | `e2e/core-flow.desktop.spec.ts` | covered  |                                                                               |
| E2E-DESKTOP-006 | Desktop explorer | External drag-and-drop upload works                                                      | admin                  | `/files`    | desktop  | writable path and local fixture file                         | dropped file appears in explorer                                                                                            | P2       | playwright        | `e2e/core-flow.desktop.spec.ts` | deferred | More fragile than dialog upload                                               |
| E2E-DESKTOP-007 | Desktop explorer | Internal drag-and-drop move works                                                        | admin                  | `/files`    | desktop  | movable item and valid destination exist                     | moved item appears at destination                                                                                           | P2       | playwright        | `e2e/core-flow.desktop.spec.ts` | deferred | More fragile than picker-based move                                           |
| E2E-DESKTOP-008 | Desktop explorer | Dragging onto a no-write target shows denied/no-drop feedback and leaves items unchanged | approved user          | `/files`    | desktop  | draggable source and visible target without write permission | target is not highlighted as droppable, no successful drop state appears, and denial feedback is shown if drop is attempted | P2       | playwright        | `e2e/core-flow.desktop.spec.ts` | deferred | Candidate browser smoke only; full permission matrix stays outside Playwright |
| E2E-DESKTOP-009 | Desktop explorer | Dragging onto the same parent or same path behaves as a no-op                            | admin or approved user | `/files`    | desktop  | draggable source and a visible no-op target                  | no drop overlay or action occurs and the listing remains unchanged                                                          | P2       | playwright        | `e2e/core-flow.desktop.spec.ts` | deferred | Candidate UX guardrail for no-op handling                                     |

### Mobile core-flow interactions

| ID             | Domain          | Flow                                                   | Role  | Entry route | Viewport | Preconditions                                    | Expected outcome                                    | Priority | Recommended layer | Planned spec file              | Status   | Notes                            |
| -------------- | --------------- | ------------------------------------------------------ | ----- | ----------- | -------- | ------------------------------------------------ | --------------------------------------------------- | -------- | ----------------- | ------------------------------ | -------- | -------------------------------- |
| E2E-MOBILE-001 | Mobile explorer | Long-press enters selection mode                       | admin | `/files`    | mobile   | visible item exists                              | selection mode starts and item is selected          | P1       | playwright        | `e2e/core-flow.mobile.spec.ts` | covered  |                                  |
| E2E-MOBILE-002 | Mobile explorer | Action sheet opens from more button                    | admin | `/files`    | mobile   | visible item exists                              | mobile action sheet is visible                      | P1       | playwright        | `e2e/core-flow.mobile.spec.ts` | covered  |                                  |
| E2E-MOBILE-003 | Mobile explorer | Breadcrumb toggle opens and closes folder tree section | admin | `/files`    | mobile   | authenticated session                            | folder tree collapse opens and closes               | P1       | playwright        | `e2e/core-flow.mobile.spec.ts` | covered  |                                  |
| E2E-MOBILE-004 | Mobile explorer | Pull-to-refresh reloads current folder                 | admin | `/files`    | mobile   | refreshable list and enough vertical scroll area | refresh indicator appears and list reload completes | P2       | playwright        | `e2e/core-flow.mobile.spec.ts` | deferred | Gesture sensitivity may be flaky |

### User-facing negative or boundary flows

| ID          | Domain   | Flow                                                       | Role               | Entry route         | Viewport | Preconditions                                         | Expected outcome                        | Priority | Recommended layer | Planned spec file                                     | Status  | Notes                                                             |
| ----------- | -------- | ---------------------------------------------------------- | ------------------ | ------------------- | -------- | ----------------------------------------------------- | --------------------------------------- | -------- | ----------------- | ----------------------------------------------------- | ------- | ----------------------------------------------------------------- |
| E2E-NEG-001 | Negative | Read-only or forbidden actions surface user-visible denial | approved user      | `/files`            | both     | user can reach a read-only target                     | UI blocks or reports denied action      | P1       | playwright        | `e2e/share-public.spec.ts` or dedicated negative spec | planned | Keep browser scope limited to visible denial, not full ACL matrix |
| E2E-NEG-003 | Negative | Full direct read/direct write permission matrix            | multiple           | API-level scenarios | both     | controlled ACL fixtures                               | all allow/deny branches match contract  | P2       | supertest         | none                                                  | non-e2e | Too broad for browser E2E                                         |
| E2E-NEG-004 | Negative | Login rate-limit branches and `Retry-After` behavior       | anonymous          | `/login`            | both     | deterministic repeated failed attempts                | rate-limit contract is correct          | P2       | supertest         | none                                                  | non-e2e | Browser E2E adds little value over route integration              |
| E2E-NEG-005 | Negative | Token refresh retry-once behavior                          | authenticated user | protected routes    | both     | expiring access token and refresh token orchestration | session retry behavior matches contract | P2       | rtl-msw           | none                                                  | non-e2e | Better isolated in client integration tests                       |

## Rollout Order

Use the following staged order when expanding browser coverage:

1. `P0` auth and protected-route baseline
2. `P0` desktop and mobile explorer CRUD beyond the current smoke tests
3. `P0` bulk move/copy/delete and mobile download restriction
4. `P0` public share success/error flows
5. `P0` internal sharing lifecycle and approved-user `__shared__` access
6. `P0` `__recent__` entry flows plus remaining MyPage user account/sharing coverage
7. `P0` MyPage admin flows
8. `P1` advanced desktop/mobile interactions, including MyPage mobile drawer coverage
9. `P2` infra-sensitive gestures, denied/no-op drag-and-drop smoke, and deferred single-file logged-in share guardrails

### Essential vs. full runs (`E2E_CORE`)

The full E2E suite (default `npm run test:e2e`) runs every spec. For quick feedback when
modifying **core file-exploration features**, run the essential subset with
`npm run test:e2e:core` (`E2E_CORE=1`):

- **Essential (still runs with `E2E_CORE=1`):** the core user-facing file-management flows —
  `auth`, `core-flow.shared`, `core-flow.desktop`, `core-flow.mobile`, `share-public`,
  `share-internal`, `mypage-user` (both backend modes). These cover auth/login, explorer CRUD,
  navigation, selection, view/sort/search, `__recent__`, bulk ops, public/internal sharing, and
  account/sharing management.
- **Non-essential (skipped with `E2E_CORE=1`):** features that change independently of the core
  file-exploration flows — `mypage-admin` (admin user management/settings) and the hermetic
  projects (`setup-wizard`, `admin-config`, `migration`).

`00-project-setup.spec.ts` (per-project DB isolation) is infrastructure and always runs.
Mode variants: `npm run test:e2e:core:s3` / `npm run test:e2e:core:webdav`.

Practical rule:

- Core-feature change → `npm run test:e2e:core:webdav` + `npm run test:e2e:core:s3`.
- Anything touching admin/config/migration tooling, or before merging → full
  `npm run test:e2e:webdav` / `npm run test:e2e:s3`.

## Out of Scope for Playwright-First Coverage

Track these areas in lower-level tests even if they appear in the inventory above as `non-e2e`:

- full ACL allow/deny matrix
- login rate-limiting headers and counters
- access-token refresh retry semantics
- upload `overwrite` and `skip` branch matrix
- batch worker partial-success internals
- ZIP progress response details and skip summaries
- video preview ticket expiry behavior
- thumbnail token/signing behavior
- ACL inheritance and non-inheritance matrices beyond representative visible denial or capability smoke
- recent-files API synchronization details
- low-level drag gesture/cursor permutations beyond representative denied/no-op smoke coverage
- maintenance and cleanup endpoint result shapes beyond user-facing smoke coverage

## Known Planning Notes

- Share-link expiry semantics have drifted across docs in the past. Plan browser assertions around the visible expired/not-found UI state rather than baking in an inconsistent intermediate assumption.
- Some permission-management behaviors are better defined by implementation and route specs than by older feature prose. Where those drift, use the current route behavior for test planning and update docs alongside implementation work.
- The first implementation wave should prefer deterministic dialogs and navigation outcomes over timing-sensitive gestures.

## Maintenance Rules

- Update this document whenever product behavior adds, removes, or re-scopes a browser-visible flow.
- When adding a new flow, assign a stable `ID`, `Priority`, `Recommended layer`, and `Planned spec file`.
- If a planned flow is intentionally postponed, move it to `deferred` and record the reason in `Notes`.
- Do not use this document as a duplicate feature spec. Keep detailed behavior in feature/spec docs and keep this file focused on planning and coverage ownership.
- When a new feature introduces selector policy or platform-specific interaction rules that are meaningful at the feature boundary, add those rules to the owning `docs/features/*.md` file and keep this document as the canonical inventory/ownership source.
