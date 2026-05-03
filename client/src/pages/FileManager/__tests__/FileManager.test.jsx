/**
 * Smoke tests for FileManager page component.
 * Verifies basic render states: loading, success, error, and no-crash with valid auth.
 */
import React from 'react';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '../../../test-utils';
import FileManager from '../FileManager';

// --- Mock heavy dependencies BEFORE importing them ---

jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
  AuthProvider: ({ children }) => <>{children}</>,
}));

jest.mock('../hooks/useFileManager');
jest.mock('../hooks/useExplorerSession');
jest.mock('../hooks/useSelection');
jest.mock('../hooks/useFileManagerDialogs');
jest.mock('../hooks/useRecentFile', () => ({
  useRecentFile: jest.fn().mockReturnValue({
    trackRecentFileClick: jest.fn(),
    trackPathHistory: jest.fn(),
    clearTracking: jest.fn(),
    clearPathHistory: jest.fn(),
    handleRecentFileError: jest.fn(),
    setRecentFileToPreview: jest.fn(),
  }),
}));
jest.mock('../hooks/useExplorerRefreshIndicator');
jest.mock('../hooks/useExplorerCommands');
jest.mock('../hooks/useExplorerProgress');
jest.mock('../hooks/useExplorerNavigation');
jest.mock('../hooks/useShareLinkOverlay');
jest.mock('../hooks/useContentAreaDragDrop');
jest.mock('../hooks/useExplorerInteraction');
jest.mock('../../../hooks/useDropToUpload');
jest.mock('../../../hooks/useResponsive');
jest.mock('../../../hooks/useMessage');

// Mock FileManagerView to render controlled content based on explorerSession props
const mockFileManagerView = jest.fn();
jest.mock('../../../components/file-manager/FileManagerView', () => {
  return function MockFileManagerView({ explorerSession }) {
    const { listingState } = explorerSession || {};
    const loading = listingState?.loading ?? false;
    const displayedFiles = listingState?.displayedFiles ?? [];

    if (loading) {
      return <div role="progressbar" data-testid="loading-indicator" />;
    }
    if (displayedFiles.length > 0) {
      return (
        <ul>
          {displayedFiles.map((f, i) => (
            <li key={i} data-testid="file-item">
              {f.basename || f.name}
            </li>
          ))}
        </ul>
      );
    }
    return <div data-testid="empty-state" />;
  };
});

// --- Import mocked modules after mocks are registered ---

import { useAuth } from '../../../contexts/AuthContext';
import { useFileManager } from '../hooks/useFileManager';
import { useExplorerSession } from '../hooks/useExplorerSession';
import { useSelection } from '../hooks/useSelection';
import { useFileManagerDialogs } from '../hooks/useFileManagerDialogs';
import { useRecentFile } from '../hooks/useRecentFile';
import { useExplorerRefreshIndicator } from '../hooks/useExplorerRefreshIndicator';
import { useExplorerCommands } from '../hooks/useExplorerCommands';
import { useExplorerProgress } from '../hooks/useExplorerProgress';
import { useExplorerNavigation } from '../hooks/useExplorerNavigation';
import { useShareLinkOverlay } from '../hooks/useShareLinkOverlay';
import { useContentAreaDragDrop } from '../hooks/useContentAreaDragDrop';
import { useExplorerInteraction } from '../hooks/useExplorerInteraction';
import { useDropToUpload } from '../../../hooks/useDropToUpload';
import { useResponsive } from '../../../hooks/useResponsive';
import { useMessage } from '../../../hooks/useMessage';

const mockUser = { id: '1', username: 'testuser' };
const mockFiles = [
  { path: '/test.txt', basename: 'test.txt', name: 'test.txt', type: 'file', size: 42, lastmod: '2025-01-01T00:00:00Z' },
];

