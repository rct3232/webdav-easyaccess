import { useState, useCallback } from 'react';
import useDialog from '../../../hooks/useDialog';

/**
 * Hook for managing all dialog states in FileManager.
 * This helps reduce the size and complexity of the FileManager component.
 * Refactored to use useDialog hook for cleaner state management.
 */
export const useFileManagerDialogs = () => {
  // Simple dialogs using useDialog hook
  const uploadDialog = useDialog();
  const createFolderDialog = useDialog();
  const previewDialog = useDialog();

  // Dialogs with file data
  const shareDialog = useDialog();
  const shareDialogV2 = useDialog();
  const propertiesDialog = useDialog();
  const bulkDeleteDialog = useDialog();
  const actionSheet = useDialog();

  // Rename dialog needs special handling for additional state
  const renameDialog = useDialog();
  const [renameNewName, setRenameNewName] = useState('');
  const [renameError, setRenameError] = useState('');

  // Context menu and selected file (not dialogs)
  const [selectedFile, setSelectedFile] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);

  // Mobile picker states
  const [mobilePickerFile, setMobilePickerFile] = useState(null);
  const [mobilePickerAction, setMobilePickerAction] = useState(null);

  // Destructure the stable open/close fns so setter deps reference stable identifiers
  // (member-expression deps would trip react-hooks/exhaustive-deps under --max-warnings 0).
  const { open: openUpload, close: closeUpload } = uploadDialog;
  const { open: openCreateFolder, close: closeCreateFolder } = createFolderDialog;
  const { open: openPreview, close: closePreview } = previewDialog;
  const { open: openRename, close: closeRename } = renameDialog;
  const { open: openShare, close: closeShare } = shareDialog;
  const { open: openShareV2, close: closeShareV2 } = shareDialogV2;
  const { open: openProperties, close: closeProperties } = propertiesDialog;
  const { open: openBulkDelete, close: closeBulkDelete } = bulkDeleteDialog;
  const { open: openActionSheet, close: closeActionSheetFn } = actionSheet;

  // Custom open/close handlers for rename dialog
  const openRenameDialog = useCallback(
    (file) => {
      if (file) {
        setRenameNewName(file.basename || file.name);
      }
      openRename(file);
    },
    [openRename]
  );

  const closeRenameDialog = useCallback(() => {
    closeRename();
    setRenameNewName('');
    setRenameError('');
  }, [closeRename]);

  // Custom close handler for action sheet
  const closeActionSheet = useCallback(() => {
    closeActionSheetFn();
  }, [closeActionSheetFn]);

  // Stable direct-control setters (identity preserved across renders)
  const setUploadDialogOpen = useCallback(
    (open) => (open ? openUpload() : closeUpload()),
    [openUpload, closeUpload]
  );
  const setCreateFolderDialogOpen = useCallback(
    (open) => (open ? openCreateFolder() : closeCreateFolder()),
    [openCreateFolder, closeCreateFolder]
  );
  const setPreviewDialogOpen = useCallback(
    (open) => (open ? openPreview() : closePreview()),
    [openPreview, closePreview]
  );
  const setRenameDialogOpen = useCallback(
    (open) => (open ? openRename() : closeRenameDialog()),
    [openRename, closeRenameDialog]
  );
  const setShareDialogOpen = useCallback(
    (open) => (open ? openShare() : closeShare()),
    [openShare, closeShare]
  );
  const setShareDialogV2Open = useCallback(
    (open) => (open ? openShareV2() : closeShareV2()),
    [openShareV2, closeShareV2]
  );
  const setPropertiesDialogOpen = useCallback(
    (open) => (open ? openProperties() : closeProperties()),
    [openProperties, closeProperties]
  );
  const setBulkDeleteDialogOpen = useCallback(
    (open) => (open ? openBulkDelete() : closeBulkDelete()),
    [openBulkDelete, closeBulkDelete]
  );
  const setActionSheetOpen = useCallback(
    (open) => (open ? openActionSheet() : closeActionSheet()),
    [openActionSheet, closeActionSheet]
  );
  const setMobileRenameFile = useCallback(
    (file) => (file ? openRename(file) : closeRename()),
    [openRename, closeRename]
  );
  const setMobileShareFile = useCallback(
    (file) => (file ? openShare(file) : closeShare()),
    [openShare, closeShare]
  );
  const setShareDialogV2File = useCallback(
    (file) => (file ? openShareV2(file) : closeShareV2()),
    [openShareV2, closeShareV2]
  );
  const setMobilePropertiesFile = useCallback(
    (file) => (file ? openProperties(file) : closeProperties()),
    [openProperties, closeProperties]
  );
  const setBulkDeleteFilePaths = useCallback(
    (paths) => (paths?.length > 0 ? openBulkDelete(paths) : closeBulkDelete()),
    [openBulkDelete, closeBulkDelete]
  );

  return {
    // States - maintaining backward compatibility
    uploadDialogOpen: uploadDialog.isOpen,
    createFolderDialogOpen: createFolderDialog.isOpen,
    previewDialogOpen: previewDialog.isOpen,
    renameDialogOpen: renameDialog.isOpen,
    shareDialogOpen: shareDialog.isOpen,
    shareDialogV2Open: shareDialogV2.isOpen,
    propertiesDialogOpen: propertiesDialog.isOpen,
    bulkDeleteDialogOpen: bulkDeleteDialog.isOpen,
    actionSheetOpen: actionSheet.isOpen,
    actionSheetFile: actionSheet.data,
    selectedFile,
    contextMenu,

    renameNewName,
    renameError,
    mobileRenameFile: renameDialog.data,
    mobileShareFile: shareDialog.data,
    shareDialogV2File: shareDialogV2.data,
    mobilePropertiesFile: propertiesDialog.data,
    bulkDeleteFilePaths: bulkDeleteDialog.data || [],
    mobilePickerFile,
    mobilePickerAction,

    // State Setters (for cases where direct control is needed)
    setUploadDialogOpen,
    setCreateFolderDialogOpen,
    setPreviewDialogOpen,
    setRenameDialogOpen,
    setShareDialogOpen,
    setShareDialogV2Open,
    setPropertiesDialogOpen,
    setBulkDeleteDialogOpen,
    setActionSheetOpen,
    setActionSheetFile: actionSheet.open,
    setSelectedFile,
    setContextMenu,
    setRenameNewName,
    setRenameError,
    setMobileRenameFile,
    setMobileShareFile,
    setShareDialogV2File,
    setMobilePropertiesFile,
    setBulkDeleteFilePaths,
    setMobilePickerFile,
    setMobilePickerAction,

    // Action Handlers
    openUploadDialog: uploadDialog.open,
    closeUploadDialog: uploadDialog.close,
    openCreateFolderDialog: createFolderDialog.open,
    closeCreateFolderDialog: createFolderDialog.close,
    openPreviewDialog: previewDialog.open,
    closePreviewDialog: previewDialog.close,
    openRenameDialog,
    closeRenameDialog,
    openShareDialog: shareDialog.open,
    closeShareDialog: shareDialog.close,
    openShareDialogV2: shareDialogV2.open,
    closeShareDialogV2: shareDialogV2.close,
    openPropertiesDialog: propertiesDialog.open,
    closePropertiesDialog: propertiesDialog.close,
    openBulkDeleteDialog: bulkDeleteDialog.open,
    closeBulkDeleteDialog: bulkDeleteDialog.close,
    closeActionSheet,
  };
};
