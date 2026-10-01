# FileListItem Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Single row item in list view: thumbnail/icon, filename, metadata (size/date), More button. Selection indicated by container light primary background. Shows processing overlay. React.memo optimized. |
| Used in            | FileList                                                                                                                                                                                              |
| Related components | formatFileSize, formatDate, getFileIcon, getThumbnail, renderProcessingIcon                                                                                                                           |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileListItem.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileListItem.test.js`

### 2.2 Props

| Name           | Type     | Required | Default | Description                                                                                                 |
| -------------- | -------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| file           | object   | Y        | -       | File object (path, basename, size, lastmod, type, thumbnailUrl, isHidden)                                   |
| isSelected     | boolean  | Y        | -       | Selected state (container shows light primary background)                                                   |
| isDisabled     | boolean  | Y        | -       | Disabled appearance                                                                                         |
| isProcessing   | boolean  | Y        | -       | Show processing overlay                                                                                     |
| processingType | string   | N        | -       | Type for renderProcessingIcon                                                                               |
| isDropTarget   | boolean  | Y        | -       | Drop target highlight                                                                                       |
| isDragging     | boolean  | Y        | -       | Dragging state (handled by parent)                                                                          |
| selectionMode  | boolean  | Y        | -       | Selection mode active (affects container styling when isSelected)                                           |
| showMoreButton | boolean  | Y        | -       | Show More (⋮) button; false when in selection mode                                                          |
| onMoreClick    | function | Y        | -       | More button click handler; opens FileActionSheet; call stopPropagation so row tap does not toggle selection |
| isMobile       | boolean  | Y        | -       | Mobile styles                                                                                               |

### 2.3 Callback Signatures

| Callback    | When invoked      | Arguments                                          |
| ----------- | ----------------- | -------------------------------------------------- |
| onMoreClick | More button click | (file) — must stopPropagation to prevent row click |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI Typography/Box/Avatar/CircularProgress/Tooltip, formatFileSize, formatDate, renderProcessingIcon, getDropTargetStyles, getFileIcon, getThumbnail, MemberStateBadges, MemberStateBadges
- **Reference implementation:** `client/src/components/file-manager/FileListItem.js`

### 2.5 i18n Keys

- `actions.folder` – label for directory type

### 2.6 Layout and Conditional Rendering

- **More button placement:** Right side of item row. Hidden when `!showMoreButton` (i.e. when in selection mode). IconButton with ⋮ icon; onMoreClick must call `event.stopPropagation()` so parent row tap does not trigger selection toggle. Uses `onTouchStart`/`onTouchEnd` with `stopPropagation` on mobile so parent long-press handler does not capture the touch and touch fires onMoreClick immediately (avoids click delay/loss on mobile).
- **Selection display:** No checkbox. When selectionMode and isSelected, container (parent) uses light primary background (e.g. alpha(primary.main, 0.12)).
- Thumbnail or icon based on getThumbnail(file)
- Processing overlay (CircularProgress + icon) when isProcessing
- **Filename:** Use `pixelMiddleTruncate` for middle ellipsis (...) with `Tooltip` showing the full name when truncated. Uses `ResizeObserver` to track container width.
- Metadata: folder label or formatFileSize, formatDate(lastmod)
- **Member-row slots (P-4, `CollectionsListView.md` §2.5) — all keyed off OPTIONAL row fields, file rows (fields absent) render byte-identical:**
  - the size caption renders ONLY when the row is NOT a size-less member row (`file.isCollectionMember === true && file.size == null` ⇒ caption omitted — the member wire carries no size; the slot stays a plain `formatFileSize(file.size)` for every other row);
  - **member-state badges (§11 follow-up 3, 2026-10-01 — the former list-only `Chip`s are REPLACED by the shared `MemberStateBadges` component rendered in ALL three member views):** `<MemberStateBadges file={file} variant="list" />` overlays a badge row on the LEADING icon/avatar column — the thumbnail container gains `position: relative`, the badge row is `position: absolute; top: 2; left: 2; z-index: 1` (flex, gap 8px, plain 16px icon badges, no plate); excluded badge (`VpnLock`, `data-testid="member-excluded-badge-<nodeId>"`, tooltip/aria `fileManager.memberNotShared`) when `file.shared_excluded === true`; publish-pending badge (`Public`+`Pending` composite, `data-testid="member-publish-pending-badge-<nodeId>"`, tooltip/aria `fileManager.memberUnpublishedBadge`) when `file.published === false`; `state:'revoked'` rows render NEITHER (the chip-era flag-only gating leaked the awaiting-publish chip onto revoked rows — fixed); file rows (fields `undefined`) render zero DOM. Gating matrix: `MemberStateBadges.md` §2.3.
  - `file.moreButtonTestId` ⇒ the More button `data-testid` (members: `member-menu-button` — the dispatch target of `onMemberAction('menu', row, anchorEl)`).
- **Memo comparator:** additionally compares `file.published` and `file.shared_excluded` (absent ⇒ `undefined === undefined` — no file-side behavior change) so member state flips re-render rows whose name/path never change.

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [x] Renders basename, size/date or folder label
- [x] Selection indicated by container light primary background when selectionMode and isSelected
- [x] More button shown when showMoreButton; hidden when !showMoreButton; onMoreClick called with file and stopPropagation
- [x] Thumbnail or icon displayed
- [x] Processing overlay when isProcessing
- [ ] (P-4 + §11 follow-up 3) Member row (isCollectionMember, size absent): no size caption; `shared_excluded`/`published:false` badges render with the member testids (`member-excluded-badge-*` / `member-publish-pending-badge-*`) as an overlay on the leading icon/avatar column; revoked rows render NEITHER badge; More button carries `file.moreButtonTestId`; state flips (published) re-render the row through the memo comparator. A plain file row renders unchanged.

### 2.8 Edge Cases

- file.type === 'directory' – shows folder label instead of size
- Hidden files – opacity handled by parent container
- getFileListItemContainerStyles exported for container styling
