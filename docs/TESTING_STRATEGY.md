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

- **Use only schema-derived or validated mocks:** Mocks (including MSW handlers) must be generated from or validated against the defined contract (e.g. OpenAPI spec, `docs/openapi.yaml`). Hand-written mocks that diverge from the schema lead to false confidence. When the schema changes, regenerate or update mocks accordingly.

### Client

- **MSW (Mock Service Worker):** All API calls are mocked in tests via handlers in `client/src/mocks/`. Use this for both unit tests (e.g. services that call `fetch`/axios) and integration tests (full component trees that trigger API calls). Keep handlers in sync with [api.md](api.md) and [shared-contracts.md](shared-contracts.md) so contract changes are reflected in mocks.
- **Services:** Prefer mocking at the network layer (MSW) rather than replacing service modules, so integration tests exercise the real client API usage.

### Server

- **WebDAV and stores:** Use test utilities and mocks so route tests don’t depend on a real WebDAV server or real metadata files. Mock or stub the WebDAV client and store modules where appropriate.
- **Auth:** Use test helpers (e.g. create a test user, issue a JWT) so routes can be called with a valid `Authorization` header without going through the real login flow.

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

## Relationship to Other Docs

| Document | Purpose |
|----------|---------|
| **TESTING_STRATEGY.md** (this file) | What to test, unit vs integration, mocking, checklist for new code. |
| **TEST_GIT_GUIDE.md** | How to run tests, what to commit, CI, coverage commands, commit messages. |
| **client/TEST_SUMMARY.md**, **server/TEST_SUMMARY.md** | Current test counts and coverage summary. |
| **api.md**, **shared-contracts.md** | Contract to test against; keep mocks and assertions in sync. |