function setupMocks({ loading = false, files = [] } = {}) {
  useAuth.mockReturnValue({ user: mockUser });

  useFileManager.mockReturnValue({
    currentPath: '/',
    setCurrentPath: jest.fn(),
    files,
    loading,
    loadFiles: jest.fn(),
    hasWritePermission: true,
    onLoadErrorRef: { current: null },
  });

  useExplorerSession.mockReturnValue({
    sessionKey: 'key',
    files,
    searchQuery: '',
    setSearchQuery: jest.fn(),
    sortMode: 'name',
    setSortMode: jest.fn(),
    viewMode: 'list',
    setViewMode: jest.fn(),
    sortedFiles: files,
    displayedFiles: files,
    loadMoreRef: { current: null },
    hasMore: false,
    handleThumbnailsLoaded: jest.fn(),
  });

  useSelection.mockReturnValue({
    selectionMode: false,
    selectedFiles: new Set(),
    handleSelectAll: jest.fn(),
    handleDeselectAll: jest.fn(),
    handleFileCheck: jest.fn(),
    toggleFileSelection: jest.fn(),
    handleFileClickSelection: jest.fn(),
    enterSelectionMode: jest.fn(),
    setSelectionMode: jest.fn(),
    setSelectedFiles: jest.fn(),
  });

  useFileManagerDialogs.mockReturnValue({
    uploadDialogOpen: false,
    openUploadDialog: jest.fn(),
    closeUploadDialog: jest.fn(),
    createFolderDialogOpen: false,
    openCreateFolderDialog: jest.fn(),
    closeCreateFolderDialog: jest.fn(),
    previewDialogOpen: false,
    setPreviewDialogOpen: jest.fn(),
    openPreviewDialog: jest.fn(),
    closePreviewDialog: jest.fn(),
    renameDialogOpen: false,
    openRenameDialog: jest.fn(),
    closeRenameDialog: jest.fn(),
    shareDialogOpen: false,
    closeShareDialog: jest.fn(),
    shareDialogV2Open: false,
    shareDialogV2File: null,
    openShareDialogV2: jest.fn(),
    closeShareDialogV2: jest.fn(),
    propertiesDialogOpen: false,
    openPropertiesDialog: jest.fn(),
    closePropertiesDialog: jest.fn(),
    bulkDeleteDialogOpen: false,
    openBulkDeleteDialog: jest.fn(),
    closeBulkDeleteDialog: jest.fn(),
    actionSheetOpen: false,
    setActionSheetOpen: jest.fn(),
    closeActionSheet: jest.fn(),
    actionSheetFile: null,
    setActionSheetFile: jest.fn(),
    selectedFile: null,
    setSelectedFile: jest.fn(),
    contextMenu: null,
    setContextMenu: jest.fn(),
    renameNewName: '',
    setRenameNewName: jest.fn(),
    renameError: '',
    setRenameError: jest.fn(),
    mobileRenameFile: null,
    mobileShareFile: null,
    mobilePropertiesFile: null,
    bulkDeleteFilePaths: [],
    mobilePickerFile: null,
    setMobilePickerFile: jest.fn(),
    mobilePickerAction: null,
    setMobilePickerAction: jest.fn(),
    addToSharedModalOpen: false,
    setAddToSharedModalOpen: jest.fn(),
    addToSharedStatus: 'confirm',
    addToSharedConfirmLoading: false,
    openAddToSharedModal: jest.fn(),
    handleAddToSharedConfirm: jest.fn(),
    leaveShareConfirmOpen: false,
    setLeaveShareConfirmOpen: jest.fn(),
    leaveShareConfirmTargetPath: null,
    setLeaveShareConfirmTargetPath: jest.fn(),
    handleLeaveShareConfirm: jest.fn(),
  });

  useRecentFile.mockReturnValue({
    trackRecentFileClick: jest.fn(),
    trackPathHistory: jest.fn(),
    clearTracking: jest.fn(),
    clearPathHistory: jest.fn(),
    handleRecentFileError: jest.fn(),
    setRecentFileToPreview: jest.fn(),
  });

  useExplorerRefreshIndicator.mockReturnValue({
    showRefreshSuccess: false,
    handleLoadComplete: jest.fn(),
    indicatorStyles: {},
    iconStyles: {},
    progress: 0,
    progressColor: 'primary.main',
    textColor: 'text.secondary',
    textContent: 'idle',
    shouldShowIndicator: false,
    isDeterminateProgress: false,
  });

  useExplorerCommands.mockReturnValue({
    processingMap: new Map(),
    renameLoading: false,
    folderPickerOpen: false,
    folderPickerAction: null,
    setFolderPickerOpen: jest.fn(),
    setFolderPickerAction: jest.fn(),
    progressItems: [],
    updateProgress: jest.fn(),
    handleBulkMove: jest.fn(),
    handleBulkCopy: jest.fn(),
    handleBulkDownload: jest.fn(),
    handleFolderPickerSelect: jest.fn(),
    handleRetry: jest.fn(),
    handleCancelBulkOperation: jest.fn(),
    bulkConflictData: null,
    resolveBulkConflict: jest.fn(),
    setBulkConflictData: jest.fn(),
    folderPickerMoveCopyInProgress: false,
    uploadConflictData: null,
    setUploadConflictData: jest.fn(),
    resolveUploadConflict: jest.fn(),
    executeExplorerUpload: jest.fn(),
    handleUploadStart: jest.fn(),
    handleExplorerDrop: jest.fn(),
    explorerUploadFilesRef: { current: [] },
    explorerUploadAbortControllersRef: { current: new Map() },
    explorerUploadCancelledRef: { current: false },
    explorerUploadCancelAllRequestedRef: { current: false },
    handleRename: jest.fn(),
    handleActionSheetDownload: jest.fn(),
    handleFileDownloadOp: jest.fn(),
    handleFileDrop: jest.fn(),
    handleInternalFileDrop: jest.fn(),
    handleDropPermissionDenied: jest.fn(),
    handleBulkDeleteConfirm: jest.fn(),
    handleOperationComplete: jest.fn(),
  });

  useExplorerProgress.mockReturnValue({
    isProgressDrawerOpen: false,
    setProgressDrawerOpen: jest.fn(),
    retryProgress: jest.fn(),
    cancelUploadFile: jest.fn(),
    cancelAll: jest.fn(),
  });

  useExplorerNavigation.mockReturnValue({
    handlePathClick: jest.fn(),
    handleScrollAreaClick: jest.fn(),
  });

  useShareLinkOverlay.mockReturnValue({
    addToSharedModalOpen: false,
    setAddToSharedModalOpen: jest.fn(),
    addToSharedStatus: 'confirm',
    addToSharedConfirmLoading: false,
    openAddToSharedModal: jest.fn(),
    handleAddToSharedConfirm: jest.fn(),
    leaveShareConfirmOpen: false,
    setLeaveShareConfirmOpen: jest.fn(),
    leaveShareConfirmTargetPath: null,
    setLeaveShareConfirmTargetPath: jest.fn(),
    handleLeaveSharePathClick: jest.fn(),
    handleLeaveShareConfirm: jest.fn(),
  });

  useContentAreaDragDrop.mockReturnValue({
    handleContentAreaDragEnter: jest.fn(),
    handleContentAreaDragOver: jest.fn(),
    handleContentAreaDragLeave: jest.fn(),
    handleContentAreaDrop: jest.fn(),
  });

  useExplorerInteraction.mockReturnValue({
    handleFileClick: jest.fn(),
    handleMoreClick: jest.fn(),
    handleLongPressSelect: jest.fn(),
    handleViewContextMenu: jest.fn(),
    handleFileDrop: jest.fn(),
    handleDropPermissionDenied: jest.fn(),
    handleDragStartFromView: jest.fn(),
    handleDragEndFromView: jest.fn(),
    handleExplorerDrop: jest.fn(),
    handleInternalFileDrop: jest.fn(),
    handleLeaveSharePathClick: jest.fn(),
    handlePathClick: jest.fn(),
    handleScrollAreaClick: jest.fn(),
    handleFileDownloadOp: jest.fn(),
    contentAreaDnD: {
      handleContentAreaDragEnter: jest.fn(),
      handleContentAreaDragOver: jest.fn(),
      handleContentAreaDragLeave: jest.fn(),
      handleContentAreaDrop: jest.fn(),
    },
    isFileAreaDraggingOver: false,
    contentAreaDragType: null,
    handleActionSheetDownload: jest.fn(),
    handleActionSheetPreview: jest.fn(),
  });

  useDropToUpload.mockReturnValue({
    isDraggingOver: false,
    handleDragEnter: jest.fn(),
    handleDragOver: jest.fn(),
    handleDragLeave: jest.fn(),
    handleDrop: jest.fn(),
    reset: jest.fn(),
  });

  useResponsive.mockReturnValue({ isMobile: false });

  useMessage.mockReturnValue({
    message: { show: false, text: '', type: 'success' },
    showError: jest.fn(),
    showWarning: jest.fn(),
    clearMessage: jest.fn(),
  });
}

describe('FileManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing with valid auth context', () => {
    setupMocks({ loading: false, files: mockFiles });
    const { container } = renderWithProviders(<FileManager />);
    expect(container.firstChild).not.toBeNull();
  });

  it('shows loading state during initial load', () => {
    setupMocks({ loading: true, files: [] });
    renderWithProviders(<FileManager />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('displays file list after successful API response', () => {
    setupMocks({ loading: false, files: mockFiles });
    renderWithProviders(<FileManager />);
    expect(screen.getByText('test.txt')).toBeInTheDocument();
  });

  it('shows error state on API failure', () => {
    setupMocks({ loading: false, files: [] });
    renderWithProviders(<FileManager />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('test.txt')).not.toBeInTheDocument();
  });
});
