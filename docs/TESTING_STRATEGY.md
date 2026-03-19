# Testing Strategy

This document describes **what** to test and **how** to test it: unit vs integration, mocking approach, and a checklist for new code. For how to run tests, what to commit, and CI, see [TEST_GIT_GUIDE.md](TEST_GIT_GUIDE.md).

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

### Mock management policy (required)

- **Prefer the smallest stable seam:** Mock at the lowest layer that keeps tests deterministic.
- **Avoid logic-heavy mocks:** Mock factories should primarily return fixed values and simple `jest.fn()` stubs. Avoid re-implementing production branching inside mocks.
- **Use shared factories for repeated dependencies:** When the same mock shape appears in 3+ files, move it to a shared factory/helper.
- **Reset policy:** Use `jest.clearAllMocks()` in `beforeEach` by default. Use `jest.resetAllMocks()` only when previous mock implementations must be fully reset. Use `jest.restoreAllMocks()` when spies on real methods are used.
- **Document decisions in fail log:** If a mocking approach causes regressions or infra incompatibility, record RCA in `.cursor/fail_log.md` and update this strategy/spec docs before broad migration.

### Client

- **MSW (Mock Service Worker):** API calls are mocked via handlers in `client/src/mocks/` for integration-style component/page tests. Keep handlers in sync with [api.md](api.md) and [shared-contracts.md](shared-contracts.md).
- **Service/unit tests:** For isolated service or adapter behavior, module-level mocks (`jest.mock`) are allowed and often preferred.
- **Known guardrails from RCA:** In this repository, avoid broad MSW migration for cases already recorded in `.cursor/fail_log.md` (for example, Node/Jest compatibility around axios response propagation and `request.formData()` parsing in jsdom).
- **Jest polyfill guardrail:** In jsdom + undici tests, expose only the minimum globals required for stable runtime. Do not instantiate `new MessageChannel()` only to infer constructor types, and avoid unnecessary global `MessageChannel` wiring when `MessagePort` alone is sufficient. These patterns can leave open `MESSAGEPORT` handles and block graceful Jest worker shutdown. If a temporary channel fallback is unavoidable, close/unref both ports immediately.
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

## Checklist for New Code

### New API endpoint

- Add an integration test that sends the correct method/path/body and asserts on status and response shape (and error body when applicable). This keeps the API contract documented and regression-safe.

### New hook or util

- Add unit tests covering the main behavior and important edge/error cases. Prefer testing the public interface (arguments and return values or side effects), not implementation details.

### New component

- If the component contains non-trivial logic or is used in many places, add tests (unit or integration) that verify key behavior and error states. Purely presentational components with no logic can be left untested or covered indirectly by parent tests.

### New shared contract

- When changing [shared-contracts.md](shared-contracts.md) (e.g. error format, validation return shape), update client display logic, server responses, and any tests that assert on those contracts.

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
4. **Record:** Add an entry to [.cursor/fail_log.md](../.cursor/fail_log.md) with date, summary, classification, and action taken.

This RCA (Root Cause Analysis) procedure is mandatory. See [.cursor/rules/rca-on-test-failure.mdc](../.cursor/rules/rca-on-test-failure.mdc) for the full rule.

---

## Relationship to Other Docs

| Document | Purpose |
|----------|---------|
| **TESTING_STRATEGY.md** (this file) | What to test, unit vs integration, mocking, checklist for new code, RCA when tests fail. |
| **TEST_SUMMARY_TEMPLATE.md** | Template for writing `client/TEST_SUMMARY.md` and `server/TEST_SUMMARY.md` when tests complete. |
| **TEST_GIT_GUIDE.md** | How to run tests, what to commit, CI, coverage commands, commit messages. |
| **client/TEST_SUMMARY.md**, **server/TEST_SUMMARY.md** | Current test counts and coverage summary per package. |
| **api.md**, **shared-contracts.md** | Contract to test against; keep mocks and assertions in sync. |
