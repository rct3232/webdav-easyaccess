# Testing Strategy

This document describes **what** to test and **how** to test it: unit vs integration, mocking approach, cross-cutting defect classes, and a checklist for new code. For how to run tests, what to commit, and CI, see [TEST_GIT_GUIDE.md](TEST_GIT_GUIDE.md).

---

## Unit vs Integration

### Unit tests

- **Scope:** Single modules in isolation: utils, hooks, middleware, store/service functions.
- **Dependencies:** Mock external dependencies (API calls, WebDAV, file system, other modules) so the test only exercises the unit.
- **Examples:** `pathUtils`, `validation`, `useAuth`, `requireUser` middleware, `errorHandler` formatting, permission helpers.

### Integration tests

- **Server:** API routes with Supertest. Request a full URL path; the real route handler and middleware run. Backing services (WebDAV, stores) are typically mocked or use test doubles so tests don’t hit real infrastructure.
- **Client:** User flows with React Testing Library. API is mocked with MSW so no real server is needed. Verify that the UI behaves correctly for given API responses (e.g. login, file list, error states).

Current layout is summarized in [client/TEST_SUMMARY.md](../client/TEST_SUMMARY.md) and [server/TEST_SUMMARY.md](../server/TEST_SUMMARY.md).

---

## Mocking

### Schema-first principle

- **Use only schema-derived or validated mocks:** Mocks (including MSW handlers) must be validated against the defined contract (e.g. `docs/api.md`, `docs/shared-contracts.md`). Hand-written mocks that diverge from the contract lead to false confidence. When the contract changes, update mocks accordingly.
- **Mock–adapter parity:** When a shared adapter contract exists (e.g. `docs/spec/server/store/blobstore.md`), the adapter's own tests and the consuming service's mock must be written against that same contract. A mock that ignores an argument the real adapter honors is a test gap, not just a code smell — on a contract change, update both sides together so they cannot silently diverge.

### Mock management policy (required)

- **Prefer the smallest stable seam:** Mock at the lowest layer that keeps tests deterministic.
- **Avoid logic-heavy mocks:** Mock factories should primarily return fixed values and simple `jest.fn()` stubs. Avoid re-implementing production branching inside mocks.
- **Use shared factories for repeated dependencies:** When the same mock shape appears in 3+ files, move it to a shared factory/helper.
- **Reset policy:** Use `jest.clearAllMocks()` in `beforeEach` by default. Use `jest.resetAllMocks()` only when previous mock implementations must be fully reset. Use `jest.restoreAllMocks()` when spies on real methods are used.
- **Document decisions in the RCA log:** If a mocking approach causes regressions or infra incompatibility, record the RCA in `docs/RCA_LOG.md` and update this strategy/spec docs before broad migration.

### Adapter mock contract fidelity

- **Mocks must enforce the documented argument contract:** When an adapter method's contract defines a typed or thresholded parameter (e.g. `listOrphanedKeys(olderThan: Date)`), the mock must not accept arguments unconditionally. Apply the same semantics as the real adapter — filter, validate, or throw on a wrong-type argument — so a call-site violation (wrong type, wrong unit) fails the test instead of passing silently.
- **Judgment call vs. logic-heavy mocks:** If the adapter contract's essence is a filter/threshold, the mock should mirror it minimally (this is contract fidelity, not speculative logic). For fixed-value adapters, keep the mock logic-free and rely on argument-type assertions instead.
- **If implementing the semantics is too heavy:** Assert on the received argument's type/shape in the test body (see "Mock inspection is limited": argument assertions are the behavior under test when they pin the adapter contract).

### Service→adapter contract-conformance tests

- **Pin the argument type/units a service passes to each adapter method:** Add one test per seam asserting the exact argument shape (e.g. "`listOrphanedKeys` is called with a `Date` cutoff derived from the TTL days"). This catches unit/type mismatches (days vs `Date`, ms vs s, numeric vs string ids) that outcome-only tests miss. Adapter mock must honor the same contract (previous subsection) so wrong-argument calls fail loudly.

### Client

