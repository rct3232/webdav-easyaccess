/**
 * selectiveTransfer service tests.
 * Verifies move/copy error handling per spec.
 * @see docs/spec/server/services/selectiveTransfer.md
 */
const { selectiveTransfer } = require('../../domains/files/services/selectiveTransfer');

function createMockWebdav(overrides = {}) {
  const defaults = {
    pathExists: jest.fn().mockResolvedValue(false),
    createDirectory: jest.fn().mockResolvedValue(undefined),
    listDirectory: jest.fn().mockResolvedValue([]),
    moveFile: jest.fn().mockResolvedValue(undefined),
    copyFile: jest.fn().mockResolvedValue(undefined),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  };
  return { ...defaults, ...overrides };
}

const alwaysEnter = () => true;
const alwaysTransfer = () => true;

describe('selectiveTransfer', () => {
  describe('move when source does not exist', () => {
    it('throws when listDirectory fails (source not found)', async () => {
      const notFoundError = new Error('Directory not found');
      notFoundError.status = 404;
      const webdav = createMockWebdav({
        pathExists: jest.fn().mockResolvedValue(true),
        listDirectory: jest.fn().mockRejectedValue(notFoundError),
      });

      await expect(
        selectiveTransfer({
          sourceRoot: '/nonexistent',
          destRoot: '/dest',
          mode: 'move',
          canEnterDirectory: alwaysEnter,
          canTransferFile: alwaysTransfer,
          webdav,
        })
      ).rejects.toThrow(/not found|Directory/i);

      expect(webdav.listDirectory).toHaveBeenCalledWith('/nonexistent');
    });
  });

  describe('copy when disk full (ENOSPC)', () => {
    it('throws when copy fails with ENOSPC', async () => {
      const enospcError = new Error('ENOSPC: no space left on device');
      enospcError.code = 'ENOSPC';
      const webdav = createMockWebdav({
        pathExists: jest.fn().mockResolvedValue(false),
        createDirectory: jest.fn().mockResolvedValue(undefined),
        listDirectory: jest.fn().mockResolvedValue([
          { basename: 'file.txt', type: 'file' },
        ]),
        copyFile: jest.fn().mockRejectedValue(enospcError),
      });

      await expect(
        selectiveTransfer({
          sourceRoot: '/src',
          destRoot: '/dest',
          mode: 'copy',
          canEnterDirectory: alwaysEnter,
          canTransferFile: alwaysTransfer,
          webdav,
        })
      ).rejects.toThrow();
    });
  });
});
