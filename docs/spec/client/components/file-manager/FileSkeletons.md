# FileSkeletons Spec

## 1. Overview

| Item               | Description                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Role               | Skeleton loaders for list, grid, detail, and tree views. Matches layout of FileList, FileGrid, FileDetail, FolderTree. |
| Used in            | FileList, FileGrid, FileDetail, FolderTree (loading state)                                                             |
| Related components | MUI Skeleton, Box, TableRow, TableCell, useResponsive                                                                  |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileSkeletons.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileSkeletons.test.js`

### 2.2 Exports

| Component          | Props                  | Description            |
| ------------------ | ---------------------- | ---------------------- |
| FileListSkeleton   | count?, selectionMode? | List view placeholder  |
| FileGridSkeleton   | count?, selectionMode? | Grid view placeholder  |
| FileDetailSkeleton | count?, selectionMode? | Table view placeholder |
| FileTreeSkeleton   | count?, level?         | Tree view placeholder  |

### 2.3 Props

| Component          | Prop          | Type    | Default                  | Description                                                                   |
| ------------------ | ------------- | ------- | ------------------------ | ----------------------------------------------------------------------------- |
| FileListSkeleton   | count         | number  | 4 (mobile) / 6 (desktop) | Skeleton row count                                                            |
| FileListSkeleton   | selectionMode | boolean | false                    | Reserved for layout compatibility; no checkbox placeholder is rendered        |
| FileGridSkeleton   | count         | number  | 4 (mobile) / 8 (desktop) | Skeleton card count                                                           |
| FileGridSkeleton   | selectionMode | boolean | false                    | Reserved for layout compatibility; no checkbox placeholder is rendered        |
| FileDetailSkeleton | count         | number  | 6                        | Table row count                                                               |
| FileDetailSkeleton | selectionMode | boolean | false                    | Reserved for layout compatibility; no checkbox column placeholder is rendered |
| FileTreeSkeleton   | count         | number  | 3                        | Tree item count                                                               |
| FileTreeSkeleton   | level         | number  | 0                        | Indentation level                                                             |

### 2.4 Dependencies

- **imports:** React, MUI Box, Skeleton, TableRow, TableCell, useResponsive
- **Reference implementation:** `client/src/components/file-manager/FileSkeletons.js`

### 2.5 i18n Keys

- None

### 2.6 Conditional Rendering

- selectionMode is accepted for API compatibility but does not render checkbox-specific placeholders
- useResponsive for FileListSkeleton/FileGridSkeleton count
- FileTreeSkeleton level: pl = level \* 2
- **Gradual opacity (max 3 items):** When count ≥ 2, the last 1–3 skeletons fade. Others stay 100%.
  - count=2: last 1 at 50%
  - count=3: last 2 at 66%, 33%
  - count=4: last 3 at 75%, 50%, 25%
  - count≥5: first (count−3) at 100%, last 3 at 75%, 50%, 25%

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] FileListSkeleton renders grid with skeleton items
- [ ] FileGridSkeleton renders grid with card-like items
- [ ] FileDetailSkeleton renders table rows
- [ ] FileTreeSkeleton renders indented items
- [ ] selectionMode prop is accepted without changing skeleton structure
- [ ] Gradual opacity: count=2→last 50%, count=4→last three 75%/50%/25%, count=5→first two 100% and last three 75%/50%/25%

### 2.8 Edge Cases

- Responsive count differs mobile vs desktop
- FileDetailSkeleton used inside TableBody