- **MSW (Mock Service Worker):** API calls are mocked via handlers in `client/src/mocks/` for integration-style component/page tests. Keep handlers in sync with [api.md](api.md) and [shared-contracts.md](shared-contracts.md).
- **Service/unit tests:** For isolated service or adapter behavior, module-level mocks (`jest.mock`) are allowed and often preferred.
- **Known guardrails from RCA:** In this repository, avoid broad MSW migration for cases already recorded in `docs/IMPROVEMENT_PLAN.md` (for example, Node/Jest compatibility around axios response propagation and `request.formData()` parsing in jsdom).
- **Jest polyfill guardrail:** In jsdom + undici tests, expose only the minimum globals required for stable runtime. Do not instantiate `new MessageChannel()` only to infer constructor types, and avoid unnecessary global `MessageChannel` wiring when `MessagePort` alone is sufficient. These patterns can leave open `MESSAGEPORT` handles and block graceful Jest worker shutdown. If a temporary channel fallback is unavoidable, close/unref both ports immediately.
- **Blob `.stream()` polyfill:** jsdom's `Blob` does not implement `.stream()`, but undici's `Response` (used by MSW) requires it. In `client/src/jest-polyfills.js`, polyfill `Blob.prototype.stream` (FileReader-based). Note: a slow retry backoff once masked a `TypeError: object.stream is not a function` in bulk-download tests — making failures fast exposes latent environment gaps, so keep polyfills complete even when tests appear to pass.
- **Unhandled MSW request policy:** `onUnhandledRequest: 'warn'` leaves unhandled requests to fail as network errors, which then feed the client retry logic and can cost ~7s of real backoff time per test. Keep MSW handlers in sync with the contract (`api.md`, `shared-contracts.md`) so no request falls through, and prefer explicit fallback handlers over silent network errors.
- **Avoid real-time waits in tests:** Do not rely on real retry backoff or sleep delays inside tests. Provide an injectable delay seam (e.g. `httpClient.js` exports `__setRetryConfigForTests({ retryDelay: 0 })`, wired in `setupTests.js`) that keeps the attempt/retry count but eliminates the 1s→2s→4s wait. This reduced the `apiClient` suite from ~45s to ~1.3s.
- **React 18 act environment:** The shared Jest setup should declare `globalThis.IS_REACT_ACT_ENVIRONMENT = true` so React can treat RTL/jsdom runs as act-aware. If warnings remain after that, fix the specific test seam or missing async flush rather than suppressing console output.
- **React 18 async update guardrail:** When a hook or page triggers async effects immediately after render, do not rely on instantly resolved mocks plus ad-hoc microtask flushing. Prefer controlling completion explicitly with deferred promises or equivalent test-owned async seams, then wait for the user-visible completion state (`findBy*`, `waitFor`, `waitForElementToBeRemoved`) before asserting. This keeps React updates inside act-aware boundaries.
- **Avoid unrelated async noise in page tests:** If a page scenario is not verifying sidebar/tree/FAB chrome, replace those shell-only async seams with lighter doubles so page tests do not inherit extra `act(...)` warnings from unrelated subscriptions or background loads.
- **Auth-gated page guardrail:** For pages that return `null` until auth context resolves (for example `MyPage`), do not perform immediate `getBy*` queries after `render`. First wait for a stable post-auth UI anchor (`findByRole` or `waitFor`), then interact/assert.
- **Decision rule:**
  - Component/page user flow tests -> prefer MSW
  - Service/hook/util unit tests -> prefer module mocks
  - Mixed tests -> use hybrid approach (UI/router/i18n module mocks + API via MSW only where stable)

### Server

