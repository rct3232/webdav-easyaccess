# FilePropertiesDialog Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Dialog showing file/folder properties: thumbnail, type, size, modified date, path, and permissions. Fetches permissions via getFolderPermissions. For directories, fetches recursive statistics (fileCount, totalSize) via getFolderStats and shows a default banner/layout (gradient, icon+name block). It hosts a tab bar **between the title and the gradient thumbnail header** with tabs `Info \| Versions` (i18n `dialogs.propertiesTabInfo` / `dialogs.propertiesTabVersions`); the versions tab lists the file's version history (S3 storage mode only) with icon-only download/restore actions (Tooltip + aria-label) and a current-version badge. The bottom action bar (Close) is fixed across tab switches. |
| Used in            | FileManager (Properties from context menu)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Related components | getFileIcon, getThumbnail, formatFileSize, formatDate, getFolderPermissions, getFolderStats, getFileVersions, restoreFileVersion, downloadFileVersion (fileService), getParentPath (shared pathUtils)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePropertiesDialog.js`
- **Test file:** `client/src/components/dialogs/__tests__/FilePropertiesDialog.test.js`

### 2.2 Props

| Name              | Type     | Required | Default | Description                                                                                                                                                 |
| ----------------- | -------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| open              | boolean  | Y        | -       | Dialog open                                                                                                                                                 |
| onClose           | function | Y        | -       | Close handler                                                                                                                                               |
| file              | object   | Y        | -       | File object                                                                                                                                                 |
| activeFileStorage | string   | N        | null    | Active file backend (`'s3' \| 'webdav'`); gates the versions tab visibility                                                                                 |
| onTrashRestore    | function | N        | -       | Trash restore executor `(file) => Promise`. When provided and the opened item is trashed (`file.isTrashed`), the action bar renders the Restore icon button |
| onTrashPurge      | function | N        | -       | Trash permanent-delete executor `(file) => Promise`; error-accented icon button behind an in-dialog error confirm                                           |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
| -------- | ------------ | --------- |
| onClose  | Dialog close | -         |

### 2.4 Dependencies

- **imports:** getFolderPermissions, getFolderStats (fileService), getFileIcon, getThumbnail, formatFileSize, formatDate, getPermissionLabels, getParentPath (shared pathUtils)
- **Reference implementation:** `client/src/components/dialogs/FilePropertiesDialog.js`

### 2.5 i18n Keys

- `dialogs.type`, `dialogs.size`, `dialogs.modifiedDate`, `dialogs.path`, `dialogs.permissions`, `actions.folder`, `actions.file`, `fileManager.folderStatsFormat` (for directory stats: count, size)
- `actions.restore`, `actions.purge` (Tooltip/aria-label), `dialogs.purgeConfirm` (in-dialog purge confirm), `fileManager.trashRestoreDone`/`trashPurgeDone`/`trashRestoreFail`/`trashPurgeFail` (trash notices)
- Locale requirement: `fileManager.folderStatsFormat` must exist in all supported locales (currently `en`, `ko`) to avoid rendering raw key text.

### 2.6 Conditional Rendering

- **Directory:** `getFolderStats(file.path)` called when open; folderStats and statsLoading state; Skeleton while stats loading; size row shows folderStatsFormat (`fileCount`, `totalSize`) or placeholder (`-`).
- **File:** size, mime; no folder stats.
- **Top block:** Thumbnail/gradient banner; icon + name block (e.g. minHeight 120); gradient overlay when no thumbnail.
- Permission groups by PERMISSION_ORDER
- Async fallback: permission/stats API failures are non-fatal. UI falls back to empty permissions and placeholder size without crashing.
- **Tabs:** the tab bar (`Info` default active) is always rendered between the title and the
  gradient header; the `Versions` tab is rendered **only when** `activeFileStorage === 's3'` AND
  `file.type === 'file'` (never for directories). On the `Info` tab the original dialog body renders
  (gradient header, permissions, property items). On the `Versions` tab the versions list renders via
  `getFileVersions(file.nodeId)`:
- Each row: `v{versionNumber}`, formatted date (`createdAt`), formatted size (`size` may be
  `null` → `dialogs.versionsUnknownSize` placeholder), `isCurrent` → `dialogs.versionsCurrentBadge`
  badge, `status === 'orphaned'` → `dialogs.versionsExpired` marker (evicted, blob pending GC).
- Icon-only action buttons per non-current row: download (`dialogs.versionsDownloadTitle`,
  `downloadFileVersion`) and restore (`dialogs.versionsRestoreTitle` → ConfirmDialog with
  `dialogs.versionsRestoreConfirmTitle`/`dialogs.versionsRestoreConfirmBody`; success toast
  `dialogs.versionsRestoreSuccess`, failure `dialogs.versionsRestoreFail`), each with Tooltip +
  `aria-label`. All styling via MUI `sx` props only.
- Load failure → `dialogs.versionsLoadFail` message, non-fatal. Empty history →
  `dialogs.versionsEmpty`.
- The versions tab is hidden entirely in WebDAV mode / for directories (server refuses or returns
  empty; the UI does not offer the dead surface).
- **Trash actions:** when the opened item is trashed (`file.isTrashed === true`, i.e.
  properties was opened from the trash view) and the host provides the executors, the fixed bottom
  action bar gains Restore and Permanent-delete **icon-only** buttons (Tooltip + `aria-label`,
  `data-testid="trash-props-restore"` / `"trash-props-purge"`, error accent for purge) next to the
  fixed Close button; hidden for live items. Restore executes directly (non-destructive); purge
  opens the in-dialog `dialogs.purgeConfirm` error confirm first. Trash permission/stats fetches are
  skipped (trashed nodes are not-found for permission/stats routes; the dialog falls back to the
  cached row fields). Success (either action) closes the dialog; the host refreshes the listing.

### 2.7 Verification Scenarios

- [ ] Renders properties, permissions
- [ ] `getFolderPermissions` called when open and returns Promise-based result
- [ ] `getFolderStats` called when open and file is directory
- [ ] Directory: Skeleton or folderStats (fileCount, totalSize) displayed; folderStatsFormat i18n used
- [ ] Permission/stats request failure still renders dialog (fallback values shown)
- [ ] Returns null when !file
- [ ] Tab bar renders between title and gradient header; `Info` active by default; Close button stays fixed across tab switches
- [ ] `Versions` tab hidden for directories and when `activeFileStorage !== 's3'`
- [ ] Versions tab (s3 + file): getFileVersions called on tab activation; rows list versionNumber/date/size; current row carries the badge; orphaned rows carry the expired marker
- [ ] Download icon button triggers downloadFileVersion; restore icon button opens the confirm dialog and calls restoreFileVersion on confirm; toasts on success/failure
- [ ] Versions load failure renders `versionsLoadFail` without crashing; empty history renders `versionsEmpty`

### 2.8 Edge Cases

- !file – return null

---

## 3. AI-platform extensions (AI platform)

Addendum per docs/features/collections-platform.md §3.3 (like entry points), §4.12 (absent-not-disabled), §4.21 (media probe); the collection-side twin of these rows is specified in `CollectionPropertiesDialog.md` §2.6. Pure-dialog rule: host prepares data, dialog renders and fires callbacks.

### 3.1 Header like toggle

- Right-edge of the gradient-header title block: like icon button (the properties dialog's sole like entry point). State = `file.liked` from row data; click → optional `onToggleLike(file)` (viewer-scoped like — no counts, no other-user state). Liked-state heart color = theme token `like` (see `FileContextMenu.md`; never `error`).
- Hidden when the callback is absent (share-link, trash view, read-only grantee without like route access).

### 3.2 `Member of` chip row — Info tab, read-only

- Host-prepared for-nodes membership data (`POST /collections/for-nodes`; dialog performs no IO): chip row of containing collection names under the property items; chip click routes to that collection's member view via `onOpenCollection(collectionId)` (host navigates, dialog closes). Empty/absent data ⇒ no row. Read-only: no add/remove controls in the dialog (membership mutates in menus/toolbars).

### 3.3 `AI Info` tab — DISPLAY-ONLY

- Tab present **only when the node's `ai_features` data exists** for the viewer's capability state — absent-not-disabled (regular-user rule); never a gray tab, never an empty tab.
- Renders read-only: derived tags, summary, category, media probe facts (V0 ffprobe container/duration etc. when present), and `truncated`/degraded badges verbatim from the payload (display honesty; no client recomputation).
- **Editing is out of scope** (future extension); the tab ships zero input affordances.
- Grantee variant: opened from a collection member row by a non-owner ⇒ read-only tab subset (member-properties rule — no permissions/versions mutation paths).

### 3.4 i18n (appends §2.5)

- `dialogs.propertiesTabAi`, `dialogs.fileAiTags`, `dialogs.fileAiSummary`, `dialogs.fileAiCategory`, `dialogs.fileAiMedia`, `dialogs.fileAiTruncated`, `fileManager.memberLike`/`memberUnlike` (shared with menu addenda), `dialogs.fileCollections` (`Member of`).

### 3.5 Verification (appends §2.7)

- [ ] (target) AI tab absent when no ai data (both empty-object and missing-field cases); present when any ai field arrives.
- [ ] (target) Like icon reflects `file.liked`; click calls `onToggleLike(file)` once without closing the dialog.
- [ ] (target) Membership chips render from props with zero network calls from the dialog.
