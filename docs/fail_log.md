# Fail Log

## 2026-04-30 - share-public logged-in E2E user mismatch

- **Area:** `e2e/share-public.spec.ts`, `e2e/helpers/shareLinks.ts`
- **Classification:** Case B (Test Error)
- **Summary:** Logged-in public share-link E2E cases (`E2E-SHARE-005/006/007`) failed because suite setup provisioned an approved user with a test-specific suffix, but the browser login step still used the unsuffixed seed username `user1`.
- **Observed failure:** `page.waitForURL(/\/files(?:\/.*)?$/)` timed out in `e2e/helpers/auth.ts` while the server returned `401` for the unsuffixed login attempt.
- **Spec cross-check:** `docs/features/files-sharing.md` requires logged-in share-link scenarios to establish an authenticated session first; the authenticated fixture identity used in setup must match the browser login identity.
- **Action taken:** Updated the share-link feature doc to clarify the fixture-identity requirement, extended `PublicShareFixtures` to expose the approved user suffix/username, and updated the logged-in share-public tests to authenticate and assert against that exact provisioned identity.