- **WebDAV and stores:** Use test utilities and mocks so route tests don’t depend on a real WebDAV server or real metadata files. Mock or stub the WebDAV client and store modules where appropriate.
- **Auth:** Use test helpers (e.g. create a test user, issue a JWT) so routes can be called with a valid `Authorization` header without going through the real login flow.
- **Route mock reuse:** Prefer shared server mock factories (for example, WebDAV and email) over repeated in-file mock object literals.
- **Override pattern:** Use `createXMock(overrides)` and only override behavior required by each scenario.
- **Disable bulk workers:** Set `process.env.WEA_SKIP_BULK_WORKER = '1'` in `server/test-setup.js` so the `setImmediate` batch worker never schedules during tests. Tests assert the batch API contract (202 + jobId) rather than worker completion, so skipping the worker avoids open handles and teardown stalls.
- **Timer hygiene:** Unref non-essential timers that would otherwise hold the event loop open during tests (e.g. the 5-minute download-progress cleanup timer in `operationProgress.js` uses `.unref()`). This prevents Jest's "worker failed to exit gracefully / force exited" stall. Use `--detectOpenHandles` to confirm the leak source before editing.
- **Console output policy:** In `server/test-setup.js`, silence `console.log` (`jest.spyOn(console, 'log').mockImplementation(() => {})`) to suppress per-request `requestLogger` noise, but preserve `console.warn` and `console.error` so tests that assert on deprecation warnings (e.g. `storage.test.js`) keep working. Tests that assert on `console.log` output must re-spy the implementation themselves (see `requestLogger.test.js`). Keep `verbose: false` in `jest.config.js` to reduce printed test-name overhead.

### Blob migration testing policy

The blob-migration feature (bidirectional WebDAV ↔ S3; spec: `docs/spec/server/tools/blob-migration.md`) is enforced by injection and a local network guard — real environments are never touched. Integrity is enforced by code, not convention.

- **Injection only:** `migrationService` takes `srcBlobStore` and `buildDestBlobStore` as injected deps. Tests inject `createFakeBlobStore()` (`server/testing/mocks/fakeBlobStore.js`) and a fake `buildDestBlobStore`; real adapters (`WebdavBlobStore`/`S3BlobStore`) are never constructed inside tests. Assert via `jest.spyOn` on their constructors where feasible.
- **Fake BlobStore contract:** `createFakeBlobStore()` is an in-memory store with REAL behavior (`uploadBlob`, `downloadBlob`, `deleteBlob`, `headBlob`, `createDirectory`/`ensureDirectoryExists`, `listKeys`). It supports failure injection (`failOn(key)`, `failNextN(n)`) and records writes (`writtenKeys()`/`writtenPaths()`, `count()`) for "only destination written", "no duplicate copy", and dry-run no-write assertions. This is contract fidelity (a real adapter mock honoring `docs/spec/server/store/blobstore.md`), not speculative logic.
- **Temp sqlite only:** tests run against temp sqlite via `createTestDatabase()` (`WEA_STORAGE_BACKEND=sqlite`). No real PG host, no network.
- **CLI tests are in-process:** call the exported `runMigrationCli(argv, { migrationService: fake, output })` directly — no subprocess, no network. Cover usage errors, the `--yes`/`--apply` gate, `--check-env`, dry-run-first, and dest config from flags + env.
- **Network guard:** migration test suites stub `net.Socket.connect` and `http.request` to throw, so any accidental socket attempt FAILS the test. Combined with CI lacking real credentials (`.env` gitignored), this is defense in depth.
- **Never use real WebDAV/S3/PG** in migration tests; the migration admin route tests assert the 202 + poll + cancel contract with the worker disabled (`WEA_SKIP_MIGRATION_WORKER`).

### Recommended factory pattern

```javascript
// Shared test helper
function createExampleMock(overrides = {}) {
  return {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}
```

- Keep defaults deterministic.
- Keep per-test setup explicit in `beforeEach` or test body.
- Do not hide assertions in helper internals.

---

## Black-box testing principle

- **Verify What, not How:** Assert on observable outcomes (public inputs and outputs, side effects visible to callers), not implementation details.
- **No access to internals:** Do not reach into internal variables, private methods, or module internals. Test only the public API.
- **Mock inspection is limited:** Asserting on mock call counts or arguments is allowed only when the interaction itself is the behavior under test (e.g. "service X was called with param Y"). Prefer verifying the final result or observable state instead.

---

## Cross-cutting defect classes & semantics-first testing

Some defects do not live inside a single function or component; they live in the
**relationship between data, derived collections, and lifecycle state**. The
ACL architecture (closure-table inheritance, structural ownership, normalized
permission tables, share tokens, virtual collections) makes several cross-cutting
defect classes possible. Presence-based happy-path tests systematically miss
them: a defect usually _adds_ or _keeps_ the wrong item instead of removing the
expected one. Treat this section as the governing policy for that class of bugs.

### 1. Defect classes

