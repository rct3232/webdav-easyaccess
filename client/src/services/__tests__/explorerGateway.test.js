/**
 * explorerGateway tests.
 * @see docs/spec/client/services/explorerGateway.md
 * @see docs/TESTING_STRATEGY.md
 */
import {
  checkConflicts,
  getAncestors,
  getFilesMetadata,
  listFiles,
  uploadMultipleFiles,
} from '../fileService';
import { getLikedNodeIds, setFileLike } from '../fileLikesRepository';
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

jest.mock('../collectionsRepository', () => {
  const fns = [
    'addCollectionItems',
    'archiveCollection',
    'createCollection',
    'deleteCollection',
    'dismissMerge',
    'getCollectionItems',
    'getCollections',
    'getGrants',
    'getMemberships',
    'getMergeSuggestions',
    'grantCollection',
    'mergeCollections',
    'previewCollection',
    'previewExistingCollection',
    'publishItems',
    'rejectMerge',
    'removeCollectionItems',
    'restoreCollection',
    'revokeGrant',
    'updateCollection',
    'runSearch',
    'recordSearchClick',
    'getActions',
    'getFileSuggestions',
    'acceptFileSuggestions',
  ];
  const mock = {};
  for (const name of fns) mock[name] = jest.fn();
  return mock;
});

jest.mock('../collectionsNotifier', () => ({
  onCollectionsChange: jest.fn(),
}));

