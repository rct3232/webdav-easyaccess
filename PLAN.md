# PLAN — S3PG E2E Coverage Consolidation

Status: IN PROGRESS.
Branch: `refactor/s3pg-e2e-consolidation` (base: `dev`).

## 1. Objective

The `e2e/s3-pg-integration.spec.ts` suite (E2E-S3PG-001..009) overlaps heavily with the
backend-agnostic webdav-mode e2e suite and with server-layer unit/integration tests. Since the
S3+PostgreSQL architecture is now proven, redistribute its coverage to the appropriate layer:

- **001** — fully redundant (upload/list/download bytes covered by E2E-EXP-005 + E2E-SETUP-001). Remove.
- **002/003/006/007** — user-observable API/UI flows that are backend-agnostic at the API level. Port
  their unique assertions into the webdav-capable e2e specs so they run in BOTH backend modes.
- **004/005/008/009** — S3-storage-internal behavior (copy-on-write, GC, DB/blob agreement). Currently
  only partial server coverage exists. Add the missing server integration assertions, then remove the
  e2e duplicates.

## 2. Scope

### 2.1 Port unique e2e coverage (backend-agnostic)

| Scenario | Unique assertion to preserve | Target |
|---|---|---|
| S3PG-002 | Byte-equality of download after rename; single-node rename API; old-path-gone | `E2E-EXP-012` in `core-flow.shared.spec.ts` |
| S3PG-003 | Byte-equality of download after move; single-node move API; old-path-gone | `E2E-EXP-013` in `core-flow.shared.spec.ts` |
| S3PG-006 | 2-level descent below grant point + requester downloads grandchild | `E2E-OVERLAY-011` in `share-internal.spec.ts` |
| S3PG-007 | Share link created then file renamed; anonymous token still serves | `E2E-SHARE-011` in `share-public.spec.ts` |

Shared API helpers (dedupe existing duplicates in `s3-pg-integration.spec.ts`,
`helpers/shareLinks.ts`, `share-internal.spec.ts`):
`createFolderAt`, `uploadFileAt`, `downloadFile`, `listNodeChildren`, `resolvePathOrNull`.

### 2.2 Add missing server-layer coverage (S3 internals)

| Behavior | Server gap to close |
|---|---|
| S3PG-004 CoW | Full chain: upload → copy (shared s3_key) → overwrite copy → original byte-identical |
| S3PG-005 delete→GC | Delete → blob survives (lazy) → GC route (S3 mode) → orphan gone, active node's blob survives + downloads |
| S3PG-008 untracked GC | GC route (S3 mode) over a real adapter + untracked blob → counters + physical removal |
| S3PG-009 DB/blob agreement | "Physical blob remains after delete" boundary against the mock store |

## 3. Success criteria

- New e2e tests E2E-EXP-012/013, E2E-OVERLAY-011, E2E-SHARE-011 pass in BOTH `s3` and `webdav`
  backend modes (no self-skip).
- Server integration tests cover the 4 S3 internals gaps; `npm run test:ci` (server) green.
- `e2e/s3-pg-integration.spec.ts` and its PG/MinIO-only helpers are removed; `playwright.config.ts`,
  `.env.e2e`, global setup/teardown updated.
- `docs/E2E_COVERAGE_PLAN.md` inventory reflects the new ownership.

## 4. Progress log

- 2026-09-02: Analysis complete — S3PG-001 fully redundant; 002/003/006/007 portability verified
  (all API-level, backend-agnostic; webdav rename/move sync path makes them the direct regression
  net); 004/005/008/009 server coverage is PARTIAL with one observable gap each. Branch created.
- 2026-09-02: Implementation complete. Ported E2E-EXP-012/013 (core-flow.shared),
  E2E-OVERLAY-011 (share-internal), E2E-SHARE-011 (share-public); added shared API helpers
  (createFolderAt/uploadFileAt/downloadFile/listNodeChildren/resolvePathOrNull); added server
  integration coverage for CoW chain, delete→GC (admin.test.js S3 mode), untracked-blob GC route,
  lazy-delete boundary (files.integration.test.js); removed `e2e/s3-pg-integration.spec.ts` +
  `e2e/helpers/pg.ts` + `putBlob`; updated playwright.config.ts testMatch, `.env.e2e` (dropped
  `GC_ORPHAN_TTL_DAYS=0.00002`), docs. Server `test:ci` green (85 suites, 1633 passed, 5 skipped).
- 2026-09-02: Server integration gaps for S3PG-004/005/008/009 closed.
  - `files.integration.test.js`: SCENARIO-4 extended with the full CoW chain (overwrite copy leaves
    original byte-identical + store blob intact); new SCENARIO-5B runs the GC route over an untracked
    blob (Tier-2 counters + physical removal); SCENARIO-5 extended with the lazy-delete boundary
    (physical blob remains after delete).
  - `admin.test.js`: new S3-mode describe runs the full delete → lazy blob → GC route flow (orphan
    reclaimed, active control blob + row + download survive). GC_ORPHAN_TTL_DAYS set to '0' per suite
    and restored; blobs backdated in the mock store so Tier-2 deterministically scans them.
  - Verified: both files pass on sqlite (`npm run test:ci` 85/85 suites green) and on the PG backend
    (scoped run 2/2 suites green; full `test:ci:pg` only fails pre-existing PG-incompatible suites
    `setup.test.js` and `sqliteTransaction.test.js`, unrelated to these changes). eslint + prettier clean.
