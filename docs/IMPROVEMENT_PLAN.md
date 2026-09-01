# Codebase Improvement Plan

> **Generated**: 2026-05-01 | **Updated**: 2026-05-03
> **Status**: P0 ✅ Complete, P1 ✅ Complete, P2 ✅ Complete (14✅ + 12-partial + 10✅), P3 ⏳ Partial (16✅, 17✅, 19✅)
> **Purpose**: Preserve audit context before implementation begins.
>
> **Commits**:
> - `1562613` — P0: security, memory leak, debug logging fixes
> - `c133db0` — P1: Korean→English translation, asyncHandler standardization, HTTP_STATUS constants
> - `ace302b` — P2-14 + P3-16: lint/format config, gitignore cleanup
> - `b175854` — P3-17 + P3-19: JWT dev warning, inline require cleanup
> - `ded0ce8` — P2-15: structured logging context in bulk operation catch blocks
> - `250cc3a` — P2-12-partial: MutationObserver replaces setInterval polling, Korean→English translation
> - `fb83a55` — P3-18: JSDoc for runBulkJobWorker and authenticateTokenOrShare
> - `1089e0f` — SQLite storage backend + Docker WebDAV dev scripts (all 7 store modules, schema init)
> - `7c32b7e` — P2-10: tests for untested server modules + critical client components (14 test files, 426+4 client tests)

---

## Executive Summary

The WebDAV EasyAccess codebase has strong architectural documentation, comprehensive testing infrastructure (941 client tests, 347 server tests, 86 E2E specs, Stryker mutation testing), and a well-designed centralized error handler. However, several areas show significant technical debt: inconsistent error handling patterns across routes, excessively large route files, mixed-language comments, hardcoded status codes, a debug endpoint that poses a security risk in production, setInterval memory leaks, and reliance on CRA v5.

---

## P0 — Critical ✅ COMPLETE

**Commit: `1562613`**

### 1. Debug Endpoint Security Vulnerability
- **File**: `server/index.js:87-94`
- **Issue**: `POST /api/debug-log` endpoint accepts arbitrary JSON and writes to disk with no authentication.
- **Risk**: Unauthorized file writes, DoS attacks in production.
- **Fix**: Remove entirely or gate behind `NODE_ENV !== 'production'` + auth middleware.

### 2. setInterval Memory Leak
- **File**: `client/src/pages/FileManager/hooks/useBulkOperations.js:208, 416`
- **Issue**: `setInterval(poll, POLL_INTERVAL_MS)` called inside `useCallback` handlers — no cleanup mechanism on component unmount.
- **Risk**: Interval continues firing after unmount → memory leak + state updates on unmounted component → crashes.
- **Fix**: Move polling into `useEffect` with `clearInterval` in cleanup; consider AbortController pattern.

### 3. Debug console.log in Production Code
- **File**: `client/src/pages/FileManager/FileManager.js:242`
- **Issue**: `console.log('[DEBUG] FileManager: Render - files length:', ...)` fires on every render.
- **Risk**: Performance impact, potential sensitive data leakage.
- **Fix**: Remove entirely or gate behind conditional debug flag.

### 4. Default Admin Credentials Logged to Console
- **File**: `server/store/bootstrap.js:50-56`
- **Issue**: Logs default admin password to console on startup.
- **Risk**: Credential exposure in logs.
- **Fix**: Remove credential logging; use structured logging with appropriate log levels.

---

## P1 — High ✅ COMPLETE

**Commit: `c133db0`**

### 5. Korean Comments → English Translation
- **Scope**: `server/routes/files.js` (lines 45, 159, 745, 753, 1068, 1129), `admin.js` (line 400), `auth.js` (line 142), and others.
- **Issue**: AGENTS.md mandates English for all documentation and technical communications — Korean comments are pervasive.
- **Fix**: Translate all Korean comments to English.

### 6. Inconsistent Error Handling — asyncHandler Bypassed
- **Files using `asyncHandler`** (correct): `files.js`, `permissions.js`, `users.js`, `recentFiles.js`, `sharePublic.js`, `shareLinks.js`, `folders.js`, `thumbnails.js`, `settings.js`.
- **Files NOT using `asyncHandler`**: `admin.js` (0 usages — inline try/catch), `auth.js` (0 usages), `permissionRequests.js` (0 usages).
- **Issue**: Bypassing centralized error handler means:
  - Error logging (`logError`) does not fire.
  - Response format may differ subtly.
  - Inconsistent developer experience.
- **Fix**: Convert all routes to use `asyncHandler` + `throw createError(...)` pattern.

