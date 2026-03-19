/**
 * useRecentFile tests.
 * @see docs/spec/client/hooks/useRecentFile.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRecentFile } from '../useRecentFile';
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

// Use real errorUtils; determineErrorType/getErrorMessageByType are pure and map status to i18n keys

jest.mock('../../../../utils/fileUtils', () => {
  const { createFileUtilsMock } = require('../../../../testing/mocks/serviceMocks');
  return createFileUtilsMock();
});

import explorerGateway from '../../../../services/explorerGateway';

const mockSetCurrentPath = jest.fn();
const mockShowError = jest.fn();
const mockSetSelectedFile = jest.fn();
const mockSetPreviewDialogOpen = jest.fn();
const mockUser = { id: '1', username: 'user1', is_admin: false };

const defaultProps = {
  setCurrentPath: mockSetCurrentPath,
  showError: mockShowError,
  user: mockUser,
  currentPathRef: { current: '/' },
  setSelectedFile: mockSetSelectedFile,
  setPreviewDialogOpen: mockSetPreviewDialogOpen,
  files: [],
  loading: false,
  currentPath: '/',
};

describe('useRecentFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    defaultProps.currentPathRef.current = '/';
    explorerGateway.listDirectory.mockResolvedValue([]);
    explorerGateway.loadRecentFiles.mockResolvedValue([]);
    explorerGateway.removeRecentFile.mockResolvedValue([]);
  });

  it('returns trackRecentFileClick, trackPathHistory, clearTracking, clearAllTracking, clearPathHistory', () => {
    const { result } = renderHook(() => useRecentFile(defaultProps));

    expect(typeof result.current.trackRecentFileClick).toBe('function');
    expect(typeof result.current.trackPathHistory).toBe('function');
    expect(typeof result.current.clearTracking).toBe('function');
    expect(typeof result.current.clearAllTracking).toBe('function');
    expect(typeof result.current.clearPathHistory).toBe('function');
    expect(typeof result.current.handleRecentFileError).toBe('function');
    expect(result.current.recentFilePathsRef).toBeDefined();
    expect(result.current.pathHistoryRef).toBeDefined();
  });

  it('trackRecentFileClick records path in recentFilePathsRef', () => {
    const { result } = renderHook(() => useRecentFile(defaultProps));

    act(() => {
      result.current.trackRecentFileClick('/folder/file.txt', '/folder');
    });

    expect(result.current.recentFilePathsRef.current.get('/folder/file.txt')).toBe('/folder/file.txt');
    expect(result.current.recentFilePathsRef.current.get('/folder')).toBeDefined();
  });

  it('trackPathHistory records path and previousPath in pathHistoryRef', () => {
    const { result } = renderHook(() => useRecentFile(defaultProps));

    act(() => {
      result.current.trackPathHistory('/folder', '/');
    });

    expect(result.current.pathHistoryRef.current.get('/folder')).toBe('/');
  });

  it('clearTracking removes path from recentFilePathsRef and pathHistoryRef', () => {
    const { result } = renderHook(() => useRecentFile(defaultProps));

    act(() => {
      result.current.trackRecentFileClick('/a/file.txt', '/a');
      result.current.trackPathHistory('/a', '/');
    });
    expect(result.current.recentFilePathsRef.current.size).toBeGreaterThan(0);
    expect(result.current.pathHistoryRef.current.size).toBeGreaterThan(0);

    act(() => {
      result.current.clearTracking('/a');
    });

    expect(result.current.recentFilePathsRef.current.has('/a')).toBe(false);
    expect(result.current.pathHistoryRef.current.has('/a')).toBe(false);
  });

  it('clearPathHistory removes path from pathHistoryRef only', () => {
    const { result } = renderHook(() => useRecentFile(defaultProps));

    act(() => {
      result.current.trackRecentFileClick('/x/file.txt', '/x');
      result.current.trackPathHistory('/x', '/');
    });

    act(() => {
      result.current.clearPathHistory('/x');
    });

    expect(result.current.pathHistoryRef.current.has('/x')).toBe(false);
    expect(result.current.recentFilePathsRef.current.size).toBeGreaterThan(0);
  });

  it('clearAllTracking clears both refs', () => {
    const { result } = renderHook(() => useRecentFile(defaultProps));

    act(() => {
      result.current.trackRecentFileClick('/a/f.txt', '/a');
      result.current.trackPathHistory('/a', '/');
    });

    act(() => {
      result.current.clearAllTracking();
    });

    expect(result.current.recentFilePathsRef.current.size).toBe(0);
    expect(result.current.pathHistoryRef.current.size).toBe(0);
  });

  it('handleRecentFileError on 404 with recent file calls removeRecentFile and showError when file not in parent', async () => {
    explorerGateway.loadRecentFiles.mockResolvedValue([{ path: '/folder/missing.txt' }]);
    explorerGateway.listDirectory.mockResolvedValue([]);

    const { result } = renderHook(() => useRecentFile(defaultProps));

    act(() => {
      result.current.trackRecentFileClick('/folder/missing.txt', '/folder');
    });

    await act(async () => {
      await result.current.handleRecentFileError(
        { response: { status: 404 } },
        '/folder/missing.txt'
      );
    });

    await waitFor(() => {
      expect(explorerGateway.removeRecentFile).toHaveBeenCalledWith('/folder/missing.txt');
      expect(mockShowError).toHaveBeenCalledTimes(1);
      expect(mockShowError).toHaveBeenCalledWith('errors.recentRemovedFromList');
    });
  });

  it('handleRecentFileError uses the provided recentGateway seam for verification and stale removal', async () => {
    const { createExplorerGatewayMock } = require('../../../../testing/mocks/serviceMocks');
    const recentGateway = createExplorerGatewayMock({
      listDirectory: jest.fn().mockResolvedValue([]),
      loadRecentFiles: jest.fn().mockResolvedValue([{ path: '/folder/missing.txt' }]),
      removeRecentFile: jest.fn().mockResolvedValue([]),
    });

    const { result } = renderHook(() => useRecentFile({ ...defaultProps, recentGateway }));

    act(() => {
      result.current.trackRecentFileClick('/folder/missing.txt', '/folder');
    });

    await act(async () => {
      await result.current.handleRecentFileError(
        { response: { status: 404 } },
        '/folder/missing.txt'
      );
    });

    expect(recentGateway.listDirectory).toHaveBeenCalledWith({ path: '/folder' });
    expect(recentGateway.loadRecentFiles).toHaveBeenCalled();
    expect(recentGateway.removeRecentFile).toHaveBeenCalledWith('/folder/missing.txt');
    expect(mockShowError).toHaveBeenCalledWith('errors.recentRemovedFromList');
  });

  it('handleRecentFileError on 404 navigates to previousPath when available', async () => {
    const currentPathRef = { current: '/folder' };
    const { result } = renderHook(() =>
      useRecentFile({ ...defaultProps, currentPathRef })
    );

    act(() => {
      result.current.trackPathHistory('/folder', '/');
    });

    await act(async () => {
      await result.current.handleRecentFileError(
        { response: { status: 404 } },
        '/folder'
      );
    });

    await waitFor(() => {
      expect(mockSetCurrentPath).toHaveBeenCalledWith('/');
    });
  });

  it('handleRecentFileError on 404 with no previousPath navigates to default path', async () => {
    const currentPathRef = { current: '/unknown' };
    const { result } = renderHook(() =>
      useRecentFile({ ...defaultProps, currentPathRef, user: mockUser })
    );

    await act(async () => {
      await result.current.handleRecentFileError(
        { response: { status: 404 } },
        '/unknown'
      );
    });

    await waitFor(() => {
      expect(mockSetCurrentPath).toHaveBeenCalledWith('/user1');
    });
  });

  it('handleRecentFileError shows error to user', async () => {
    const { result } = renderHook(() => useRecentFile(defaultProps));

    await act(async () => {
      await result.current.handleRecentFileError(
        { response: { status: 500 } },
        '/any'
      );
    });

    expect(mockShowError).toHaveBeenCalledWith('errors.fileNotFound');
  });

  it('setRecentFileToPreview when file in files opens preview dialog', async () => {
    const { canPreview } = require('../../../../utils/fileUtils');
    canPreview.mockReturnValue(true);

    const imgFile = {
      path: '/folder/img.jpg',
      basename: 'img.jpg',
      type: 'file',
      mime: 'image/jpeg',
    };
    const props = {
      ...defaultProps,
      files: [imgFile],
      currentPath: '/folder',
      loading: false,
    };

    const { result } = renderHook(() => useRecentFile(props));

    act(() => {
      result.current.setRecentFileToPreview({
        filePath: '/folder/img.jpg',
        fileName: 'img.jpg',
        parentPath: '/folder',
      });
    });

    await waitFor(() => {
      expect(mockSetPreviewDialogOpen).toHaveBeenCalledWith(true);
      expect(mockSetSelectedFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/folder/img.jpg', name: 'img.jpg' })
      );
    });
  });

  it('setRecentFileToPreview verifies through explorerGateway when file is not in local files', async () => {
    const { canPreview } = require('../../../../utils/fileUtils');
    canPreview.mockReturnValue(true);
    explorerGateway.listDirectory.mockResolvedValue([
      { path: '/folder/img.jpg', basename: 'img.jpg', type: 'file', mime: 'image/jpeg' },
    ]);

    const props = {
      ...defaultProps,
      files: [],
      currentPath: '/folder',
      loading: false,
    };

    const { result } = renderHook(() => useRecentFile(props));

    act(() => {
      result.current.setRecentFileToPreview({
        filePath: '/folder/img.jpg',
        fileName: 'img.jpg',
        parentPath: '/folder',
      });
    });

    await waitFor(() => {
      expect(explorerGateway.listDirectory).toHaveBeenCalledWith({ path: '/folder' });
      expect(mockSetPreviewDialogOpen).toHaveBeenCalledWith(true);
    });
  });
});
