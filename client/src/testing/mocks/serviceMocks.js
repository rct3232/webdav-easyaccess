export function createFileServiceMock(overrides = {}) {
  return {
    listFiles: jest.fn().mockResolvedValue([]),
    resolvePath: jest.fn().mockResolvedValue(null),
    getAncestors: jest.fn().mockResolvedValue({ ancestors: [] }),
    getWebDAVInfo: jest.fn().mockResolvedValue(null),
    getFilesMetadata: jest.fn().mockResolvedValue([]),
    getFileBlob: jest.fn().mockResolvedValue(new Blob()),
    getVideoPreviewStreamUrl: jest.fn().mockResolvedValue(''),
    downloadFile: jest.fn().mockResolvedValue(undefined),
    uploadFile: jest.fn().mockResolvedValue(null),
    uploadMultipleFiles: jest.fn().mockResolvedValue({ results: [], errors: [] }),
    renameFile: jest.fn().mockResolvedValue(null),
    createFolder: jest.fn().mockResolvedValue(null),
    getFolderStats: jest.fn().mockResolvedValue({ fileCount: 0, totalSize: 0 }),
    checkConflicts: jest.fn().mockResolvedValue([]),
    downloadMultipleFiles: jest.fn().mockResolvedValue(null),
    getDownloadProgress: jest.fn().mockResolvedValue(null),
    requestThumbnailsBatch: jest.fn().mockResolvedValue({ thumbnails: [] }),
    batchDeleteFiles: jest.fn().mockResolvedValue({ jobId: null }),
    batchMoveFiles: jest.fn().mockResolvedValue({ jobId: null }),
    batchCopyFiles: jest.fn().mockResolvedValue({ jobId: null }),
    getBulkOperationStatus: jest.fn().mockResolvedValue(null),
    cancelBulkOperation: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

export function createPermissionServiceMock(overrides = {}) {
  return {
    clearUserPermissionsCache: jest.fn(),
    getUserPermissions: jest.fn(),
    getSharedPermissions: jest.fn(),
    getFolderPermissions: jest.fn(),
    grantPermission: jest.fn(),
    revokePermission: jest.fn(),
    checkPermission: jest.fn(),
    listFilePermissions: jest.fn(),
    ...overrides,
  };
}

export function createUserServiceMock(overrides = {}) {
  return {
    getApprovedUsers: jest.fn(),
    updateEmail: jest.fn(),
    updatePassword: jest.fn(),
    updateUserPermissions: jest.fn(),
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
    clearRecentFiles: jest.fn().mockResolvedValue(undefined),
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
    removeRecentFile: jest.fn().mockResolvedValue([]),
    subscribeToRecentFiles: jest.fn(() => jest.fn()),
    uploadToPath: jest.fn().mockResolvedValue({ errors: [] }),
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
