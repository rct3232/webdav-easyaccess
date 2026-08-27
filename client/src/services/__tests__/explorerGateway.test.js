/**
 * explorerGateway tests.
 * @see docs/spec/client/services/explorerGateway.md
 * @see docs/TESTING_STRATEGY.md
 */
import { checkConflicts, getFilesMetadata, listFiles, uploadMultipleFiles } from '../fileService';
import { getShowHiddenFiles } from '../../utils/localStorage';
import { checkPermission, getSharedPermissions, getUserPermissions } from '../permissionService';
import { addRecentFile, getRecentFiles, removeRecentFile } from '../recentFilesRepository';
import { onRecentFilesChange } from '../recentFilesNotifier';
import explorerGateway, {
  canNavigateToNode,
  checkConflictsForExplorer,
  getEntriesMetadata,
  getPathAccess,
  listDirectory,
  loadRecentFiles,
  loadSharedEntries,
  removeExplorerRecentFile,
  uploadToPath,
} from '../explorerGateway';

jest.mock('../fileService', () => {
  const { createFileServiceMock } = require('../../testing/mocks/serviceMocks');
  return createFileServiceMock();
});

jest.mock('../permissionService', () => {
  const { createPermissionServiceMock } = require('../../testing/mocks/serviceMocks');
  return createPermissionServiceMock();
});

jest.mock('../recentFilesRepository', () => {
  const { createRecentFilesRepositoryMock } = require('../../testing/mocks/serviceMocks');
  return createRecentFilesRepositoryMock();
});

jest.mock('../recentFilesNotifier', () => {
  const { createRecentFilesNotifierMock } = require('../../testing/mocks/serviceMocks');
  return createRecentFilesNotifierMock();
});

jest.mock('../../utils/localStorage', () => {
  const { createLocalStorageUiMock } = require('../../testing/mocks/serviceMocks');
  return createLocalStorageUiMock({
    getShowHiddenFiles: jest.fn(() => false),
  });
});

