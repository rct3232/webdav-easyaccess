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

export function createRecentFilesMock(overrides = {}) {
  return {
    getRecentFiles: jest.fn(),
    removeRecentFile: jest.fn(),
    applyRecentFilesAfterRename: jest.fn(),
    onRecentFilesChange: jest.fn(() => () => {}),
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
