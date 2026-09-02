# Codebase Improvement Plan — Consolidated Open-Item Tracker

> **Updated**: 2026-09-03
> **Purpose**: This is the **single tracking document** for every unresolved, undecided, or
> unimplemented item in the repository.
>
> **Governance rule**: Spec/feature docs describe only the **current implemented/decided**
> state. Planned/future/"pending implementation"/"target contract" work must **not** be written
> into individual docs — record it here instead (see AGENTS.md §2.1).
>
> **Status legend**: `DEFERRED`

---

## 1. Deferred & future work (no active owner)

Ordered by urgency review (2026-09-02): highest priority first.

| ID | Status | Item | Originating doc (now references here) |
| -- | ------ | ---- | ------------------------------------- |
| DEF-2 | DEFERRED | Test black-box compliance refactor — client + server; audit 2026-09-02 (~155 violations in 12 files). Fragile client mock factories. | see DEF-2 detail below |
| DEF-3 | DEFERRED | env↔DB sync/alert tool (D9). | `docs/features/config-source-resolution.md` |
| DEF-4 | DEFERRED | FileManager `useMemo`/`useCallback` performance sprint (MutationObserver already applied). | former improvement-plan backlog (pre-2026-09-02, item #12) |
| DEF-5 | DEFERRED | `encrypt_secret_key` rotation tooling. | `docs/features/config-source-resolution.md` |
| DEF-6 | DEFERRED | HTTP Range/206 support on public share download. | `docs/spec/server/routes/sharePublic.md` |
| DEF-7 | DEFERRED | Blob migration source-delete mode (`--delete-mode`). | `docs/spec/server/tools/blob-migration.md`, `docs/SETUP.md` |
| DEF-8 | DEFERRED | Admin/operator app split (recorded, not planned). | `docs/features/migration-mode.md` |
| DEF-9 | DEFERRED | Redis-backed cache / operationProgress store. | `docs/spec/server/services/downloadService.md`, `docs/ARCHITECTURE.md` |
| DEF-10 | DEFERRED | CRA v5 → Vite migration (separate project/epic). | former improvement-plan backlog (pre-2026-09-02, item #13) |
| DEF-11 | DEFERRED | Multi-version object history (`version_number > 1`). | `docs/spec/server/services/blobStorageService.md`, `docs/spec/server/store/fileNodesStore.md`, `docs/features/core-service-layer.md` |

---

### DEF-2 detail — black-box violation audit (2026-09-02)

**Scope & method.** All 243 test files were audited (client `client/src` 156, server `server/` 87).
Per AGENTS.md §3.1 and `docs/TESTING_STRATEGY.md` (verify "what" not "how"), only these were
counted as violations:

- **V1** implementation-detail wiring pin — a mock-inspection assertion
  (`toHaveBeenCalledWith` / `toHaveBeenCalledTimes` / `toHaveBeenCalled` / `.mock.calls[...]`)
  that pins an internal call into a mocked pure util / imported helper / sibling hook or service
  with exact internal args or context tokens, when the behavior is observable through the
  module-under-test output/state/UI.
- **V2** internal-helper re-implementation + call pin (mock a pure helper, re-create its logic,
  then pin its call tuple).
- **V3** internal reach — non-public/implementation-only internals or `.mock.calls[i]`
  sequencing that is not the seam under test.

Excluded as legitimate (not counted): HTTP/`apiClient` contract assertions; service→store /
service→adapter param-contract conformance that specs mandate; component prop callbacks (public
interface); observable outcomes (`screen`, `waitFor`, `result.current`, return values); and
supertest full-HTTP route assertions.

**Totals**

| Area | Test files | Violations (V1/V2/V3) | Files with violations | Borderline |
| ---- | ---------- | --------------------- | --------------------- | ---------- |
| Client | 156 | 8 (V1 8) | 4 | ~25 |
| Server | 87 | ~147 (V1 ~145, V2 2) | 8 | ~30 |
| All | 243 | ~155 | 12 | ~55 |

**Client — strong compliance; only 4 files flagged**

- `pages/FileManager/hooks/__tests__/useExplorerCommands.test.js` — V1 3. Pins mocked sibling
  hooks/error util with internal tuples: `handleFileRename(file, 'renamed.txt',
  { startedNodeId: 10 })` (`:224-228`), `handleBulkDelete({ nodeIds:[42,43] }, null)` (`:248-253`),
  `showErrorFromError(..., raw t)` (`:266-271`) — outcomes already asserted via state/dialogs.
- `pages/FileManager/hooks/__tests__/useExplorerInteraction.test.js` — V1 1. `canPreview`
  `toHaveBeenCalledWith('report.txt')` (`:261`) while the preview-open outcome is asserted at `:262`.
- `hooks/__tests__/useMessage.test.js` — V1 1. `getServerErrorDisplay` call pin (`:158`)
  redundant to the asserted output message (`:161`).
- `components/dialogs/FilePreviewDialog.test.jsx` — V1 3. `getVideoPreviewStreamUrl(20, …)`
  (`:261`), `getFileBlob(2, …)` (`:280`), `not.toHaveBeenCalledWith(1, …)` (`:333`) substitute for
  asserting the rendered preview/video source.

Client mock-factory structural debt (separate from assertion counts): `testing/mocks/serviceMocks.js`
mirrors full service export surfaces key-for-key (`createFileServiceMock` 22 keys ↔ 22 exports;
used by ~20 test files), and `createMigrationServiceMock` is stale/dead (mirrors 3 of 8 real
exports, referenced by no test). Target shape = behavior-based factories (values/defaults, not
full-surface mirrors).

**Server — few files, one dense judgment cluster**

| File | V1/V2 | Notes |
| ---- | ----- | ----- |
| `domains/files/services/__tests__/fileService.test.js` | ~95 / 2 | Whole-file call-graph pins into injected mock services (fileNodeService/aclService/blobStorageService/uploadService): order, exact args, counts, absence. |
| `domains/files/services/__tests__/batchOperationService.test.js` | ~30 | e.g. `:486` `copyFile` 2× + exact args while `copiedCount:2` already asserted. |
| `domains/files/services/__tests__/downloadService.test.js` | ~9 | `:108-110` per-file permission-check sequencing via call count/args. |
| `service/__tests__/blobStorageService.test.js` | 3 | `:387-389` internal arg pins while returned-content equality (`:390`) is the observable. |
| `service/__tests__/gcService.test.js` | 1 | `:242` `Date` arg-format pin; deletion behavior already asserted (`:247-249`). |
| `service/__tests__/uploadService.test.js` | 1 | `:80` `uploadBlob` arg pin redundant to store read-back (`:81-83`). |
| `infrastructure/adapters/.../config.test.js` | 4 | Mocked `S3BlobStore` constructor exact-config pins; effective state already asserted via `forcePathStyle` (`:99`). |
| `utils/__tests__/errorHandler.test.js` | 2 | `:224-240` pins internal `healthReport()` side channel with no observable equivalent. |

**Caveats / accuracy**

- The former "424" figure is **not reproducible**; 424 matches the client's total
  `toHaveBeenCalledWith` count (376), most of which is legitimate. Hard client violations are 8.
- The server `domains` cluster (~134) is the most judgment-sensitive: thin orchestrators with
  mocked stores make delegation wiring the only runtime signal. Under a strict reading these are
  V1; if documented delegation seams are exempted, the total drops by up to ~100. The unambiguous
  hard subset is client 8 + server 11 (infra/ssm/utils clusters).
- ~55 borderline instances are exact-arg pins co-located with observable assertions
  (mostly documented seam checks that over-specify request shaping) — a secondary reduction pool.

**Suggested sequencing for DEF-2 work**

1. Client: fix the 4 flagged files (8 assertions), then trim the full-surface mock factories
   (`serviceMocks.js`) toward behavior-based defaults and delete the dead `createMigrationServiceMock`.
2. Server: start with the unambiguous 11 (blobStorage/gc/upload/config/errorHandler), then tackle
   the three orchestrator files (fileService, batchOperationService, downloadService) — largest
   surface, requires deciding the seam policy for delegation pins first.
3. Decide once, repo-wide: when a delegation pin is documented by a spec as the seam under test,
   it is exempt; otherwise drop the pin or assert the observable outcome.

---

### Completion note (2026-09-02)

All previously open items were resolved on 2026-09-02 and removed from this tracker during
consolidation:

- decisions D-1…D-3 (refreshPolicy direction, dead `fileService` permission wrappers, iOS
  "Save Image" hint),
- code changes C-1…C-4 and M-1 (envFileWriter allowlist, `fileService` wrapper removal,
  `refreshPolicy` nodeId migration, setup-suite PG gating, `removeExplorerRecentFile` param),
- residual doc drift 3-1…3-4, and the pre-2026-09-02 completed backlog.

The resolved-work log and its provenance commits were removed with the completed items. No
open items remain outside the DEF list above.

---

### Completion note (2026-09-03)

- DEF-1 (schemaManager checksum-based modified-DDL detection, Option A hard fail) implemented
  on 2026-09-03 via `feature/checksum-ddl-detection`.
