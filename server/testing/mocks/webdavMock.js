/**
 * Shared WebDAV mock factory for server route tests.
 */
function createWebdavMock(overrides = {}) {
  return {
    testConnection: jest.fn().mockResolvedValue({ success: true }),
    pathExists: jest.fn().mockResolvedValue(true),
    listDirectory: jest.fn().mockResolvedValue([]),
    getFileContents: jest.fn().mockResolvedValue(Buffer.from('')),
    putFileContents: jest.fn().mockResolvedValue(undefined),
    putFileContentsAdvanced: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    moveFile: jest.fn().mockResolvedValue(undefined),
    copyFile: jest.fn().mockResolvedValue(undefined),
    createDirectory: jest.fn().mockResolvedValue(undefined),
    ensureDirectoryExists: jest.fn().mockResolvedValue(undefined),
    getFileMetadata: jest.fn().mockResolvedValue({}),
    isImageFile: jest.fn(() => false),
    isVideoFile: jest.fn(() => false),
    getRecursiveFolderStats: jest.fn().mockResolvedValue({ fileCount: 0, totalSize: 0 }),
    ...overrides,
  };
}

module.exports = {
  createWebdavMock,
};
