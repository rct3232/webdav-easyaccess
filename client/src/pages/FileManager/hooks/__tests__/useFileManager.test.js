/**
 * useFileManager tests (nodeId end-state).
 * @see docs/spec/client/hooks/useFileManager.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useFileManager } from '../useFileManager';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('../../../../services/explorerGateway', () => {
  const { createExplorerGatewayMock } = require('../../../../testing/mocks/serviceMocks');
  return {
    __esModule: true,
    default: createExplorerGatewayMock(),
  };
});
import explorerGateway from '../../../../services/explorerGateway';

jest.mock('../../../../services/fileService', () => ({
  resolvePath: jest.fn(),
  getAncestors: jest.fn(),
}));
import { resolvePath, getAncestors } from '../../../../services/fileService';

const mockUser = { id: '1', username: 'testuser', is_admin: false, rootNodeId: 1 };
const defaultListedFiles = [
  { nodeId: 10, path: '/testuser/a.txt', basename: 'a.txt', type: 'file', hasReadPermission: true, hasWritePermission: true },
  { nodeId: 11, path: '/testuser/folder', basename: 'folder', type: 'directory', hasReadPermission: true, hasWritePermission: true },
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
  const wrapper = ({ children }) => (
    <TestWrapper initialPath={urlPath}>{children}</TestWrapper>
  );
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
    expect(result.current.files[0]).toMatchObject({ path: '/testuser/a.txt', basename: 'a.txt', type: 'file' });
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
    const recentEntries = [
      { path: '/recent/file.txt', type: 'file', lastAccessed: '2024-01-01' },
    ];

    const { result } = await renderAndResolveRecentLoad(recentEntries);

    expect(explorerGateway.loadRecentFiles).toHaveBeenCalled();
    expect(result.current.files.some((f) => f.isRecentFile)).toBe(true);
  });

  it('__shared__ path loads shared folders through explorerGateway', async () => {
    const sharedEntries = [
      { nodeId: 21, path: '/other/dir', basename: 'dir', type: 'directory', hasReadPermission: true },
    ];

    const { result } = await renderAndResolveSharedLoad(sharedEntries);

    expect(explorerGateway.loadSharedEntries).toHaveBeenCalledWith({ user: mockUser });
    expect(result.current.files).toEqual([
      expect.objectContaining({ path: '/other/dir', type: 'directory' }),
    ]);
  });

  it('calls onLoadComplete when load completes', async () => {
    const onLoadComplete = jest.fn();
    await renderAndResolveNormalLoad('', { onLoadComplete });

    expect(onLoadComplete).toHaveBeenCalled();
  });
});