| #   | Class               | Question it answers                                            | Primary layer                    | Representative example                                                                                       |
| --- | ------------------- | -------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A   | Derived visibility  | What is included / excluded from a listing?                    | Server route integration         | `__shared__` / shared tree contains exactly the nodes granted by others — never the user's own subtree       |
| B   | Authorization (ACL) | Does the grantee get exactly read/write/admin?                 | Server route integration + store | File-specific grant overrides inherited directory grant; revoke removes access immediately                   |
| C   | Reference stability | Do nodeId references survive move/rename/delete?               | Server route integration + store | After a move, the closure table is rebuilt and permission inheritance follows the new parent                 |
| D   | Storage consistency | Do DB nodes and blobs agree?                                   | Server integration + S3+PG infra | Copy shares a blob; overwriting the copy leaves the original intact; orphaned blobs are GC'd                 |
| E   | State transitions   | Are lifecycle transitions atomic and terminal-state-enforcing? | Server route integration         | Approving grants the requested permission; an already-cancelled request cannot be approved again             |
| F   | Freshness / cache   | Do cache, ETag, and existence index stay fresh?                | Server integration + client unit | A grant is visible within cache TTL; a revoke is reflected immediately; `If-None-Match` gets a correct `304` |
| G   | Security surfaces   | Can tokens / IDOR / path traversal leak?                       | Server route integration         | Expired/invalid share token blocks download; share-token scope traversal is denied                           |
| H   | Cleanup / migration | Are cascades and reconciliations complete?                     | Server route integration + store | Deleting a user removes permission/share/recent rows while the home-root ADMIN anchor is preserved           |

### 2. Common principles

Apply to every class above:

1. **Pin semantics at the authoritative boundary.** The server response and the
   DB are the source of truth. Encode each invariant as a route-integration
   (Supertest) assertion; client unit tests and E2E are regression smoke, not the
   primary guard.
2. **Presence assertions never catch absence bugs.** Verify a listing with an
   exact-set assertion: expected items present, unexpected items absent, correct
   count, no duplicates.
3. **Recreate the failure precondition.** Fresh E2E users hide accumulation and
   state defects. When a defect requires a precondition (own folders created, a
   request approved, a share expired), inject that precondition explicitly in the
   scenario.
4. **Distinguish identities.** Ownership ≠ grantee ≠ requester. Whenever a
   listing or permission check conflates them, the test must assert the boundary.
5. **Assert terminal states.** A non-terminal action must fail (e.g. approving an
   already-cancelled request returns 404), not silently no-op.
6. **Assert cleanup completeness.** Verify rows are removed _and_ anchor grants
   are preserved (e.g. home-root ADMIN survives self-grant cleanup).
7. **Verify cache via invalidation.** After any ACL mutation, assert the new state
   is visible immediately (grant appears, revoke disappears) within the configured
   TTL.

### 3. Representative examples

Anchors for the pattern — not an exhaustive matrix.

- **Class A — derived visibility (`__shared__`).** Server route integration
  provisions a user who owns subfolders (historical self-grant rows) _and_
  holds a genuine grant from another user, then asserts `GET
/api/permissions/shared` returns exactly the genuine grant with its real
  `name`/`type` — never the own subtree. E2E asserts the sidebar "Shared" tree is
  empty for a user who only has own folders.
- **Class B + F — grant/revoke propagation.** Grant, then read the listing/check
  within cache TTL → the granted node appears; revoke → it disappears
  immediately; a follow-up `If-None-Match` returns a correct `304`.
- **Class C — reference stability after move.** Move a granted folder, then
  assert the grantee can still access it, the ancestor chain is rebuilt, and
  recent entries still resolve.
- **Class H — user deletion cascade.** Delete a user, then assert permission
  rows, share links, and recent entries are gone; `ensure-home-owner-admin`
  removes self-grants on the user's own subtree but preserves the home-root
  ADMIN.

---

## E2E flow policy

- Keep platform-owned interaction coverage split when the UI surface differs, but allow a shared spec file for platform-agnostic core flows that exercise the same user-visible path on both desktop and mobile projects.
- Shared E2E helpers and shared flow specs may contain only platform-agnostic preparation, selectors, and assertions:
  - authentication/login setup
  - deterministic test naming
  - fixture loading
  - stable file-item locators such as `data-file-path`
