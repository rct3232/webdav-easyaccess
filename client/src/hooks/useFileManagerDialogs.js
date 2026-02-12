import { useState, useCallback } from 'react';
import useDialog from './useDialog';

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
  const sharedFolderManageDialog = useDialog();
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

  // Custom open/close handlers for rename dialog
  const openRenameDialog = useCallback((file) => {
    if (file) {
      setRenameNewName(file.basename || file.name);
    }
    renameDialog.open(file);
  }, [renameDialog]);

  const closeRenameDialog = useCallback(() => {
    renameDialog.close();
    setRenameNewName('');
    setRenameError('');
  }, [renameDialog]);

  // Custom close handler for action sheet
  const closeActionSheet = useCallback(() => {
    actionSheet.close();
  }, [actionSheet]);

  return {
    // States - maintaining backward compatibility
    uploadDialogOpen: uploadDialog.isOpen,
    createFolderDialogOpen: createFolderDialog.isOpen,
    previewDialogOpen: previewDialog.isOpen,
    renameDialogOpen: renameDialog.isOpen,
    shareDialogOpen: shareDialog.isOpen,
    shareDialogV2Open: shareDialogV2.isOpen,
    sharedFolderManageDialogOpen: sharedFolderManageDialog.isOpen,
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
    mobileSharedManageFile: sharedFolderManageDialog.data,
    mobilePropertiesFile: propertiesDialog.data,
    bulkDeleteFilePaths: bulkDeleteDialog.data || [],
    mobilePickerFile,
    mobilePickerAction,

    // State Setters (for cases where direct control is needed)
    setUploadDialogOpen: (open) => open ? uploadDialog.open() : uploadDialog.close(),
    setCreateFolderDialogOpen: (open) => open ? createFolderDialog.open() : createFolderDialog.close(),
    setPreviewDialogOpen: (open) => open ? previewDialog.open() : previewDialog.close(),
    setRenameDialogOpen: (open) => open ? renameDialog.open() : closeRenameDialog(),
    setShareDialogOpen: (open) => open ? shareDialog.open() : shareDialog.close(),
    setShareDialogV2Open: (open) => open ? shareDialogV2.open() : shareDialogV2.close(),
    setSharedFolderManageDialogOpen: (open) => open ? sharedFolderManageDialog.open() : sharedFolderManageDialog.close(),
    setPropertiesDialogOpen: (open) => open ? propertiesDialog.open() : propertiesDialog.close(),
    setBulkDeleteDialogOpen: (open) => open ? bulkDeleteDialog.open() : bulkDeleteDialog.close(),
    setActionSheetOpen: (open) => open ? actionSheet.open() : actionSheet.close(),
    setActionSheetFile: (file) => actionSheet.open(file),
    setSelectedFile,
    setContextMenu,
    setRenameNewName,
    setRenameError,
    setMobileRenameFile: (file) => file ? renameDialog.open(file) : renameDialog.close(),
    setMobileShareFile: (file) => file ? shareDialog.open(file) : shareDialog.close(),
    setShareDialogV2File: (file) => file ? shareDialogV2.open(file) : shareDialogV2.close(),
    setMobileSharedManageFile: (file) => file ? sharedFolderManageDialog.open(file) : sharedFolderManageDialog.close(),
    setMobilePropertiesFile: (file) => file ? propertiesDialog.open(file) : propertiesDialog.close(),
    setBulkDeleteFilePaths: (paths) => paths?.length > 0 ? bulkDeleteDialog.open(paths) : bulkDeleteDialog.close(),
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
    openSharedFolderManageDialog: sharedFolderManageDialog.open,
    closeSharedFolderManageDialog: sharedFolderManageDialog.close,
    openPropertiesDialog: propertiesDialog.open,
    closePropertiesDialog: propertiesDialog.close,
    openBulkDeleteDialog: bulkDeleteDialog.open,
    closeBulkDeleteDialog: bulkDeleteDialog.close,
    closeActionSheet,
  };
};
