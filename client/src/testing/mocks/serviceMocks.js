export function createFileServiceMock(overrides = {}) {
  return {
    listFiles: jest.fn(),
    getWebDAVInfo: jest.fn(),
    checkPermission: jest.fn(),
    listFilePermissions: jest.fn(),
    getFilesMetadata: jest.fn(),
    ...overrides,
  };
}

export function createPermissionServiceMock(overrides = {}) {
  return {
    getUserPermissions: jest.fn(),
    getFolderPermissions: jest.fn(),
    grantPermission: jest.fn(),
    revokePermission: jest.fn(),
    ...overrides,
  };
}

export function createUserServiceMock(overrides = {}) {
  return {
    getApprovedUsers: jest.fn(),
    updateUserPermissions: jest.fn(),
    ...overrides,
  };
}

export function createPermissionRequestServiceMock(overrides = {}) {
  return {
    approvePermissionRequest: jest.fn(),
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
    ...overrides,
  };
}
