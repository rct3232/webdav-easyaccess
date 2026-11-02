/**
 * useFileManager tests (nodeId end-state).
 * @see docs/spec/client/hooks/useFileManager.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useFileManager } from '../useFileManager';
import explorerGateway from '../../../../services/explorerGateway';
import { resolvePath, getAncestors } from '../../../../services/fileService';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('react-i18next', () => {
  const { createI18nModuleMock } = require('../../../../testing/mocks/i18nMock');
  return createI18nModuleMock();
});

jest.mock('../../../../services/explorerGateway', () => {
  const { createExplorerGatewayMock } = require('../../../../testing/mocks/serviceMocks');
  return {
    __esModule: true,
    default: createExplorerGatewayMock(),
  };
});

jest.mock('../../../../services/fileService', () => {
  const { createFileServiceMock } = require('../../../../testing/mocks/serviceMocks');
  return createFileServiceMock();
});

const mockUser = { id: '1', username: 'testuser', is_admin: false, rootNodeId: 1 };
const defaultListedFiles = [
  {
    nodeId: 10,
    path: '/testuser/a.txt',
    basename: 'a.txt',
    type: 'file',
    hasReadPermission: true,
    hasWritePermission: true,
  },
  {
    nodeId: 11,
    path: '/testuser/folder',
    basename: 'folder',
    type: 'directory',
    hasReadPermission: true,
    hasWritePermission: true,
  },
];
const defaultPathAccess = { canRead: true, canWrite: true, raw: {} };

function TestWrapper({ initialPath, children }) {
  const path = initialPath === undefined || initialPath === '' ? '/files' : `/files/${initialPath}`;
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/files/*" element={children} />
      </Routes>
    </MemoryRouter>
  );
}

function renderWithPath(urlPath, options = {}) {
  const wrapper = ({ children }) => <TestWrapper initialPath={urlPath}>{children}</TestWrapper>;
  return renderHook(() => useFileManager(mockUser, options), { wrapper });
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Captures the REAL react-router navigate inside a mounted tree so a test can
// change the URL (and thus locationKey) while the hook stays mounted.
const { useNavigate: realUseNavigate } = jest.requireActual('react-router-dom');
function LocationDriver({ driverRef }) {
  const navigate = realUseNavigate();
  driverRef.current = navigate;
  return null;
}

async function renderAndResolveNormalLoad(urlPath = '', options = {}, overrides = {}) {
  const listDeferred = createDeferred();
  const accessDeferred = createDeferred();

  explorerGateway.listDirectory.mockReturnValueOnce(listDeferred.promise);
  explorerGateway.getPathAccess.mockReturnValueOnce(accessDeferred.promise);

  const renderResult = renderWithPath(urlPath, options);

  await act(async () => {
    listDeferred.resolve(overrides.files ?? defaultListedFiles);
    accessDeferred.resolve(overrides.access ?? defaultPathAccess);
    await Promise.all([listDeferred.promise, accessDeferred.promise]);
  });

  await waitFor(() => {
    expect(renderResult.result.current.loading).toBe(false);
  });

  return renderResult;
}

async function renderAndResolveRecentLoad(recentEntries = []) {
  const recentDeferred = createDeferred();
  const metadataDeferred = createDeferred();

  explorerGateway.loadRecentFiles.mockReturnValueOnce(recentDeferred.promise);
  explorerGateway.getEntriesMetadata.mockReturnValueOnce(metadataDeferred.promise);

  const renderResult = renderWithPath('__recent__');

  await act(async () => {
    recentDeferred.resolve(recentEntries);
    metadataDeferred.resolve(
      recentEntries
        .filter((entry) => entry.type === 'file')
        .map((entry) => ({
          path: entry.path,
          size: 100,
          lastmod: null,
          mime: null,
        }))
    );
    await Promise.all([recentDeferred.promise, metadataDeferred.promise]);
  });

  await waitFor(() => {
    expect(renderResult.result.current.loading).toBe(false);
  });

  return renderResult;
}

async function renderAndResolveSharedLoad(sharedEntries = []) {
  const sharedDeferred = createDeferred();
  explorerGateway.loadSharedEntries.mockReturnValueOnce(sharedDeferred.promise);

  const renderResult = renderWithPath('__shared__');

  await act(async () => {
    sharedDeferred.resolve(sharedEntries);
    await sharedDeferred.promise;
  });

  await waitFor(() => {
    expect(renderResult.result.current.loading).toBe(false);
  });

  return renderResult;
}

describe('useFileManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNavigate.mockClear();
    explorerGateway.listDirectory.mockResolvedValue(defaultListedFiles);
    explorerGateway.getPathAccess.mockResolvedValue(defaultPathAccess);
    explorerGateway.loadRecentFiles.mockResolvedValue([]);
    explorerGateway.getEntriesMetadata.mockResolvedValue([]);
    explorerGateway.loadSharedEntries.mockResolvedValue([]);
    explorerGateway.loadTrashEntries.mockResolvedValue([]);
    explorerGateway.subscribeToRecentFiles.mockReturnValue(jest.fn());
    resolvePath.mockResolvedValue({ nodeId: 3 });
    getAncestors.mockResolvedValue({ ancestors: [] });
  });

  it('parses /files as home and lists the user root nodeId', async () => {
    const { result } = await renderAndResolveNormalLoad();

    expect(result.current.currentNodeId).toBe(1);
    expect(result.current.currentPath).toBe('/');
    expect(result.current.loading).toBe(false);
    expect(result.current.files).toHaveLength(2);
    expect(result.current.files[0]).toMatchObject({
      path: '/testuser/a.txt',
      basename: 'a.txt',
      type: 'file',
    });
    expect(result.current.hasWritePermission).toBe(true);
    expect(explorerGateway.listDirectory).toHaveBeenCalledWith({
      nodeId: 1,
      options: expect.objectContaining({ user: mockUser }),
    });
    expect(getAncestors).not.toHaveBeenCalled();
  });

  it('parses /files/node/<id> as a real folder and fetches ancestors for the breadcrumb', async () => {
    getAncestors.mockResolvedValue({
      ancestors: [
        { nodeId: 1, name: 'testuser' },
        { nodeId: 2, name: 'docs' },
      ],
    });

    const { result } = await renderAndResolveNormalLoad('node/2');

    expect(result.current.currentNodeId).toBe(2);
    expect(explorerGateway.listDirectory).toHaveBeenCalledWith({
      nodeId: 2,
      options: expect.objectContaining({ user: mockUser }),
    });
    await waitFor(() => {
      expect(getAncestors).toHaveBeenCalledWith(2);
      expect(result.current.ancestors).toEqual([
        { nodeId: 1, name: 'testuser' },
        { nodeId: 2, name: 'docs' },
      ]);
    });
    expect(result.current.currentPath).toBe('/testuser/docs');
  });

  it('redirects legacy path URLs through resolve-path', async () => {
    resolvePath.mockResolvedValue({ nodeId: 3 });

    renderWithPath('testuser/folder');

    await waitFor(() => {
      expect(resolvePath).toHaveBeenCalledWith('/testuser/folder');
      expect(mockNavigate).toHaveBeenCalledWith('/files/node/3', { replace: true });
    });
  });

  it('falls back to the root listing when a legacy path URL fails to resolve (404)', async () => {
    const notFound = new Error('not found');
    notFound.response = { status: 404 };
    resolvePath.mockRejectedValue(notFound);

    renderWithPath('unknown/path');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/files', { replace: true });
    });
  });

  it('setCurrentNodeId navigates by nodeId (home -> /files, folder -> node URL)', async () => {
    const { result } = await renderAndResolveNormalLoad();

    act(() => {
      result.current.setCurrentNodeId(null);
    });
    expect(mockNavigate).toHaveBeenCalledWith('/files');

    act(() => {
      result.current.setCurrentNodeId(1);
    });
    expect(mockNavigate).toHaveBeenCalledWith('/files');

    act(() => {
      result.current.setCurrentNodeId(5);
    });
    expect(mockNavigate).toHaveBeenCalledWith('/files/node/5');
  });

  it('share mode uses the share root nodeId from linkInfo and lists by nodeId', async () => {
    const linkInfo = { filePath: '/shared/root', nodeId: 5 };
    const { result } = renderWithPath('', { shareToken: 'token123', linkInfo });

    await waitFor(() => {
      expect(result.current.currentNodeId).toBe(5);
    });
    await waitFor(() => {
      expect(explorerGateway.listDirectory).toHaveBeenCalledWith({
        nodeId: 5,
        options: expect.objectContaining({ shareToken: 'token123' }),
      });
    });
    expect(resolvePath).not.toHaveBeenCalled();
    expect(result.current.currentPath).toBe('/shared/root');
  });

  it('share mode uses displayPath from linkInfo for the breadcrumb and never calls resolve-path', async () => {
    const linkInfo = { displayPath: '/shared/root', nodeId: 5 };
    resolvePath.mockResolvedValue({ nodeId: 5 });

    const { result } = renderWithPath('', { shareToken: 'token123', linkInfo });

    await waitFor(() => {
      expect(result.current.currentNodeId).toBe(5);
    });
    await waitFor(() => {
      expect(explorerGateway.listDirectory).toHaveBeenCalledWith({
        nodeId: 5,
        options: expect.objectContaining({ shareToken: 'token123' }),
      });
    });
    expect(resolvePath).not.toHaveBeenCalled();
    expect(result.current.currentPath).toBe('/shared/root');
  });

  it('share mode navigates to a subfolder by nodeId and keeps the display path for breadcrumbs', async () => {
    const linkInfo = { filePath: '/shared/root', nodeId: 5 };
    const { result } = renderWithPath('', { shareToken: 'token123', linkInfo });

    await waitFor(() => {
      expect(result.current.currentNodeId).toBe(5);
    });

    act(() => {
      result.current.setCurrentNodeId(6);
      result.current.setCurrentPath('/shared/root/sub');
    });

    await waitFor(() => {
      expect(explorerGateway.listDirectory).toHaveBeenLastCalledWith({
        nodeId: 6,
        options: expect.objectContaining({ shareToken: 'token123' }),
      });
    });
    expect(result.current.currentNodeId).toBe(6);
    expect(result.current.currentPath).toBe('/shared/root/sub');
  });

  it('__recent__ path loads recent files', async () => {
    const recentEntries = [{ path: '/recent/file.txt', type: 'file', lastAccessed: '2024-01-01' }];

    const { result } = await renderAndResolveRecentLoad(recentEntries);

    expect(explorerGateway.loadRecentFiles).toHaveBeenCalled();
    expect(result.current.files.some((f) => f.isRecentFile)).toBe(true);
  });

  it('refetches the recent list when a recent-files change notification fires', async () => {
    let notifyRecentChange;
    explorerGateway.subscribeToRecentFiles.mockImplementationOnce((callback) => {
      notifyRecentChange = callback;
      return jest.fn();
    });

    explorerGateway.loadRecentFiles.mockResolvedValueOnce([
      { path: '/recent/a.txt', name: 'a.txt', type: 'file', lastAccessed: '2024-01-01' },
    ]);

    const { result } = renderWithPath('__recent__');

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.files.some((file) => file.basename === 'a.txt')).toBe(true);

    expect(explorerGateway.subscribeToRecentFiles).toHaveBeenCalled();
    expect(notifyRecentChange).toBeInstanceOf(Function);

    explorerGateway.loadRecentFiles.mockResolvedValueOnce([
      { path: '/recent/a.txt', name: 'a.txt', type: 'file', lastAccessed: '2024-01-01' },
      { path: '/recent/b.txt', name: 'b.txt', type: 'file', lastAccessed: '2024-01-02' },
    ]);

    act(() => {
      notifyRecentChange();
    });

    await waitFor(() => {
      expect(explorerGateway.loadRecentFiles).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(result.current.files.some((file) => file.basename === 'b.txt')).toBe(true);
    });
  });

  it('__shared__ path loads shared folders through explorerGateway', async () => {
    const sharedEntries = [
      {
        nodeId: 21,
        path: '/other/dir',
        basename: 'dir',
        type: 'directory',
        hasReadPermission: true,
      },
    ];

    const { result } = await renderAndResolveSharedLoad(sharedEntries);

    expect(explorerGateway.loadSharedEntries).toHaveBeenCalledWith({ user: mockUser });
    expect(result.current.files).toEqual([
      expect.objectContaining({ path: '/other/dir', type: 'directory' }),
    ]);
  });

  it('A21: __trash__ path loads trashed entries through explorerGateway (urlView kind + gateway fn)', async () => {
    const trashEntries = [
      {
        nodeId: 31,
        name: 'gone.txt',
        path: '/testuser/gone.txt',
        basename: 'gone.txt',
        type: 'file',
        deletedAt: '2026-01-01T00:00:00Z',
        hasReadPermission: true,
        hasWritePermission: true,
        hasAdminPermission: true,
        isTrashed: true,
      },
    ];

    explorerGateway.loadTrashEntries.mockResolvedValueOnce(trashEntries);
    const { result } = renderWithPath('__trash__');

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(explorerGateway.loadTrashEntries).toHaveBeenCalled();
    expect(result.current.currentPath).toBe('/__trash__');
    // The trash view is read-only (no FAB / drag-drop), like recent/shared.
    expect(result.current.hasWritePermission).toBe(false);
    expect(result.current.files).toEqual(trashEntries);
  });

  it('calls onLoadComplete when load completes', async () => {
    const onLoadComplete = jest.fn();
    await renderAndResolveNormalLoad('', { onLoadComplete });

    expect(onLoadComplete).toHaveBeenCalled();
  });

  // D1: admins hold no grant rows (home is the filesystem root `/`), so write
  // capability must short-circuit client-side without a getPathAccess round-trip
  // that would otherwise report no access and hide the FAB / drag-drop.
  it('grants write capability to admin users without a getPathAccess round-trip', async () => {
    const adminUser = { ...mockUser, is_admin: true, rootNodeId: null };

    const listDeferred = createDeferred();
    explorerGateway.listDirectory.mockReturnValueOnce(listDeferred.promise);

    const wrapper = ({ children }) => <TestWrapper initialPath="node/2">{children}</TestWrapper>;
    const { result } = renderHook(() => useFileManager(adminUser), { wrapper });

    await act(async () => {
      listDeferred.resolve(defaultListedFiles);
      await listDeferred.promise;
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasWritePermission).toBe(true);
    expect(explorerGateway.getPathAccess).not.toHaveBeenCalled();
  });

  it('still calls getPathAccess for non-admin users to derive write capability', async () => {
    const { result } = await renderAndResolveNormalLoad('node/2');

    expect(explorerGateway.getPathAccess).toHaveBeenCalled();
    expect(result.current.hasWritePermission).toBe(true);
  });

  // Navigating away from a writable location must drop the permission-gated FAB
  // in the SAME commit as the location change: without the synchronous reset the
  // previous location's FAB keeps painting until the async getPathAccess lands.
  // The URL is driven through the REAL router (the hook's useNavigate is mocked
  // to a no-op, so setCurrentNodeId alone never changes locationKey here).
  it('drops write permission synchronously on a location change and restores it once access resolves', async () => {
    const driverRef = { current: null };
    const wrapper = ({ children }) => (
      <MemoryRouter initialEntries={['/files']}>
        <Routes>
          <Route
            path="/files/*"
            element={
              <>
                {children}
                <LocationDriver driverRef={driverRef} />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    const { result } = renderHook(() => useFileManager(mockUser), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.hasWritePermission).toBe(true);

    const accessDeferred = createDeferred();
    explorerGateway.getPathAccess.mockReturnValueOnce(accessDeferred.promise);

    act(() => {
      driverRef.current('/files/node/5');
    });

    expect(result.current.hasWritePermission).toBe(false);

    await act(async () => {
      accessDeferred.resolve(defaultPathAccess);
      await accessDeferred.promise;
    });

    expect(result.current.hasWritePermission).toBe(true);
  });
  describe('trash hierarchical navigation (DEF-16 P9)', () => {
    const topmostTrash = [
      {
        nodeId: 41,
        name: 'trashed-folder',
        path: '/testuser/trashed-folder',
        basename: 'trashed-folder',
        type: 'directory',
        displayPath: '/testuser/trashed-folder',
        hasWritePermission: true,
        isTrashed: true,
      },
    ];
    const childTrash = [
      {
        nodeId: 42,
        name: 'child.txt',
        path: '/testuser/trashed-folder/child.txt',
        basename: 'child.txt',
        type: 'file',
        displayPath: '/testuser/trashed-folder/child.txt',
        hasWritePermission: true,
        isTrashed: true,
      },
    ];

    it('passes parentId when the trash route names a trashed folder', async () => {
      explorerGateway.loadTrashEntries.mockResolvedValueOnce(childTrash);
      const { result } = renderWithPath('__trash__/node/31');

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(explorerGateway.loadTrashEntries).toHaveBeenCalledWith({ parentId: 31 });
      expect(result.current.currentPath).toBe('/__trash__');
      expect(result.current.trashParentNodeId).toBe(31);
    });

    it('omits parentId at the trash root', async () => {
      explorerGateway.loadTrashEntries.mockResolvedValueOnce(topmostTrash);
      const { result } = renderWithPath('__trash__');

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(explorerGateway.loadTrashEntries).toHaveBeenCalledWith({});
      expect(result.current.trashParentNodeId).toBeNull();
    });

    it('openTrashFolder caches the name and navigates to the trash hierarchy URL', async () => {
      explorerGateway.loadTrashEntries.mockResolvedValueOnce(topmostTrash);
      const { result } = renderWithPath('__trash__');

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.openTrashFolder(41, 'trashed-folder');
      });

      expect(mockNavigate).toHaveBeenCalledWith('/files/__trash__/node/41');
    });

    it('derives the trashed parent name from the first child displayPath on refresh', async () => {
      explorerGateway.loadTrashEntries.mockResolvedValueOnce(childTrash);
      const { result } = renderWithPath('__trash__/node/41');

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await waitFor(() => {
        expect(result.current.trashTrail).toEqual([{ nodeId: 41, name: 'trashed-folder' }]);
      });
    });

    it('openTrashFolder(null) navigates back to the trash root', async () => {
      explorerGateway.loadTrashEntries.mockResolvedValueOnce(childTrash);
      const { result } = renderWithPath('__trash__/node/41');

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.openTrashFolder(null);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/files/__trash__');
    });
  });
});

describe('P-4 member-row adapter (useFileManager §2.3.2)', () => {
  const wireNormal = {
    node_id: 7,
    name: 'beach.jpg',
    type: 'file',
    mime: 'image/jpeg',
    size: 1234,
    lastmod: '2026-09-01T00:00:00Z',
    created_at: '2026-08-01T00:00:00Z',
    membership: 'stored',
    published: false,
    added_by: 3,
    state: 'normal',
    liked: true,
    reason: 'tag:beach',
    shared_excluded: false,
  };
  const wireRevoked = {
    node_id: 8,
    name: null,
    type: null,
    mime: null,
    created_at: '2026-07-01T00:00:00Z',
    membership: 'derived',
    published: false,
    state: 'revoked',
    liked: false,
    reason: null,
    shared_excluded: true,
  };

  async function renderMembers(items, extra = {}) {
    explorerGateway.loadCollectionItems.mockResolvedValueOnce({
      items,
      ...extra,
    });
    const renderResult = renderWithPath('__collections__/collection/5');
    await waitFor(() => {
      expect(renderResult.result.current.loading).toBe(false);
    });
    return renderResult;
  }

  it('Decision B: ONE full fetch fills collectionMembers — no cursor state, no loadMore seam', async () => {
    const { result } = await renderMembers([wireNormal, wireRevoked]);

    expect(explorerGateway.loadCollectionItems).toHaveBeenCalledTimes(1);
    const opts = explorerGateway.loadCollectionItems.mock.calls[0][1];
    expect(opts).not.toHaveProperty('cursor');
    expect(opts).not.toHaveProperty('limit');
    expect(result.current.collectionMembers.items).toHaveLength(2);
    expect(result.current.collectionMembers.collectionId).toBe(5);
    expect(result.current.collectionMembers).not.toHaveProperty('nextCursor');
    expect(result.current.collectionMembers).not.toHaveProperty('loadingMore');
    expect(result.current.loadMoreCollectionMembers).toBeUndefined();
  });

  it('maps the wire row to file shape with the member slots and drops the size', async () => {
    const { result } = await renderMembers([wireNormal]);
    const row = result.current.collectionMembers.items[0];

    expect(row).toMatchObject({
      nodeId: 7,
      path: '',
      name: 'beach.jpg',
      basename: 'beach.jpg',
      type: 'file',
      mime: 'image/jpeg',
      lastmod: '2026-09-01T00:00:00Z',
      membership: 'stored',
      published: false,
      added_by: 3,
      state: 'normal',
      liked: true,
      reason: 'tag:beach',
      shared_excluded: false,
      isCollectionMember: true,
      hasWritePermission: false,
      rowTestId: 'member-row-7',
      moreButtonTestId: 'member-menu-button',
    });
    // the wire DOES carry size on this legacy fixture — the adapter still
    // omits it (the member surface must never render a size).
    expect(row).not.toHaveProperty('size');
  });

  it('lastmod falls back to created_at', async () => {
    const { result } = await renderMembers([{ ...wireNormal, lastmod: null }]);
    expect(result.current.collectionMembers.items[0].lastmod).toBe('2026-08-01T00:00:00Z');
  });

  it('M-8: the row carries created_at explicitly (membership-added date — the client date-sort key)', async () => {
    const { result } = await renderMembers([wireNormal, { ...wireRevoked, created_at: null }]);
    const [normal, revoked] = result.current.collectionMembers.items;

    expect(normal.created_at).toBe('2026-08-01T00:00:00Z');
    // revoked masquerade: null created_at (pins to the date-sort END — CollectionsListView §2.5)
    expect(revoked.created_at).toBeNull();
  });

  it('revoked rows carry the placeholder NAME, null mime and stay non-eligible for thumbnails', async () => {
    const { result } = await renderMembers([wireRevoked]);
    const row = result.current.collectionMembers.items[0];

    expect(row.nodeId).toBe(8);
    expect(row.name).toBeNull();
    expect(row.basename).toBe('fileManager.collectionsUnavailable');
    expect(row.mime).toBeNull();
    expect(row.state).toBe('revoked');
    expect(row.shared_excluded).toBe(true);
    expect(row.isCollectionMember).toBe(true);
    expect(row.rowTestId).toBe('member-row-8');
    expect(row).not.toHaveProperty('size');
  });

  it('handleMemberThumbnailsLoaded merges into collectionMembers rows only (never the session files)', async () => {
    const { result } = await renderMembers([wireNormal]);

    act(() => {
      result.current.handleMemberThumbnailsLoaded(new Map([[7, 'https://thumb/7']]));
    });

    expect(result.current.collectionMembers.items[0].thumbnailUrl).toBe('https://thumb/7');
    // member ids never leak into the session file list
    expect(result.current.files).toEqual([]);

    act(() => {
      result.current.handleMemberThumbnailsLoaded(new Map([[999, 'https://thumb/999']]));
    });
    expect(result.current.collectionMembers.items[0].thumbnailUrl).toBe('https://thumb/7');
  });
});

describe('P-5 collections-liked surface (useFileManager §2.3.3)', () => {
  const wireLiked = (nodeId, overrides = {}) => ({
    node_id: nodeId,
    name: `liked-${nodeId}.txt`,
    type: 'file',
    mime: 'text/plain',
    state: 'normal',
    liked: true,
    created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  });

  async function renderLiked(page) {
    explorerGateway.loadLikedItems.mockResolvedValueOnce(page);
    const renderResult = renderWithPath('__collections__/liked');
    await waitFor(() => {
      expect(renderResult.result.current.loading).toBe(false);
    });
    return renderResult;
  }

  it('parses the route, lists via loadLikedItems and feeds member-parity adapter rows', async () => {
    const { result } = await renderLiked({ items: [wireLiked(41)] });

    expect(result.current.currentPath).toBe('/__collections__/liked');
    expect(explorerGateway.loadLikedItems).toHaveBeenCalled();
    expect(result.current.likedItems).not.toHaveProperty('nextCursor'); // Decision B
    expect(result.current.likedItems.items[0]).toMatchObject({
      nodeId: 41,
      name: 'liked-41.txt',
      basename: 'liked-41.txt',
      type: 'file',
      lastmod: '2026-08-01T00:00:00Z',
      state: 'normal',
      liked: true,
      isCollectionMember: true,
      hasWritePermission: false,
      rowTestId: 'member-row-41',
      moreButtonTestId: 'member-menu-button',
    });
    expect(result.current.likedItems.items[0]).not.toHaveProperty('size');
    // the file explorer region stays empty on the overlay surface
    expect(result.current.files).toEqual([]);
  });

  it('revoked likes land as disabled placeholder rows (adapter parity)', async () => {
    const { result } = await renderLiked({
      items: [wireLiked(42, { name: null, type: null, mime: null, state: 'revoked' })],
    });

    const row = result.current.likedItems.items[0];
    expect(row.state).toBe('revoked');
    expect(row.name).toBeNull();
    expect(row.basename).toBe('fileManager.collectionsUnavailable');
    expect(row.mime).toBeNull();
  });

  it('Decision B: liked listing is ONE full fetch — no nextCursor, no loadMoreLikedItems seam', async () => {
    const { result } = await renderLiked({ items: [wireLiked(41), wireLiked(42)] });

    expect(explorerGateway.loadLikedItems).toHaveBeenCalledTimes(1);
    expect(result.current.likedItems.items.map((row) => row.nodeId)).toEqual([41, 42]);
    expect(result.current.likedItems).not.toHaveProperty('nextCursor');
    expect(result.current.likedItems).not.toHaveProperty('loadingMore');
    expect(result.current.loadMoreLikedItems).toBeUndefined();
  });

  it('applyLikedRemoval drops the row optimistically (unknown ids are a no-op)', async () => {
    const { result } = await renderLiked({
      items: [wireLiked(41), wireLiked(42)],
    });

    act(() => result.current.applyLikedRemoval(999));
    expect(result.current.likedItems.items).toHaveLength(2);

    act(() => result.current.applyLikedRemoval(41));
    expect(result.current.likedItems.items.map((row) => row.nodeId)).toEqual([42]);
  });

  it('handleMemberThumbnailsLoaded merges into likedItems rows too (member-local, never the session files)', async () => {
    const { result } = await renderLiked({ items: [wireLiked(41)] });

    act(() => {
      result.current.handleMemberThumbnailsLoaded(new Map([[41, 'https://thumb/41']]));
    });

    expect(result.current.likedItems.items[0].thumbnailUrl).toBe('https://thumb/41');
    expect(result.current.files).toEqual([]);
  });
});

describe('admin urlView guard (PLAN §14 client half)', () => {
  const adminUser = { id: '1', username: 'admin', is_admin: true, rootNodeId: null };

  beforeEach(() => {
    explorerGateway.listDirectory.mockResolvedValue(defaultListedFiles);
    explorerGateway.getPathAccess.mockResolvedValue(defaultPathAccess);
    explorerGateway.loadCollectionItems.mockResolvedValue({ items: [] });
    explorerGateway.loadLikedItems.mockResolvedValue({ items: [] });
    explorerGateway.subscribeToRecentFiles.mockReturnValue(jest.fn());
    resolvePath.mockResolvedValue({ nodeId: 3 });
    getAncestors.mockResolvedValue({ ancestors: [] });
  });

  async function renderAdmin(urlPath, options = {}) {
    const wrapper = ({ children }) => <TestWrapper initialPath={urlPath}>{children}</TestWrapper>;
    const renderResult = renderHook(() => useFileManager(adminUser, options), { wrapper });
    await waitFor(() => {
      expect(renderResult.result.current.loading).toBe(false);
    });
    return renderResult;
  }

  it('resolves /files/__collections__ for admin to the home view (root listing, no error toast)', async () => {
    const onLoadError = jest.fn();
    const { result } = await renderAdmin('__collections__', { onLoadError });

    expect(result.current.currentPath).toBe('/');
    expect(explorerGateway.listDirectory).toHaveBeenCalledWith({
      nodeId: null,
      options: expect.objectContaining({ user: adminUser }),
    });
    expect(onLoadError).not.toHaveBeenCalled();
    expect(result.current.files).toEqual(defaultListedFiles);
  });

  it('resolves /files/__collections__/__archive__ for admin to the home view', async () => {
    const { result } = await renderAdmin('__collections__/__archive__');

    expect(result.current.currentPath).toBe('/');
    expect(explorerGateway.listDirectory).toHaveBeenCalledWith({
      nodeId: null,
      options: expect.objectContaining({ user: adminUser }),
    });
  });

  it('resolves /files/__collections__/collection/<id> for admin to the home view (no member fetch)', async () => {
    const { result } = await renderAdmin('__collections__/collection/5');

    expect(result.current.currentPath).toBe('/');
    expect(explorerGateway.loadCollectionItems).not.toHaveBeenCalled();
    expect(result.current.collectionMembers.collectionId).toBeNull();
    expect(explorerGateway.listDirectory).toHaveBeenCalled();
  });

  it('resolves /files/__collections__/liked for admin to the home view (no liked fetch)', async () => {
    const { result } = await renderAdmin('__collections__/liked');

    expect(result.current.currentPath).toBe('/');
    expect(explorerGateway.loadLikedItems).not.toHaveBeenCalled();
    expect(result.current.likedItems.items).toEqual([]);
    expect(explorerGateway.listDirectory).toHaveBeenCalled();
  });

  it('non-admin control: the collections overlay kinds still parse', async () => {
    const wrapper = ({ children }) => (
      <TestWrapper initialPath="__collections__/liked">{children}</TestWrapper>
    );
    explorerGateway.loadLikedItems.mockResolvedValue({ items: [] });
    const { result } = renderHook(() => useFileManager(mockUser), { wrapper });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.currentPath).toBe('/__collections__/liked');
    expect(explorerGateway.loadLikedItems).toHaveBeenCalled();
    expect(explorerGateway.listDirectory).not.toHaveBeenCalled();
  });
});