- Playwright hook signatures that use fixtures must use object destructuring for the first argument (even when unused), e.g. `test.beforeEach(async ({}, testInfo) => ...)`.
- Do not force desktop and mobile flows to share interaction helpers when the UI surface differs. Shared FAB-based create/upload helpers are fine when the user path is the same, but desktop item-action/context-menu interactions and mobile action-sheet interactions should live in their own platform spec or helper.
- Express platform ownership in Playwright project/spec assignment, naming, `testMatch`, or `grep` configuration rather than inline `test.skip()` branches keyed off the current project. Exception: mobile-only cases that live inside a both-platform spec (e.g. `E2E-MYPAGE-011/012`) may keep a reason-carrying `test.skip(isMobile ? false : true, 'reason')`.
- Follow the selector policy from [features/files-sharing.md](features/files-sharing.md): semantic selectors first, `data-file-path` for explorer items, and `data-testid` only for documented unstable or icon-only seams. For SpeedDial-style action menus, prefer the visible `menuitem` names after opening the trigger when that accessibility surface is stable.

### Naming convention (suites and cases)

Apply uniformly to every spec in `e2e/`:

- **Case title format**: `E2E-<DOMAIN>-NNN: <third-person present declarative description>`.
  - Sentence case; declarative statement form (no imperative commands like `Approve pending signup`, no `[Px]` priority prefixes, no literal backticks, no emojis, no `snake_case` identifiers in the title).
  - Scenario labels for hermetic suites stay as a parenthetical between the ID and the colon, normalized: setup wizard `(Case N, both modes|s3 mode only)`, migration `(Flow <label>)`.
  - IDs should be declared in numeric order within each file. Exception: a serial suite whose execution order is load-bearing (e.g. migration job-state sequences) keeps its execution order.
  - Every `test()` carries an ID. Setup-only infrastructure tests use a documented `E2E-SETUP-NNN` slot.