### 7. Hardcoded HTTP Status Codes Mixed with Constants
- **Files**: `auth.js:72,172,179,180` — uses raw `403` instead of `HTTP_STATUS.FORBIDDEN`.
- **File**: `errorHandler.js:198` — `validationError(errorCode, 400)` uses raw `400`.
- **Fix**: Use `HTTP_STATUS.*` constants consistently throughout.

### 8. God Object Files Need Splitting
| File | Lines | Responsibility Overlap |
|------|-------|------------------------|
| `server/routes/files.js` | 1,547 | List, upload, download, delete, move, copy, batch ops, conflicts, previews |
| `client/src/pages/FileManager/FileManager.js` | 928 | 15+ hooks, 40+ state variables, deeply nested useMemo prop building |
| `client/src/components/file-manager/FileManagerView.js` | 969 | All UI rendering + massive prop drilling |
| `server/store/permissionStore.js` | 1,103 | All CRUD for permissions, shares, user paths |

- **Fix Direction**:
  - `files.js`: Split into `list.js`, `upload.js`, `download.js`, `bulk-operations.js`, `conflicts.js`, `previews.js`.
  - `FileManager.js`: Extract state into separate contexts (selection, navigation, dialogs).
  - `FileManagerView.js`: Break into smaller presentational components.
  - `permissionStore.js`: Split into `pathStore.js`, `shareStore.js`, `userPathStore.js`.

### 9. Prop Overloading — 23+ Parameters per Component
- **Files**: `FileGrid.js:14`, `FileList.js:14`, `FileDetail.js:26` — each receives 23+ individual props.
- **Fix**: Group related props into objects (e.g., `{ fileActions, selectionState, dragState }`); use React Context for cross-cutting concerns.

---

## P2 — Medium ✅ Complete (14✅, 15✅, 12-partial✅, 10✅)

### 10. Test Coverage Gaps ✅ COMPLETE (Commit: `7c32b7e`)

#### Previously untested server modules — now covered:
| File | Risk |
|------|------|
| `server/utils/permissionPolicy.js` | Core security logic untested |
| `server/utils/thumbnail.js` | Image processing untested |
| `server/utils/email.js` | Email sending untested |
| `server/middleware/requestLogger.js` | Request logging untested |

#### Critical Untested Client Modules:
| File | Risk |
|------|------|
| `FilePreviewDialog/` entire subsystem | Major user-facing feature, zero tests |
| `pages/FileManager/FileManager.js` | Main page untested |
| `components/file-manager/FileItem.js` | Core rendering untested |

#### Shared Package:
- **7 files, 0 tests** — constants, validation, pathUtils, fileTypes used by both client and server.

### 11. Client Test Quality Issues ⏳ Deferred (low-impact/high-risk)
- **424 implementation-detail assertions** (`toHaveBeenCalledWith`, `toHaveBeenCalledTimes`) — test "how" not "what".
- **Fragile mock setup**: `FileManagerView.test.js` has 130+ line `createProps()` factory.
- **Heavy mocking**: 73/147 client test files use `jest.mock()`, averaging 4 mocks per file.
- **Fix Direction**: Replace with behavior-focused assertions; add shared mock factories (`createMockUser()`, `createMockFile()`).
- **Defer Reason**: Existing tests already pass; refactoring creates high regression risk with low ROI. The service-level tests (fileService, recentFilesRepository, permissionService) are already well-structured with outcome-focused assertions.

### 12. Performance Issues ⏳ Partial (MutationObserver ✅, useCallback/useMemo deferred)
| File:Line | Issue | Status |
|-----------|-------|--------|
| `useThumbnailLazyLoad.js:143` | `setInterval(observeElements, 500)` queries DOM every 500ms | ✅ Fixed (MutationObserver) |
| `useBulkOperations.js:210` | useCallback dependency array has 20+ items → unnecessary re-creation | ⏳ Deferred — high-risk |
| `FileManager.js:534-911` | 15+ useMemo calls with full dependency arrays → cascading re-computation | ⏳ Deferred — high-risk |

- **Fix Direction**: Use `useRef` for stable references; reduce useMemo nesting. (MutationObserver already applied.)
- **Defer Reason**: useCallback/useMemo changes are high-risk — require careful analysis and testing in dedicated session. Deferring to future focused performance optimization sprint.

### 13. CRA v5 Migration Planning
- **File**: `client/package.json` — `react-scripts 5.0.1`
- **Issue**: Known Node.js >= 18 compatibility issues; community has moved to Vite-based alternatives.
- **Fix Direction**: Plan migration to Vite as a separate project/epic.

