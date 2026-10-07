# dashboardService Spec

Target-contract spec (server side of `docs/spec/server/routes/dashboard.md`).

## 1. Overview

| Item       | Description                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Role       | Compose the Storage-dashboard read (dups + computed suggestions + trash summary) and the accept-to-trash command over EXISTING surfaces. |
| Boundaries | No SQL, no persistence, no journal writer (P0 journal writers = collections only); no LLM/vectors.                                       |

## 2. Implementation Spec

### 2.1 File Paths

- **Source:** `server/domains/dashboard/service.js`
- **Test file:** `server/domains/dashboard/__tests__/dashboardService.test.js`

### 2.2 Main functions

| Function                                   | Returns (camelCase domain object — the ROUTE serializes snake_case)                                                                                                                                                                            | Contract                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getDashboardSummary(userId)`              | `{ duplicates: { groupCount, duplicateCount, reclaimableBytes }, suggestions: [{ nodeId, kind: 'exact_dup', path, sizeBytes, reason: { kind: 'exact_dup', keepNodeId } }], trash: { itemCount, totalBytes, oldestDeletedAt, retentionDays } }` | ONE `dupFinderService.findExactDuplicateGroups(userId)` pass feeds both `duplicates` (the summary fields) and `suggestions` (members beyond the kept one per group, `keepNodeId` = smallest node id, group order preserved). Pure read; two consecutive calls on unchanged data return deep-equal results. NULL-hash rows never surface (consumer-side assertion of the service guarantee). No user root ⇒ zeros/empty. |
| `acceptSuggestions(userId, user, nodeIds)` | `{ trashed: number[], rejectedNotOwned: number[], skipped: number[] }`                                                                                                                                                                         | Per node: `ownerNodeResolver.isOwnerNode(userId, nodeId)` gate (own live node — foreign, unknown, already-trashed all fall to `rejectedNotOwned`, the owner check precedes the trash call); then the files-domain trash core `fileService.deleteNode(nodeId, userId, user)`; a core THROW → `skipped` (per-node isolation, the loop never aborts). NO journal row (§2.4, routes/dashboard.md §2.4).                     |
| `resolveTrashRetentionDays()`              | `Promise<number>`                                                                                                                                                                                                                              | Same resolution order as gcService Tier 3: `getSharedResolver().getConfig('TRASH_RETENTION_DAYS')` → finite ≥0 wins, else default `30` (`0` = retention off).                                                                                                                                                                                                                                                           |

### 2.3 Dependencies

- `domains/ai/dupFinderService` (compute reused verbatim — do NOT re-implement grouping)
- `store/fileNodesStore` → `getUserRootNode`, `summarizeTrashedSubtree`
  (`docs/spec/server/store/fileNodesStore.md`)
- `infrastructure/configResolver.getSharedResolver` (retention days)
- `service/composition.getComposition` → `fileService` (trash core) +
  `domains/permissions/policy/ownerNodeResolver` (own-node gate)

### 2.4 Errors & transactions

- Service throws bare string codes (`emptyNodeIds` — missing/empty/non-array/over-200
  `nodeIds`, validated BEFORE the loop); route-level `ERROR_MAP` translates.
- Per-node deletes run in the trash core's own discipline (no service-level TX — batch
  semantics stay per-node like `batchOperationService.deleteNodesBatch`).
- Suggestions are COMPUTED, not persisted — no `file_suggestions` rows, no dismissal or
  expiry surface (store/route spec pointer unchanged).

### 2.5 Verification Scenarios

- [ ] 3-hash-group: 2 suggestions (ids after the keep), `keepNodeId` = smallest, `duplicates`
      counts = the dupFinder summary
- [ ] NULL-hash identical twins: zero suggestions, zero duplicate counts (consumer-side of
      the hard rule)
- [ ] Trash subtree: children of a trashed folder counted once each; live files excluded;
      empty trash ⇒ zeros with `oldestDeletedAt: null`
- [ ] Accept: own live file → trashed (row `deleted_at` set); foreign id →
      `rejectedNotOwned` and the foreign row untouched; trashed id → `rejectedNotOwned`;
      delete-core throw → `skipped`; `action_journal` row count unchanged
- [ ] Validation: `[]`, missing, 201 ids → `emptyNodeIds` before any work
