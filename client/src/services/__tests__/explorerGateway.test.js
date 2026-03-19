/**
 * explorerGateway tests.
 * @see docs/spec/client/services/explorerGateway.md
 * @see docs/TESTING_STRATEGY.md
 */
jest.mock('../fileService', () => ({
  checkConflicts: jest.fn(),
  getFilesMetadata: jest.fn(),
  listFiles: jest.fn(),
  uploadMultipleFiles: jest.fn(),
}));

jest.mock('../permissionService', () => ({
  checkPermission: jest.fn(),
  getUserPermissions: jest.fn(),
  listFilePermissions: jest.fn(),
}));

jest.mock('../recentFilesRepository', () => ({
  addRecentFile: jest.fn(),
  getRecentFiles: jest.fn(),
  removeRecentFile: jest.fn(),
}));

jest.mock('../recentFilesNotifier', () => ({
  onRecentFilesChange: jest.fn(() => jest.fn()),
}));

jest.mock('../../utils/localStorage', () => ({
  getShowHiddenFiles: jest.fn(() => false),
}));

import { checkConflicts, getFilesMetadata, listFiles, uploadMultipleFiles } from '../fileService';
import { getShowHiddenFiles } from '../../utils/localStorage';
import { checkPermission, getUserPermissions, listFilePermissions } from '../permissionService';
import { addRecentFile, getRecentFiles, removeRecentFile } from '../recentFilesRepository';
import { onRecentFilesChange } from '../recentFilesNotifier';
import explorerGateway, {
  canNavigateToPath,
  checkConflictsForExplorer,
  getEntriesMetadata,
  getPathAccess,
  listDirectory,
  loadRecentFiles,
  loadSharedEntries,
  removeExplorerRecentFile,
  uploadToPath,
} from '../explorerGateway';

describe('explorerGateway', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getShowHiddenFiles.mockReturnValue(false);
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
      canNavigateToPath,
      checkConflicts: checkConflictsForExplorer,
      getEntriesMetadata,
      getPathAccess,
      listDirectory,
      loadRecentFiles,
      loadSharedEntries,
      removeRecentFile: removeExplorerRecentFile,
      uploadToPath,
    });
  });

  it('lists a normal directory with hidden filtering and admin permission enrichment', async () => {
    listFiles.mockResolvedValueOnce([
      { path: '/docs/report.txt', isHidden: false },
      { path: '/docs/.draft.txt', isHidden: true },
    ]);
    getUserPermissions.mockResolvedValueOnce([
      { folder_path: '/docs', permission: 'admin' },
    ]);

    const result = await listDirectory({
      path: '/docs',
      options: {
        user: { id: '1', is_admin: false },
      },
    });

    expect(listFiles).toHaveBeenCalledWith('/docs', {});
    expect(getShowHiddenFiles).toHaveBeenCalled();
    expect(result).toEqual([
      expect.objectContaining({ path: '/docs/report.txt', hasAdminPermission: true }),
    ]);
  });

  it('returns raw share listings without hidden or permission enrichment', async () => {
    listFiles.mockResolvedValueOnce([{ path: '/shared/.hidden.txt', isHidden: true }]);

    const result = await listDirectory({
      path: '/shared',
      options: {
        shareToken: 'share-token',
        user: { id: '1', is_admin: false },
      },
    });

    expect(listFiles).toHaveBeenCalledWith('/shared', { shareToken: 'share-token' });
    expect(result).toEqual([{ path: '/shared/.hidden.txt', isHidden: true }]);
    expect(getUserPermissions).not.toHaveBeenCalled();
  });

  it('maps permission checks into explorer access facts', async () => {
    checkPermission.mockResolvedValueOnce({ hasRead: true, hasWrite: false, source: 'path' });

    const access = await getPathAccess({ path: '/docs' });

    expect(checkPermission).toHaveBeenCalledWith('/docs', {});
    expect(access).toEqual({
      canRead: true,
      canWrite: false,
      raw: { hasRead: true, hasWrite: false, source: 'path' },
    });
  });

  it('uses access facts for canNavigateToPath', async () => {
    checkPermission.mockResolvedValueOnce({ hasRead: false, hasWrite: false });

    const result = await canNavigateToPath('/forbidden');

    expect(result).toBe(false);
  });

  it('loads metadata for file entries only', async () => {
    getFilesMetadata.mockResolvedValueOnce([{ path: '/docs/report.txt', size: 12 }]);

    const result = await getEntriesMetadata({
      entries: [
        { path: '/docs/report.txt', type: 'file' },
        { path: '/docs/archive', type: 'directory' },
      ],
    });

    expect(getFilesMetadata).toHaveBeenCalledWith(['/docs/report.txt'], {});
    expect(result).toEqual([{ path: '/docs/report.txt', size: 12 }]);
  });

  it('delegates recent file loading, removal, and subscription helpers', async () => {
    const unsubscribe = jest.fn();
    getRecentFiles.mockResolvedValueOnce([{ path: '/docs/report.txt' }]);
    removeRecentFile.mockResolvedValueOnce([]);
    onRecentFilesChange.mockReturnValueOnce(unsubscribe);

    const recentFiles = await loadRecentFiles();
    await removeExplorerRecentFile('/docs/report.txt');
    const resultUnsubscribe = explorerGateway.subscribeToRecentFiles(jest.fn());

    expect(recentFiles).toEqual([{ path: '/docs/report.txt' }]);
    expect(removeRecentFile).toHaveBeenCalledWith('/docs/report.txt', undefined);
    expect(resultUnsubscribe).toBe(unsubscribe);
  });

  it('loads shared entries with top-level folders and file metadata', async () => {
    getUserPermissions.mockResolvedValueOnce([
      { folder_path: '/shared/team', permission: 'write' },
      { folder_path: '/shared/team/reports', permission: 'read' },
      { folder_path: '/owner-home/docs', permission: 'read' },
    ]);
    listFilePermissions.mockResolvedValueOnce([
      { filePath: '/lonely/readme.txt', permission: 'read' },
      { filePath: '/shared/team/report.txt', permission: 'read' },
    ]);
    getFilesMetadata.mockResolvedValueOnce([
      { path: '/lonely/readme.txt', size: 50, lastmod: '2024-01-01', mime: 'text/plain' },
    ]);

    const result = await loadSharedEntries({
      user: { id: '1', username: 'owner-home', is_admin: false },
    });

    expect(result).toEqual([
      expect.objectContaining({ path: '/shared/team', type: 'directory', hasWritePermission: true }),
      expect.objectContaining({
        path: '/lonely/readme.txt',
        type: 'file',
        size: 50,
        mime: 'text/plain',
      }),
    ]);
  });

  it('delegates addRecentFile through the default gateway', async () => {
    addRecentFile.mockResolvedValueOnce([{ path: '/docs/report.txt' }]);

    const result = await explorerGateway.addRecentFile({ path: '/docs/report.txt' });

    expect(addRecentFile).toHaveBeenCalledWith({ path: '/docs/report.txt' }, undefined);
    expect(result).toEqual([{ path: '/docs/report.txt' }]);
  });
});
