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

jest.mock('../../utils/localStorage', () => ({
  getShowHiddenFiles: () => false,
  getSortMode: () => 'name',
}));

jest.mock('../../utils/recentFiles', () => ({
  getRecentFiles: jest.fn(),
}));

import * as fileService from '../../services/fileService';
import * as permissionService from '../../services/permissionService';
import * as recentFiles from '../../utils/recentFiles';

const mockUser = { id: '1', username: 'testuser', is_admin: false };

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

describe('useFileManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNavigate.mockClear();
    fileService.listFiles.mockResolvedValue([
      { path: '/a.txt', basename: 'a.txt', type: 'file', hasReadPermission: true, hasWritePermission: true },
      { path: '/folder', basename: 'folder', type: 'directory', hasReadPermission: true, hasWritePermission: true },
    ]);
    fileService.getWebDAVInfo.mockResolvedValue({ url: 'https://webdav.example.com' });
    fileService.checkPermission.mockResolvedValue({ hasWrite: true });
  });

  it('returns currentPath, files, loading, and other state', async () => {
    const { result } = renderWithPath();

    expect(result.current.currentPath).toBe('/');
    expect(result.current.loading).toBe(true);
    expect(typeof result.current.setCurrentPath).toBe('function');
    expect(typeof result.current.loadFiles).toBe('function');

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.files).toHaveLength(2);
    expect(result.current.files[0]).toMatchObject({ path: '/a.txt', basename: 'a.txt', type: 'file' });
    expect(result.current.hasWritePermission).toBe(true);
  });

  it('loads files via listFiles for normal path', async () => {
    const { result } = renderWithPath();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fileService.listFiles).toHaveBeenCalledWith('/');
  });

  it('setCurrentPath navigates when not in share mode', async () => {
    const { result } = renderWithPath();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setCurrentPath('/subfolder');
    });

    expect(mockNavigate).toHaveBeenCalledWith('/files/subfolder');
  });

  it('share mode uses shareCurrentPath from linkInfo', () => {
    const linkInfo = { filePath: '/shared/root' };
    const { result } = renderHook(
      () => useFileManager(mockUser, { shareToken: 'token123', linkInfo }),
      { wrapper: ({ children }) => <TestWrapper initialPath="">{children}</TestWrapper> }
    );

    expect(result.current.currentPath).toBe('/shared/root');
  });

  it('__recent__ path loads recent files', async () => {
    recentFiles.getRecentFiles.mockResolvedValue([
      { path: '/recent/file.txt', type: 'file', lastAccessed: '2024-01-01' },
    ]);
    fileService.getFilesMetadata.mockResolvedValue([{ path: '/recent/file.txt', size: 100, lastmod: null, mime: null }]);

    const { result } = renderWithPath('__recent__');

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(recentFiles.getRecentFiles).toHaveBeenCalled();
    expect(result.current.files.some((f) => f.isRecentFile)).toBe(true);
  });

  it('__shared__ path loads shared folders from getUserPermissions', async () => {
    permissionService.getUserPermissions.mockResolvedValue([
      { folder_path: '/other/dir', permission: 'read', owner_id: '2' },
    ]);
    fileService.listFilePermissions.mockResolvedValue([]);

    const { result } = renderWithPath('__shared__');

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(permissionService.getUserPermissions).toHaveBeenCalledWith(mockUser.id);
    expect(result.current.files).toBeDefined();
    expect(Array.isArray(result.current.files)).toBe(true);
  });

  it('calls onLoadComplete when load completes', async () => {
    const onLoadComplete = jest.fn();
    const { result } = renderWithPath('', { onLoadComplete });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(onLoadComplete).toHaveBeenCalled();
  });
});
