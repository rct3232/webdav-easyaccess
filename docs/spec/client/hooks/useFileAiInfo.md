# useFileAiInfo Spec

Target-contract spec. Service authority:
[aiEnrichmentService.md](../services/aiEnrichmentService.md). Dialog authority:
[FilePropertiesDialog.md](../components/dialogs/FilePropertiesDialog.md) §3.3.

## 1. Overview

| Item                     | Description                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Role                     | Host-side fetch of the opened node's AI enrichment for the properties dialog.                            |
| Used by components/pages | `client/src/pages/FileManager/FileManager.js` (page shell) → `FileManagerView` → `FilePropertiesDialog`. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useFileAiInfo.js` (page-local)
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useFileAiInfo.test.js`

### 2.2 Input Parameters

| Name    | Type    | Required | Description                                                                                          |
| ------- | ------- | -------- | ---------------------------------------------------------------------------------------------------- |
| nodeId  | number  | N        | Opened node id. `null`/absent ⇒ no IO, state `null`.                                                 |
| enabled | boolean | N        | Host gate (dialog open, not share-link, not trashed). `false` ⇒ no IO, state `null`. Default `true`. |

### 2.3 Return Value / State

| Key        | Type           | Meaning                                                        |
| ---------- | -------------- | -------------------------------------------------------------- |
| enrichment | object \| null | `payload.enrichment`; `null` when absent, disabled, or failed. |

### 2.4 Dependencies

- Services called: `aiEnrichmentService.getNodeEnrichment`.
- Other hooks: none.

### 2.5 Side Effects

- One GET per `(nodeId, enabled)` transition while enabled and `nodeId` is valid.
- A stable `nodeId` re-render does not refetch (fetch-once per opened node).
- A run token invalidates in-flight results when `nodeId`/`enabled` changes or the hook
  unmounts (stale guard); an old response can never overwrite the current node's state.
- Disabling immediately clears the state to `null`.

### 2.6 Error Handling

- Any rejection is absorbed: log once and set `enrichment = null`.
- No retry loop, no toast, no error surface — the dialog simply omits the AI tab
  (absent-not-disabled).

### 2.7 Verification Scenarios

- [ ] Enabled + valid id → one service call; resolves to `payload.enrichment`.
- [ ] `payload.enrichment` missing/`null` → state `null`.
- [ ] Rejection → state `null`, no throw.
- [ ] `enabled = false` / `nodeId = null` → zero calls, state `null`.
- [ ] Changing `nodeId` before the first resolves ignores the stale result.
- [ ] Same id re-render does not issue a second call.

### 2.8 Edge Cases

- Trashed and share-link hosts pass `enabled = false`; the hook issues no IO.
- A response arriving after unmount is dropped.
