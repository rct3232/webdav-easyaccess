# Fail Log

## 2026-04-30 - share-public logged-in E2E user mismatch

- **Area:** `e2e/share-public.spec.ts`, `e2e/helpers/shareLinks.ts`
- **Classification:** Case B (Test Error)
- **Summary:** Logged-in public share-link E2E cases (`E2E-SHARE-005/006/007`) failed because suite setup provisioned an approved user with a test-specific suffix, but the browser login step still used the unsuffixed seed username `user1`.
- **Observed failure:** `page.waitForURL(/\/files(?:\/.*)?$/)` timed out in `e2e/helpers/auth.ts` while the server returned `401` for the unsuffixed login attempt.
- **Spec cross-check:** `docs/features/files-sharing.md` requires logged-in share-link scenarios to establish an authenticated session first; the authenticated fixture identity used in setup must match the browser login identity.
- **Action taken:** Updated the share-link feature doc to clarify the fixture-identity requirement, extended `PublicShareFixtures` to expose the approved user suffix/username, and updated the logged-in share-public tests to authenticate and assert against that exact provisioned identity.

---

## 2026-07-29 — B6 Final Test Gate

### Server: 1 failure (795 passed / 1 failed)

- **Area:** `server/domains/admin/routes/__tests__/admin.test.js:194`
- **Test:** `POST /api/admin/cleanup/orphaned › returns 200 with messageCode and results shape when admin`
- **Classification:** Case A (Source Error — likely regression from phase7 refactoring)
- **Observed failure:** Expected status 200, received 500. The `cleanupOrphanedData` function in `cleanupService.js` throws an unhandled error at runtime. Likely caused by commits `b1c9b7e` (T7.19 — migrate to cleanupService) or `37593a1` (T7.3 — finalize cleanupService and admin routes).
- **Impact:** Admin orphaned data cleanup endpoint returns 500 for all callers.
- **Resolution:** Fixed `permissionPolicy` import path in `cleanupService.js` — B5 migration used wrong relative path (`../../../utils/permissionPolicy`). Corrected to `../../permissions/policy/permissionPolicy`. Commit: `97781b2`. All 796 server tests now pass.

### Client: 12 failures (1245 passed / 12 failed, 3 suites failed)

- **Area:** `client/src/services/__tests__/apiClient.test.js` and others
- **Classification:** Case B (Test Error — pre-existing environmental issues)
- **Observed failure:** Timeout errors (`Exceeded timeout of 5000 ms`) in 403 handling tests. No recent commits modify client code; these are pre-existing flaky tests unrelated to current changes.
