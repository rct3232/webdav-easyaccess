# fileIconUtils Spec

## 1. Overview

| Item | Description                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| Role | Resolve file/folder icon components (MUI icons) based on file type and mime. Returns JSX for use in FileList, FileGrid, etc. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/fileIconUtils.js`
- **Test file:** `client/src/utils/__tests__/fileIconUtils.test.js`

### 2.2 Function Signatures

| Function           | (input) => return                                    |
| ------------------ | ---------------------------------------------------- |
| getFileIcon        | (file) => JSX.Element (Folder/Image/Video/File icon) |
| getFileIconForGrid | (file) => JSX.Element (larger, sx props)             |
| getThumbnail       | (file) => string \| null (file.thumbnailUrl)         |

### 2.3 Dependencies

- `@mui/icons-material` (Folder, InsertDriveFile, Image, VideoFile)
- File shape: { type, mime, thumbnailUrl }

### 2.4 Icon Selection

- `type === 'directory'` → FolderIcon
- `mime?.startsWith('image/')` → ImageIcon
- `mime?.startsWith('video/')` → VideoIcon
- else → FileIcon

### 2.5 Verification Scenarios

- [ ] getFileIcon: directory → FolderIcon; image mime → ImageIcon; video mime → VideoIcon; default → FileIcon
- [ ] getFileIconForGrid: directory → FolderIcon 48px; file → FileIcon 48px
- [ ] getThumbnail returns thumbnailUrl or null

### 2.6 Edge Cases

- Missing mime/type → default FileIcon