- **Suite title format**: lowercase sentence case. Platform-owned suites append `(desktop)` or `(mobile)`. Hermetic families append their ID range, e.g. `first-run setup wizard (E2E-SETUP-001..004)`.
- **Serialization**: use `test.describe.configure({ mode: 'serial' })` (never the anonymous `test.describe.serial`). Suites that mutate shared per-project DB state are serial.
- **Skips**: every `test.skip`/`test.fixme` carries a reason string. Platform ownership goes in `testMatch`/project assignment, not inline project skips (exception above).
- **Filename style**: `<name>.<platform>.spec.ts` dot suffix for platform files (`core-flow.shared`, `core-flow.desktop`, `core-flow.mobile`). No hyphen-prefix platform files.
- For E2E setup phases (creating test folders/files as prerequisites), avoid timing-sensitive UI seams like SpeedDial open/transition states; prefer stable API endpoints (e.g. folder create + multipart upload) to make prerequisites deterministic.
- When using Playwright `APIRequestContext` for setup or cleanup, pass URL query strings with `params`, not `query`, so contract-required request parameters actually reach the server.
- **Hermetic scratch projects (setup wizard):** the first-run setup spec runs in dedicated `setup-wizard-desktop` / `setup-wizard-mobile` Playwright projects that never reuse the shared `.env.e2e` boot state. Each test spawns its own scratch server instance on `:5003` (own env file via `DOTENV_CONFIG_PATH`, own sqlite path, own scratch PG DB) and supervises its own process lifecycle, because restart is the behavior under test. The spec is serial within the describe and cleans up per case in `afterEach` (kill the scratch child, remove the scratch dir, drop the scratch PG database). Keep these projects additive — do not fold them into the mode-prefixed project matrix.
- **Per-project data isolation via setup projects:** the shared E2E database accumulates state across projects (Playwright caps the initial render at 50 root items, so a later project's file upload can sort past the cap and never render). The `00-project-setup.spec.ts` reset must therefore run once **per dependent project**, not once per run. Express this with Playwright project `dependencies`, NOT by relying on a `00-` filename prefix being matched by each test project:
  - Give the mode-prefixed test projects a dedicated sibling setup project (e.g. `${backendMode}-desktop-setup` / `${backendMode}-mobile-setup`) whose `testMatch` matches only `00-project-setup.spec.ts`, and list that setup project in the test project's `dependencies`.
  - **Do not** point multiple dependent projects at one shared setup project: a `dependencies` setup project runs exactly once per run, so the second dependent project would start from the first one's dirty DB, silently breaking isolation.
  - A failing setup run blocks all its dependent tests (they do not execute on a dirty DB). Use `--no-deps` to skip setup explicitly when running a subset.

### Minimum flow coverage

- Desktop flow: login plus CRUD happy paths that exercise create folder, upload, rename, and delete.
- Mobile flow: the same CRUD happy paths.
- Treat create/upload as shared FAB-driven outcomes when the user path matches across platforms, and split only the interaction helpers that genuinely differ, such as desktop item actions/context menu versus the mobile action sheet for rename/delete.

Detailed browser-flow inventory, rollout order, and planned Playwright ownership are maintained in [E2E_COVERAGE_PLAN.md](E2E_COVERAGE_PLAN.md). Keep this document focused on layer policy and E2E design rules rather than exhaustive scenario tracking.

### Feature-doc responsibility for E2E guidance

- Put exhaustive scenario inventory, priority, ownership, and status in [E2E_COVERAGE_PLAN.md](E2E_COVERAGE_PLAN.md).
- Keep `docs/features/*.md` focused on product behavior and **feature-specific testing anchors** only.
- Add E2E guidance to a feature doc only when that feature has rules that are easier to understand at the feature boundary than in the global plan, for example:
  - selector rules unique to that feature
  - platform-specific interaction ownership (desktop vs mobile)
  - feature-only flow-structure constraints
- Do not copy full scenario matrices, rollout order, or per-spec ownership into feature docs when the canonical E2E plan already tracks them.

---

## Checklist for New Code

### New API endpoint

- Add an integration test that sends the correct method/path/body and asserts on status and response shape (and error body when applicable). This keeps the API contract documented and regression-safe.

### New hook or util

- Add unit tests covering the main behavior and important edge/error cases. Prefer testing the public interface (arguments and return values or side effects), not implementation details.

### New component

- If the component contains non-trivial logic or is used in many places, add tests (unit or integration) that verify key behavior and error states. Purely presentational components with no logic can be left untested or covered indirectly by parent tests.

### New shared contract

- When changing [shared-contracts.md](shared-contracts.md) (e.g. error format, validation return shape), update client display logic, server responses, and any tests that assert on those contracts.

### New service → adapter call

- Add a contract-conformance test asserting the argument types/units passed to the adapter match its documented signature (e.g. a `Date` cutoff, milliseconds, numeric id). Keep the adapter mock faithful to that contract so wrong-argument calls fail loudly.

### New or changed listing endpoint

- Add an **exact-set invariant** test (expected items present, own/unauthorized items absent, correct count, no duplicates) — not just a response-shape assertion. See [Cross-cutting defect classes](#cross-cutting-defect-classes--semantics-first-testing).

### New ACL mutation or permission check

- Add a denial/revoke assertion (grantee loses access immediately) plus a cache-invalidation assertion (the new state is visible within TTL).

### New move/rename/delete flow

- Assert reference and closure integrity: the ancestor chain is rebuilt, permission inheritance follows the new parent, and dependent references (recent files, share links, permission rows) still resolve or are cleaned up.

### New cleanup or migration logic

- Assert cascade completeness _and_ anchor preservation (e.g. home-root ADMIN survives self-grant cleanup).

---

## Property-based testing (fast-check)

**Purpose:** Reduce happy-path bias by reinforcing boundary and exception cases with automatically generated inputs. Use `fast-check` to state invariants and let the framework generate many inputs (including edge cases) that must satisfy them.

**Principle:** For pure functions with clear input/output contracts, write properties (e.g. “when `validateFileName(s)` returns `null`, then `s` is trimmed, length 1–255, has no forbidden chars, no reserved names, no trailing space, no leading dot”) and use `fc.assert(fc.property(...))` instead of (or in addition to) a few hand-picked examples.

**Primary targets:**

- **[shared/validation.js](../shared/validation.js)** — e.g. `validateFileName`: if result is `null`, the string satisfies length (1–255 after trim), allowed characters, no reserved names, no trailing space, no leading dot; `validateEmail`: if `null`, format and length ≤254.
- **[shared/pathUtils.js](../shared/pathUtils.js)** — e.g. `normalizePath`: output always starts with `/`, no duplicate slashes; `getParentPath(normalizePath(p))` consistency; path segment rules.

**Where to add tests:** New property-based tests can live in the client (e.g. `client/src/utils/__tests__/validation.test.js`, `pathUtils.test.js`) or, when testing shared logic from the server, in the server test suite. Use `fast-check` in addition to example-based unit tests for these modules.

---

## Coverage Goals

Align with [TEST_GIT_GUIDE.md#coverage-goals](TEST_GIT_GUIDE.md#coverage-goals):

- **New code:** At least 80% coverage.
- **Refactored code:** At least 90% coverage.
- **Core business logic:** 95%+ coverage.

Run from each directory: `cd client && npm run test:coverage` and `cd server && npm run test:coverage`. Don’t commit coverage artifacts; see TEST_GIT_GUIDE for what to commit and ignore.

**Mutation testing (Stryker):** Prefer improving Mutation Score over chasing coverage numbers. Coverage can miss weak tests; mutation testing measures whether tests actually detect code changes. Run `cd client && npm run test:mutation` and `cd server && npm run test:mutation`. Start with small modules (e.g. `server/utils/errorHandler.js`) and expand the mutate scope gradually. See `stryker.config.json` in each package.

---

## Test Performance & Run Guidance

- **Cold vs warm cache:** The first Jest run after a cache invalidation is substantially slower (a cold full client run can exceed 10 minutes). Base timing comparisons and timeout budgets on warm runs, not the first run.
- **Avoid concurrent full-suite runs:** Running the full server and client suites simultaneously on a constrained machine causes resource contention — individual fast suites (e.g. `files.test.js`, ~2s standalone) can stall and time out. Run suites sequentially, or tune `--maxWorkers` when parallelizing.
- **Measure consistently:** When judging a performance regression, compare identical environment, worker count, and warm-cache state. Real-time retry backoff (see "Avoid real-time waits in tests") is the most common hidden cost in slow suites.
- **Know the critical path:** In a parallelized suite, the wall-clock time is bounded by the slowest suite. Profile per-suite timing (Jest `--json` + duration aggregation) before optimizing; the slowest suite is usually a network/retry or heavy-rendering suite, not the largest one.

---

## Documenting Test Results

When the full test suite has completed (e.g. after adding tests, refactoring, or major changes), update the test summary documents in each package:

- Write [client/TEST_SUMMARY.md](../client/TEST_SUMMARY.md) and [server/TEST_SUMMARY.md](../server/TEST_SUMMARY.md) in each respective folder.
- Follow the format in [TEST_SUMMARY_TEMPLATE.md](TEST_SUMMARY_TEMPLATE.md) so that test counts, coverage, infrastructure, and running instructions stay consistent across the project.

---

## When Tests Fail

When a test fails (during development, CI, or when fixing regressions):

1. **Diagnose:** Run the failing test, read the error message, and identify the root cause.
2. **Classify:** Determine whether it is:
   - **A** — Bug in production code
   - **B** — Bug in the test itself
   - **C** — Spec/contract mismatch
3. **Act:** Apply the fix (or update spec) according to the classification. Do not modify code before classifying.
4. **Record:** Add an entry to [docs/RCA_LOG.md](RCA_LOG.md) with date, summary, classification, and action taken.

This RCA (Root Cause Analysis) procedure is mandatory. See [AGENTS.md](../AGENTS.md) §3.2 for the full rule.

---

## Relationship to Other Docs

| Document                                               | Purpose                                                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **TESTING_STRATEGY.md** (this file)                    | What to test, unit vs integration, mocking, checklist for new code, RCA when tests fail.        |
| **TEST_SUMMARY_TEMPLATE.md**                           | Template for writing `client/TEST_SUMMARY.md` and `server/TEST_SUMMARY.md` when tests complete. |
| **TEST_GIT_GUIDE.md**                                  | How to run tests, what to commit, CI, coverage commands, commit messages.                       |
| **client/TEST_SUMMARY.md**, **server/TEST_SUMMARY.md** | Current test counts and coverage summary per package.                                           |
| **api.md**, **shared-contracts.md**                    | Contract to test against; keep mocks and assertions in sync.                                    |
