# FilePropertiesDialog Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Dialog showing file/folder properties: thumbnail, type, size, modified date, path, and permissions. Fetches permissions via getFolderPermissions. For directories, fetches recursive statistics (fileCount, totalSize) via getFolderStats and shows a default banner/layout (gradient, icon+name block). Since DEF-11 it hosts a tab bar **between the title and the gradient thumbnail header** with tabs `정보 \| 버전` (i18n `dialogs.propertiesTabInfo` / `dialogs.propertiesTabVersions`); the versions tab lists the file's version history (S3 storage mode only) with icon-only download/restore actions (Tooltip + aria-label) and a current-version badge. The bottom action bar (Close) is fixed across tab switches. |
| Used in            | FileManager (Properties from context menu)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Related components | getFileIcon, getThumbnail, formatFileSize, formatDate, getFolderPermissions, getFolderStats, getFileVersions, restoreFileVersion, downloadFileVersion (fileService), getParentPath (shared pathUtils)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePropertiesDialog.js`
- **Test file:** `client/src/components/dialogs/__tests__/FilePropertiesDialog.test.js`

### 2.2 Props

| Name              | Type     | Required | Default | Description                                                                                                                                                             |
| ----------------- | -------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| open              | boolean  | Y        | -       | Dialog open                                                                                                                                                             |
| onClose           | function | Y        | -       | Close handler                                                                                                                                                           |
| file              | object   | Y        | -       | File object                                                                                                                                                             |
| activeFileStorage | string   | N        | null    | Active file backend (`'s3' \| 'webdav'`); gates the versions tab visibility                                                                                             |
| onTrashRestore    | function | N        | -       | Trash restore executor `(file) => Promise` (DEF-16 P9). When provided and the opened item is trashed (`file.isTrashed`), the action bar renders the Restore icon button |
| onTrashPurge      | function | N        | -       | Trash permanent-delete executor `(file) => Promise` (DEF-16 P9); error-accented icon button behind an in-dialog error confirm                                           |

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
- **Tabs (DEF-11):** the tab bar (`정보` default active) is always rendered between the title and the
  gradient header; the `버전` tab is rendered **only when** `activeFileStorage === 's3'` AND
  `file.type === 'file'` (never for directories). On the `정보` tab the original dialog body renders
  (gradient header, permissions, property items). On the `버전` tab the versions list renders via
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
- **Trash actions (DEF-16 P9):** when the opened item is trashed (`file.isTrashed === true`, i.e.
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
- [ ] Tab bar renders between title and gradient header; `정보` active by default; Close button stays fixed across tab switches
- [ ] `버전` tab hidden for directories and when `activeFileStorage !== 's3'`
- [ ] Versions tab (s3 + file): getFileVersions called on tab activation; rows list versionNumber/date/size; current row carries the badge; orphaned rows carry the expired marker
- [ ] Download icon button triggers downloadFileVersion; restore icon button opens the confirm dialog and calls restoreFileVersion on confirm; toasts on success/failure
- [ ] Versions load failure renders `versionsLoadFail` without crashing; empty history renders `versionsEmpty`

### 2.8 Edge Cases

- !file – return null
