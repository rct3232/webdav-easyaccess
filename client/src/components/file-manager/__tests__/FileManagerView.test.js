/**
 * FileManagerView tests.
 * @see docs/spec/client/components/file-manager/FileManagerView.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';

import { renderWithProviders } from '../../../test-utils';
import FileManagerView from '../FileManagerView';

jest.mock('../../../services/folderTreeGateway', () => {
  const { createFolderTreeGatewayMock } = require('../../../testing/mocks/serviceMocks');
  return createFolderTreeGatewayMock();
});

jest.mock('../../../services/recentFilesRepository', () => {
  const { createRecentFilesRepositoryMock } = require('../../../testing/mocks/serviceMocks');
  return createRecentFilesRepositoryMock();
});

jest.mock('../../../services/recentFilesNotifier', () => {
  const { createRecentFilesNotifierMock } = require('../../../testing/mocks/serviceMocks');
  return createRecentFilesNotifierMock();
});

import folderTreeGateway from '../../../services/folderTreeGateway';
import { getRecentFiles } from '../../../services/recentFilesRepository';
import { onRecentFilesChange } from '../../../services/recentFilesNotifier';

function createProps(overrides = {}) {
  const baseProps = {
    shareContext: {
      shareToken: null,
      isShareLinkMode: false,
      shareRootPath: '/shared',
      shareRootName: 'Shared',
    },
    shellContext: {
      user: { id: 'user-1', username: 'user1' },
      navigate: jest.fn(),
      isMobile: true,
      fileContentRef: { current: null },
      scrollContainerRef: { current: null },
    },
    overlayState: {
      drawerOpen: false,
      setDrawerOpen: jest.fn(),
      progressDrawerOpen: false,
      setProgressDrawerOpen: jest.fn(),
      loginModalOpen: false,
      setLoginModalOpen: jest.fn(),
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
    },
    explorerSession: {
      controlsState: {
        currentPath: '/docs',
        viewMode: 'list',
        setViewMode: jest.fn(),
        sortMode: 'name',
        setSortMode: jest.fn(),
        searchQuery: '',
        setSearchQuery: jest.fn(),
      },
      listingState: {
        displayedFiles: [{ nodeId: 1, path: '/docs/a.txt', basename: 'a.txt', type: 'file', size: 12, lastmod: '2025-01-01T00:00:00Z' }],
        loading: false,
        processingMap: new Map(),
        handleThumbnailsLoaded: jest.fn(),
        loadMoreRef: { current: null },
        hasMore: false,
      },
    },
    selectionState: {
      selectionModel: {
        selectionMode: false,
        selectedFiles: new Set(),
        handleFileCheck: jest.fn(),
      },
      bulkState: {
        handleSelectAll: jest.fn(),
        handleDeselectAll: jest.fn(),
        allSelectedHaveWrite: true,
        hasReadOnlyInSelection: false,
      },
    },
    explorerActionState: {
      capabilityState: {
        hasWritePermission: true,
      },
      treeState: {
        treeUpdateTrigger: null,
      },
      transferState: {
        contentAreaDraggedPath: null,
        bulkMoveCopyInProgress: false,
      },
    },
    dialogState: {
      actionContext: {
        actionSheetOpen: false,
        closeActionSheet: jest.fn(),
        actionSheetFile: null,
        contextMenu: null,
        setContextMenu: jest.fn(),
      },
      pickerState: {
        mobilePickerFile: null,
        setMobilePickerFile: jest.fn(),
        mobilePickerAction: null,
        setMobilePickerAction: jest.fn(),
        folderPickerOpen: false,
        folderPickerAction: null,
        setFolderPickerOpen: jest.fn(),
        setFolderPickerAction: jest.fn(),
      },
      modalDialogs: {
        uploadDialogOpen: false,
        closeUploadDialog: jest.fn(),
        createFolderDialogOpen: false,
        closeCreateFolderDialog: jest.fn(),
        previewDialogOpen: false,
        closePreviewDialog: jest.fn(),
        openRenameDialog: jest.fn(),
        closeRenameDialog: jest.fn(),
        renameDialogOpen: false,
        renameNewName: '',
        setRenameNewName: jest.fn(),
        renameError: '',
        setRenameError: jest.fn(),
        renameLoading: false,
        shareDialogV2Open: false,
        closeShareDialogV2: jest.fn(),
        shareDialogOpen: false,
        closeShareDialog: jest.fn(),
        openShareDialogV2: jest.fn(),
        propertiesDialogOpen: false,
        closePropertiesDialog: jest.fn(),
        openPropertiesDialog: jest.fn(),
        bulkDeleteDialogOpen: false,
        closeBulkDeleteDialog: jest.fn(),
      },
      fileTargets: {
        shareDialogV2File: null,
        mobileShareFile: null,
        propertiesFile: null,
        bulkDeleteFilePaths: [],
        bulkConflictData: null,
        setBulkConflictData: jest.fn(),
        uploadConflictData: null,
        setUploadConflictData: jest.fn(),
        mediaFiles: [],
        selectedFile: null,
        setSelectedFile: jest.fn(),
      },
    },
    messaging: {
      dropMessage: { show: false, text: '', type: 'success' },
      setDropMessage: jest.fn(),
      message: { show: false, text: '', type: 'success' },
      clearMessage: jest.fn(),
      showError: jest.fn(),
      showWarning: jest.fn(),
    },
    explorerHandlers: {
      interaction: {
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
        contentAreaDragType: 'external',
        handleActionSheetDownload: jest.fn(),
        handleActionSheetPreview: jest.fn(),
      },
      commands: {
        handleOperationComplete: jest.fn(),
        handleRename: jest.fn(),
        handleBulkDeleteConfirm: jest.fn(),
        resolveBulkConflict: jest.fn(),
        resolveUploadConflict: jest.fn(),
        handleUploadStart: jest.fn(),
        handleCreateFolderComplete: jest.fn(),
        handleFolderPickerSelect: jest.fn(),
        handleBulkMove: jest.fn(),
        handleBulkCopy: jest.fn(),
        handleBulkDownload: jest.fn(),
        openBulkDeleteDialog: jest.fn(),
        openUploadDialog: jest.fn(),
        openCreateFolderDialog: jest.fn(),
        onShareTargetSave: jest.fn(),
      },
      progress: {
        progressItems: [],
        updateProgress: jest.fn(),
        handleRetryUpload: jest.fn(),
        handleCancelUploadFileWrapper: jest.fn(),
        handleCancelAllWrapper: jest.fn(),
      },
      refreshIndicator: {
        indicatorStyles: {},
        iconStyles: {},
        isDeterminateProgress: false,
        progress: 0,
        progressColor: 'primary.main',
        textColor: 'text.secondary',
        shouldShowIndicator: false,
        showRefreshSuccess: false,
        textContent: 'idle',
      },
    },
  };

  return {
    ...baseProps,
    ...overrides,
  };
}

describe('FileManagerView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    folderTreeGateway.getUserSharedFolderPermissions.mockResolvedValue([]);
    folderTreeGateway.listFolderChildren.mockResolvedValue([]);
    getRecentFiles.mockResolvedValue([]);
    onRecentFilesChange.mockReturnValue(() => {});
  });

  it('renders the visible file list and forwards file click interactions', async () => {
    const props = createProps();
    renderWithProviders(<FileManagerView {...props} />);

    await waitFor(() => {
      expect(folderTreeGateway.getUserSharedFolderPermissions).toHaveBeenCalled();
    });

    const fileName = await screen.findByText('a.txt');
    expect(fileName).toBeInTheDocument();

    fireEvent.click(fileName);

    expect(props.explorerHandlers.interaction.handleFileClick).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 1, path: '/docs/a.txt' }),
      expect.any(Object),
      0
    );
  });

  it('forwards search input and view-mode interactions through grouped props', async () => {
    const props = createProps();
    renderWithProviders(<FileManagerView {...props} />);

    await waitFor(() => {
      expect(folderTreeGateway.getUserSharedFolderPermissions).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'needle' } });
    fireEvent.click(screen.getByTitle(/grid/i));

    expect(props.explorerSession.controlsState.setSearchQuery).toHaveBeenCalledWith('needle');
    expect(props.explorerSession.controlsState.setViewMode).toHaveBeenCalledWith('grid');
  });

  it('forwards fab upload and create-folder actions', async () => {
    const props = createProps();
    renderWithProviders(<FileManagerView {...props} />);

    await waitFor(() => {
      expect(folderTreeGateway.getUserSharedFolderPermissions).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: /file actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /upload file/i }));
    fireEvent.click(screen.getByRole('button', { name: /file actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /create folder/i }));

    expect(props.explorerHandlers.commands.openUploadDialog).toHaveBeenCalled();
    expect(props.explorerHandlers.commands.openCreateFolderDialog).toHaveBeenCalled();
  });

  it('uses share-link fab actions for login and add-to-shared states', async () => {
    const loginProps = createProps({
      shareContext: {
        ...createProps().shareContext,
        isShareLinkMode: true,
      },
      shellContext: {
        ...createProps().shellContext,
        user: null,
      },
    });
    const addProps = createProps({
      shareContext: {
        ...createProps().shareContext,
        isShareLinkMode: true,
      },
    });

    const { rerender } = renderWithProviders(<FileManagerView {...loginProps} />);
    // Ensure initial render/effects settle before interactions.
    await screen.findByText('a.txt');
    fireEvent.click(screen.getByRole('button', { name: /login/i }));
    expect(loginProps.overlayState.setLoginModalOpen).toHaveBeenCalledWith(true);

    rerender(<FileManagerView {...addProps} />);
    await waitFor(() => {
      expect(folderTreeGateway.getUserSharedFolderPermissions).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole('button', { name: /add to shared/i }));
    expect(addProps.overlayState.openAddToSharedModal).toHaveBeenCalled();
  });
});
