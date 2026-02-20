# FileSkeletons Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Skeleton loaders for list, grid, detail, and tree views. Matches layout of FileList, FileGrid, FileDetail, FolderTree. |
| Used in | FileList, FileGrid, FileDetail, FolderTree (loading state) |
| Related components | MUI Skeleton, Box, TableRow, TableCell, useResponsive |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileSkeletons.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileSkeletons.test.js`

### 2.2 Exports

| Component | Props | Description |
|-----------|-------|-------------|
| FileListSkeleton | count?, selectionMode? | List view placeholder |
| FileGridSkeleton | count?, selectionMode? | Grid view placeholder |
| FileDetailSkeleton | count?, selectionMode? | Table view placeholder |
| FileTreeSkeleton | count?, level? | Tree view placeholder |

### 2.3 Props

| Component | Prop | Type | Default | Description |
|-----------|------|------|---------|-------------|
| FileListSkeleton | count | number | 4 (mobile) / 6 (desktop) | Skeleton row count |
| FileListSkeleton | selectionMode | boolean | false | Show checkbox skeleton |
| FileGridSkeleton | count | number | 4 (mobile) / 8 (desktop) | Skeleton card count |
| FileGridSkeleton | selectionMode | boolean | false | Show checkbox skeleton |
| FileDetailSkeleton | count | number | 6 | Table row count |
| FileDetailSkeleton | selectionMode | boolean | false | Show checkbox column |
| FileTreeSkeleton | count | number | 3 | Tree item count |
| FileTreeSkeleton | level | number | 0 | Indentation level |

### 2.4 Dependencies

- **imports:** React, MUI Box, Skeleton, TableRow, TableCell, useResponsive
- **Reference implementation:** `client/src/components/file-manager/FileSkeletons.js`

### 2.5 i18n Keys

- None

### 2.6 Conditional Rendering

- selectionMode: checkbox placeholder in each skeleton
- useResponsive for FileListSkeleton/FileGridSkeleton count
- FileTreeSkeleton level: pl = level * 2

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] FileListSkeleton renders grid with skeleton items
- [ ] FileGridSkeleton renders grid with card-like items
- [ ] FileDetailSkeleton renders table rows
- [ ] FileTreeSkeleton renders indented items
- [ ] selectionMode adds checkbox placeholder

### 2.8 Edge Cases

- Responsive count differs mobile vs desktop
- FileDetailSkeleton used inside TableBody
