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

## DB test tiers (metadata storage)

The server's DB access flows through the executor seam and per-domain
repositories (`docs/spec/server/store/executor.md`,
`docs/spec/server/store/repository-contract.md`). Tests are tiered accordingly:

| Tier                       | What                                                                                                                  | Backend                                                     | Where                                                                                                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **L0 unit**                | Pure logic; storage mocked at the executor/store boundary                                                             | none                                                        | `**/__tests__` (no DB)                                                                                                                                                                                                                                                   |
| **L1 functional**          | Routes/services/models — observable behavior through APIs                                                             | **sqlite only** (per-suite temp DB)                         | `**/__tests__` DB suites; default `test:ci` leg                                                                                                                                                                                                                          |
| **L2 adapter conformance** | Repository interfaces against real storage: CRUD/upsert/RETURNING/type mapping/transactions/locking/schema/migrations | real sqlite + **real PostgreSQL** (`WEA_TEST_PG_*`, serial) | `server/store/repositories/__tests__/*.conformance.test.js` + `server/domains/permissions/stores/repositories/__tests__/*.conformance.test.js` + executor suite (`server/infrastructure/db/__tests__/executor.test.js`) + schema/migration suites; `test:ci:pg:adapters` |
| **L3 cross-DB smoke**      | Representative store roundtrip + migration apply-once per supported RDB                                               | each RDB                                                    | subset inside the adapter leg                                                                                                                                                                                                                                            |

Rules:

- **Functional suites never target PostgreSQL.** Real-PG regressions are the
  responsibility of L2/L3; jest processes cannot receive production `WEA_DB_*`
  credentials (see "DB namespace isolation" below), and the disposable
  `webdav_test` database is self-provisioned by the test harness when missing.
- **Repository conformance suites are backend-agnostic by design** — they call
  `createTestDatabase()` and assert behavior on whichever backend is active,
  so the same file covers sqlite (default leg) and PostgreSQL (adapter leg).
- The former full-suite real-PostgreSQL jest leg is retired; the adapter
  leg (`test:ci:pg:adapters`) is the only real-PG jest entry point.

---

## AI-platform test tiers

Additive policy for the collections/AI platform (docs/features/collections-platform.md §4.x, CODING_STYLE.md Express Patterns–§8). The
L0–L3 definitions above are **unchanged**; this section only adds rules and IDs.

- **Fake-LLM hermeticism:** every server-side suite that exercises AI enrichment or query
  embed runs against an **in-process fake LLM server injected via the adapter's role config**
  (`{BASE_URL, API_KEY, MODEL}` pointing at a local test listener) — never a real provider,
  never a module-level mock that bypasses the adapter contract. The same network-guard
  precedent as blob-migration testing (stubbed sockets) applies: an accidental real request
  fails the test.
