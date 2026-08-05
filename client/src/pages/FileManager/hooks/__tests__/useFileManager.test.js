/**
 * useFileManager tests.
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

const mockUser = { id: '1', username: 'testuser', is_admin: false };
const defaultListedFiles = [
  { path: '/a.txt', basename: 'a.txt', type: 'file', hasReadPermission: true, hasWritePermission: true },
  { path: '/folder', basename: 'folder', type: 'directory', hasReadPermission: true, hasWritePermission: true },
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
  });

  it('returns currentPath, files, loading, and other state', async () => {
    const { result } = await renderAndResolveNormalLoad();

    expect(result.current.currentPath).toBe('/');
    expect(result.current.loading).toBe(false);
    expect(typeof result.current.setCurrentPath).toBe('function');
    expect(typeof result.current.loadFiles).toBe('function');

    expect(result.current.files).toHaveLength(2);
    expect(result.current.files[0]).toMatchObject({ path: '/a.txt', basename: 'a.txt', type: 'file' });
    expect(result.current.hasWritePermission).toBe(true);
  });

  it('loads files via explorerGateway for normal path', async () => {
    await renderAndResolveNormalLoad();

    expect(explorerGateway.listDirectory).toHaveBeenCalledWith({
      nodeId: null,
      options: expect.objectContaining({
        user: mockUser,
      }),
    });
  });

  it('setCurrentPath navigates when not in share mode', async () => {
    const { result } = await renderAndResolveNormalLoad();

    act(() => {
      result.current.setCurrentPath('/subfolder');
    });

    expect(mockNavigate).toHaveBeenCalledWith('/files/subfolder');
  });

  it('share mode uses shareCurrentPath from linkInfo', () => {
    const linkInfo = { filePath: '/shared/root' };
    const neverSettles = new Promise(() => {});
    explorerGateway.listDirectory.mockReturnValue(neverSettles);
    explorerGateway.getPathAccess.mockReturnValue(neverSettles);
    const { result } = renderHook(
      () => useFileManager(mockUser, { shareToken: 'token123', linkInfo }),
      { wrapper: ({ children }) => <TestWrapper initialPath="">{children}</TestWrapper> }
    );

    expect(result.current.currentPath).toBe('/shared/root');
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
      { path: '/other/dir', basename: 'dir', type: 'directory', hasReadPermission: true },
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