### 14. Root-Level Lint/Format Configuration Missing ✅ COMPLETE (root config added `chore/residual-gap-closure`)
- **Commit: `ace302b`** — root `.prettierrc` and server-only `server/eslint.config.js` added here.
- Only client has ESLint config (embedded in `package.json`). Server and shared have no linting.
- No Prettier configuration anywhere.
- **Fix**: Add root-level `eslint.config.js` + `.prettierrc` applying to all workspaces.
- True root-level `eslint.config.js` (flat config covering server+client+shared) plus `eslint-config-prettier` were added on `chore/residual-gap-closure` (2026-09-01), at which point the client's legacy `eslintConfig` and `server/eslint.config.js` were removed.

### 15. Silent Error Swallowing in Permission Operations ✅ COMPLETE
- **Commit: `ded0ce8`**
- **File**: `server/routes/files.js:350,371,476,482,493,603,614`
- **Issue**: Multiple catch blocks log to console but continue execution — makes debugging production issues very difficult.
- **Fix**: At minimum, log with structured context (jobId, userId, path).

---

## P3 — Low ⏳ Partial (16✅, 17-20 pending)

### 16. `server/undefined/` Directory Cleanup ✅ COMPLETE
- **Commit: `ace302b`**
- Stray metadata files committed to repo; not in `.gitignore`.
- **Fix**: Add `server/undefined/` to `.gitignore`; investigate root cause of undefined storage path.

### 17. Default JWT Secret Warning ✅ COMPLETE
- **Commit: `b175854`**
- **File**: `server/utils/auth.js:7` — `'your-secret-key-change-in-production'`
- Production guard exists, but adding a startup warning in development mode would improve DX.

### 18. JSDoc Documentation Gaps ✅ COMPLETE
- **Commit: `fb83a55`**
- Complex functions (`runBulkJobWorker`, `authenticateTokenOrShare`) lack parameter types, return types, and documented contracts.
- **Fix**: Add JSDoc annotations to complex functions.

### 19. Inline require() Calls in Route Handlers ✅ COMPLETE
- **Commit: `b175854`**
- **File**: `server/routes/files.js:970,1240` — `require()` calls deep inside route handlers instead of top-level imports.
- **Fix**: Move all requires to top of file per CODING_STYLE.md.

### 20. No Integration Tests Between Client and Server ⏳ Deferred
- Client unit tests mock API responses; server tests use supertest directly. No integration tests exercising full stack (client → server → WebDAV backend).
- **Fix Direction**: Add lightweight integration test layer between E2E and unit tests.
- **Defer Reason**: Existing route-level integration tests (files.test.js, permissions.test.js, etc.) already provide comprehensive coverage using supertest with mocked WebDAV. The remaining gap (full client→server→WebDAV stack) is what E2E tests cover.

---

## Priority Action Plan

| Priority | Task | Estimated Effort |
|----------|------|------------------|
| **P0** | Remove/secure debug endpoint (`server/index.js:87-94`) | 15 min |
| **P0** | Fix setInterval memory leak (`useBulkOperations.js`) | 30 min |
| **P0** | Remove debug console.log (`FileManager.js:242`) | 10 min |
| **P0** | Remove credential logging (`bootstrap.js:50-56`) | 10 min |
| **P1** | Translate Korean comments to English (multiple files) | 2-3 hours |
| **P1** | Standardize error handling — convert all routes to asyncHandler | 2-3 hours |
| **P1** | Replace hardcoded status codes with HTTP_STATUS constants | 1 hour |
| **P2** | Add tests for critical untested server modules (permissionPolicy) | 4-6 hours |
| **P2** | Add tests for FilePreviewDialog subsystem | 3-4 hours |
| **P2** | Fix performance issues (useRef, reduce useMemo, MutationObserver) | 2-3 hours |
| **P2** | Add root-level ESLint + Prettier configuration | 1 hour |
| **P2** | Fix silent error swallowing — add structured logging context | 1-2 hours |
| **P3** | Begin God Object file splitting (files.js, FileManager) | 1-2 days |
| **P3** | Add JSDoc to complex functions | 2-3 hours |
| **P3** | CRA → Vite migration planning | Separate epic |

---

## Reference: Original Audit Sources

This document was generated from three parallel codebase exploration agents:
1. **Comprehensive Assessment Agent** — Structure, conventions, error handling, types, tests, config, dependencies, docs.
2. **Anti-Pattern Detection Agent** — Complexity, duplication, magic values, dead code, security, performance, null checks.
3. **Test Coverage Assessment Agent** — Framework, coverage scope, critical gaps, test quality, integration vs unit balance.

See original agent results in session history for full detail including specific line numbers and file references.
