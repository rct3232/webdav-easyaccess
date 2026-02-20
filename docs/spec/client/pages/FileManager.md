# FileManager Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Route path | `/files/*` |
| Role | Main file browser: lists files/folders, supports CRUD, bulk operations, drag-and-drop upload, share link mode. Used as the primary file management UI and also rendered inside ShareLinkLoader for shared directories. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager.js`
- **Test file:** `client/src/pages/__tests__/FileManager.test.js`

### 2.2 Hooks Used

- useAuth, useNavigate, useTranslation
- useFileManager (path, files, loading, sort, loadFiles, hasWritePermission)
- useSelection (selectionMode, selectedFiles, handlers)
- useBulkOperations
- useFileOperations
- useFileManagerDialogs
- useDropToUpload, usePullToRefresh (mobile)
- useResponsive (isMobile)
- useInfiniteScroll
- useMessage, useRecentFile

### 2.3 Main Child Components

- FileManagerHeader, Breadcrumb, FileManagerControls, FAB
- FileList, FileGrid, FileDetail (view-mode-dependent)
- FileContextMenu, FileActionSheet
- FolderTree
- BulkActionToolbar
- FileOperationProgress
- UploadDialog, CreateFolderDialog, FilePreviewDialog, FolderPickerDialog
- ShareDialog, ShareTargetDialog, LoginDialog, ConfirmDialog
- ConflictResolveDialog, RenameDialog, FilePropertiesDialog

### 2.4 Route Protection

- Wrapped by PrivateRoute when rendered from `/files/*` (auth required)
- When rendered by ShareLinkLoader (share link mode): no auth required; optional login modal for “add to my permissions”

### 2.5 Main User Flows

- Browse folders (path click, breadcrumb, back)
- Search (client-side filter by name)
- Sort (name, date, size, type)
- View mode toggle (list, grid, detail)
- Selection mode (bulk move, copy, download, delete)
- File click: open preview or navigate folder
- Context menu / action sheet: download, rename, move, copy, share, properties, delete
- Drag-and-drop: file-to-folder move, external file upload
- Pull-to-refresh (mobile)
- Create folder, upload files
- Share link mode: login, add to shared, leave share

### 2.6 Integration Test Scenarios

- [ ] Initial render with loading state
- [ ] File list loads and displays after load
- [ ] Path navigation updates list
- [ ] Search filters files
- [ ] Selection mode: select all, bulk actions
- [ ] Context menu opens and actions call correct handlers
- [ ] Upload flow (conflict check, progress, completion)
- [ ] Share link mode: unauthenticated vs authenticated behavior
- [ ] Permission request from ShareTargetDialog: open Share on folder (no permission) → Request read permission → UI shows requested state (plan 3.2, MyPage 2.6)

### 2.7 Conditional Rendering

- Loading: spinner while loading files
- Share link mode: simplified header, no upload/create, download-only bulk actions
- Breadcrumb, FAB: shown on all viewports
- Mobile: collapsible FolderTree, FileActionSheet
- Add-to-shared modal when user has share link but lacks permission
