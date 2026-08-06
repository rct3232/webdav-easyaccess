# PLAN: Test Suite Alignment (TESTING_STRATEGY.md 준수)

## Objective

Re-align the server + client test suites to the mandatory policies in `docs/TESTING_STRATEGY.md` (and its referenced `TEST_GIT_GUIDE.md`). Phase 7 is complete and merged to `dev`; this workstream runs on `refactor/test-suite-alignment` before Phase 8 (E2E excluded). No production behavior change — test code, shared factories, MSW handlers, config, docs only.

## Scope

- **In scope**: shared mock factories, reset policy, MSW contract sync, real-time wait removal, black-box compliance, test placement/layout, jest/stryker config, TEST_SUMMARY/GIT_GUIDE docs, stray test artifacts.
- **Out of scope**: Playwright E2E, production source logic, Phase 8 (S3+PG integration, E2E expansion).

## Baseline (verified 2026-08-06, dev HEAD `776f852`)

| Suite | Files | Result |
|-------|-------|--------|
| server `npm run test:ci -w server` | 68 test files | 68 suites / 1159 passed / 3 skipped |
| client `CI=true react-scripts test --watchAll=false` | 149 test files | 149 suites / 1260 passed / 0 failed |

Coverage/docs claims currently stale: `server/TEST_SUMMARY.md` claims 36 suites/347 tests, `client/TEST_SUMMARY.md` claims 101 suites/941 tests; both wrong vs actual file counts.

---

## Task Dependency Graph

```
Phase A (config/infra) ──→ Phase B (shared factories) ──→ Phase C (mock/MSW/async) ──→ Phase D (layout/cleanup) ──→ Phase E (verify)
   A1 jest aliases            B1 server webdav factory       C1 MSW handler sync            D1 test file relocation      E1 server suite
   A2 test scripts            B2 server store/userStore     C2 reset policy                 D2 TEST_SUMMARY + GIT_GUIDE  E2 client suite
   A3 stryker scope           B3 server service mocks       C3 real-time wait removal       D3 duplicate tests merge     E3 lint
                              B4 client useResponsive       C4 black-box fixes              D4 stray artifact cleanup    E4 summaries
                              B5 client i18n/service mocks  C5 logic-heavy SQL mocks
```

Sequential constraint: B (factories) must land before C (which may extend/use them). C1–C5 are mutually independent once B is done. D independent of B/C results. E gates completion.

---

## Phase A — Configuration & Infrastructure

| Task | Objective | Inputs | Expected Outputs | Verification | Deps |
|------|-----------|--------|------------------|--------------|------|
| A1 | Add `@server/*` + `@testing/*` jest aliases | `server/jest.config.js` | moduleNameMapper for `@server/*` → `<rootDir>` and `@testing/*` → `testing/`; migrate existing deep-relative test imports to aliases (best-effort, no forced migration of untouched files) | server suite resolves alias imports | — |
| A2 | Fix test scripts | `server/package.json`, `client/package.json` | `test:unit` covers store/service/domains (server) and services/contexts (client); `test:integration` includes the 3 full-app tests (`domains/files/__tests__/files.integration.test.js`, `domains/recentFiles/__tests__/recentFiles.test.js`, `infrastructure/__tests__/healthRoutes.test.js`); client `test:integration` no longer matches zero files | `npm run test:integration` runs the 3 full-app suites; client script matches ≥1 suite | A1 |
| A3 | Extend mutation scope | `server/stryker.config.json` | `service/**/*.js` added to `mutate` | stryker config validates | — |

## Phase B — Shared Factories

| Task | Objective | Inputs | Expected Outputs | Verification | Deps |
|------|-----------|--------|------------------|--------------|------|
| B1 | Consolidate server WebDAV mocks | `testing/mocks/webdavMock.js`, `domains/files/services/__tests__/selective{Transfer,Delete,Download}.test.js`, `blobstore/__tests__/WebdavBlobStore.test.js`, `utils/__tests__/thumbnail.test.js`, `infrastructure/__tests__/healthRoutes.test.js` | All 6 files use `createWebdavMock` (with per-test `overrides`); inline `createMockWebdav` removed | affected suites green; no `createMockWebdav` remains | — |
| B2 | Create shared store mocks | `testing/mocks/storeMocks.js` (new): `createUserStoreMock`, `createStorageMock`, `createPermissionStoreMock`, `createLockManagerMock` | Consume in `tokenStore`, `permissionStore.test`, `permissionStore.postgresql.test`, `schemaManager.test`, `lockManager.test`, `shareLinkStore.test`, `aclService.test`, `admin.test` | 8+ suites green; duplicated shapes removed | — |
| B3 | Create shared service mocks | `testing/mocks/serviceMocks.js` (new): `createFileNodeServiceMock`, `createAclServiceMock`, `createBlobStorageServiceMock`, `createInMemoryBlobStore` | Consume in `fileService.test`, `downloadService.test`, `batchOperationService.test`, `blobStorageService.test`, `uploadService.test` | 5 suites green; inline factories removed | B2 |
| B4 | Client useResponsive mock consolidation | `client/src/testing/mocks/useResponsiveMock.js` (exists), 17 test files | All 17 use `createUseResponsiveModuleMock` | client suites green; zero inline `useResponsive` jest.mock | — |
| B5 | Client i18n/service mock consolidation | `client/src/testing/mocks/i18nMock.js`, `serviceMocks.js` (exist); ~40 inline test files | Mass adoption of `createI18nModuleMock`/`create*Mock`; inline service/`react-i18next` mocks replaced | client suites green | B4 |

