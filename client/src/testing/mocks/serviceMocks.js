export function createFileServiceMock(overrides = {}) {
  return {
    listFiles: jest.fn().mockResolvedValue([]),
    resolvePath: jest.fn().mockResolvedValue(null),
    getAncestors: jest.fn().mockResolvedValue({ ancestors: [] }),
    getFilesMetadata: jest.fn().mockResolvedValue([]),
    getFileBlob: jest.fn().mockResolvedValue(new Blob()),
    getVideoPreviewStreamUrl: jest.fn().mockResolvedValue(''),
    downloadFile: jest.fn().mockResolvedValue(undefined),
    uploadMultipleFiles: jest.fn().mockResolvedValue({ results: [], errors: [] }),
    renameFile: jest.fn().mockResolvedValue(null),
    createFolder: jest.fn().mockResolvedValue(null),
    getFolderStats: jest.fn().mockResolvedValue({ fileCount: 0, totalSize: 0 }),
    checkConflicts: jest.fn().mockResolvedValue([]),
    downloadMultipleFiles: jest.fn().mockResolvedValue(null),
    requestThumbnailsBatch: jest.fn().mockResolvedValue({ thumbnails: [] }),
    batchDeleteFiles: jest.fn().mockResolvedValue({ jobId: null }),
    batchMoveFiles: jest.fn().mockResolvedValue({ jobId: null }),
    batchCopyFiles: jest.fn().mockResolvedValue({ jobId: null }),
    getBulkOperationStatus: jest.fn().mockResolvedValue(null),
    cancelBulkOperation: jest.fn().mockResolvedValue(null),
    getFileVersions: jest.fn().mockResolvedValue({
      nodeId: 0,
      currentVersionNumber: null,
      versions: [],
    }),
    restoreFileVersion: jest.fn().mockResolvedValue({
      messageCode: 'serverMessages.files.versionRestored',
      nodeId: 0,
      restoredVersionNumber: 1,
    }),
    downloadFileVersion: jest.fn().mockResolvedValue(undefined),
    getTrashFiles: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    restoreTrashedItem: jest.fn().mockResolvedValue({ nodeId: 0 }),
    purgeTrashedItem: jest.fn().mockResolvedValue({ nodeId: 0 }),
    emptyTrash: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}

export function createPermissionServiceMock(overrides = {}) {
  return {
    getUserPermissions: jest.fn(),
    getSharedPermissions: jest.fn(),
    getFolderPermissions: jest.fn(),
    grantPermission: jest.fn(),
    revokePermission: jest.fn(),
    checkPermission: jest.fn(),
    ...overrides,
  };
}

export function createUserServiceMock(overrides = {}) {
  return {
    getApprovedUsers: jest.fn(),
    updateEmail: jest.fn(),
    updatePassword: jest.fn(),
    ...overrides,
  };
}

export function createPermissionRequestServiceMock(overrides = {}) {
  return {
    createPermissionRequest: jest.fn(),
    listInboxPermissionRequests: jest.fn(),
    listOutboxPermissionRequests: jest.fn(),
    approvePermissionRequest: jest.fn(),
    rejectPermissionRequest: jest.fn(),
    cancelPermissionRequest: jest.fn(),
    checkOwnerExists: jest.fn(),
    ...overrides,
  };
}

export function createRecentFilesRepositoryMock(overrides = {}) {
  return {
    getRecentFiles: jest.fn().mockResolvedValue([]),
    addRecentFile: jest.fn().mockResolvedValue([]),
    removeRecentFile: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

export function createRecentFilesNotifierMock(overrides = {}) {
  return {
    onRecentFilesChange: jest.fn(() => jest.fn()),
    notifyRecentFilesChange: jest.fn(),
    ...overrides,
  };
}

export function createFileLikesRepositoryMock(overrides = {}) {
  return {
    getLikedNodeIds: jest.fn().mockResolvedValue({ liked: [] }),
    setFileLike: jest.fn().mockResolvedValue(null),
    subscribeFileLikesChange: jest.fn(() => jest.fn()),
    notifyFileLikesChange: jest.fn(),
    ...overrides,
  };
}

export function createRecentQueriesStorageMock(overrides = {}) {
  return {
    loadRecentQueries: jest.fn(() => []),
    saveRecentQueries: jest.fn(),
    clearRecentQueries: jest.fn(),
    ...overrides,
  };
}

export function createExplorerGatewayMock(overrides = {}) {
  return {
    addRecentFile: jest.fn().mockResolvedValue([]),
    canNavigateToNode: jest.fn().mockResolvedValue(true),
    checkConflicts: jest.fn().mockResolvedValue([]),
    getEntriesMetadata: jest.fn().mockResolvedValue([]),
    getPathAccess: jest.fn().mockResolvedValue({ canRead: true, canWrite: true, raw: {} }),
    listDirectory: jest.fn().mockResolvedValue([]),
    loadRecentFiles: jest.fn().mockResolvedValue([]),
    loadSharedEntries: jest.fn().mockResolvedValue([]),
    loadTrashEntries: jest.fn().mockResolvedValue([]),
    removeRecentFile: jest.fn().mockResolvedValue([]),
    subscribeToRecentFiles: jest.fn(() => jest.fn()),
    uploadToPath: jest.fn().mockResolvedValue({ errors: [] }),
    // Collections platform seams (T0.3 — explorerGateway §2.6 re-export group)
    loadCollections: jest.fn().mockResolvedValue({ collections: [] }),
    createCollection: jest.fn().mockResolvedValue(null),
    updateCollection: jest.fn().mockResolvedValue(null),
    archiveCollection: jest.fn().mockResolvedValue(null),
    restoreCollection: jest.fn().mockResolvedValue(null),
    deleteCollection: jest.fn().mockResolvedValue(false),
    loadCollectionItems: jest.fn().mockResolvedValue({ items: [], next_cursor: null }),
    addCollectionItems: jest.fn().mockResolvedValue(null),
    removeCollectionItems: jest.fn().mockResolvedValue(null),
    publishItems: jest.fn().mockResolvedValue(null),
    getMemberships: jest.fn().mockResolvedValue({ memberships: [] }),
    previewCollection: jest.fn().mockResolvedValue(null),
    previewExistingCollection: jest.fn().mockResolvedValue(null),
    getMergeSuggestions: jest.fn().mockResolvedValue({ suggestions: [] }),
    mergeCollections: jest.fn().mockResolvedValue(null),
    dismissMerge: jest.fn().mockResolvedValue(null),
    rejectMerge: jest.fn().mockResolvedValue(null),
    getGrants: jest.fn().mockResolvedValue({ grants: [] }),
    grantCollection: jest.fn().mockResolvedValue(null),
    revokeGrant: jest.fn().mockResolvedValue(null),
    subscribeToCollections: jest.fn(() => jest.fn()),
    // Search results-mode seams (T0.11 — explorerGateway §2.6 search group)
    runSearch: jest.fn().mockResolvedValue(null),
    recordSearchClick: jest.fn().mockResolvedValue(false),
    undoAction: jest
      .fn()
      .mockResolvedValue({ ok: true, status: 'undone', itemsUndone: 1, itemsSkipped: 0 }),
    // File-likes seams (T0.5 — explorerGateway §2.6 file-likes group)
    loadFileLikes: jest.fn().mockResolvedValue({ liked: [] }),
    setFileLike: jest.fn().mockResolvedValue(null),
    subscribeToFileLikes: jest.fn(() => jest.fn()),
    loadNodesMetadata: jest.fn().mockResolvedValue([]),
    loadNodeAncestors: jest.fn().mockResolvedValue({ ancestors: [] }),
    ...overrides,
  };
}

export function createFolderTreeGatewayMock(overrides = {}) {
  return {
    __esModule: true,
    default: {
      listFolderChildren: jest.fn(),
      getUserSharedFolderPermissions: jest.fn(),
      ...overrides,
    },
  };
}

export function createLocalStorageUiMock(overrides = {}) {
  return {
    getShowHiddenFiles: () => false,
    setShowHiddenFiles: () => {},
    getViewMode: () => 'list',
    setViewMode: () => {},
    getSortMode: () => 'name',
    setSortMode: () => {},
    ...overrides,
  };
}

export function createFileUtilsMock(overrides = {}) {
  return {
    canPreview: jest.fn(() => true),
    ...overrides,
  };
}

export function createErrorUtilsMock(overrides = {}) {
  return {
    getServerErrorDisplay: jest.fn((data) => data?.errorCode || 'error'),
    showErrorFromError: jest.fn(),
    ...overrides,
  };
}
