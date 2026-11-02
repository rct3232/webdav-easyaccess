# FilePropertiesDialog Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role               | Dialog showing file/folder properties: thumbnail, type, size, modified date, path, permissions, and — when the host provides it — the persisted AI enrichment. Fetches permissions via getFolderPermissions. For directories, fetches recursive statistics (fileCount, totalSize) via getFolderStats and shows a default banner/layout (gradient, icon+name block). It hosts a tab bar **between the title and the gradient thumbnail header** with tabs `Info \| AI Info \| Versions` (i18n `dialogs.propertiesTabInfo` / `dialogs.propertiesTabAi` / `dialogs.propertiesTabVersions`); `AI Info` is display-only and appears only when meaningful enrichment data exists; the versions tab lists the file's version history (S3 storage mode only) with icon-only download/restore actions (Tooltip + aria-label) and a current-version badge. The bottom action bar (Close) is fixed across tab switches. |
| Used in            | FileManager (Properties from context menu)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Related components | getFileIcon, getThumbnail, formatFileSize, formatDate, getFolderPermissions, getFolderStats, getFileVersions, restoreFileVersion, downloadFileVersion (fileService), getParentPath (shared pathUtils)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePropertiesDialog.js`
- **Test file:** `client/src/components/dialogs/__tests__/FilePropertiesDialog.test.js`

### 2.2 Props

| Name              | Type     | Required | Default | Description                                                                                                                                                                                         |
| ----------------- | -------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| open              | boolean  | Y        | -       | Dialog open                                                                                                                                                                                         |
| onClose           | function | Y        | -       | Close handler                                                                                                                                                                                       |
| file              | object   | Y        | -       | File object                                                                                                                                                                                         |
| activeFileStorage | string   | N        | null    | Active file backend (`'s3' \| 'webdav'`); gates the versions tab visibility                                                                                                                         |
| onTrashRestore    | function | N        | -       | Trash restore executor `(file) => Promise`. When provided and the opened item is trashed (`file.isTrashed`), the action bar renders the Restore icon button                                         |
| onTrashPurge      | function | N        | -       | Trash permanent-delete executor `(file) => Promise`; error-accented icon button behind an in-dialog error confirm                                                                                   |
| collections       | array    | N        | `[]`    | Host-prepared containing-collection entries `{ id, name }` for the opened node (§3.2). Empty/absent ⇒ no `Member of` row; the dialog performs no membership IO                                      |
| onOpenCollection  | function | N        | -       | Collection-chip click handler `(collectionId) => void`; host closes the dialog and navigates (§3.2). Chips render only when both data and this callback are present                                 |
| aiEnrichment      | object   | N        | null    | Host-prepared enrichment (`enrichment` object from `GET /api/ai/enrichments/:nodeId`, §3.3). `null`/empty/trashed ⇒ no `AI Info` tab; the dialog performs no AI IO and renders the payload verbatim |

### 2.3 Callback Signatures

| Callback         | When invoked           | Arguments      |
| ---------------- | ---------------------- | -------------- |
| onClose          | Dialog close           | -              |
| onOpenCollection | `Member of` chip click | `collectionId` |

### 2.4 Dependencies

- **imports:** getFolderPermissions, getFolderStats (fileService), getFileIcon, getThumbnail, formatFileSize, formatDate, getPermissionLabels, getParentPath (shared pathUtils)
- **AI data:** host-prepared via `aiEnrichment` (no service import in the dialog; §3.3)
- **Reference implementation:** `client/src/components/dialogs/FilePropertiesDialog.js`

### 2.5 i18n Keys

- `dialogs.type`, `dialogs.size`, `dialogs.modifiedDate`, `dialogs.path`, `dialogs.permissions`, `actions.folder`, `actions.file`, `fileManager.folderStatsFormat` (for directory stats: count, size)
- `actions.restore`, `actions.purge` (Tooltip/aria-label), `dialogs.purgeConfirm` (in-dialog purge confirm), `fileManager.trashRestoreDone`/`trashPurgeDone`/`trashRestoreFail`/`trashPurgeFail` (trash notices)
- AI tab (§3.3/§3.4): `dialogs.propertiesTabAi`, `dialogs.fileAiTags`, `dialogs.fileAiSummary`, `dialogs.fileAiCaption`, `dialogs.fileAiTranscript`, `dialogs.fileAiMedia`, `dialogs.fileAiMediaKind`, `dialogs.fileAiMediaDuration`, `dialogs.fileAiMediaDimensions`, `dialogs.fileAiMediaCodecs`, `dialogs.fileAiTruncated`, `dialogs.fileAiProvenance`, `dialogs.fileAiProvenanceFeatures`, `dialogs.fileAiProvenanceCaption`, `dialogs.fileAiProvenanceAsr`
- Locale requirement: `fileManager.folderStatsFormat` must exist in all supported locales (currently `en`, `ko`) to avoid rendering raw key text.

### 2.6 Conditional Rendering

- **Directory:** `getFolderStats(file.path)` called when open; folderStats and statsLoading state; Skeleton while stats loading; size row shows folderStatsFormat (`fileCount`, `totalSize`) or placeholder (`-`).
- **File:** size, mime; no folder stats.
- **Top block:** Thumbnail/gradient banner; icon + name block (e.g. minHeight 120); gradient overlay when no thumbnail.
- Permission groups by PERMISSION_ORDER
- Async fallback: permission/stats API failures are non-fatal. UI falls back to empty permissions and placeholder size without crashing.
- **Tabs:** the tab bar (`Info` default active) is always rendered between the title and the
  gradient header. Tab order is `Info`, `AI Info` (§3.3 — only when the host's `aiEnrichment`
  carries meaningful data), `Versions`. The `Versions` tab is rendered **only when**
  `activeFileStorage === 's3'` AND `file.type === 'file'` (never for directories). If the
  active tab's data disappears (AI enrichment cleared, storage mode changed), the dialog
  falls back to `Info` — never an empty AI/versions pane. On the `Info` tab the original
  dialog body renders (gradient header, permissions, property items). On the `Versions` tab
  the versions list renders via `getFileVersions(file.nodeId)`:
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
- Rendering contract: the `dialogs.fileCollections` label sits above a wrapping chip row, one chip per `{ id, name }` entry in host order (collections-LIST order from the hook); each chip is a small clickable MUI `Chip` with `data-testid="props-collection-chip-<id>"`. Chips render only on the Info tab, only when `collections.length > 0` AND `onOpenCollection` is provided (absent callback ⇒ absent affordance, never dead chips). The dialog issues no collections request, passes the id verbatim, and never closes itself — the host owns both close and navigation.

### 3.3 `AI Info` tab — DISPLAY-ONLY

- **Data source:** host-prepared `aiEnrichment` prop (the `enrichment` object from
  `GET /api/ai/enrichments/:nodeId`, [aiEnrichments.md](../../../server/routes/aiEnrichments.md)).
  The dialog performs **zero AI IO**.
  The host fetches once per opened node via `useFileAiInfo` and withholds the prop for
  share-link, trashed, or failed cases.
- **Visibility (absent-not-disabled):** the tab renders only when `aiEnrichment` is an object
  with at least one meaningful field — non-empty `tags`, non-empty `summary`/`caption`/
  `transcript`, `media_kind`, any safe media fact, or `truncated === true`. `null`, `{}`,
  and metadata-only-empty payloads render **no tab at all** (never gray, never empty).
  A trashed file (`file.isTrashed`) never shows the tab.
- **Active-tab fallback:** if the payload disappears while `AI Info` is active (re-open,
  error, host clears), the dialog resolves back to `Info`.
- **Renders read-only, verbatim:**
  - `tags` → wrapping chips (`data-testid="props-ai-tag"` per tag; container
    `props-ai-tags`).
  - `summary` (`props-ai-summary`), `caption` (`props-ai-caption`), `transcript`
    (`props-ai-transcript`) — only when non-empty.
  - `media_kind` and safe media facts `duration_sec`/`width`/`height`/`codecs` under
    `props-ai-media` — never raw probe tags/streams, ids, base URLs, or vectors.
  - `truncated === true` → `props-ai-truncated` badge (`dialogs.fileAiTruncated`);
    `false`/absent renders no badge.
  - `provenance` → `props-ai-provenance` rows for the non-null
    `features`/`caption`/`asr` entries, showing `model_name` only.
  - No `category` is promised or rendered; `schema_version`/`updated_at` are metadata,
    not tab-visibility triggers.
- **Zero edit affordances:** no inputs, no save/regenerate controls — the tab ships only
  display nodes.
- Grantee variant: opened from a collection member row by a non-owner ⇒ read-only tab subset
  (member-properties rule — no permissions/versions mutation paths).

### 3.4 i18n (appends §2.5)

- `dialogs.propertiesTabAi`, `dialogs.fileAiTags`, `dialogs.fileAiSummary`,
  `dialogs.fileAiCaption`, `dialogs.fileAiTranscript`, `dialogs.fileAiMedia`,
  `dialogs.fileAiMediaKind`, `dialogs.fileAiMediaDuration`,
  `dialogs.fileAiMediaDimensions`, `dialogs.fileAiMediaCodecs`,
  `dialogs.fileAiTruncated`, `dialogs.fileAiProvenance`,
  `dialogs.fileAiProvenanceFeatures`/`Caption`/`Asr`,
  `fileManager.memberLike`/`memberUnlike` (shared with menu addenda),
  `dialogs.fileCollections` (`Member of`).
- `dialogs.fileAiCategory` is intentionally NOT defined (no category promise).

### 3.5 Verification (appends §2.7)

- [ ] AI tab absent for `null`, `{}`, metadata-only payloads, and trashed files; present when
      any meaningful field arrives.
- [ ] AI tab renders tags/summary/caption/transcript/media/truncated/provenance with the
      `props-ai-*` testids; no input/save control exists.
- [ ] Raw probe tags/streams, model ids, base URLs and vectors never render.
- [ ] Active `AI Info` falls back to `Info` when the payload disappears.
- [ ] Like icon reflects `file.liked`; click calls `onToggleLike(file)` once without closing the dialog.
- [ ] Membership chips render from props with zero network calls from the dialog; a chip click calls `onOpenCollection(id)` once; empty/absent data (or an absent callback) renders no row.