## Phase C — Mock / MSW / Async Compliance

| Task | Objective | Inputs | Expected Outputs | Verification | Deps |
|------|-----------|--------|------------------|--------------|------|
| C1 | Sync MSW handlers with contract | `client/src/mocks/handlers.js`, `docs/api.md`, `FileManager.test.js:199-262,935-941` | Add 14 missing handlers; restore legacy `POST /files/move|copy`, `DELETE /files/delete`; fix `{ paths }` → `{ nodeIds }` on `/files/metadata`; module state reset between tests; add fallback `http.all` | MSW handler inventory matches api.md; affected tests green | B4 |
| C2 | Reset policy compliance | 9 server test files (auth, tokenStore, healthRoutes, admin, sharePublic, shareLinks, recentFiles, files.integration, permissions routes) | `beforeEach(jest.clearAllMocks)` where missing; remove dead mocks (auth email, admin mockEmail) | suites green; reset policy audited | B1 |
| C3 | Remove real-time waits | `handlers.js:342,362,382`, `ShareLinkLoader.test.js:43`, `httpClient.test.js:81-88`, `useDropToUpload.test.js:124,162`, `useFileOperations.test.js:36`, server `thumbnails.test.js:35`, `files.integration.test.js:89` | Deferred-promise seams or `__setRetryConfigForTests`; fake timers flushed | no real-time waits; suites green + faster | B4 |
| C4 | Black-box compliance | `utils/__tests__/thumbnail.test.js:34-144`, `downloadService.test.js:122-138`, `batchOperationService.test.js:84-86,218-276,490-492`, `useSharedManage.test.js:126-127` | Use public cache API in thumbnail tests; add observable outcome assertions to mock-inspection-dominant tests; relax order-assertions where not contract | affected suites green | B2/B3 |
| C5 | De-logic-heavy SQL mocks | `permissionStore.test.js:9-217`, `permissionStore.postgresql.test.js:28-81`, `shareLinkStore.test.js:14-83`, `lockManager.test.js:77-115` | Replace SQL-text state machines with shared store mocks (B2) + contract-faithful fixtures; assertions via public store API, not mock internal state | suites green; no SQL-`includes()`-routing mocks remain | B2 |

## Phase D — Layout & Cleanup

| Task | Objective | Inputs | Expected Outputs | Verification | Deps |
|------|-----------|--------|------------------|--------------|------|
| D1 | Relocate misplaced tests | 3 full-app tests + 5 domain tests (see inventory §7) | Tests colocated with source; `routes/__tests__` convention restored; duplicate pairs merged | all suites green after move | — |
| D2 | Rewrite summary/guild docs | `server/TEST_SUMMARY.md`, `client/TEST_SUMMARY.md`, `docs/TEST_GIT_GUIDE.md` | Accurate file lists/counts (68 / 149); corrected paths; removed non-existent entries (`Permission.test.js`, `normalizePathParam.test.js`, `bulkJobStore.test.js`, client `folderUtils`/`recentFiles`, `client/src/mocks/server.js`) | docs match actual layout | A2 |
| D3 | Merge duplicate test pairs | FileManager (client ×2), FilePreviewDialog (client ×2), pathUtils (server ×2), sqliteSchemaInit (server ×2), permissionPolicy (server ×2) | One test file per component/module; legacy copies removed | suites green | D1 |
| D4 | Remove stray artifact | `server/undefined/.wea/` (git-tracked test residue) | Directory removed from git; test/process no longer writes there | `git ls-files server/undefined` empty | — |

## Phase E — Verification

| Task | Objective | Expected Outputs | Verification |
|------|-----------|------------------|--------------|
| E1 | Server suite | 68 suites / 1159+ passed / green | `npm run test:ci -w server` |
| E2 | Client suite | 149 suites / 1260 passed / green | `CI=true npx react-scripts test --watchAll=false` |
| E3 | Lint | no new warnings | `npm run lint -w server`; client ESLint via react-scripts |
| E4 | Final docs | TEST_SUMMARY.md both accurate to final counts | manual diff vs actual |

---

## Execution Rules

1. Docs-first: update affected specs/strategy docs before each phase's code changes.
2. Branch: `refactor/test-suite-alignment`; commit per task (Conventional Commits, `<type>: <desc> (test-alignment <task>)`).
3. Delegate: each Phase B/C/D task to a dedicated sub-agent where safely parallel; integration (E) executed by orchestrator.
4. No production behavior change — any production bug surfaced is RCA-classified (A/B/C) and fixed in a separate commit.
5. E2E excluded entirely.

## Success Criteria

- All server + client suites green after each phase (no regression).
- Zero TESTING_STRATEGY violations from inventory categories 1–8 remain (audited).
- `test:unit` / `test:integration` scripts actually exercise their intended scopes.
- TEST_SUMMARY.md (both) match the real layout/counts.
