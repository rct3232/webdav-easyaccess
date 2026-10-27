# FileDetail Spec

## 1. Overview

| Item               | Description                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Role               | Table view of files: icon, name, type/mime, size, date. Supports selection, drag-and-drop, long-press on mobile. |
| Used in            | FileManager                                                                                                      |
| Related components | useFileViewCommon, FileDetailSkeleton, formatFileSize, formatDate, getFileIcon                                   |

---

### 2.0 Trash-view empty state

- `emptyText` (string, optional): overrides the default `fileManager.noFiles` empty message (`fileManager.trashEmpty` in the trash view).

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileDetail.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileDetail.test.js`

### 2.2 Props

| Name                | Type     | Required | Default | Description                                                                                                                                                                   |
| ------------------- | -------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| files               | array    | Y        | -       | File objects                                                                                                                                                                  |
| onFileClick         | function | Y        | -       | Row click handler; receives (file, event) for modifier detection                                                                                                              |
| onMoreClick         | function | Y        | -       | More button click handler (file); opens FileActionSheet                                                                                                                       |
| onLongPressSelect   | function | Y        | -       | Long-press handler for mobile: enters selection mode and selects file                                                                                                         |
| onContextMenu       | function | Y        | -       | Context menu handler                                                                                                                                                          |
| onFileDrop          | function | N        | -       | Drop handler                                                                                                                                                                  |
| selectionMode       | boolean  | Y        | -       | Selection mode active (row shows light primary background when selected)                                                                                                      |
| selectedFiles       | Set      | Y        | -       | Selected paths                                                                                                                                                                |
| processingMap       | object   | N        | -       | Processing state                                                                                                                                                              |
| loading             | boolean  | N        | false   | Loading state                                                                                                                                                                 |
| membershipsByNodeId | object   | N        | null    | `{ [nodeId]: [{ id, name }] }` membership map (`CollectionMembershipBadges.md` §2.6); the table slices per row and passes `memberships` into `FileDetailRow` (row prop: array | null) |

### 2.3 Callback Signatures

| Callback          | When invoked                          | Arguments     |
| ----------------- | ------------------------------------- | ------------- |
| onFileClick       | Row click                             | (file, event) |
| onMoreClick       | More button click (IconButton in row) | (file)        |
| onLongPressSelect | Mobile long-press on row              | (file)        |
| onContextMenu     | Right-click                           | (e, file)     |

### 2.4 Dependencies

- **imports:** React, useFileViewCommon, useResponsive, formatFileSize, formatDate, getFileIcon, renderProcessingIcon, FileDetailSkeleton
- **Reference implementation:** `client/src/components/file-manager/FileDetail.js`

### 2.5 i18n Keys

- `fileManager.noFiles` – empty state
- `actions.folder` – directory type label

### 2.6 Conditional Rendering

- loading && files.length === 0: FileDetailSkeleton
- files.length === 0: empty row with noFiles
- **Selection display:** No checkbox column. When selectionMode and row is selected, use light primary background (e.g. alpha(primary.main, 0.12)).
- **Filename:** Use `pixelMiddleTruncate` for middle ellipsis (...) with `Tooltip` showing the full name when truncated. Uses `ResizeObserver` to track container width.
- Long-press (onLongPressSelect) on mobile when !selectionMode — enters selection mode and selects file. More IconButton at right end of row (last TableCell); visible when !selectionMode. Uses `onTouchStart`/`onTouchEnd` with `stopPropagation` so parent long-press does not capture touch; touch fires onMoreClick immediately (avoids click delay/loss on mobile).
- Detail view hidden on mobile (via parent)
- **Member-row reuse (`CollectionsListView.md` §2.5):** the collection MEMBERS surface detail mode feeds file-shape member rows through this component + `FileDetailRow` (hosted by `CollectionsListView`). Optional row slots only — file rows (fields absent) render byte-identical: `file.rowTestId` → `TableRow` `data-testid` (`member-row-<nodeId>`), `file.moreButtonTestId` → the More button `data-testid` (`member-menu-button`); the size cell renders `'-'` for size-less member rows (`file.isCollectionMember === true && file.size == null` — the wire carries no size and `formatFileSize(null)` would lie `'0 B'`; directories keep their existing `'-'`); the type cell stays `file.mime || '-'` (revoked member rows carry `mime:null` → `'-'`); `state:'revoked'` rows arrive disabled via `getFileItemState` (`fileViewUtils.md`), so no click/menu (FileDetailRow already gates `onFileClick`/`onContextMenu` on `isDisabled`). **Member-state badges:** the table renders `<MemberStateBadges file={file} variant="detail" />` INLINE in the name cell — plain 16px icon badges between the leading `getFileIcon` glyph and the truncated name (the cell's existing `gap: 0.75` flex spaces them); same gating/testids/tooltips as the other views (`MemberStateBadges.md` §2.3 — the badges appear in all three member views). `FileDetailRow` keeps the DEFAULT `React.memo` shallow compare: the adapter re-maps rows on every load/publish flip, so fresh object identity re-renders the row — a field-only custom comparator would risk stale `dragHandlers`/`dropHandlers` closures and is NOT added.
- **Search-server-row reuse (`useSearchResults.md` §2.3):** Zone B rows render through this component + `FileDetailRow` in results-mode detail view. Optional slots only — file rows render byte-identical: `file.isSearchServerRow === true` → `TableRow` exposes `data-file-node-id` (dedup anchor) and `file.rowTestId` (`server-search-row-<id>`) as the `data-testid`; `file.highlights` → the name cell renders the two-color ranges inside the truncated name exactly like `FileListItem.md` (`search-highlight-range` / `filter-highlight-range` testids, Tooltip intact); `file.hasWritePermission === false` → the `EditOff` badge renders at the leading icon cell corner (`search-readonly-badge-<nodeId>` — icon-cell parity with the list view) and drag is inert; the size cell renders `'-'` for search server rows while un-enriched (`file.size == null` — same no-lie rule as the member row), real value after enrichment; date sorting uses the enriched `lastmod`. The adapter re-maps rows on every highlight/enrichment change, so the default shallow memo stays sufficient. `membershipsByNodeId` (optional) slices the host-prepared membership map per row and forwards `memberships` to `FileDetailRow`, which renders `<CollectionMembershipBadges nodeId={file.nodeId} entries={memberships} variant="detail" />` INLINE in the name cell after the member-state badges (plain 16px glyphs, cap 2 + `+N` overflow — `CollectionMembershipBadges.md` §2.4); absent slice ⇒ zero DOM. `FileDetailRow` keeps the default shallow memo — the slice prop is compared by identity automatically; no custom comparator is added.

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [x] Table with name, type, size, date columns
- [x] onFileClick, onContextMenu
- [x] Loading/empty states
- [x] Long-press invokes onLongPressSelect on mobile — enters selection mode
- [x] Drag-and-drop
- [x] More IconButton visible when !selectionMode; hidden when selectionMode; onMoreClick called with file
- [ ] Search server row: `rowTestId` + `data-file-node-id` on the `TableRow`, size cell `'-'` until enriched, name highlight ranges with the `search-highlight-range`/`filter-highlight-range` testids, `search-readonly-badge-<nodeId>` when `hasWritePermission:false`; regular rows render byte-identical.
- [ ] `membershipsByNodeId` slice renders the inline membership badges (`membership-badge-<nodeId>-<collectionId>`, cap 2 + `membership-badge-more-<nodeId>`) before the name; absent slice ⇒ zero DOM; a changed slice re-renders the row through the default shallow memo.

### 2.8 Edge Cases

- file.type === 'directory' – size shows '-', type shows folder label
- Horizontal scroll on mobile (minWidth 600)
- Processing overlay overlay on row
