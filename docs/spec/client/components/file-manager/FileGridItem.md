# FileGridItem Spec

## 1. Overview

| Item               | Description                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Card-style grid item: thumbnail/icon, filename, More button. Selection indicated by light primary background. Processing overlay. React.memo optimized. |
| Used in            | FileGrid                                                                                                                                                |
| Related components | getFileIconForGrid, getThumbnail, renderProcessingIcon                                                                                                  |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileGridItem.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileGridItem.test.js`

### 2.2 Props

| Name           | Type     | Required | Default | Description                                                                                                  |
| -------------- | -------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| file           | object   | Y        | -       | File object                                                                                                  |
| isSelected     | boolean  | Y        | -       | Selected state                                                                                               |
| isDisabled     | boolean  | Y        | -       | Disabled                                                                                                     |
| isProcessing   | boolean  | Y        | -       | Processing overlay                                                                                           |
| processingType | string   | N        | -       | Processing type                                                                                              |
| isDropTarget   | boolean  | Y        | -       | Drop target highlight                                                                                        |
| isDragging     | boolean  | Y        | -       | Dragging                                                                                                     |
| selectionMode  | boolean  | Y        | -       | Selection mode active (affects card styling when isSelected)                                                 |
| showMoreButton | boolean  | Y        | -       | Show More (⋮) button; false when in selection mode                                                           |
| onMoreClick    | function | Y        | -       | More button click handler; opens FileActionSheet; call stopPropagation so card tap does not toggle selection |
| isMobile       | boolean  | Y        | -       | Mobile styles                                                                                                |

### 2.3 Callback Signatures

| Callback    | When invoked      | Arguments                                           |
| ----------- | ----------------- | --------------------------------------------------- |
| onMoreClick | More button click | (file) — must stopPropagation to prevent card click |

### 2.4 Dependencies

- **imports:** React, MUI Card/CardMedia/CardContent/Typography/Box/CircularProgress, renderProcessingIcon, getFileIconForGrid, getThumbnail, CardTile (shared tile shell: the card JSX body lives in `CardTile.md` and `FileGridItem` is a thin delegation keeping this component's props, DOM and memo comparator externally IDENTICAL; the regression anchor is `FileGridItem.test.js` passing unchanged), MemberStateBadges
- **Reference implementation:** `client/src/components/file-manager/FileGridItem.js`

### 2.5 i18n Keys

- None

### 2.6 Layout and Conditional Rendering

- **More button placement:** Top-right of preview (thumbnail/icon) area, overlaid with `position: absolute`, `top`, `right`, and `z-index` so the icon is not pushed. Hidden when `!showMoreButton` (i.e. when in selection mode). IconButton with ⋮ icon; onMoreClick must call `event.stopPropagation()` so parent card tap does not trigger selection toggle. Uses `onTouchStart`/`onTouchEnd` with `stopPropagation` on mobile so parent long-press handler does not capture the touch and touch fires onMoreClick immediately (avoids click delay/loss on mobile).
- **Selection display:** No checkbox. When isSelected, card uses light primary background (e.g. alpha(primary.main, 0.12)) instead of border.
- Thumbnail or getFileIconForGrid
- Processing overlay when isProcessing
- Border/background for isSelected, isDropTarget
- **Filename placement:** CardContent uses flex (`display: flex`, `alignItems: center`, `justifyContent: center`) so the filename is centered horizontally and vertically within the content area. Use `pixelMiddleTruncate` for middle ellipsis (...) with `Tooltip` showing the full name when truncated. Uses `ResizeObserver` to track container width.
- **Search-server-row slots (`useSearchResults.md` §2.3) — OPTIONAL, regular file tiles render byte-identical (zero DOM delta):**
  - **`file.highlights`:** ranges render inside the centered truncated name exactly as in the list view (`FileListItem.md` — same `search-highlight-range` / `filter-highlight-range` testids, committed = secondary.light, live = theme `highlight` yellow; computed against the rendered truncated string, Tooltip keeps the full name).
  - **Read-only badge:** `file.isSearchServerRow === true && file.hasWritePermission === false` ⇒ `EditOff` on a `TileCornerBadge` plate (28px translucent plate, 16px icon — member-badge family) at the THUMBNAIL TOP-RIGHT corner, `data-testid="search-readonly-badge-<nodeId>"`; when the More action is also visible it sits beside the badge (More rightmost). Regular tiles render none.
  - **Memo comparator:** additionally compares `file.highlights`, `file.hasWritePermission` and `file.hasReadPermission` (undefined-safe) so highlight/permission changes re-render tiles whose name/path never change.
- **Padding:** `p: 1`, `pt: 0.5`, `pb: 1`; `'&:last-child': { pb: 1 }` overrides MUI CardContent default paddingBottom so the text area matches FileGridSkeleton.
- **Member-tile slots (`CollectionsListView.md` §2.5):** the collection MEMBERS surface grid mode feeds file-shape member rows through this component (hosted by `CollectionsListView`). Optional slots only — file rows (fields absent) render byte-identical (regression anchor `FileGridItem.test.js` unchanged): `file.moreButtonTestId` → the More action `data-testid` (members: `member-menu-button`); the card container `data-testid` (`member-row-<nodeId>`) rides the parent `FileGridItemContainer` via `file.rowTestId`. Tiles carry NO size (media + name only). **Member-state badges:** the tile renders `<MemberStateBadges file={file} variant="grid" />` into the shared `CardTile.cornerBadges` slot — top-left over the media (`top: 4; left: 4; z-index: 1`, flex gap 8px, opposite the More action), each badge a `TileCornerBadge` (28px translucent circular plate, 16px icon): excluded `VpnLock` (`member-excluded-badge-<nodeId>`) when `shared_excluded === true`, pending `Public`+`Pending` composite (`member-publish-pending-badge-<nodeId>`) when `published === false`; `state:'revoked'` renders NEITHER. The slot value is `hasMemberStateBadges(file) ? <MemberStateBadges variant="grid" /> : null` — a plain-element prop would be non-null even when the badge set is empty (an `<Element/>` is not `null`), which would make `CardTile` render an empty corner container over file tiles; `hasMemberStateBadges` (pure flag check) is the single source of the zero-DOM-delta guard. Gating matrix + tooltips: `MemberStateBadges.md`. The memo comparator additionally compares `file.published`/`file.shared_excluded`/`file.state` (undefined-safe) so member state flips re-render tiles whose name/path never change. Revoked rows arrive already disabled (`getFileItemState`) with the placeholder name and a null mime — `getThumbnail`/`getFileIconForGrid` never request a thumbnail.

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [x] Renders basename, thumbnail/icon
- [x] Selection indicated by light primary background when isSelected
- [x] More button shown when showMoreButton; hidden when !showMoreButton; onMoreClick called with file and stopPropagation
- [x] Selected/drop target styles
- [x] Processing overlay
- [ ] Member rows show the corner badges (`member-excluded-badge-*`/`member-publish-pending-badge-*`) in the `cornerBadges` slot; revoked rows show NEITHER; plain file tiles keep zero badge DOM (slot stays null).
- [ ] Search server tile: name renders the two-color highlight ranges (`search-highlight-range` / `filter-highlight-range`); `hasWritePermission:false` renders the `search-readonly-badge-<nodeId>` plate at the thumbnail top-right; plain file tiles render byte-identical; `highlights`/permission flips re-render through the memo comparator.

### 2.8 Edge Cases

- isHidden – reduced opacity
- Mobile touch styles
