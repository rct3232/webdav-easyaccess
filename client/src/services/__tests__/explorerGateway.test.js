/**
 * explorerGateway tests.
 * @see docs/spec/client/services/explorerGateway.md
 * @see docs/TESTING_STRATEGY.md
 */
jest.mock('../fileService', () => ({
  uploadMultipleFiles: jest.fn(),
  checkConflicts: jest.fn(),
}));

import { uploadMultipleFiles, checkConflicts } from '../fileService';
import explorerGateway, { checkConflictsForExplorer, uploadToPath } from '../explorerGateway';

describe('explorerGateway', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates conflict preflight to fileService with the same operations', async () => {
    checkConflicts.mockResolvedValueOnce([{ path: '/docs/report.txt' }]);

    const result = await checkConflictsForExplorer({
      operations: [{ sourcePath: 'report.txt', destinationPath: '/docs/report.txt', type: 'upload' }],
      options: { limit: false },
    });

    expect(checkConflicts).toHaveBeenCalledWith(
      [{ sourcePath: 'report.txt', destinationPath: '/docs/report.txt', type: 'upload' }],
      { limit: false }
    );
    expect(result).toEqual([{ path: '/docs/report.txt' }]);
  });

  it('delegates uploadToPath to fileService preserving progress and conflict options', async () => {
    const onProgress = jest.fn();
    uploadMultipleFiles.mockResolvedValueOnce({ results: [{ success: true }], errors: [] });

    const files = [{ file: { name: 'report.txt' }, relativePath: 'report.txt' }];
    const result = await uploadToPath({
      targetPath: '/docs',
      files,
      onProgress,
      onConflict: 'replace',
      options: { getSignalForFile: jest.fn() },
    });

    expect(uploadMultipleFiles).toHaveBeenCalledWith(
      files,
      '/docs',
      onProgress,
      'replace',
      expect.objectContaining({ getSignalForFile: expect.any(Function) })
    );
    expect(result).toEqual({ results: [{ success: true }], errors: [] });
  });

  it('exposes the same gateway functions through the default export', () => {
    expect(explorerGateway).toMatchObject({
      checkConflicts: checkConflictsForExplorer,
      uploadToPath,
    });
  });
});
