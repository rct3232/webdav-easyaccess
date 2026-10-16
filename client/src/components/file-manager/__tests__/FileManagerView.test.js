/**
 * FileManagerView tests.
 * @see docs/spec/client/components/file-manager/FileManagerView.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';

import { renderWithProviders } from '../../../test-utils';
import FileManagerView from '../FileManagerView';

import folderTreeGateway from '../../../services/folderTreeGateway';
import explorerGateway from '../../../services/explorerGateway';
import { getRecentFiles } from '../../../services/recentFilesRepository';
import { onRecentFilesChange } from '../../../services/recentFilesNotifier';

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

jest.mock('../../../services/explorerGateway', () => {
  const { createExplorerGatewayMock } = require('../../../testing/mocks/serviceMocks');
  return { __esModule: true, default: createExplorerGatewayMock() };
});

jest.mock('../../../hooks/useThumbnailLazyLoad', () => ({
  __esModule: true,
  useThumbnailLazyLoad: jest.fn(),
}));

import { useThumbnailLazyLoad } from '../../../hooks/useThumbnailLazyLoad';

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
      leaveShareConfirmTargetNodeId: null,
      setLeaveShareConfirmTargetNodeId: jest.fn(),
      leaveShareConfirmTargetPath: null,
      setLeaveShareConfirmTargetPath: jest.fn(),
      handleLeaveShareConfirm: jest.fn(),
    },
    explorerSession: {
      controlsState: {
        currentPath: '/docs',
        viewMode: 'list',
        setViewMode: jest.fn(),
        memberViewMode: 'grid',
        setMemberViewMode: jest.fn(),
        likedViewMode: 'grid',
        setLikedViewMode: jest.fn(),
        memberSortMode: 'date_desc',
        setMemberSortMode: jest.fn(),
        sortMode: 'name',
        setSortMode: jest.fn(),
        searchQuery: '',
        setSearchQuery: jest.fn(),
        onSubmitQuery: jest.fn(),
      },
      listingState: {
        displayedFiles: [
          {
            nodeId: 1,
            path: '/docs/a.txt',
            basename: 'a.txt',
            type: 'file',
            size: 12,
            lastmod: '2025-01-01T00:00:00Z',
          },
        ],
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
        handleFolderTreeNodeClick: jest.fn(),
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

describe('FileManagerView search results mode (§3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    folderTreeGateway.getUserSharedFolderPermissions.mockResolvedValue([]);
    folderTreeGateway.listFolderChildren.mockResolvedValue([]);
    getRecentFiles.mockResolvedValue([]);
    onRecentFilesChange.mockReturnValue(() => {});
    explorerGateway.loadCollections.mockResolvedValue({ collections: [] });
    explorerGateway.subscribeToCollections.mockImplementation(() => jest.fn());
  });

  const zoneARow = {
    nodeId: 1,
    path: '/docs/movie.txt',
    name: 'movie.txt',
    basename: 'movie.txt',
    type: 'file',
    size: 10,
    highlights: [{ start: 0, end: 5, kind: 'committed' }],
  };
  const zoneBRow = {
    nodeId: 11,
    path: '',
    name: 'movie.pdf',
    basename: 'movie.pdf',
    isSearchServerRow: true,
    rowTestId: 'server-search-row-11',
    highlights: [],
  };

  const searchModel = (overrides = {}) => ({
    mode: 'results',
    terms: ['movie'],
    zoneARows: [zoneARow],
    zoneBRows: [zoneBRow],
    zoneCRows: [],
    zoneCounts: { zoneA: 1, zoneB: 1, zoneC: 0 },
    zonesCollapsed: {},
    onToggleZone: jest.fn(),
    onRevertToStep: jest.fn(),
    onExit: jest.fn(),
    onLibraryAdd: jest.fn(),
    onRowOpen: jest.fn(),
    ...overrides,
  });

  const controlsWithSearch = (base, model, extraControls = {}) => ({
    ...base,
    explorerSession: {
      ...base.explorerSession,
      controlsState: {
        ...base.explorerSession.controlsState,
        onSubmitQuery: jest.fn(),
        ...extraControls,
      },
    },
    searchResults: model,
  });

  it('results mode: the chip bar replaces the breadcrumb row and the accordion zones render inside the listing', async () => {
    const base = createProps();
    const props = controlsWithSearch(base, searchModel());
    renderWithProviders(<FileManagerView {...props} />);

    expect(await screen.findByTestId('search-chip-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('breadcrumb')).not.toBeInTheDocument();

    expect(screen.getByTestId('search-zone-header-a')).toBeInTheDocument();
    expect(screen.getByTestId('search-zone-header-b')).toBeInTheDocument();
    expect(screen.queryByTestId('search-zone-header-c')).not.toBeInTheDocument();

    const container = screen.getByTestId('explorer-container');
    expect(container).toHaveTextContent('movie.txt');
    expect(screen.getByTestId('server-search-row-11')).toBeInTheDocument();
    // the normal listing region is suppressed while the zones are on screen
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument();

    // header A shows the current path + counts; header B the EN label + count
    expect(screen.getByTestId('search-zone-header-a')).toHaveTextContent('/docs');
    expect(screen.getByTestId('search-zone-header-a')).toHaveTextContent('1');
    expect(screen.getByTestId('search-zone-header-b')).toHaveTextContent('All results');
    expect(screen.getByTestId('search-zone-header-b')).toHaveTextContent('1');
  });

  it('zone headers are sticky inside the scroll container', async () => {
    const props = controlsWithSearch(createProps(), searchModel());
    renderWithProviders(<FileManagerView {...props} />);

    await screen.findByTestId('search-zone-header-a');
    expect(getComputedStyle(screen.getByTestId('search-zone-header-a')).position).toBe('sticky');
  });

  it('zone headers carry plain icons: B cloud, C wand-stars (no composite)', async () => {
    const props = controlsWithSearch(
      createProps(),
      searchModel({
        zoneCRows: [
          {
            nodeId: 90,
            path: '',
            name: 'fantasy.jpg',
            basename: 'fantasy.jpg',
            isSearchServerRow: true,
            rowTestId: 'server-search-row-90',
            highlights: [],
          },
        ],
        zoneCounts: { zoneA: 1, zoneB: 1, zoneC: 1 },
      })
    );
    renderWithProviders(<FileManagerView {...props} />);

    const headerB = await screen.findByTestId('search-zone-header-b');
    expect(within(headerB).getByTestId('search-zone-glyph-b')).toBeInTheDocument();
    expect(within(headerB).queryByTestId('search-glyph')).not.toBeInTheDocument();
    expect(within(headerB).queryByTestId('search-action-glyph-plate')).not.toBeInTheDocument();
    const headerC = await screen.findByTestId('search-zone-header-c');
    expect(within(headerC).getByTestId('search-zone-glyph-c')).toBeInTheDocument();
  });

  it('zone header content shares the rows edge line (no horizontal inset)', async () => {
    const props = controlsWithSearch(createProps(), searchModel());
    renderWithProviders(<FileManagerView {...props} />);

    const headerA = await screen.findByTestId('search-zone-header-a');
    expect(['', '0px']).toContain(getComputedStyle(headerA).paddingLeft);
    expect(['', '0px']).toContain(getComputedStyle(headerA).paddingRight);
  });

  it('zone spacing is a grid gap between zones (no trailing margin after the last)', async () => {
    const props = controlsWithSearch(createProps(), searchModel());
    renderWithProviders(<FileManagerView {...props} />);

    const headerB = await screen.findByTestId('search-zone-header-b');
    const zoneB = headerB.parentElement;
    expect(['', '0px']).toContain(getComputedStyle(zoneB).marginBottom);
    expect(getComputedStyle(zoneB.parentElement).display).toBe('grid');
  });

  it('zone C renders when its rows arrive (suggested results label)', async () => {
    const props = controlsWithSearch(
      createProps(),
      searchModel({
        zoneCRows: [
          {
            nodeId: 90,
            path: '',
            name: 'fantasy.jpg',
            basename: 'fantasy.jpg',
            isSearchServerRow: true,
            rowTestId: 'server-search-row-90',
            highlights: [],
          },
        ],
        zoneCounts: { zoneA: 1, zoneB: 1, zoneC: 1 },
      })
    );
    renderWithProviders(<FileManagerView {...props} />);

    expect(await screen.findByTestId('search-zone-header-c')).toHaveTextContent(
      'Suggested results'
    );
    expect(screen.getByTestId('server-search-row-90')).toBeInTheDocument();
  });

  it('toggle click collapses a zone through the host callback', async () => {
    const model = searchModel();
    const props = controlsWithSearch(createProps(), model);
    renderWithProviders(<FileManagerView {...props} />);

    fireEvent.click(await screen.findByTestId('search-zone-toggle-b'));
    expect(model.onToggleZone).toHaveBeenCalledWith('b');
  });

  it('a collapsed zone keeps its header but hides its rows', async () => {
    const props = controlsWithSearch(createProps(), searchModel({ zonesCollapsed: { b: true } }));
    renderWithProviders(<FileManagerView {...props} />);

    await screen.findByTestId('search-zone-header-b');
    expect(screen.queryByTestId('server-search-row-11')).not.toBeInTheDocument();
    expect(document.querySelector('[data-file-node-id="1"]')).toBeInTheDocument();
  });
  it('header click also toggles the zone', async () => {
    const model = searchModel();
    const props = controlsWithSearch(createProps(), model);
    renderWithProviders(<FileManagerView {...props} />);

    fireEvent.click(await screen.findByTestId('search-zone-header-a'));
    expect(model.onToggleZone).toHaveBeenCalledWith('a');
  });

  it('row activation dispatches the model onRowOpen for both zones', async () => {
    const model = searchModel();
    const props = controlsWithSearch(createProps(), model);
    renderWithProviders(<FileManagerView {...props} />);

    fireEvent.click(await screen.findByTestId('server-search-row-11'));
    expect(model.onRowOpen).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 11 }),
      expect.anything(),
      expect.any(Number)
    );

    const zoneAElement = await waitFor(() => {
      const el = document.querySelector('[data-file-node-id="1"]');
      expect(el).toBeInTheDocument();
      return el;
    });
    fireEvent.click(zoneAElement);
    expect(model.onRowOpen).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 1 }),
      expect.anything(),
      expect.any(Number)
    );
  });

  it('pending mode renders the viewMode skeleton with search-zone-skeleton instead of zone content', async () => {
    const props = controlsWithSearch(
      createProps(),
      searchModel({ mode: 'pending', zoneCounts: { zoneA: 0, zoneB: 0, zoneC: 0 } })
    );
    renderWithProviders(<FileManagerView {...props} />);

    expect(await screen.findByTestId('search-zone-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('server-search-row-11')).not.toBeInTheDocument();
    // the chip bar stays mounted through pending
    expect(screen.getByTestId('search-chip-bar')).toBeInTheDocument();
  });

  it('pending refinement keeps the previous chain zones with skeletons in place of content', async () => {
    const props = controlsWithSearch(
      createProps(),
      searchModel({ mode: 'pending', zoneCounts: { zoneA: 1, zoneB: 1, zoneC: 0 } })
    );
    renderWithProviders(<FileManagerView {...props} />);

    expect(await screen.findByTestId('search-zone-header-a')).toBeInTheDocument();
    expect(screen.getByTestId('search-zone-header-b')).toBeInTheDocument();
    expect(screen.getAllByTestId('search-zone-skeleton').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('server-search-row-11')).not.toBeInTheDocument();
  });

  it('zero rows across the zones renders no headers and a single searchNoResults line', async () => {
    const props = controlsWithSearch(
      createProps(),
      searchModel({ zoneARows: [], zoneBRows: [], zoneCounts: { zoneA: 0, zoneB: 0, zoneC: 0 } })
    );
    renderWithProviders(<FileManagerView {...props} />);

    await screen.findByTestId('search-no-results');
    expect(screen.queryByTestId('search-zone-header-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('search-zone-header-b')).not.toBeInTheDocument();
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('each zone runs its own 50+50 infinite scroll (only the first slice renders)', async () => {
    const manyRows = Array.from({ length: 60 }, (_, i) => ({
      nodeId: 100 + i,
      path: '',
      name: `f${i}.txt`,
      basename: `f${i}.txt`,
      isSearchServerRow: true,
      rowTestId: `server-search-row-${100 + i}`,
      highlights: [],
    }));
    const props = controlsWithSearch(
      createProps(),
      searchModel({ zoneBRows: manyRows, zoneCounts: { zoneA: 1, zoneB: 60, zoneC: 0 } })
    );
    renderWithProviders(<FileManagerView {...props} />);

    await screen.findByTestId('server-search-row-100');
    expect(screen.getAllByTestId(/server-search-row-/)).toHaveLength(50);
  });

  it('grid viewMode renders the zones through the grid renderer', async () => {
    const base = createProps();
    const props = controlsWithSearch(base, searchModel(), {});
    props.explorerSession = {
      ...base.explorerSession,
      controlsState: {
        ...base.explorerSession.controlsState,
        viewMode: 'grid',
        onSubmitQuery: jest.fn(),
      },
      listingState: base.explorerSession.listingState,
    };
    renderWithProviders(<FileManagerView {...props} />);

    expect(await screen.findByTestId('server-search-row-11')).toBeInTheDocument();
  });

  it('FloatingSearchBar gets the results-mode/pending flags and reports the morph to the FAB', async () => {
    const onSearchBarExpandedChange = jest.fn();
    const props = controlsWithSearch(
      createProps(),
      searchModel({ mode: 'pending', zoneARows: [], zoneBRows: [] }),
      { onSearchBarExpandedChange }
    );
    renderWithProviders(<FileManagerView {...props} />);

    const searchbox = await screen.findByRole('searchbox');
    fireEvent.change(searchbox, { target: { value: 'movie' } });
    fireEvent.focus(searchbox);
    expect(onSearchBarExpandedChange).toHaveBeenLastCalledWith(true);

    // the FAB stays mounted while the morph owns the slot (controlled-mount)
    fireEvent.blur(searchbox);
    expect(screen.queryByTestId('file-actions-speed-dial')).toBeInTheDocument();
  });

  it('with the model absent the breadcrumb+listing composition is unchanged (regression)', async () => {
    const props = createProps({ searchResults: null });
    renderWithProviders(<FileManagerView {...props} />);

    expect(await screen.findByTestId('breadcrumb')).toBeInTheDocument();
    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.queryByTestId('search-chip-bar')).not.toBeInTheDocument();
  });

  it('zone labels match BOTH locales exactly (i18n mirror)', () => {
    const en = require('../../../locales/en.json');
    const ko = require('../../../locales/ko.json');
    expect(en.fileManager.searchZoneAllResults).toBe('All results');
    expect(ko.fileManager.searchZoneAllResults).toBe('전체 결과');
    expect(en.fileManager.searchZoneSuggestedResults).toBe('Suggested results');
    expect(ko.fileManager.searchZoneSuggestedResults).toBe('추천 결과');
  });

  it('zone B/C renderers receive the zone-local thumbnail merge callback', async () => {
    const onZoneThumbnailsLoaded = jest.fn();
    const props = controlsWithSearch(
      createProps(),
      searchModel({
        onZoneThumbnailsLoaded,
        zoneCRows: [
          {
            nodeId: 90,
            path: '',
            name: 'fantasy.jpg',
            basename: 'fantasy.jpg',
            isSearchServerRow: true,
            rowTestId: 'server-search-row-90',
            highlights: [],
          },
        ],
        zoneCounts: { zoneA: 1, zoneB: 1, zoneC: 1 },
      })
    );
    renderWithProviders(<FileManagerView {...props} />);
    await screen.findByTestId('server-search-row-90');

    const zoneBSetup = useThumbnailLazyLoad.mock.calls.find(([files]) =>
      files.some((file) => file.nodeId === 11)
    );
    const zoneCSetup = useThumbnailLazyLoad.mock.calls.find(([files]) =>
      files.some((file) => file.nodeId === 90)
    );
    expect(zoneBSetup[1]).toBe(onZoneThumbnailsLoaded);
    expect(zoneCSetup[1]).toBe(onZoneThumbnailsLoaded);
  });

  it('zone A keeps the session thumbnail merge; browse listings are untouched', async () => {
    const onZoneThumbnailsLoaded = jest.fn();
    const props = controlsWithSearch(createProps(), searchModel({ onZoneThumbnailsLoaded }));
    const sessionCb = props.explorerSession.listingState.handleThumbnailsLoaded;
    renderWithProviders(<FileManagerView {...props} />);
    await screen.findByTestId('server-search-row-11');

    // the Zone A instance (session rows) still lands on the session merge
    const zoneASetup = useThumbnailLazyLoad.mock.calls.find(
      ([files]) =>
        files.some((file) => file.nodeId === 1) && !files.some((file) => file.nodeId === 11)
    );
    expect(zoneASetup[1]).toBe(sessionCb);
    expect(zoneASetup[1]).not.toBe(onZoneThumbnailsLoaded);

    // browse composition: the plain listing instance keeps its own session callback
    useThumbnailLazyLoad.mockClear();
    const browseProps = createProps({ searchResults: null });
    renderWithProviders(<FileManagerView {...browseProps} />);
    await screen.findByText('a.txt');
    const browseSetup = useThumbnailLazyLoad.mock.calls.find(([files]) =>
      files.some((file) => file.nodeId === 1)
    );
    expect(browseSetup[1]).toBe(browseProps.explorerSession.listingState.handleThumbnailsLoaded);
  });

  it('a zone B row carrying a merged thumbnailUrl renders the image, not the icon placeholder', async () => {
    const props = controlsWithSearch(
      createProps(),
      searchModel({
        zoneBRows: [{ ...zoneBRow, mime: 'image/jpeg', thumbnailUrl: '/api/thumbnails/11.webp' }],
      })
    );
    renderWithProviders(<FileManagerView {...props} />);

    const row = await screen.findByTestId('server-search-row-11');
    expect(row.querySelector('img')).toHaveAttribute('src', '/api/thumbnails/11.webp');
    // unmerged rows keep the zero-delta icon placeholder (no image element)
    const iconRow = document.querySelector('[data-file-node-id="1"]');
    expect(iconRow).not.toBeNull();
    expect(iconRow.querySelector('img')).toBeNull();
  });
});

describe('FileManagerView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    folderTreeGateway.getUserSharedFolderPermissions.mockResolvedValue([]);
    folderTreeGateway.listFolderChildren.mockResolvedValue([]);
    getRecentFiles.mockResolvedValue([]);
    onRecentFilesChange.mockReturnValue(() => {});
    // CRA resetMocks strips the gateway seam implementations — the folder tree's
    // §3 collections effect needs array-safe defaults in every case.
    explorerGateway.loadCollections.mockResolvedValue({ collections: [] });
    explorerGateway.subscribeToCollections.mockImplementation(() => jest.fn());
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

  it('shows fab create/upload affordances for write-granted shared targets', async () => {
    const props = createProps({
      explorerSession: {
        ...createProps().explorerSession,
        controlsState: {
          ...createProps().explorerSession.controlsState,
          currentPath: '/shared/docs',
        },
      },
      explorerActionState: {
        ...createProps().explorerActionState,
        capabilityState: { hasWritePermission: true },
      },
    });
    renderWithProviders(<FileManagerView {...props} />);

    await waitFor(() => {
      expect(folderTreeGateway.getUserSharedFolderPermissions).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: /file actions/i }));

    expect(screen.getByRole('menuitem', { name: /upload file/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /create folder/i })).toBeInTheDocument();
  });

  it('hides fab create/upload affordances for read-granted targets', async () => {
    const props = createProps({
      explorerSession: {
        ...createProps().explorerSession,
        controlsState: {
          ...createProps().explorerSession.controlsState,
          currentPath: '/shared/docs',
        },
      },
      explorerActionState: {
        ...createProps().explorerActionState,
        capabilityState: { hasWritePermission: false },
      },
    });
    renderWithProviders(<FileManagerView {...props} />);

    await waitFor(() => {
      expect(folderTreeGateway.getUserSharedFolderPermissions).toHaveBeenCalled();
    });

    expect(screen.queryByRole('button', { name: /file actions/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('file-actions-speed-dial')).not.toBeInTheDocument();
  });

  it('expands search bar to FAB space when the FAB is hidden for read-granted targets', async () => {
    const props = createProps({
      explorerSession: {
        ...createProps().explorerSession,
        controlsState: {
          ...createProps().explorerSession.controlsState,
          currentPath: '/shared/docs',
        },
      },
      explorerActionState: {
        ...createProps().explorerActionState,
        capabilityState: { hasWritePermission: false },
      },
    });
    const { container } = renderWithProviders(<FileManagerView {...props} />);

    await waitFor(() => {
      expect(screen.queryByTestId('file-actions-speed-dial')).not.toBeInTheDocument();
    });

    const bar = container.querySelector('[data-testid="floating-search-bar"]');
    expect(getComputedStyle(bar).right).toBe('16px');
  });

  it('keeps search bar beside the FAB when the FAB is visible', async () => {
    const props = createProps();
    const { container } = renderWithProviders(<FileManagerView {...props} />);

    await waitFor(() => {
      expect(screen.getByTestId('file-actions-speed-dial')).toBeInTheDocument();
    });

    const bar = container.querySelector('[data-testid="floating-search-bar"]');
    expect(getComputedStyle(bar).right).toBe('84px');
  });

  it('expands search bar to FAB space when selection mode hides the FAB', async () => {
    const props = createProps({
      selectionState: {
        ...createProps().selectionState,
        selectionModel: {
          ...createProps().selectionState.selectionModel,
          selectionMode: true,
        },
      },
    });
    const { container } = renderWithProviders(<FileManagerView {...props} />);

    await waitFor(() => {
      expect(screen.queryByTestId('file-actions-speed-dial')).not.toBeInTheDocument();
    });

    const bar = container.querySelector('[data-testid="floating-search-bar"]');
    expect(getComputedStyle(bar).right).toBe('16px');
  });

  it('renders real folder names in the shared tree (no placeholder names)', async () => {
    folderTreeGateway.getUserSharedFolderPermissions.mockResolvedValue([
      { nodeId: 21, name: 'Reports', permission: 'write', type: 'directory' },
    ]);

    const props = createProps({
      shellContext: {
        ...createProps().shellContext,
        isMobile: false,
      },
      explorerSession: {
        ...createProps().explorerSession,
        controlsState: {
          ...createProps().explorerSession.controlsState,
          currentPath: '/__shared__',
        },
      },
    });
    renderWithProviders(<FileManagerView {...props} />);

    await waitFor(() => {
      expect(folderTreeGateway.getUserSharedFolderPermissions).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText('Reports')).toBeInTheDocument();
    });
    expect(screen.queryByText('Shared (21)')).not.toBeInTheDocument();
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

  it('renders the leave-share confirmation dialog and forwards confirm/cancel', async () => {
    const props = createProps({
      overlayState: {
        ...createProps().overlayState,
        leaveShareConfirmOpen: true,
      },
    });
    renderWithProviders(<FileManagerView {...props} />);

    await waitFor(() => {
      expect(folderTreeGateway.getUserSharedFolderPermissions).toHaveBeenCalled();
    });

    expect(screen.getByTestId('confirm-dialog-confirm')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-dialog-cancel')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(props.overlayState.handleLeaveShareConfirm).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
    expect(props.overlayState.setLeaveShareConfirmOpen).toHaveBeenCalledWith(false);
    expect(props.overlayState.setLeaveShareConfirmTargetNodeId).toHaveBeenCalledWith(null);
    expect(props.overlayState.setLeaveShareConfirmTargetPath).toHaveBeenCalledWith(null);
  });

  it('renders the backend-health banner (admin copy) when the active file backend is fail', async () => {
    const props = createProps({
      shellContext: {
        ...createProps().shellContext,
        user: { id: 'user-1', username: 'admin1', is_admin: true },
        backendHealth: { postgresql: 'ok', s3: 'ok', webdav: 'fail' },
        activeFileStorage: 'webdav',
      },
    });
    renderWithProviders(<FileManagerView {...props} />);

    expect(await screen.findByTestId('backend-health-banner')).toBeInTheDocument();
    expect(screen.getByText(/backend is experiencing connection problems/i)).toBeInTheDocument();
  });

  it('renders the backend-health banner for non-admin users with simplified copy', async () => {
    const props = createProps({
      shellContext: {
        ...createProps().shellContext,
        user: { id: 'user-1', username: 'user1', is_admin: false },
        backendHealth: { postgresql: 'ok', s3: 'ok', webdav: 'fail' },
        activeFileStorage: 'webdav',
      },
    });
    renderWithProviders(<FileManagerView {...props} />);

    expect(await screen.findByTestId('backend-health-banner')).toBeInTheDocument();
    expect(screen.getByText(/Storage is temporarily unavailable/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/backend is experiencing connection problems/i)
    ).not.toBeInTheDocument();
  });

  it('does not render the banner when the active file backend is not fail', async () => {
    const props = createProps({
      shellContext: {
        ...createProps().shellContext,
        user: { id: 'user-1', username: 'admin1', is_admin: true },
        // WebDAV is failing but s3 is the active file backend → no banner.
        backendHealth: { postgresql: 'ok', s3: 'unknown', webdav: 'fail' },
        activeFileStorage: 's3',
      },
    });
    renderWithProviders(<FileManagerView {...props} />);

    await screen.findByTestId('explorer-container');

    expect(screen.queryByTestId('backend-health-banner')).not.toBeInTheDocument();
  });

  it('renders the banner for non-admin users when the active metadata DB (postgresql) is failing', async () => {
    const props = createProps({
      shellContext: {
        ...createProps().shellContext,
        user: { id: 'user-1', username: 'user1', is_admin: false },
        backendHealth: { postgresql: 'fail', s3: 'ok', webdav: 'unknown' },
        activeFileStorage: 's3',
        activeMetadataBackend: 'postgresql',
      },
    });
    renderWithProviders(<FileManagerView {...props} />);

    expect(await screen.findByTestId('backend-health-banner')).toBeInTheDocument();
    expect(screen.getByText(/service database is unavailable/i)).toBeInTheDocument();
  });

  it('does not render the banner when the failing postgresql backend is not active (sqlite)', async () => {
    const props = createProps({
      shellContext: {
        ...createProps().shellContext,
        user: { id: 'user-1', username: 'user1', is_admin: false },
        backendHealth: { postgresql: 'fail', s3: 'ok', webdav: 'unknown' },
        activeFileStorage: 's3',
        activeMetadataBackend: 'sqlite',
      },
    });
    renderWithProviders(<FileManagerView {...props} />);

    await screen.findByTestId('explorer-container');
    expect(screen.queryByTestId('backend-health-banner')).not.toBeInTheDocument();
  });

  it('routes non-share folder-tree clicks through handleLeaveSharePathClick in share mode', async () => {
    const props = createProps({
      shareContext: {
        ...createProps().shareContext,
        isShareLinkMode: true,
        shareToken: 'share-token',
        shareRootNodeId: 10,
      },
      shellContext: {
        ...createProps().shellContext,
        isMobile: false,
        user: { id: 'user-1', username: 'user1', rootNodeId: 7 },
      },
    });
    renderWithProviders(<FileManagerView {...props} />);

    await waitFor(() => {
      expect(folderTreeGateway.getUserSharedFolderPermissions).toHaveBeenCalled();
    });

    const tree = screen.getByTestId('folder-tree');
    await waitFor(() => {
      expect(within(tree).getByText('Home')).toBeInTheDocument();
    });
    fireEvent.click(within(tree).getByText('Home'));

    expect(props.explorerHandlers.interaction.handleLeaveSharePathClick).toHaveBeenCalledWith(7);
  });

  // -- AI-platform composition (§3 addendum) ---------------------------------
  describe('collections overlay (§3)', () => {
    const collectionsModel = () => ({
      mode: 'list',
      collections: [
        {
          collection_id: 1,
          name: 'Roadtrip',
          item_count: 4,
          status: 'active',
          origin: 'user',
          granted_role: null,
        },
      ],
      sort: 'activity',
      onSortChange: jest.fn(),
      onCardAction: jest.fn(),
      onCardClick: jest.fn(),
      onCardLongPressSelect: jest.fn(),
    });

    it('active node __collections__ renders CollectionsListView in place of FileList', async () => {
      const base = createProps();
      const props = createProps({
        shellContext: { ...base.shellContext, isMobile: false },
        explorerSession: {
          ...base.explorerSession,
          controlsState: {
            ...base.explorerSession.controlsState,
            currentPath: '/__collections__',
          },
        },
        collectionsModel: collectionsModel(),
      });
      renderWithProviders(<FileManagerView {...props} />);

      expect(await screen.findByTestId('collections-list-view')).toBeInTheDocument();
      expect(screen.getByText('Roadtrip')).toBeInTheDocument();
      // Region swap: the explorer listing must NOT render under it.
      expect(screen.queryByText('a.txt')).not.toBeInTheDocument();
    });

    it('no file-grid fallback while the collections model is active', async () => {
      const base = createProps();
      const props = createProps({
        explorerSession: {
          ...base.explorerSession,
          controlsState: {
            ...base.explorerSession.controlsState,
            currentPath: '/__collections__/__archive__',
            viewMode: 'grid',
          },
        },
        collectionsModel: { ...collectionsModel(), include: 'mine,archived' },
      });
      renderWithProviders(<FileManagerView {...props} />);

      expect(await screen.findByTestId('collections-list-view')).toBeInTheDocument();
      expect(screen.queryByText('a.txt')).not.toBeInTheDocument();
    });

    it('toolbar sort button swaps to the collections menu when the list model is active (P-2)', async () => {
      const model = collectionsModel();
      const base = createProps();
      const props = createProps({
        shellContext: { ...base.shellContext, isMobile: false },
        explorerSession: {
          ...base.explorerSession,
          controlsState: {
            ...base.explorerSession.controlsState,
            currentPath: '/__collections__',
          },
        },
        collectionsModel: model,
      });
      renderWithProviders(<FileManagerView {...props} />);

      fireEvent.click(await screen.findByTestId('file-manager-sort'));
      expect(screen.getAllByRole('menuitem')).toHaveLength(5);
      expect(screen.queryAllByRole('radio')).toHaveLength(0);
      fireEvent.click(screen.getByTestId('collections-sort-option-name'));
      expect(model.onSortChange).toHaveBeenCalledWith('name');
    });

    it('archive surface shares the collections sort menu (P-2)', async () => {
      const model = { ...collectionsModel(), include: 'mine,archived' };
      const base = createProps();
      const props = createProps({
        shellContext: { ...base.shellContext, isMobile: false },
        explorerSession: {
          ...base.explorerSession,
          controlsState: {
            ...base.explorerSession.controlsState,
            currentPath: '/__collections__/__archive__',
          },
        },
        collectionsModel: model,
      });
      renderWithProviders(<FileManagerView {...props} />);

      await screen.findByTestId('collections-list-view');
      fireEvent.click(screen.getByTestId('file-manager-sort'));
      expect(screen.getByTestId('collections-sort-option-created')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('collections-sort-option-created'));
      expect(model.onSortChange).toHaveBeenCalledWith('created');
    });

    it('files surface keeps the radio sort menu when no collections model is active (P-2)', async () => {
      const props = createProps();
      renderWithProviders(<FileManagerView {...props} />);

      fireEvent.click(await screen.findByTestId('file-manager-sort'));
      expect(screen.getAllByRole('radio')).toHaveLength(4);
      expect(screen.queryByTestId('collections-sort-option-name')).not.toBeInTheDocument();
      fireEvent.click(screen.getAllByRole('radio')[0]);
      expect(props.explorerSession.controlsState.setSortMode).toHaveBeenCalledWith(
        expect.any(String)
      );
    });

    it('P-3: list surface hides the view-mode buttons but keeps the collections sort', async () => {
      const base = createProps();
      const props = createProps({
        shellContext: { ...base.shellContext, isMobile: false },
        explorerSession: {
          ...base.explorerSession,
          controlsState: {
            ...base.explorerSession.controlsState,
            currentPath: '/__collections__',
          },
        },
        collectionsModel: collectionsModel(),
      });
      renderWithProviders(<FileManagerView {...props} />);

      await screen.findByTestId('collections-list-view');
      expect(screen.queryByTestId('view-mode-list')).not.toBeInTheDocument();
      expect(screen.queryByTestId('view-mode-grid')).not.toBeInTheDocument();
      expect(screen.getByTestId('file-manager-sort')).toBeInTheDocument();
    });

    const memberModel = (overrides = {}) => ({
      mode: 'members',
      items: [],
      digest: null,
      publishPendingCount: null,
      onMemberAction: jest.fn(),
      onPublishBatch: jest.fn(),
      onBulkMemberExclude: jest.fn(),
      onBulkAddToCollection: jest.fn(),
      onMemberThumbnailsLoaded: jest.fn(),
      ...overrides,
    });

    const memberAdapterRow = (overrides = {}) => ({
      nodeId: 90210,
      path: '',
      name: 'poster.pdf',
      basename: 'poster.pdf',
      type: 'file',
      mime: 'application/pdf',
      lastmod: '2026-09-01T00:00:00Z',
      membership: 'stored',
      published: true,
      state: 'normal',
      liked: false,
      reason: null,
      shared_excluded: false,
      isCollectionMember: true,
      hasWritePermission: false,
      rowTestId: 'member-row-90210',
      moreButtonTestId: 'member-menu-button',
      ...overrides,
    });

    const memberSurfaceProps = (overrides = {}) => {
      const base = createProps();
      return createProps({
        shellContext: { ...base.shellContext, isMobile: false },
        explorerSession: {
          ...base.explorerSession,
          controlsState: {
            ...base.explorerSession.controlsState,
            currentPath: '/__collections__/collection/5',
            memberViewMode: 'grid',
            ...(overrides.controlsState ?? {}),
          },
        },
        collectionsModel: overrides.model ?? memberModel(),
      });
    };

    it("M-2: the list model's onPseudoTileNavigate is forwarded to CollectionsListView (tile click dispatches)", async () => {
      const base = createProps();
      const navigate = jest.fn();
      const props = createProps({
        shellContext: { ...base.shellContext, isMobile: false },
        explorerSession: {
          ...base.explorerSession,
          controlsState: {
            ...base.explorerSession.controlsState,
            currentPath: '/__collections__',
          },
        },
        collectionsModel: { ...collectionsModel(), onPseudoTileNavigate: navigate },
      });
      renderWithProviders(<FileManagerView {...props} />);

      await screen.findByTestId('collection-tile-liked');
      fireEvent.click(screen.getByTestId('collection-tile-archive'));
      expect(navigate).toHaveBeenCalledWith('/__collections__/__archive__');
    });

    it('M-9: member route renders the Collections › <name> breadcrumb chips (name from the model)', async () => {
      const model = memberModel({
        collectionId: 5,
        collections: [{ collection_id: 5, name: 'Roadtrip' }],
      });
      const props = memberSurfaceProps({ model });
      renderWithProviders(<FileManagerView {...props} />);

      await screen.findByTestId('collections-list-view');
      const crumb = await screen.findByTestId('breadcrumb');
      expect(crumb).toHaveTextContent('Collections');
      expect(crumb).toHaveTextContent('Roadtrip');
      expect(crumb).not.toHaveTextContent('Home');
    });

    it('M-9: unresolved collection list shows the transient ellipsis segment (owner option (a))', async () => {
      const model = memberModel({ collectionId: 5, collections: [] });
      const props = memberSurfaceProps({ model });
      renderWithProviders(<FileManagerView {...props} />);

      const crumb = await screen.findByTestId('breadcrumb');
      expect(crumb).toHaveTextContent('Collections');
      expect(crumb).toHaveTextContent('…');
    });

    it('M-9: liked route renders Collections › Liked', async () => {
      const base = createProps();
      const props = createProps({
        shellContext: { ...base.shellContext, isMobile: false },
        explorerSession: {
          ...base.explorerSession,
          controlsState: {
            ...base.explorerSession.controlsState,
            currentPath: '/__collections__/liked',
          },
        },
        collectionsModel: {
          mode: 'members',
          likedSurface: true,
          items: [],
          onMemberAction: jest.fn(),
          onMemberThumbnailsLoaded: jest.fn(),
        },
      });
      renderWithProviders(<FileManagerView {...props} />);

      const crumb = await screen.findByTestId('breadcrumb');
      expect(crumb).toHaveTextContent('Collections');
      expect(crumb).toHaveTextContent('Liked');
    });

    it('M-8: members surface SHOWS the sort button bound to the MEMBER sort key (files-style radios)', async () => {
      const props = memberSurfaceProps();
      renderWithProviders(<FileManagerView {...props} />);

      await screen.findByTestId('collections-list-view');
      expect(screen.getByTestId('file-manager-sort')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('file-manager-sort'));
      // FILES-style radios: name asc/desc first, then date asc/desc — the FIRST
      // radio is the persisted-surface default group's `name_asc`.
      const radios = await screen.findAllByRole('radio');
      fireEvent.click(radios[0]);
      // the member dispatch fires, the FILE sort setter never sees it
      expect(props.explorerSession.controlsState.setMemberSortMode).toHaveBeenCalledWith(
        'name_asc'
      );
      expect(props.explorerSession.controlsState.setSortMode).not.toHaveBeenCalled();
    });

    it('P-4: members surface renders the three view-mode buttons bound to the MEMBER key', async () => {
      const props = memberSurfaceProps();
      renderWithProviders(<FileManagerView {...props} />);

      await screen.findByTestId('collections-list-view');
      fireEvent.click(screen.getByTestId('view-mode-list'));
      expect(props.explorerSession.controlsState.setMemberViewMode).toHaveBeenCalledWith('list');
      // the file view-mode setter never sees a members click
      expect(props.explorerSession.controlsState.setViewMode).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('view-mode-detail'));
      expect(props.explorerSession.controlsState.setMemberViewMode).toHaveBeenCalledWith('detail');
    });

    it('P-4: members region delegates to the shared renderer with row callbacks (grid default)', async () => {
      const model = memberModel({ items: [memberAdapterRow()] });
      const props = memberSurfaceProps({ model });
      renderWithProviders(<FileManagerView {...props} />);

      const row = await screen.findByTestId('member-row-90210');
      // grid tile shell proves the delegated renderer (memberViewMode='grid')
      expect(row.querySelector('.MuiCard-root')).toBeTruthy();
      // single click rides the SHARED selection machinery (interaction handler)
      fireEvent.click(row);
      expect(props.explorerHandlers.interaction.handleFileClick).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 90210 }),
        expect.any(Object),
        0
      );
      // right-click dispatches the member menu — never the file context menu
      fireEvent.contextMenu(row);
      expect(model.onMemberAction).toHaveBeenCalledWith(
        'menu',
        expect.objectContaining({ nodeId: 90210 }),
        expect.any(HTMLElement)
      );
      expect(document.querySelectorAll('[data-testid^="file-action-"]')).toHaveLength(0);
    });

    it('P-4: member bulk seams activate in selection mode (bulk exclude + bulk add, no file bulk buttons)', async () => {
      const base = createProps();
      const model = memberModel({ items: [memberAdapterRow()] });
      const props = createProps({
        shellContext: { ...base.shellContext, isMobile: false },
        explorerSession: {
          ...base.explorerSession,
          controlsState: {
            ...base.explorerSession.controlsState,
            currentPath: '/__collections__/collection/5',
            memberViewMode: 'list',
          },
        },
        selectionState: {
          ...base.selectionState,
          selectionModel: {
            selectionMode: true,
            selectedFiles: new Set([90210]),
            handleFileCheck: jest.fn(),
          },
        },
        collectionsModel: model,
      });
      renderWithProviders(<FileManagerView {...props} />);

      expect(await screen.findByTestId('bulk-member-exclude')).toBeInTheDocument();
      expect(screen.getByTestId('bulk-collection-add')).toBeInTheDocument();
      expect(screen.queryByTestId('bulk-action-move')).not.toBeInTheDocument();
      expect(screen.queryByTestId('bulk-action-download')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('bulk-member-exclude'));
      expect(model.onBulkMemberExclude).toHaveBeenCalledWith([90210]);
      fireEvent.click(screen.getByTestId('bulk-collection-add'));
      expect(model.onBulkAddToCollection).toHaveBeenCalledWith([90210]);
    });

    it('P-3: selection inputs and card callbacks flow through to CollectionsListView', async () => {
      const model = collectionsModel();
      const propsWithSelection = (selectionModel) => {
        const base = createProps();
        return createProps({
          shellContext: { ...base.shellContext, isMobile: false },
          explorerSession: {
            ...base.explorerSession,
            controlsState: {
              ...base.explorerSession.controlsState,
              currentPath: '/__collections__',
            },
          },
          selectionState: { ...base.selectionState, selectionModel },
          collectionsModel: model,
        });
      };
      const selectedFiles = new Set(['/__collections__/collection/1']);
      renderWithProviders(
        <FileManagerView
          {...propsWithSelection({
            selectionMode: true,
            selectedFiles,
            handleFileCheck: jest.fn(),
          })}
        />
      );

      const cardEl = await screen.findByTestId('collection-card-1');
      // selectionMode hides the card menu action and the selected card renders
      // the shared tile background (parity forwarded from selectionState).
      expect(screen.queryByTestId('card-menu-button-1')).not.toBeInTheDocument();
      expect(cardEl.querySelector('.MuiCard-root')).toHaveStyle({
        backgroundColor: 'rgba(65, 103, 186, 0.12)',
      });
      // single click forwards the card+event dispatch to the shell callback.
      fireEvent.click(cardEl);
      expect(model.onCardClick).toHaveBeenCalledWith(
        expect.objectContaining({ collection_id: 1 }),
        expect.any(Object)
      );
    });

    it('P-3: toolbar cluster swaps to the collections bulk set with the selection present', async () => {
      const model = {
        ...collectionsModel(),
        include: 'mine,shared',
        onBulkAction: jest.fn(),
      };
      const base = createProps();
      const props = createProps({
        shellContext: { ...base.shellContext, isMobile: false },
        explorerSession: {
          ...base.explorerSession,
          controlsState: {
            ...base.explorerSession.controlsState,
            currentPath: '/__collections__',
          },
        },
        selectionState: {
          ...base.selectionState,
          selectionModel: {
            selectionMode: true,
            selectedFiles: new Set(['/__collections__/collection/1']),
            handleFileCheck: jest.fn(),
          },
        },
        collectionsModel: model,
      });
      renderWithProviders(<FileManagerView {...props} />);

      expect(await screen.findByTestId('bulk-collections-pin')).toBeInTheDocument();
      expect(screen.getByTestId('bulk-collections-archive')).toBeInTheDocument();
      expect(screen.queryByTestId('bulk-action-move')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('bulk-collections-pin'));
      expect(model.onBulkAction).toHaveBeenCalledWith('pin');
    });

    const likedSurfaceProps = (overrides = {}) => {
      const base = createProps();
      const model = {
        ...memberModel({ items: overrides.rows ?? [] }),
        likedSurface: true,
        digest: undefined,
        publishPendingCount: undefined,
        onPublishBatch: undefined,
        onBulkMemberExclude: undefined,
        onBulkAddToCollection: undefined,
      };
      return {
        props: createProps({
          shellContext: { ...base.shellContext, isMobile: false },
          explorerSession: {
            ...base.explorerSession,
            controlsState: {
              ...base.explorerSession.controlsState,
              currentPath: '/__collections__/liked',
              likedViewMode: overrides.likedViewMode ?? 'grid',
              setLikedViewMode: overrides.setLikedViewMode ?? jest.fn(),
            },
          },
          collectionsModel: model,
        }),
        model,
      };
    };

    it('P-5/M-8: liked surface SHOWS the sort button and binds the view toggles to the LIKES key only', async () => {
      const setLikedViewMode = jest.fn();
      const { props } = likedSurfaceProps({ setLikedViewMode });
      renderWithProviders(<FileManagerView {...props} />);

      await screen.findByTestId('collections-list-view');
      // M-8 (2026-09-30): the liked surface shares the members sort state — the
      // FILES-style sort button renders (collectionMemberSortMode binding).
      expect(screen.getByTestId('file-manager-sort')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('view-mode-list'));
      expect(setLikedViewMode).toHaveBeenCalledWith('list');
      // neither the member key nor the file key dispatches on a likes toggle
      expect(props.explorerSession.controlsState.setMemberViewMode).not.toHaveBeenCalled();
      expect(props.explorerSession.controlsState.setViewMode).not.toHaveBeenCalled();
    });

    it('P-5: liked surface renders rows through the shared renderer chosen by likedViewMode (no membership banners)', async () => {
      const { props } = likedSurfaceProps({ likedViewMode: 'list', rows: [memberAdapterRow()] });
      renderWithProviders(<FileManagerView {...props} />);

      await screen.findByTestId('members-list');
      expect(screen.getByTestId('member-row-90210')).toBeInTheDocument();
      // list renderer ⇒ NO card shell (grid would add the MuiCard root)
      expect(
        screen.getByTestId('member-row-90210').querySelector('.MuiCard-root')
      ).not.toBeInTheDocument();
      // membership chrome never appears on the liked surface
      expect(screen.queryByTestId('publish-pending-banner')).not.toBeInTheDocument();
      expect(screen.queryByTestId('digest-banner')).not.toBeInTheDocument();
    });

    it('P-5: liked surface omits the member bulk cluster even in selection mode', async () => {
      const base = createProps();
      const { props } = likedSurfaceProps();
      const selectionProps = createProps({
        ...props,
        selectionState: {
          ...base.selectionState,
          selectionModel: {
            selectionMode: true,
            selectedFiles: new Set([90210]),
            handleFileCheck: jest.fn(),
          },
        },
        collectionsModel: props.collectionsModel,
        explorerSession: props.explorerSession,
      });
      renderWithProviders(<FileManagerView {...selectionProps} />);

      await screen.findByTestId('collections-list-view');
      expect(screen.queryByTestId('bulk-member-exclude')).not.toBeInTheDocument();
      expect(screen.queryByTestId('bulk-collection-add')).not.toBeInTheDocument();
    });

    it('folder tree hosts the CollectionsSection and routes collection clicks through the host', async () => {
      explorerGateway.loadCollections.mockImplementation(async ({ include } = {}) =>
        include === 'mine,archived'
          ? { collections: [] }
          : {
              collections: [
                {
                  collection_id: 1,
                  name: 'Roadtrip',
                  item_count: 4,
                  granted_role: null,
                },
              ],
            }
      );
      explorerGateway.subscribeToCollections.mockImplementation(() => jest.fn());
      const base = createProps();
      const props = createProps({
        shellContext: { ...base.shellContext, isMobile: false },
      });
      const handleFolderTreeNodeClick =
        props.explorerHandlers.interaction.handleFolderTreeNodeClick;
      renderWithProviders(<FileManagerView {...props} />);

      const tree = await screen.findByTestId('folder-tree');
      expect(within(tree).getByTestId('collections-section')).toBeInTheDocument();
      fireEvent.click(within(tree).getByTestId('collections-toggle'));
      await waitFor(() => {
        expect(handleFolderTreeNodeClick).toHaveBeenCalledWith('/__collections__');
      });
      const row = await within(tree).findByTestId('collection-row-1');
      fireEvent.click(row);
      await waitFor(() => {
        expect(handleFolderTreeNodeClick).toHaveBeenCalledWith('/__collections__/collection/1');
      });
    });

    it('share-link mode renders no CollectionsSection (product overlay rule)', async () => {
      const base = createProps();
      const props = createProps({
        shareContext: {
          ...base.shareContext,
          isShareLinkMode: true,
          shareToken: 'share-token',
          shareRootNodeId: 10,
        },
        shellContext: { ...base.shellContext, isMobile: false },
      });
      renderWithProviders(<FileManagerView {...props} />);

      const tree = await screen.findByTestId('folder-tree');
      await waitFor(() => {
        expect(within(tree).getByText('Home')).toBeInTheDocument();
      });
      expect(within(tree).queryByTestId('collections-section')).not.toBeInTheDocument();
    });

    it('with the collections model absent the listing renders unchanged (regression)', async () => {
      const props = createProps();
      renderWithProviders(<FileManagerView {...props} />);

      expect(await screen.findByText('a.txt')).toBeInTheDocument();
      expect(screen.queryByTestId('collections-list-view')).not.toBeInTheDocument();
    });
  });
});
