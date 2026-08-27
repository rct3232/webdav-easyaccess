# useRecentFile Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Recent-file flow controller for FileManager. Tracks recent-file click/history state, coordinates preview/navigation recovery, and maps recent-file failures into user-visible outcomes. |
| Used by components/pages | `FileManager` page shell and explorer interaction flows |
| Does not own | Recent-files repository IO, directory listing IO, metadata enrichment, or product routing policy. Those dependencies must be supplied through gateway-backed seams. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useRecentFile.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useRecentFile.test.js`

### 2.2 Input Parameters

`useRecentFile(params)`

| Name | Type | Required | Description |
|------|------|----------|-------------|
| setCurrentPath | function | Y | Set path or delegate navigation for recent-file recovery. |
| showError | function | Y | Show user-visible error feedback. |
| user | object | Y | Current user. |
| currentPathRef | ref | N | Current path ref for async rollback/recovery logic. |
| setSelectedFile | function | N | Set preview target file. |
| setPreviewDialogOpen | function | N | Open preview dialog. |
| files | array | Y | Current explorer listing used to resolve clicked recent entries against already-loaded content. |
| loading | boolean | Y | Whether the current explorer listing is loading. |
| currentPath | string | Y | Current explorer path. |
| recentGateway | object | N | Preferred final-target seam exposing gateway-backed helpers such as `addRecentFile`, `removeRecentFile`, and `listDirectory` (defaulting to `explorerGateway` when omitted). Exact shape may vary, but direct repository/service imports do not belong inside this hook. |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| trackRecentFileClick | (nodeId, parentNodeId) => void | Track recent file click |
| trackPathHistory | (path, previousPath) => void | Track path navigation history |
| clearTracking | (path) => void | Clear tracking for path |
| clearAllTracking | () => void | Clear all tracking |
| clearPathHistory | (path) => void | Clear path history for path |
| handleRecentFileError | (error, path) => Promise | Error handler: 404+recent → removeRecentFile; navigates on error |
| recentFileToPreview | object \| null | File pending preview open |
| setRecentFileToPreview | function | Set file to open in preview |
| recentFilePathsRef | ref | Map of nodeId → recent file nodeId |
| pathHistoryRef | ref | Map of path → previous path |
| processingErrorRef | ref | Set of paths with active error handling |

### 2.4 Responsibilities (must be non-overlapping)

- **Owns**
  - Tracking recent-file click intent and path history used for recovery.
  - Deciding whether a clicked recent target should open preview or navigate to its parent.
  - Converting recent-file failures into the current user-visible outcomes (rollback, stale-entry cleanup, and error messaging).
- **Does not own**
  - Loading the recent-files collection for the explorer list (`useFileManager` + `explorerGateway`).
  - Recent-files repository access or notifier subscriptions.
  - Raw directory listing or metadata IO for parent-folder checks.
  - General explorer navigation policy outside the recent-file flow.

### 2.5 Dependencies

- **May use:** pure error/preview helpers such as `determineErrorType`, `getErrorMessageByType`, `canPreview`.
- **Must route IO through:** `explorerGateway` or a narrow gateway bundle passed into the hook for recent-file removal, parent-directory listing, and any metadata lookup needed for recovery.
- **Must not use directly in the final target:** `recentFilesRepository`, `listFiles`, or other low-level service modules.
- Gateway-backed stale-entry cleanup should remain a two-step outcome when needed: verify the parent folder state through the listing seam, then remove the stale recent entry through the recent-files seam before surfacing the same user-visible toast/result as today.

### 2.6 Side Effects

- Update current path on recent-file click/recovery.
- Trigger preview open when a recent target is previewable and available.
- Request stale-entry cleanup through the gateway when recovery determines the recent target no longer exists.
- Request parent-directory verification/listing through the gateway when needed to recover a clicked recent file.

### 2.7 Error Handling

- Use `determineErrorType` and `getErrorMessageByType` (or equivalent pure helpers) to preserve current message mapping.
- Surface user-visible errors via `showError`.
- Use `processingErrorRef` (or equivalent dedupe state) to avoid duplicate toasts for the same recovery path.
- When a recent target is confirmed missing, remove it through the gateway-backed seam before surfacing the stale-entry outcome.
- When preview recovery needs to confirm a parent folder entry, use the gateway-backed listing seam rather than importing raw file-service helpers.
- Preview recovery and error recovery may share the same gateway-backed verification helpers internally, but they must still preserve the current rollback timing and user-visible message mapping.

### 2.8 Verification Scenarios

- [ ] `trackRecentFileClick(nodeId, parentNodeId)` records the recent entry's nodeId and parent nodeId, enough to recover recent-file navigation as they do today.
- [ ] When a recent target is missing (`404`/equivalent stale-entry outcome), `handleRecentFileError` removes the stale recent entry through the gateway-backed seam and shows the same user-visible error outcome.
- [ ] On recoverable navigation errors, the hook returns the explorer to the previous path (or current default fallback) as it does today.
- [ ] Previewable recent targets still open preview instead of forcing directory navigation.
- [ ] `clearTracking`, `clearPathHistory`, and `clearAllTracking` reset hook-owned tracking state without needing repository writes.

### 2.9 Edge Cases

- `canPreview` target -> open preview instead of navigating.
- `processingErrorRef` (or equivalent) prevents duplicate recovery work/messages for the same path.
