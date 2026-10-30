# storageRepository Spec

Target-contract spec (storage client-domain split).

## 1. Overview

| Item         | Description                                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role         | IO boundary for the personal Storage domain: hygiene + persisted cleanup suggestions read, storage-usage summary/series read, suggestion accept and dismiss. Owns request/response mapping and failure absorption. |
| Used by      | `explorerGateway` (re-export boundary — see `explorerGateway.md` §2.6). Controller/content components consume the gateway, never this module directly (ARCHITECTURE.md §7).                                        |
| Does not own | Pub-sub fan-out (`collectionsNotifier`), UI state, toast/label mapping, endpoint behavior (see `docs/spec/server/routes/storage.md`), collection status/journal reads (`collectionsRepository.md`).                |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/storageRepository.js`
- **Test file:** `client/src/services/__tests__/storageRepository.test.js`

### 2.2 Data Shapes (wire contract)

- The repository returns server payloads **verbatim in snake_case**; no client-side key remapping. Consumers map fields to UI labels at render time.
- `GET /api/storage` (`getStorageHygiene`) returns the hygiene summary + persisted pending suggestion rows in ONE payload:

```json
{
  "hygiene": {
    "duplicates": { "group_count": 2, "duplicate_count": 5, "reclaimable_bytes": 4718592 },
    "near_duplicates": { "group_count": 1, "duplicate_count": 2 },
    "trash": {
      "item_count": 3,
      "total_bytes": 98765,
      "oldest_deleted_at": "2025-09-01T03:00:00Z",
      "retention_days": 30
    }
  },
  "suggestions": [
    {
      "id": 3012,
      "node_id": 90211,
      "kind": "exact_dup",
      "path": "/alice/photos/beach copy.jpg",
      "size_bytes": 2359296,
      "reason": { "kind": "exact_dup", "keep_node_id": 90210 },
      "created_at": "2025-10-20T03:00:00Z",
      "expires_at": "2025-11-19T03:00:00Z"
    }
  ]
}
```

- `near_duplicates` is absent when the vector leg is unavailable (absent-not-disabled). `suggestions` sorts exact rows first, near-dup rows after, rule rows last (server order). Suggestion rows, keeper blocks, expiry and rule-kind semantics are documented by `docs/spec/server/routes/storage.md` §2.4.
- `GET /api/storage/usage` (`getStorageUsage`) returns the current breakdown + daily series:

```json
{
  "current": {
    "total_bytes": 5242880,
    "live_bytes": 4194304,
    "trash_bytes": 524288,
    "versions_bytes": 524288,
    "version_history_supported": true,
    "incomplete": false
  },
  "series": {
    "points": [
      { "day": "2025-10-01", "bytes": 1048576 },
      { "day": "2025-10-02", "bytes": 2097152 }
    ]
  }
}
```

- `version_history_supported: false` ⇒ the client hides the versions line (WebDAV mode graphs current + trash bytes only). `incomplete: true` ⇒ the client renders the incomplete warning. `series.points` ascends by UTC day; fewer than two points ⇒ an empty array (the client omits the sparkline).

### 2.3 Main Functions

| Function                 | Input ⇒ Return (failure ⇒ right side of `∥`)                                                                                                                                        | API                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| getStorageHygiene        | `() => Promise<payload ∥ { suggestions: [] }>` — the ONE hygiene+suggestions read; failure fallback `{ suggestions: [] }` (all storage blocks omitted).                             | GET `/api/storage`                      |
| getStorageUsage          | `() => Promise<payload ∥ null>` — current breakdown + series; absorbed failure returns `null` so the summary and sparkline are omitted (no fabricated series).                      | GET `/api/storage/usage`                |
| acceptStorageSuggestions | `(nodeIds, options?) => Promise<payload ∥ null>` — checked rows → trash as ONE journaled command; the response carries `undo: { action_id }` for the toast.                         | POST `/api/storage/suggestions/accept`  |
| dismissStorageSuggestion | `(suggestionId, options?) => Promise<{ id, state } ∥ null>` — per-row dismiss of a persisted suggestion (`pending → dismissed`); absorbed failure returns `null` and the row stays. | POST `/api/storage/suggestions/dismiss` |

`options` (mutations): `{ onError?: (error: { errorCode?, params? } \| null) => void }` — invoked exactly once per absorbed mutation failure with the response's error envelope (`null` for transport failures without a response body) BEFORE the fallback returns; never invoked on success (§2.4). Read functions accept no options.

### 2.4 Failure-Absorption Contract

- No method rejects for ordinary API/storage failures; callers receive the contract-safe fallback in §2.3 and errors are logged for diagnostics.
- Mutations return `null` on any absorbed failure; callers branch on `null` (never on the `onError` callback) and must not surface an undo affordance when the result is `null`.
- The repository has no collection-notifier fan-out: the storage dashboard refreshes only its own reads after a real success (`StorageDashboard.md` §2.3.1). Trash-surface notifications are raised by the file-operation seams that perform the mutation, not here.

### 2.5 Dependencies

- Transport: `client/src/services/apiClient` (get, post).
- No notifier imports (see §2.4).

### 2.6 Verification Scenarios

- [ ] `getStorageHygiene()` returns the payload verbatim; transport failure resolves `{ suggestions: [] }` without throwing.
- [ ] `getStorageUsage()` returns the payload verbatim; transport failure resolves `null` (summary/sparkline omitted).
- [ ] `acceptStorageSuggestions([1,2])` POSTs `/api/storage/suggestions/accept` with `{ nodeIds: [1,2] }` and returns `undo.action_id` untouched on success.
- [ ] `acceptStorageSuggestions` absorbs a failure to `null` and surfaces the error envelope through `options.onError`.
- [ ] `dismissStorageSuggestion(9)` POSTs `/api/storage/suggestions/dismiss` with `{ suggestionId: 9 }`, returns `{ id, state }`, and absorbs failure to `null`.
- [ ] No storage method rejects; no storage method calls `collectionsNotifier`.

### 2.7 Notes

- The storage domain is collection-independent: it must not import `collectionsRepository` (grep gate: `storageRepository` has zero collection imports).
- Request bodies are camelCase (`{ nodeIds }`, `{ suggestionId }`); response fields stay snake_case.
