import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useFileManager } from '../useFileManager';
import { listFiles, getWebDAVInfo, checkPermission } from '../../services/fileService';

jest.mock('../../services/fileService', () => ({
  listFiles: jest.fn(),
  getWebDAVInfo: jest.fn(),
  checkPermission: jest.fn(),
}));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useFileManager', () => {
  const user = { id: 1, username: 'alice', is_admin: false };

  const createWrapper = (initialPath = '/files/alice') => {
    return ({ children }) => (
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/files/*" element={children} />
        </Routes>
      </MemoryRouter>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getWebDAVInfo.mockResolvedValue({ url: 'http://example.test/webdav' });
    checkPermission.mockResolvedValue({ hasWrite: true });
  });

  it('clears files immediately when currentPath changes', async () => {
    const initialFiles = [
      { path: '/alice/a.txt', basename: 'a.txt', type: 'file', size: 1, lastmod: null },
      { path: '/alice/folder', basename: 'folder', type: 'directory', size: 0, lastmod: null },
    ];
    const nextFiles = [{ path: '/other/b.txt', basename: 'b.txt', type: 'file', size: 2, lastmod: null }];

    const next = deferred();
    listFiles.mockResolvedValueOnce(initialFiles).mockReturnValueOnce(next.promise);

    const { result } = renderHook(() => useFileManager(user), {
      wrapper: createWrapper('/files/alice')
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.files).toEqual(initialFiles);

    act(() => {
      result.current.setCurrentPath('/other');
    });

    await waitFor(() => {
      expect(result.current.files).toEqual([]);
      expect(result.current.loading).toBe(true);
    });

    next.resolve(nextFiles);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.files).toEqual(nextFiles);
  });

  it('keeps existing files when refreshing the same path (loadFiles)', async () => {
    const initialFiles = [{ path: '/alice/a.txt', basename: 'a.txt', type: 'file', size: 1, lastmod: null }];
    const refreshedFiles = [{ path: '/alice/c.txt', basename: 'c.txt', type: 'file', size: 3, lastmod: null }];

    const refresh = deferred();
    listFiles.mockResolvedValueOnce(initialFiles).mockReturnValueOnce(refresh.promise);

    const { result } = renderHook(() => useFileManager(user), {
      wrapper: createWrapper('/files/alice')
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.files).toEqual(initialFiles);

    act(() => {
      result.current.loadFiles();
    });

    // While refresh is in-flight, existing items should remain visible.
    expect(result.current.files).toEqual(initialFiles);
    expect(result.current.loading).toBe(true);

    refresh.resolve(refreshedFiles);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.files).toEqual(refreshedFiles);
  });
});