- **Hermetic scratch projects:** each destructive AI E2E suite (evolution passes, merge
  execution, archive/purge lifecycles) gets its **own scratch server project** following the
  destructive-suite precedent. Scratch slots are project-scoped with separate desktop and
  mobile slots resolved through the shared port-band helper (each checkout's whole port set
  shifts together; see the runner guide's parallel-worktree section), own env file, own
  sqlite/PG scratch DB, and per-case cleanup. This extends the destructive-case policy:
  **auto-evolution mutates user data, so AI suites are scratch-only, never run against the
  shared E2E server/database.** Scratch servers are process isolation for boot config,
  global settings, DB, and restart; the project-scoped cwd, bucket, and WebDAV subtree only
  isolate blobs.
- **E2E case identity:** case families use backend-qualified IDs where the backend is part
  of the contract, third-person declarative titles per the naming convention above, and the
  minimum lifecycle chain create→digest→archive→undo→restore→purge (CODING_STYLE.md Express
  Patterns gate). Concrete IDs, case ownership, and project/slot mapping are canonical in
  [E2E_COVERAGE_PLAN.md](E2E_COVERAGE_PLAN.md).
- **Degradation-matrix suite:** one suite per §4.12 capability column — `None` (no adapter
  configured at all; the built-in embed engine suppressed by fixture — absent lock/weights ⇒
  `roleConfigured('embed')` false), `embed` (fake embed only), `embed+chat` (fake embed+chat) — and the
  **None and embed columns must pass green with no real adapter present** (the
  "never-a-render-dependency" invariant, verified by construction).
- **Provisioning-trigger fixtures (`llmPresets.md` §4):** hermetic legs assert the
  provider-triggered postures — a setup-mode boot fetches ZERO model bytes (network stub);
  every configured boot missing weights — the first one after the wizard included, no
  special event — uses the boot-blocking posture (failure warn-only, caps OFF + reason); an
  override-clear trigger runs IN PLACE (`preparing(phase='provisioning', progress)` readiness
  row; embed jobs park and drain in order on caps-ON); an enabled remote override defers with
  no caps-off signal; switching to remote never deletes existing weights.
- **Repository conformance additions:** the new repository twins (collections, fileLikes,
  actionJournal, aiJobs, llmModels, aiUsageDaily, embeddings, embeddingsChunk, aiTag, queryParses) join the existing
  `*.conformance.test.js` L2 leg (sqlite default + `test:ci:pg:adapters` PG twin). Notable
  contract cases: `ai_jobs` **claim race** (one runner wins per `(node_id, kind,
generation)`, backoff/retry parity), embeddings/chunks upsert + FK-cascade parity,
  actionJournal `chain_seq` monotonicity and `UNIQUE(domain,subject,chain_seq)`.
- **§4.13c vectorStore contract tests:** a per-engine conformance suite asserting — exact
  engines (JS fallback, vec0) return results **identical to the JS oracle**; ANN engines
  (pgvector HNSW, `ef_search=400` fixed) achieve **recall@50 ≥ 0.99 graded with HELD-OUT
  external queries only** (self-queries flatter the index and must not be the grade
  basis). Cross-engine result-identity is not asserted (ANN is approximate) — the promise
  is the recall floor.
- **CI grep-gate:** `domains/(collections|ai)/**` and new stores contain zero
  `CacheAdapter`/`operationProgress` imports (invariant 8).

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
- **DB namespace isolation:** Jest suites never receive production `WEA_DB_*`. `server/test-setup.js` wipes them at entry (and fails fast if a real-PG request is made without the test namespace); the real-PostgreSQL leg is driven by the dedicated `WEA_TEST_PG_*` namespace consumed only by `createTestDatabase()` via the storage test-only override seam (`docs/spec/server/store/storage.md` §2.8).
- **Timer hygiene:** Unref non-essential timers that would otherwise hold the event loop open during tests (e.g. the 5-minute download-progress cleanup timer in `operationProgress.js` uses `.unref()`). This prevents Jest's "worker failed to exit gracefully / force exited" stall. Use `--detectOpenHandles` to confirm the leak source before editing.
- **Console output policy:** In `server/test-setup.js`, silence `console.log` (`jest.spyOn(console, 'log').mockImplementation(() => {})`) to suppress per-request `requestLogger` noise, but preserve `console.warn` and `console.error` so tests that assert on deprecation warnings (e.g. `storage.test.js`) keep working. Tests that assert on `console.log` output must re-spy the implementation themselves (see `requestLogger.test.js`). Keep `verbose: false` in `jest.config.js` to reduce printed test-name overhead.

### Blob migration testing policy

The blob-migration feature (bidirectional WebDAV ↔ S3; spec: `docs/spec/server/tools/blob-migration.md`) is enforced by injection and a local network guard — real environments are never touched. Integrity is enforced by code, not convention.

- **Injection only:** `migrationService` takes `srcBlobStore` and `buildDestBlobStore` as injected deps. Tests inject `createFakeBlobStore()` (`server/testing/mocks/fakeBlobStore.js`) and a fake `buildDestBlobStore`; real adapters (`WebdavBlobStore`/`S3BlobStore`) are never constructed inside tests. Assert via `jest.spyOn` on their constructors where feasible.
- **Fake BlobStore contract:** `createFakeBlobStore()` is an in-memory store with REAL behavior (`uploadBlob`, `downloadBlob`, `deleteBlob`, `headBlob`, `createDirectory`/`ensureDirectoryExists`, `listKeys`). It supports failure injection (`failOn(key)`, `failNextN(n)`) and records writes (`writtenKeys()`/`writtenPaths()`, `count()`) for "only destination written", "no duplicate copy", and dry-run no-write assertions. This is contract fidelity (a real adapter mock honoring `docs/spec/server/store/blobstore.md`), not speculative logic.
- **Temp sqlite only:** tests run against temp sqlite via `createTestDatabase()` with no `WEA_DB_*` credentials set (sqlite default). No real PG host, no network.
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

### Delegation seams

- **Spec-documented delegation pins are exempt:** A mock-call pin (`toHaveBeenCalledWith` / `toHaveBeenCalledTimes` / call absence) is exempt from the black-box rule when a spec document explicitly records that delegation tuple or absence as a contract (e.g. the per-method delegation tuples in `docs/spec/server/services/fileService.md` §2.3, or the permission-gate mandates in §3). Such pins verify a documented seam, not an implementation detail.
- **Otherwise assert the observable:** If the behavior is observable through the module-under-test's output, state, or rendered UI, the pin must be dropped or replaced by the observable assertion (see AGENTS.md §3.1, "Verify What, Not How").

### Performance / memoization refactors

- **Memoization and callback identity are implementation details.** `React.memo`, `useCallback`/`useMemo` dependency arrays, render counts, and bail-out behavior must not be asserted by unit tests (that would reach into internals — the "How").
- **Verification is drift-free behavior plus structural evidence.** A performance-only refactor (e.g. stabilizing handler identities, memoizing grouped props, removing dead props) is verified by ① existing black-box suites staying green with zero observable behavior/test drift, ② a commit message explaining the structural change, and ③ manual React DevTools Profiler checks where a render-count claim is made. Render-frequency or `React.memo` bail-out assertions are not added to unit tests.
- **Spec docs describe the memoization as implemented state only.** A component may note that it is `React.memo`-wrapped as an implementation fact, but such a claim is not a unit-test checklist item.

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

Concrete suite names, project names, case IDs, scratch slots, skip counts, and
per-case ownership are canonical in [E2E_COVERAGE_PLAN.md](E2E_COVERAGE_PLAN.md).
This section defines only the invariants every E2E suite must follow.

### Backend and group ownership

- S3 is the default backend. The default and core groups must not start a WebDAV
  container; only the WebDAV job starts exactly one shared bytemark.
- Keep platform-owned interaction coverage split when the UI surface differs,
  but allow a shared spec for platform-agnostic core flows that exercise the
  same user-visible path on desktop and mobile.
- Shared E2E helpers and shared flow specs may contain only platform-agnostic
  preparation, selectors, and assertions: authentication/login setup,
  deterministic test naming, fixture loading, and stable item locators such as
  `data-file-path`.
- Playwright hook signatures that use fixtures must use object destructuring for
  the first argument, even when unused.
- Do not force desktop and mobile flows to share interaction helpers when the UI
  surface differs. Shared create/upload helpers are fine when the user path is
  the same, but desktop item actions/context menus and mobile action sheets stay
  in their own platform spec or helper.
- Express platform ownership in project/spec assignment, naming, `testMatch`,
  or `grep` configuration rather than inline `test.skip()` branches keyed off
  the current project. Mobile-only cases embedded in a both-platform spec may
  keep a reason-carrying skip.
- Follow the selector policy in
  [features/files-sharing.md](features/files-sharing.md): semantic selectors
  first, `data-file-path` for explorer items, and `data-testid` only for
  documented unstable or icon-only seams.

### Backend direction and release-gate composition

- The default group is the full generic S3 release gate and includes the core
  subset. The core group is a fast optional pre-merge subset. The WebDAV group
  is required release coverage for real WebDAV-specific behavior.
- Cross-backend migration ownership follows the source and destination backend,
  not a single global rule. A generic gate/role check can run in the default S3 group
  with an S3 source and a WebDAV destination tarpit (a local raw TCP listener,
  not a WebDAV container). An S3 destination may legitimately require a WebDAV
  source. Real WebDAV source/destination behavior remains in the WebDAV job.
- The default S3 gate must not depend solely on the WebDAV job for generic
  gate/role behavior, and the WebDAV job must not be treated as optional in a
  release. Concrete cases and backend directions are listed in the coverage
  plan.

### Interaction contract

- The first Enter/click on a submit control must produce exactly one request.
  Count requests, not responses, and wait for an observable ready or completed
  state instead of pressing again.
- Do not retry non-idempotent writes blindly. An exactly-once job means one
  server-side job or gate, not one transport attempt. Prove it with a deliberate
  second write returning `409` and with the server-side job count/state; if a
  transport retry is ever needed, use an idempotency key and assert the server
  job count rather than only classifying the thrown error.

### Test data realism

- Seed actual application settings with multiple keys and distinct values, and
  assert the copied key/value pairs. A marker-only row or a row count is not
  evidence that settings migration works.
- Settings that are `dbOnly` must be written through the database/config
  surface; setting an ignored environment variable is not a valid test setup.

### Timeouts, latency, and flakiness

- Keep infrastructure waits (scratch boot, container health, job polling)
  separate from product latency assertions. Do not raise a global timeout as the
  only response to weak CI; use a per-case budget only when boot/restart is the
  behavior under test.
- The release gate runs with retries disabled and fails on flaky tests. Retries
  are a development diagnostic, not release evidence.
- A stress run at four or more workers is capacity validation only. It is not a
  fixed worker gate and must not become a per-project worker cap.

### Skip policy

- In CI, a missing required resource (WebDAV, PostgreSQL, or AI weights) must
  fail the gate, not skip the case. Every skip carries a reason.
- Expected skip counts are release invariants, not reporting noise. The
  canonical expected count per group lives in the coverage plan, and the
  skip-count reporter compares every run against it.
- Any unexpected skip fails release. Any mismatch against the documented count
  is a gate failure, including a missing expected skip; update the count only
  when the product/coverage decision is explicit.
- Do not convert a skip into a pass through a retry, a broader timeout, or a
  conditional guard. Fix the missing resource or the contract.

### State preservation

- Route-driven expansion is initial state, not a per-refresh reset. When the
  current route is a collections route, the collections section is expanded on
  first render and on remount.
- An undo or notifier refresh must preserve the user's current expansion. It
  must not silently collapse an expanded section.
- A manual collapse is user intent and takes precedence while the route is
  unchanged. Only a later route entry or remount may auto-expand the section
  again.
- Do not reload the page to bypass a same-session fetch queue or resume
  workflow. Wait for the observable dialog/request state; reload only when boot
  or restart is the behavior under test.
- Do not reload, re-open, or re-expand a tree merely to make an undo-state
  assertion pass. Assert the product's observable expansion state directly.
- Collapsed, empty, and load-failure states must be distinguishable through
  explicit accessible state (for example `aria-expanded` plus an empty or error
  message), never inferred from row absence alone.

### Concurrency and isolation

- No Playwright project dependencies. Projects are independent siblings; the
  worker count is the only concurrency throttle. Do not add a fixed
  per-project `workers: 1`; use `serial` mode or `fullyParallel` as the suite
  requires.
- Per-run seeding happens once. Isolation comes from case hermeticity and
  assertion-context containment, not from ordering.
- Scratch servers are process isolation for boot configuration, global
  settings, the metadata DB, and restart. The project-scoped working directory,
  S3 bucket, PG database, and WebDAV subtree isolate blobs only.
- Globally destructive cases run scratch-hermetic. File-level `testMatch`
  ownership is not sufficient because `fullyParallel` interleaves tests across
  spec files; a global purge must have its own scratch world and stay out of
  shared-mode smoke sets.
- Global-state mutations are restored in-test. A case that flips a shared
  setting saves, mutates, asserts, and restores it before finishing.
- Case-scoped names are unique per run and per project, including the project
  slug and a timestamp or retry suffix where the helper provides one.
- Retries must be self-healing: derived user identities are unique per attempt,
  so a retry of a permanently mutating case does not collide with its prior
  attempt. Failed attempts leave residue, so assertions filter by the case's
  own identifiers rather than exact counts on shared listings.
- Prefer parallel-safe cases. A file is serial only when it mutates shared
  per-project DB state or depends on prior cases; state the reason.

### Serialization

Use `test.describe.configure({ mode: 'serial' })` (never anonymous
`test.describe.serial`). Suites that mutate shared per-project DB state are
serial. Assertion-context containment is the default; serial is the exception.

### Naming, IDs, and hygiene

Apply uniformly to every E2E spec:

- Every `test()` carries a stable case ID and a third-person present declarative
  title. Platform cases use the platform ID family; backend-specific hermetic
  cases carry a backend qualifier. Retired IDs are never reused and are mapped
  in the coverage plan.
- Sentence case; no imperative commands, priority prefixes, literal backticks,
  emojis, or `snake_case` identifiers in titles.
- Hermetic scenario labels stay as a parenthetical between ID and colon and are
  normalized per suite.
- IDs are declared in numeric order within a file. A serial suite whose
  execution order is load-bearing keeps execution order.
- Suite titles are lowercase sentence case. Platform-owned suites append a
  platform suffix; hermetic families append their ID range.
- Use platform/backend dot suffixes in spec file names and keep shared helpers
  alongside the family. No hyphen-prefix platform files.
- Every `test.skip`/`test.fixme` carries a reason string. Platform ownership
  belongs in project assignment, not inline project skips.
- For setup phases, create prerequisite folders/files through stable API
  endpoints when those operations are not the behavior under test. Exercise the
  UI flow when it is the behavior under test.
- When using Playwright `APIRequestContext` for setup or cleanup, pass query
  strings with `params`, not `query`, so contract-required parameters reach the
  server.
- Do not leave debug `console.log` output in specs. Do not reference retired or
  deleted suite names/IDs; the coverage plan is the canonical map.

### Assertion-context containment

- The admin home is the filesystem root, and the client renders at most 50 items per listing (infinite scroll). Visibility assertions against a shared listing couple a case to creation order and break once the listing exceeds the render window under parallel workers.
- Create and assert items only inside a case-owned folder (named via `buildName`); never assert item visibility in the admin root or another shared listing.
- Seed the owned base folder through the stable API (resolve-or-create) and navigate into it. Use UI creation flows (FAB, upload) when creation is the behavior under test; otherwise seed fixture items through the API and reserve UI actions for the behavior being tested.
- A case may render-and-assert only in a listing bounded to its own data.
- Each case deletes its owned base folder in `afterEach` via the admin permanent
  delete route, tolerant of the folder having already been moved, renamed, or
  deleted by the case, so the shared admin root never accumulates residue. The
  ordinary delete channel trashes; cleanup must not rely on it.
- A standard user's own home is role-scoped, not the admin root. Home-root label
  assertions run only against that user's own home folder, never a shared
  listing.
- Prefer parallel-safe cases; a case/file is serial only when it mutates shared
  users/settings or depends on prior cases, with the reason stated.

### Authenticated-session reuse (L1)

- Default to an authenticated session for admin-actor cases via a per-file
  `storageState`; only auth-state cases start unauthenticated or perform a UI
  login. New cases must not repeat a UI login the seeded session already
  provides.

### Minimum flow coverage

- Desktop flow: login plus CRUD happy paths that exercise create folder, upload, rename, and delete.
- Mobile flow: the same CRUD happy paths.
- Treat create/upload as shared FAB-driven outcomes when the user path matches across platforms, and split only the interaction helpers that genuinely differ, such as desktop item actions/context menu versus the mobile action sheet for rename/delete.

Detailed browser-flow inventory, future expansion plan, and planned Playwright ownership are maintained in [E2E_COVERAGE_PLAN.md](E2E_COVERAGE_PLAN.md). Keep this document focused on layer policy and E2E design rules rather than exhaustive scenario tracking.

### Feature-doc responsibility for E2E guidance

- Put exhaustive scenario inventory, priority, ownership, and status in [E2E_COVERAGE_PLAN.md](E2E_COVERAGE_PLAN.md).
- Keep `docs/features/*.md` focused on product behavior and **feature-specific testing anchors** only.
- Add E2E guidance to a feature doc only when that feature has rules that are easier to understand at the feature boundary than in the global plan, for example:
- selector rules unique to that feature
- platform-specific interaction ownership (desktop vs mobile)
- feature-only flow-structure constraints
- Do not copy full scenario matrices, future expansion plan, or per-spec ownership into feature docs when the canonical E2E plan already tracks them.

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

### New or modified E2E spec

- Create/assert data only inside a case-owned folder; never assert visibility in a shared listing (assertion-context containment).
- Do not repeat a UI login when a seeded per-file `storageState` session already provides it; only auth-state cases start unauthenticated or perform a UI login.
- Verify order-independence before enabling parallel workers: run the affected project with `--workers=1` and `--workers=2` and confirm an identical passed/skipped set (repeat 3×).

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
- **Avoid concurrent full-suite runs:** Running the full server and client suites simultaneously on a constrained machine causes resource contention — individual fast suites can stall and time out. Run suites sequentially, or tune `--maxWorkers` when parallelizing.
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
