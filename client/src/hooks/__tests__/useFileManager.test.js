import { renderHook, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useFileManager } from '../useFileManager';
import { listFiles, getWebDAVInfo, checkPermission } from '../../services/fileService';
import { getUserPermissions } from '../../services/permissionService';

jest.mock('../../services/fileService', () => ({
  listFiles: jest.fn(),
  getWebDAVInfo: jest.fn(),
  checkPermission: jest.fn(),
  listFilePermissions: jest.fn(),
  getFilesMetadata: jest.fn(),
}));

jest.mock('../../services/permissionService', () => ({
  getUserPermissions: jest.fn(),
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
    getUserPermissions.mockResolvedValue([]);
  });

  it('clears files immediately when currentPath changes', async () => {
    const initialFiles = [
      { path: '/alice/a.txt', basename: 'a.txt', type: 'file', size: 1, lastmod: null, hasAdminPermission: false },
      { path: '/alice/folder', basename: 'folder', type: 'directory', size: 0, lastmod: null, hasAdminPermission: false },
    ];
    const nextFiles = [{ path: '/other/b.txt', basename: 'b.txt', type: 'file', size: 2, lastmod: null, hasAdminPermission: false }];

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
    const initialFiles = [{ path: '/alice/a.txt', basename: 'a.txt', type: 'file', size: 1, lastmod: null, hasAdminPermission: false }];
    const refreshedFiles = [{ path: '/alice/c.txt', basename: 'c.txt', type: 'file', size: 3, lastmod: null, hasAdminPermission: false }];

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

  describe('초기 권한 체크 타이밍 (INIT2-INIT4)', () => {
    it('should initialize hasWritePermission as false (INIT4)', async () => {
      listFiles.mockResolvedValue([]);
      
      const { result } = renderHook(() => useFileManager(user), {
        wrapper: createWrapper('/files/alice')
      });

      // 초기 상태에서 hasWritePermission은 false여야 함
      expect(result.current.hasWritePermission).toBe(false);

      // 로딩 완료 후 권한 체크가 실행됨
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('should skip permission check when user is null (INIT2)', async () => {
      listFiles.mockResolvedValue([]);
      checkPermission.mockClear();

      const { result } = renderHook(() => useFileManager(null), {
        wrapper: createWrapper('/files/alice')
      });

      // user가 null이면 권한 체크 API가 호출되지 않아야 함
      await waitFor(() => {
        // 아무 동작도 일어나지 않음 (user가 null)
        expect(checkPermission).not.toHaveBeenCalled();
      });
    });

    it('should check permission after user is set (INIT3)', async () => {
      listFiles.mockResolvedValue([]);
      checkPermission.mockResolvedValue({ hasWrite: true });

      const { result, rerender } = renderHook(
        ({ user }) => useFileManager(user),
        {
          wrapper: createWrapper('/files/alice'),
          initialProps: { user: null },
        }
      );

      // 초기에는 user가 null
      await waitFor(() => {
        expect(checkPermission).not.toHaveBeenCalled();
      });

      // user 설정
      rerender({ user });

      // user가 설정되면 권한 체크가 실행됨
      await waitFor(() => {
        expect(checkPermission).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(result.current.hasWritePermission).toBe(true);
      });
    });

    it('should set hasWritePermission to false for special paths', async () => {
      listFiles.mockResolvedValue([]);
      checkPermission.mockClear();

      const { result } = renderHook(() => useFileManager(user), {
        wrapper: createWrapper('/files/__shared__')
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // __shared__ 경로에서는 항상 쓰기 권한이 없음
      expect(result.current.hasWritePermission).toBe(false);
      // 특별 경로에서는 API 호출하지 않음
      expect(checkPermission).not.toHaveBeenCalled();
    });

    it('should set hasWritePermission to false for __recent__ path', async () => {
      listFiles.mockResolvedValue([]);
      checkPermission.mockClear();

      const { result } = renderHook(() => useFileManager(user), {
        wrapper: createWrapper('/files/__recent__')
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // __recent__ 경로에서는 항상 쓰기 권한이 없음
      expect(result.current.hasWritePermission).toBe(false);
    });
  });
});

