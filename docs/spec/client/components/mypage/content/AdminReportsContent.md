# AdminReportsContent Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Admin "Admin reports" section: renders the persisted `admin_reports` rows (`GET /api/admin/reports`) as a refreshable list with an expandable per-kind payload detail and row-level repair actions (content-hash backfill, per-node repair-sync, per-node permanent delete). Read + repair surface; no create. |
| Used in            | `SystemSettingsContent`, between the env→DB config-sync row and the "Advanced settings" accordion.                                                                                                                                                                                                             |
| Related components | `SystemSettingsContent` (page-level Snackbar via `onSnackbar`), `ConfirmDialog` (shared, purge confirmation), `adminService.getAdminReports` / `repairAdminReport`                                                                                                                                             |
| API contract       | `docs/spec/server/routes/admin.md` §2.2.6 (list/detail/repair + action matrix)                                                                                                                                                                                                                                 |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/AdminReportsContent.js`
- **Test file:** `client/src/components/mypage/content/__tests__/AdminReportsContent.test.js`

### 2.2 Props

| Name       | Type     | Required | Default | Description                                                                                                                        |
| ---------- | -------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| onSnackbar | function | N        | -       | Page-level Snackbar handler; called with `{ type: 'success'\|'error', text }`. Mirror of the `SystemConfigEditor` mount precedent. |

### 2.3 Callback Signatures

| Callback   | When invoked                                          | Arguments                            |
| ---------- | ----------------------------------------------------- | ------------------------------------ |
| onSnackbar | Repair success (backfill / repair-sync / perm-delete) | `(msg)` where `msg = { type, text }` |

### 2.4 Dependencies

- **imports:** `useTranslation`, MUI (`Alert, Box, Button, Chip, CircularProgress, Collapse, Typography`), `adminService`, `errorUtils` (`getServerErrorDisplay`, `getServerMessageDisplay`), shared `ConfirmDialog`.
- **Data fetching:** `adminService.getAdminReports()` on Refresh click only — **zero data fetch on mount** (the section is inert until the operator refreshes; `repairAdminReport` is the only other call).
- **Payload mining:** one-line summaries and detail rows are derived from the payload per kind (precedent: the cleanup-snackbar summary mining in `SystemSettingsContent`); unknown/absent sections degrade to nothing rendered, never to a crash.

### 2.5 Data Contract (server-produced payload shapes, mirrored)

Wire row (list entries and the single-report/repair responses): `{ id, kind, status, payload, created_at }` — `created_at` snake_case, `payload` parsed object or `null`, list newest-first (server ordering; the client renders it as returned).

`kind` ∈ `gc | migration | failsafe | night_eval | cleanup`; `status` ∈ `ok | partial`.

- **`failsafe`** (startup scan merged with the boot content-hash completeness section):
  `{ scanned, resolved, manualReview: [{ nodeId, path }], pendingUpload: { scanned, nodes: [{ nodeId, name, type, path, createdAt, updatedAt, classification, pendingS3Key, blobPresent }] }, contentHashCompleteness?: { nullCount, checkedAt, backfilled?, backfilledAt?, errors? } }`
  (`contentHashCompleteness` is absent when the boot probe failed; `nullCount: null` when the count itself failed; `backfilled`/`backfilledAt` appear after a `content_hash` repair.)
- **`gc`**: the full GC-cycle result
  `{ tier1: { orphanedRows, guardedRows, deletedBlobs, deletedRows, pendingDeletedRows, errors[] }, tier2: { scannedKeys, untrackedKeys, deletedKeys, skipped, errors[] }, tier3: { purgedNodes, deletedBlobs, deletedRows, skipped, errors[] } }`
  or `{ error }` for a failed run.
- **`cleanup`**: the cleanup-run result `{ errors[], gc: { tier1, tier2, tier3 } | null, orphanedNodes: [{ nodeId, path }], pendingUploadNodes: [{ nodeId, name, type, path, createdAt, updatedAt, classification, pendingS3Key, blobPresent }] }`.
- **`migration` / `night_eval`**: enum values with no producer today — label rendering only, no summary, no detail, no repair affordance.

### 2.6 Rendering Contract

- Header row: section title `admin.reports.title` + refresh button (`admin.reports.refresh`, `data-testid="admin-reports-refresh"`, disabled + `CircularProgress` while the list request is in flight).
- One row per report, in list order, `data-testid="admin-reports-row-<id>"`, showing:
  1. `created_at` localized (`toLocaleString`);
  2. kind label chip (`admin.reports.kind.<kind>`; an unknown kind falls back to the raw value);
  3. status chip tone: `ok` → success (`admin.reports.status.ok`), `partial` → warning (`admin.reports.status.partial`);
  4. a one-line summary mined per kind:
     - `failsafe`: scanned / resolved / manual-review count / pending-upload scanned / content-hash `nullCount` (non-finite `nullCount` renders the unknown marker);
     - `gc`: tier1 blob/row deletions, tier2 deleted keys, tier3 purged nodes (missing sections → 0); `{ error }` → the failed-run line with the error text;
     - `cleanup`: orphaned / pending-upload node counts + error count;
     - `migration` / `night_eval` / unknown: no summary line.
- Payload detail per row behind an expand toggle (`admin.reports.expand` / `admin.reports.collapse`, MUI `Collapse`), rendered only when the payload has detail for its kind: tier counts (`gc` / `cleanup.gc`), the `manualReview` / `pendingUpload.nodes` / `orphanedNodes` / `pendingUploadNodes` node lists (path/name + nodeId per entry), and the `contentHashCompleteness` section (`nullCount`, `checkedAt` localized, `backfilled` when present).
- Empty state after a successful refresh with zero rows: `admin.reports.empty`.
- Load failure: inline `Alert severity="error"` with `getServerErrorDisplay(error.response.data, t)` (fallback `admin.reports.loadFail`).

### 2.7 Repair Visibility Matrix

| Control                                             | Visibility condition                                                                                                                                                                                                                      | Request body                                              | Row after success                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Backfill content hashes (`admin.reports.backfill`)  | iff `kind === 'failsafe'` **and** `payload.contentHashCompleteness` is an object **and** `nullCount` is finite and `> 0`; `data-testid="admin-reports-backfill-<id>"`                                                                     | `{ action: 'content_hash' }`                              | RE-RENDERED (list re-fetch shows the new `nullCount`/`backfilled` and status) |
| Repair-sync per node (`admin.reports.repairSync`)   | every node entry carrying a finite `nodeId` in `manualReview`, `pendingUpload.nodes` (`failsafe`) or `orphanedNodes`, `pendingUploadNodes` (`cleanup`), inside the expanded detail; `data-testid="admin-reports-node-repair-<nodeId>"`    | `{ action: 'repair-sync', nodeId, repairAction: 'auto' }` | UNCHANGED (re-fetch returns the same row)                                     |
| Permanently-delete per node (`admin.reports.purge`) | same node entries as Repair-sync, via the shared `ConfirmDialog` (trash-parity wording — title/confirm `actions.purge`, body `admin.reports.purgeConfirmBody` with the node name/path); `data-testid="admin-reports-node-purge-<nodeId>"` | `{ action: 'perm-delete', nodeId }`                       | UNCHANGED (re-fetch returns the same row)                                     |

- Node entries WITHOUT a finite `nodeId` (missing / non-numeric) never get action buttons (guard: only finite nodeIds are ever dispatched).
- `gc` / `migration` / `night_eval` rows carry no repair affordance (no node lists; `content_hash` is refused server-side on non-`failsafe` rows).

### 2.8 Busy States, Feedback, Errors

- **Busy scoping is row-/node-scoped**: while a repair is in flight only the dispatched control is disabled and shows `CircularProgress`; other rows and other node buttons stay enabled. The synchronous content-hash backfill can take a while — its row's backfill button keeps the spinner until the response arrives.
- **Success feedback:** page Snackbar via `onSnackbar` with `getServerMessageDisplay(response, t)` (`serverMessages.admin.reportRepaired` / `repairSyncDone` / `permDeleteDone`), then **the list is re-fetched** (single `GET /api/admin/reports`) so a re-rendered `failsafe` row shows its repaired state. Expanded rows stay expanded across the re-fetch.
- **Repair failure:** inline `Alert severity="error"` (`data-testid="admin-reports-repair-error"`) with `getServerErrorDisplay(error.response.data, t)` — e.g. a 400 `serverErrors.admin.repairNotAvailable` renders its translated message; the list is NOT re-fetched and the row keeps its pre-repair state.
- **Purge confirmation:** the `ConfirmDialog` owns the destructive step; cancelling closes it and dispatches nothing.

### 2.9 Stable Test IDs (E2E contract)

`admin-reports-section` (section root), `admin-reports-refresh`, `admin-reports-row-<id>`, `admin-reports-expand-<id>`, `admin-reports-backfill-<id>`, `admin-reports-node-repair-<nodeId>`, `admin-reports-node-purge-<nodeId>`, `admin-reports-error` (load failure), `admin-reports-repair-error` (repair failure), plus the shared `confirm-dialog-confirm` / `confirm-dialog-cancel` for the purge flow.

### 2.10 i18n Keys

- `admin.reports.title`, `admin.reports.refresh`, `admin.reports.empty`
- `admin.reports.kind.gc|migration|failsafe|night_eval|cleanup`
- `admin.reports.status.ok|partial`
- `admin.reports.summary.failsafe` (`{scanned}`/`{resolved}`/`{review}`/`{pending}`/`{nullCount}`), `admin.reports.summary.gc` (`{blobs}`/`{rows}`/`{keys}`/`{purged}`), `admin.reports.summary.gcFailed` (`{error}`), `admin.reports.summary.cleanup` (`{orphaned}`/`{pending}`/`{errors}`), `admin.reports.unknown`
- `admin.reports.expand`, `admin.reports.collapse`
- `admin.reports.label.manualReview|pendingUpload|orphanedNodes|pendingUploadNodes|nullCount|checkedAt|backfilled|tier1|tier2|tier3|errors`
- `admin.reports.detail.tier1` (`{orphaned}`/`{guarded}`/`{blobs}`/`{rows}`/`{pending}`), `admin.reports.detail.tier2` (`{scanned}`/`{untracked}`/`{deleted}`), `admin.reports.detail.tier3` (`{purged}`/`{blobs}`/`{rows}`)
- `admin.reports.backfill`, `admin.reports.repairSync`, `admin.reports.purge`, `admin.reports.purgeConfirmBody` (`{name}`)
- `admin.reports.loadFail`, `admin.reports.repairFail`
- Server codes (already mirrored): `serverErrors.admin.reportNotFound`, `serverErrors.admin.repairNotAvailable`, `serverMessages.admin.reportRepaired`, `serverMessages.admin.repairSyncDone`, `serverMessages.admin.permDeleteDone`
- Reused: `actions.purge`, `common.cancel`

### 2.11 Verification Scenarios

- [ ] No request fires on mount; the list loads only on Refresh click and re-loads after every successful repair
- [ ] Rows render created_at localized, kind chip, status chip tone, per-kind one-line summary; server order preserved
- [ ] Expand toggles the payload detail (tier counts; node lists; `nullCount`/`checkedAt`/`backfilled`)
- [ ] Backfill button appears iff `failsafe` ∧ `contentHashCompleteness` object ∧ finite `nullCount > 0` (absent for `nullCount` 0/null, non-`failsafe` kinds)
- [ ] Repair-sync + Permanently-delete render per finite-nodeId entry in `manualReview`/`pendingUpload.nodes`/`orphanedNodes`/`pendingUploadNodes`; entries without a finite nodeId get no buttons
- [ ] `content_hash` success: Snackbar (`reportRepaired`), list re-fetched, re-rendered row visible (nullCount/backfilled/status)
- [ ] `repair-sync` success sends `{ action: 'repair-sync', nodeId, repairAction: 'auto' }`, Snackbar (`repairSyncDone`), row unchanged, list re-fetched
- [ ] `perm-delete` runs behind the shared ConfirmDialog (`confirm-dialog-confirm`), Snackbar (`permDeleteDone`), row unchanged, list re-fetched; cancel dispatches nothing
- [ ] 400 `repairNotAvailable` renders the translated inline Alert and skips the re-fetch
- [ ] Busy affordance: in-flight control disabled + progress, scoped to its row/node only
- [ ] Empty list renders the empty state; load failure renders the translated error Alert

### 2.12 Edge Cases

- `payload: null` → row renders chips + no summary + no expand toggle (nothing to mine).
- `contentHashCompleteness` with `error` (count failed, `nullCount: null`) → summary renders the unknown marker; NO backfill button (a null count is not a finite `> 0`).
- GC `{ error }` payload → `gcFailed` summary line; no tier detail.
- Repeated Refresh clicks during an in-flight request: the button is disabled while loading.
- A repair response for a row id no longer present after re-fetch (retention prune): the re-fetched list simply renders without it.