jest.mock('../fileLikesRepository', () => {
  const { createFileLikesRepositoryMock } = require('../../testing/mocks/serviceMocks');
  return createFileLikesRepositoryMock();
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

  it('lists a normal directory with hidden filtering and server-provided admin capability', async () => {
    listFiles.mockResolvedValueOnce([
      { nodeId: 10, display_path: '/docs/report.txt', isHidden: false, hasAdminPermission: true },
      { nodeId: 11, display_path: '/docs/.draft.txt', isHidden: true, hasAdminPermission: true },
    ]);

    const result = await listDirectory({
      nodeId: 5,
      options: {
        user: { id: '1', is_admin: false },
      },
    });

    expect(listFiles).toHaveBeenCalledWith(5, {});
    expect(getShowHiddenFiles).toHaveBeenCalled();
    expect(result).toEqual([expect.objectContaining({ nodeId: 10, hasAdminPermission: true })]);
    expect(result).toHaveLength(1); // hidden file filtered out
    // hasAdminPermission comes from the server listing row, not getUserPermissions.
    expect(getUserPermissions).not.toHaveBeenCalled();
  });

  it('returns raw share listings without hidden or permission enrichment', async () => {
    listFiles.mockResolvedValueOnce([
      { nodeId: 20, display_path: '/shared/.hidden.txt', isHidden: true },
    ]);

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
    getFilesMetadata.mockResolvedValueOnce([
      { nodeId: 10, display_path: '/docs/report.txt', size: 12 },
    ]);

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
      expect.objectContaining({
        nodeId: 100,
        name: 'Shared Docs',
        basename: 'Shared Docs',
        type: 'directory',
        hasWritePermission: true,
      }),
      expect.objectContaining({ nodeId: 101, name: 'Read Only', type: 'directory' }),
      expect.objectContaining({
        nodeId: 300,
        name: 'report.txt',
        basename: 'report.txt',
        type: 'file',
        size: 50,
        mime: 'text/plain',
      }),
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
      expect.objectContaining({
        nodeId: 102,
        hasWritePermission: false,
        hasAdminPermission: false,
      }),
      expect.objectContaining({
        nodeId: 300,
        type: 'file',
        hasWritePermission: false,
        hasAdminPermission: false,
      }),
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

  describe('explorerGateway collections re-exports (T0.3)', () => {
    const {
      getCollections,
      createCollection,
      updateCollection,
      archiveCollection,
      restoreCollection,
      deleteCollection,
      getCollectionItems,
      addCollectionItems,
      removeCollectionItems,
      publishItems,
      getMemberships,
      previewCollection,
      getMergeSuggestions,
      mergeCollections,
      dismissMerge,
      rejectMerge,
    } = require('../collectionsRepository');
    const { onCollectionsChange } = require('../collectionsNotifier');

    it('re-exports the collections seams under the §2.6 names, preserving shapes and fallbacks', async () => {
      getCollections.mockResolvedValueOnce({ collections: [] });
      await expect(explorerGateway.loadCollections({ sort: 'name' })).resolves.toEqual({
        collections: [],
      });
      expect(getCollections).toHaveBeenCalledWith({ sort: 'name' });

      createCollection.mockResolvedValueOnce({ undo: { action_id: 1 } });
      await expect(explorerGateway.createCollection({ name: 'X' })).resolves.toEqual({
        undo: { action_id: 1 },
      });

      updateCollection.mockResolvedValueOnce(null);
      await expect(explorerGateway.updateCollection(17, { pinned: true })).resolves.toBeNull();

      archiveCollection.mockResolvedValueOnce({ undo: { action_id: 2 } });
      restoreCollection.mockResolvedValueOnce({ undo: { action_id: 3 } });
      await explorerGateway.archiveCollection(17);
      await explorerGateway.restoreCollection(17);
      expect(archiveCollection).toHaveBeenCalledWith(17);
      expect(restoreCollection).toHaveBeenCalledWith(17);

      deleteCollection.mockResolvedValueOnce(true);
      await expect(explorerGateway.deleteCollection(17)).resolves.toBe(true);

      getCollectionItems.mockResolvedValueOnce({ items: [], next_cursor: null });
      await expect(explorerGateway.loadCollectionItems(17, { limit: 50 })).resolves.toEqual({
        items: [],
        next_cursor: null,
      });
      expect(getCollectionItems).toHaveBeenCalledWith(17, { limit: 50 });

      addCollectionItems.mockResolvedValueOnce({ added: [1] });
      removeCollectionItems.mockResolvedValueOnce({ removed: [1] });
      await explorerGateway.addCollectionItems(17, [1]);
      await explorerGateway.removeCollectionItems(17, [1]);
      expect(addCollectionItems).toHaveBeenCalledWith(17, [1]);
      expect(removeCollectionItems).toHaveBeenCalledWith(17, [1]);

      publishItems.mockResolvedValueOnce(null);
      await expect(explorerGateway.publishItems(17, [1])).resolves.toBeNull();

      getMemberships.mockResolvedValueOnce({ memberships: [] });
      await expect(explorerGateway.getMemberships([1])).resolves.toEqual({ memberships: [] });

      previewCollection.mockResolvedValueOnce({ count: 0, sample: [], sample_truncated: false });
      await expect(explorerGateway.previewCollection({ seedNodeId: 5 })).resolves.toEqual({
        count: 0,
        sample: [],
        sample_truncated: false,
      });

      getMergeSuggestions.mockResolvedValueOnce({ suggestions: [] });
      await expect(explorerGateway.getMergeSuggestions()).resolves.toEqual({ suggestions: [] });

      mergeCollections.mockResolvedValueOnce({ absorbed_id: 23 });
      dismissMerge.mockResolvedValueOnce({ state: 'dismissed' });
      rejectMerge.mockResolvedValueOnce({ state: 'rejected' });
      await explorerGateway.mergeCollections(1, 2);
      await explorerGateway.dismissMerge(1, 2);
      await explorerGateway.rejectMerge(1, 2);
      expect(mergeCollections).toHaveBeenCalledWith(1, 2);
      expect(dismissMerge).toHaveBeenCalledWith(1, 2);
      expect(rejectMerge).toHaveBeenCalledWith(1, 2);
    });

    it('subscribeToCollections wraps the notifier unsubscribe contract', () => {
      const unsub = jest.fn();
      onCollectionsChange.mockReturnValueOnce(unsub);

      const result = explorerGateway.subscribeToCollections(() => {});
      expect(result).toBe(unsub);
      expect(typeof result).toBe('function');
    });

    // -- §2.6 search results-mode group (T0.11) --------------------------------

    it('re-exports runSearch and recordSearchClick with the repository shapes', async () => {
      const { runSearch, recordSearchClick } = require('../collectionsRepository');

      const payload = {
        name_matches: [],
        result_ref: 'sr1.x',
        counts: {},
        semantic_available: false,
      };
      runSearch.mockResolvedValueOnce(payload);
      await expect(explorerGateway.runSearch({ query: 'movie' })).resolves.toBe(payload);

      recordSearchClick.mockResolvedValueOnce(true);
      await expect(explorerGateway.recordSearchClick(11)).resolves.toBe(true);
    });

    // -- §2.6 file-likes group (T0.5) -----------------------------------------

    it('listDirectory merges liked=false onto rows when no node is liked (absorbed read)', async () => {
      listFiles.mockResolvedValueOnce([
        { nodeId: 10, display_path: '/docs/a.txt', isHidden: false },
        { nodeId: 11, display_path: '/docs/b.txt', isHidden: false },
      ]);
      getLikedNodeIds.mockResolvedValueOnce({ liked: [] });

      const result = await listDirectory({
        nodeId: 5,
        options: { user: { id: '1', is_admin: false } },
      });

      expect(result.every((r) => r.liked === false)).toBe(true);
    });

    it('listDirectory marks liked=true for nodes present in the whole-viewer read', async () => {
      listFiles.mockResolvedValueOnce([
        { nodeId: 10, display_path: '/docs/a.txt', isHidden: false },
        { nodeId: 11, display_path: '/docs/b.txt', isHidden: false },
      ]);
      getLikedNodeIds.mockResolvedValueOnce({ liked: [11] });

      const result = await listDirectory({
        nodeId: 5,
        options: { user: { id: '1', is_admin: false } },
      });

      const byId = Object.fromEntries(result.map((r) => [r.nodeId, r.liked]));
      expect(byId).toEqual({ 10: false, 11: true });
    });

    it('share-token listings skip the liked merge (no like read)', async () => {
      listFiles.mockResolvedValueOnce([{ nodeId: 20, display_path: '/shared/.hidden.txt' }]);

      const result = await listDirectory({
        nodeId: 15,
        options: { shareToken: 'share-token', user: { id: '1' } },
      });

      expect(getLikedNodeIds).not.toHaveBeenCalled();
      expect(result[0]).not.toHaveProperty('liked');
    });

    it('re-exports loadFileLikes / setFileLike / subscribeToFileLikes with the repository shapes', async () => {
      getLikedNodeIds.mockResolvedValueOnce({ liked: [4, 5] });
      await expect(explorerGateway.loadFileLikes()).resolves.toEqual({ liked: [4, 5] });

      setFileLike.mockResolvedValueOnce({ node_id: 4, liked: false });
      await expect(explorerGateway.setFileLike(4, false)).resolves.toEqual({
        node_id: 4,
        liked: false,
      });
      expect(setFileLike).toHaveBeenCalledWith(4, false, undefined);

      const repo = require('../fileLikesRepository');
      const unsub = jest.fn();
      repo.subscribeFileLikesChange = jest.fn(() => unsub);
      expect(explorerGateway.subscribeToFileLikes(() => {})).toBe(unsub);
    });

    it('re-exports loadLikedItems with the repository cursor shape (P-5)', async () => {
      const repo = require('../fileLikesRepository');
      const page = { items: [{ node_id: 7, state: 'normal' }], next_cursor: 'token' };
      repo.getLikedItems.mockResolvedValueOnce(page);

      await expect(explorerGateway.loadLikedItems({ cursor: 'token' })).resolves.toEqual(page);
      expect(repo.getLikedItems).toHaveBeenCalledWith({ cursor: 'token' });
    });
  });

  describe('explorerGateway narrow listing/render helpers (T0.5/T0.11)', () => {
    it('loadNodesMetadata returns fileService metadata for raw nodeIds', async () => {
      getFilesMetadata.mockResolvedValueOnce([{ nodeId: 11, type: 'file', size: 20 }]);

      await expect(explorerGateway.loadNodesMetadata([11])).resolves.toEqual([
        { nodeId: 11, type: 'file', size: 20 },
      ]);
      expect(getFilesMetadata).toHaveBeenCalledWith([11]);
    });

    it('loadNodesMetadata absorbs a metadata failure into []', async () => {
      getFilesMetadata.mockRejectedValueOnce(new Error('boom'));

      await expect(explorerGateway.loadNodesMetadata([11])).resolves.toEqual([]);
    });

    it('loadNodeAncestors passes the ancestor chain through for reveal-original navigation', async () => {
      getAncestors.mockResolvedValueOnce({
        ancestors: [
          { nodeId: 1, name: '/' },
          { nodeId: 42, name: 'docs' },
          { nodeId: 99, name: 'f.pdf' },
        ],
      });

      const result = await explorerGateway.loadNodeAncestors(99);
      expect(result.ancestors[result.ancestors.length - 2].nodeId).toBe(42);
    });
  });

  describe('explorerGateway actions-feed + dashboard seams (T0.10)', () => {
    it('re-exports getActions / getFileSuggestions / acceptFileSuggestions with the repository shapes', async () => {
      const repo = require('../collectionsRepository');

      const feed = { actions: [{ action_id: 1 }] };
      repo.getActions.mockResolvedValueOnce(feed);
      await expect(explorerGateway.getActions({ domain: 'collection' })).resolves.toBe(feed);
      expect(repo.getActions).toHaveBeenCalledWith({ domain: 'collection' });

      const payload = { suggestions: [], duplicates: { group_count: 0 } };
      repo.getFileSuggestions.mockResolvedValueOnce(payload);
      await expect(explorerGateway.getFileSuggestions()).resolves.toBe(payload);

      repo.acceptFileSuggestions.mockResolvedValueOnce({ trashed: [7] });
      await expect(explorerGateway.acceptFileSuggestions([7], { silent: true })).resolves.toEqual({
        trashed: [7],
      });
      expect(repo.acceptFileSuggestions).toHaveBeenCalledWith([7], { silent: true });
    });
  });
});