describe('explorerGateway', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getShowHiddenFiles.mockReturnValue(false);
  });

  it('delegates conflict preflight to fileService with the same operations', async () => {
    checkConflicts.mockResolvedValueOnce([{ nodeId: 1, basename: 'report.txt' }]);

    const result = await checkConflictsForExplorer({
      operations: [{ sourceNodeId: 1, destinationParentNodeId: 2, type: 'move' }],
      options: { limit: false },
    });

    expect(checkConflicts).toHaveBeenCalledWith(
      [{ sourceNodeId: 1, destinationParentNodeId: 2, type: 'move' }],
      { limit: false }
    );
    expect(result).toEqual([{ nodeId: 1, basename: 'report.txt' }]);
  });

  it('delegates uploadToPath to fileService preserving progress and conflict options', async () => {
    const onProgress = jest.fn();
    uploadMultipleFiles.mockResolvedValueOnce({ results: [{ success: true }], errors: [] });

    const files = [{ file: { name: 'report.txt' }, relativePath: 'report.txt' }];
    const result = await uploadToPath({
      parentNodeId: 5,
      files,
      onProgress,
      onConflict: 'replace',
      options: { getSignalForFile: jest.fn() },
    });

    expect(uploadMultipleFiles).toHaveBeenCalledWith(
      files,
      5,
      onProgress,
      'replace',
      expect.objectContaining({ getSignalForFile: expect.any(Function) })
    );
    expect(result).toEqual({ results: [{ success: true }], errors: [] });
  });

  it('exposes the same gateway functions through the default export', () => {
    expect(explorerGateway).toMatchObject({
      canNavigateToNode,
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
      { nodeId: 10, display_path: '/docs/report.txt', isHidden: false },
      { nodeId: 11, display_path: '/docs/.draft.txt', isHidden: true },
    ]);
    getUserPermissions.mockResolvedValueOnce([
      { nodeId: 10, permission: 'admin' },
    ]);

    const result = await listDirectory({
      nodeId: 5,
      options: {
        user: { id: '1', is_admin: false },
      },
    });

    expect(listFiles).toHaveBeenCalledWith(5, {});
    expect(getShowHiddenFiles).toHaveBeenCalled();
    expect(result).toEqual([
      expect.objectContaining({ nodeId: 10, hasAdminPermission: true }),
    ]);
  });

  it('returns raw share listings without hidden or permission enrichment', async () => {
    listFiles.mockResolvedValueOnce([{ nodeId: 20, display_path: '/shared/.hidden.txt', isHidden: true }]);

    const result = await listDirectory({
      nodeId: 15,
      options: {
        shareToken: 'share-token',
        user: { id: '1', is_admin: false },
      },
    });

    expect(listFiles).toHaveBeenCalledWith(15, { shareToken: 'share-token' });
    expect(result).toEqual([
      expect.objectContaining({ nodeId: 20, display_path: '/shared/.hidden.txt', isHidden: true }),
    ]);
    expect(getUserPermissions).not.toHaveBeenCalled();
  });

  it('normalizes server-shaped file entries into the client shape', async () => {
    listFiles.mockResolvedValueOnce([
      {
        nodeId: 30,
        name: 'report.pdf',
        type: 'file',
        display_path: '/docs/report.pdf',
        size: 120,
        mimeType: 'application/pdf',
        modifiedAt: '2024-05-01T10:00:00Z',
        hasReadPermission: true,
        hasWritePermission: true,
        isHidden: false,
      },
      {
        nodeId: 31,
        name: 'assets',
        type: 'directory',
        display_path: '/docs/assets',
        size: 0,
        mimeType: null,
        modifiedAt: null,
        hasReadPermission: true,
        hasWritePermission: true,
        isHidden: false,
      },
    ]);

    const result = await listDirectory({
      nodeId: 5,
      options: { user: { id: '1', is_admin: true } },
    });

    expect(result[0]).toMatchObject({
      nodeId: 30,
      path: '/docs/report.pdf',
      basename: 'report.pdf',
      name: 'report.pdf',
      mime: 'application/pdf',
      lastmod: '2024-05-01T10:00:00Z',
      size: 120,
      type: 'file',
      display_path: '/docs/report.pdf',
    });
    expect(result[1]).toMatchObject({
      nodeId: 31,
      path: '/docs/assets',
      basename: 'assets',
      mime: null,
      lastmod: null,
    });
  });

  it('maps permission checks into explorer access facts', async () => {
    checkPermission.mockResolvedValueOnce({ hasRead: true, hasWrite: false, source: 'nodeId' });

    const access = await getPathAccess({ nodeId: 5 });

    expect(checkPermission).toHaveBeenCalledWith(5, {});
    expect(access).toEqual({
      canRead: true,
      canWrite: false,
      raw: { hasRead: true, hasWrite: false, source: 'nodeId' },
    });
  });

  it('uses access facts for canNavigateToNode', async () => {
    checkPermission.mockResolvedValueOnce({ hasRead: false, hasWrite: false });

    const result = await canNavigateToNode(99);

    expect(result).toBe(false);
  });

  it('loads metadata for file entries only', async () => {
    getFilesMetadata.mockResolvedValueOnce([{ nodeId: 10, display_path: '/docs/report.txt', size: 12 }]);

    const result = await getEntriesMetadata({
      entries: [
        { nodeId: 10, type: 'file' },
        { nodeId: 11, type: 'directory' },
      ],
    });

    expect(getFilesMetadata).toHaveBeenCalledWith([10], {});
    expect(result).toEqual([{ nodeId: 10, display_path: '/docs/report.txt', size: 12 }]);
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
    getSharedPermissions.mockResolvedValueOnce([
      { nodeId: 100, name: 'Shared Docs', permission: 'write', type: 'directory' },
      { nodeId: 101, name: 'Read Only', permission: 'read', type: 'directory' },
      { nodeId: 300, name: 'report.txt', permission: 'read', type: 'file' },
    ]);
    getFilesMetadata.mockResolvedValueOnce([
      { nodeId: 300, size: 50, lastmod: '2024-01-01', mime: 'text/plain' },
    ]);

    const result = await loadSharedEntries({
      user: { id: '1', username: 'owner-home', is_admin: false, rootNodeId: 200 },
    });

    expect(result).toEqual([
      expect.objectContaining({ nodeId: 100, name: 'Shared Docs', basename: 'Shared Docs', type: 'directory', hasWritePermission: true }),
      expect.objectContaining({ nodeId: 101, name: 'Read Only', type: 'directory' }),
      expect.objectContaining({ nodeId: 300, name: 'report.txt', basename: 'report.txt', type: 'file', size: 50, mime: 'text/plain' }),
    ]);
    expect(result).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain('node-100');
    expect(JSON.stringify(result)).not.toContain('node-101');
    expect(JSON.stringify(result)).not.toContain('file-300');
  });

  it('derives hasWritePermission and hasAdminPermission from the granted permission, not ownership', async () => {
    getSharedPermissions.mockResolvedValueOnce([
      { nodeId: 100, name: 'Admin Folder', permission: 'admin', type: 'directory' },
      { nodeId: 101, name: 'Write Folder', permission: 'write', type: 'directory' },
      { nodeId: 102, name: 'Read Folder', permission: 'read', type: 'directory' },
      { nodeId: 300, name: 'read-only.txt', permission: 'read', type: 'file' },
    ]);
    getFilesMetadata.mockResolvedValueOnce([]);

    const result = await loadSharedEntries({
      user: { id: '1', username: 'owner-home', is_admin: false, rootNodeId: 200 },
    });

    expect(result).toEqual([
      expect.objectContaining({ nodeId: 100, hasWritePermission: true, hasAdminPermission: true }),
      expect.objectContaining({ nodeId: 101, hasWritePermission: true, hasAdminPermission: false }),
      expect.objectContaining({ nodeId: 102, hasWritePermission: false, hasAdminPermission: false }),
      expect.objectContaining({ nodeId: 300, type: 'file', hasWritePermission: false, hasAdminPermission: false }),
    ]);
    expect(JSON.stringify(result)).not.toContain('node-100');
    expect(JSON.stringify(result)).not.toContain('file-300');
  });

  it('excludes the user own root node from shared entries', async () => {
    getSharedPermissions.mockResolvedValueOnce([
      { nodeId: 200, name: 'owner-home', permission: 'admin', type: 'directory' },
      { nodeId: 300, name: 'Genuine Share', permission: 'read', type: 'directory' },
    ]);

    const result = await loadSharedEntries({
      user: { id: '1', username: 'owner-home', is_admin: false, rootNodeId: 200 },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ nodeId: 300, name: 'Genuine Share', type: 'directory' });
  });

  it('dedupes shared entries by nodeId and keeps directory entries before file entries', async () => {
    getSharedPermissions.mockResolvedValueOnce([
      { nodeId: 100, name: 'Docs', permission: 'read', type: 'directory' },
      { nodeId: 100, name: 'Docs', permission: 'read', type: 'directory' },
      { nodeId: 300, name: 'note.txt', permission: 'read', type: 'file' },
    ]);
    getFilesMetadata.mockResolvedValueOnce([{ nodeId: 300, size: 5 }]);

    const result = await loadSharedEntries({
      user: { id: '1', username: 'owner-home', is_admin: false, rootNodeId: 200 },
    });

    expect(result.map((entry) => entry.nodeId)).toEqual([100, 300]);
    expect(result[0]).toMatchObject({ type: 'directory', name: 'Docs' });
    expect(result[1]).toMatchObject({ type: 'file', name: 'note.txt' });
  });

  it('delegates addRecentFile through the default gateway', async () => {
    addRecentFile.mockResolvedValueOnce([{ path: '/docs/report.txt' }]);

    const result = await explorerGateway.addRecentFile({ path: '/docs/report.txt' });

    expect(addRecentFile).toHaveBeenCalledWith({ path: '/docs/report.txt' }, undefined);
    expect(result).toEqual([{ path: '/docs/report.txt' }]);
  });
});
