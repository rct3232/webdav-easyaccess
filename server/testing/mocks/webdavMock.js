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
    deleteFile: jest.fn().mockResolvedValue(undefined),
    moveFile: jest.fn().mockResolvedValue(undefined),
    copyFile: jest.fn().mockResolvedValue(undefined),
    createDirectory: jest.fn().mockResolvedValue(undefined),
    ensureDirectoryExists: jest.fn().mockResolvedValue(undefined),
    getFileMetadata: jest.fn().mockResolvedValue({}),
    listAllEntriesRecursive: jest.fn().mockResolvedValue([]),
    isImageFile: jest.fn(() => false),
    isVideoFile: jest.fn(() => false),
    ...overrides,
  };
}

module.exports = {
  createWebdavMock,
};
