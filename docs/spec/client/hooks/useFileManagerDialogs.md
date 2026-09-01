# useFileManagerDialogs Spec

## 1. Overview

| Item                     | Description                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Centralized dialog state for FileManager. Uses useDialog for upload, createFolder, preview, share, properties, bulkDelete, actionSheet, rename. Context menu, selected file, mobile picker. |
| Used by components/pages | FileManager                                                                                                                                                                                 |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useFileManagerDialogs.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useFileManagerDialogs.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
| ---- | ---- | -------- | ----------- |
| None | -    | -        | -           |

### 2.3 Return Value / State

| Key                                             | Type                       | Meaning                |
| ----------------------------------------------- | -------------------------- | ---------------------- |
| uploadDialogOpen                                | boolean                    | Upload dialog          |
| createFolderDialogOpen                          | boolean                    | Create folder          |
| previewDialogOpen                               | boolean                    | Preview                |
| renameDialogOpen                                | boolean                    | Rename                 |
| shareDialogOpen                                 | boolean                    | Share                  |
| shareDialogV2Open                               | boolean                    | Share v2               |
| propertiesDialogOpen                            | boolean                    | Properties             |
| bulkDeleteDialogOpen                            | boolean                    | Bulk delete            |
| actionSheetOpen                                 | boolean                    | Action sheet           |
| actionSheetFile                                 | object                     | Action sheet file      |
| selectedFile                                    | object                     | Selected file          |
| contextMenu                                     | { mouseX, mouseY } \| null | Context menu pos       |
| renameNewName                                   | string                     | Rename value           |
| renameError                                     | string                     | Rename error           |
| mobileRenameFile                                | object                     | Rename dialog file     |
| mobileShareFile                                 | object                     | Share dialog file      |
| shareDialogV2File                               | object                     | Share v2 dialog file   |
| mobilePropertiesFile                            | object                     | Properties dialog file |
| bulkDeleteFilePaths                             | array                      | Bulk delete paths      |
| mobilePickerFile                                | object                     | Mobile picker file     |
| mobilePickerAction                              | string                     | Mobile picker action   |
| openUploadDialog, closeUploadDialog             | function                   | Upload dialog          |
| openCreateFolderDialog, closeCreateFolderDialog | function                   | Create folder          |
| openPreviewDialog, closePreviewDialog           | function                   | Preview                |
| openRenameDialog, closeRenameDialog             | function                   | Rename                 |
| openShareDialog, closeShareDialog               | function                   | Share                  |
| openShareDialogV2, closeShareDialogV2           | function                   | Share v2               |
| openPropertiesDialog, closePropertiesDialog     | function                   | Properties             |
| openBulkDeleteDialog, closeBulkDeleteDialog     | function                   | Bulk delete            |
| closeActionSheet                                | function                   | Close action sheet     |
| set\*                                           | functions                  | Setters for state      |

### 2.4 Dependencies

- useDialog
- No services

### 2.5 Side Effects

- State updates only

### 2.6 Error Handling

- None

### 2.7 Verification Scenarios

- [ ] Each dialog open/close
- [ ] openRenameDialog sets renameNewName
- [ ] closeRenameDialog clears error
- [ ] contextMenu, selectedFile

### 2.8 Edge Cases

- renameDialog.data = file for mobileRenameFile
