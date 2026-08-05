/**
 * useExplorerInteraction tests.
 * @see docs/spec/client/hooks/useExplorerInteraction.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';

jest.mock('../../../../utils/fileUtils', () => ({
  canPreview: jest.fn(() => true),
}));

jest.mock('../../../../services/explorerGateway', () => ({
  __esModule: true,
  default: {
    addRecentFile: jest.fn().mockResolvedValue(undefined),
  },
}));

import { canPreview } from '../../../../utils/fileUtils';
import explorerGateway from '../../../../services/explorerGateway';
import { useExplorerInteraction } from '../useExplorerInteraction';

function createDefaultProps(overrides = {}) {
  return {
    isMobile: false,
    isShareLinkMode: false,
    selectionMode: false,
    displayedFiles: [
      { nodeId: 101, path: '/docs/report.txt', name: 'report.txt', basename: 'report.txt', type: 'file' },
      { nodeId: 102, path: '/docs/photos', name: 'photos', basename: 'photos', type: 'directory' },
    ],
    toggleFileSelection: jest.fn(),
    handleFileClickSelection: jest.fn(),
    enterSelectionMode: jest.fn(),
    setSelectedFiles: jest.fn(),
    navigateToExplorerPath: jest.fn(),
    openExplorerFolder: jest.fn(),
    openPreviewDialog: jest.fn(),
    setSelectedFile: jest.fn(),
    setContextMenu: jest.fn(),
    setActionSheetFile: jest.fn(),
    actionSheetFile: null,
    showError: jest.fn(),
    t: (key) => key,
    recentFileApi: {
      trackRecentFileClick: jest.fn(),
      clearTracking: jest.fn(),
      handleRecentFileError: jest.fn(),
      setRecentFileToPreview: jest.fn(),
    },
    handleProductPathClick: jest.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe('useExplorerInteraction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    canPreview.mockImplementation(() => true);
  });

  it('lets product policy intercept path clicks before generic explorer navigation', async () => {
    const props = createDefaultProps({
      handleProductPathClick: jest.fn().mockResolvedValue(true),
    });
    const { result } = renderHook(() => useExplorerInteraction(props));

    await act(async () => {
      await result.current.handlePathClick('/__shared__');
    });

    expect(props.handleProductPathClick).toHaveBeenCalledWith('/__shared__');
    expect(props.navigateToExplorerPath).not.toHaveBeenCalled();
  });

  it('delegates desktop single-click selection using the displayed file index', () => {
    const props = createDefaultProps();
    const file = props.displayedFiles[1];
    const event = { shiftKey: true };
    const { result } = renderHook(() => useExplorerInteraction(props));

    act(() => {
      result.current.handleFileClick(file, event);
    });

    expect(props.handleFileClickSelection).toHaveBeenCalledWith(file, event, 1);
    expect(props.openExplorerFolder).not.toHaveBeenCalled();
  });

  it('opens the item on desktop double-click instead of re-running selection handling', async () => {
    const props = createDefaultProps();
    const file = props.displayedFiles[1];
    const timeSpy = jest.spyOn(Date, 'now');
    timeSpy
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1200);

    const { result } = renderHook(() => useExplorerInteraction(props));

    act(() => {
      result.current.handleFileClick(file, { detail: 1 });
    });

    await act(async () => {
      result.current.handleFileClick(file, { detail: 1 });
    });

    expect(props.handleFileClickSelection).toHaveBeenCalledTimes(1);
    expect(props.openExplorerFolder).toHaveBeenCalledWith(102);

    timeSpy.mockRestore();
  });

  it('opens a normal file preview and records it in recent files through the gateway', async () => {
    const props = createDefaultProps();
    const file = props.displayedFiles[0];
    const { result } = renderHook(() => useExplorerInteraction(props));

    await act(async () => {
      await result.current.handleFileClick(file);
    });

    expect(props.setSelectedFile).toHaveBeenCalledWith(expect.objectContaining({
      path: '/docs/report.txt',
      name: 'report.txt',
      canPreview: true,
    }));
    expect(props.openPreviewDialog).toHaveBeenCalled();
    expect(explorerGateway.addRecentFile).toHaveBeenCalledWith(file);
  });

  it('enters selection mode and selects only the pressed file on long press', () => {
    const props = createDefaultProps({
      isMobile: true,
    });
    const file = props.displayedFiles[0];
    const { result } = renderHook(() => useExplorerInteraction(props));

    act(() => {
      result.current.handleLongPressSelect(file);
    });

    expect(props.enterSelectionMode).toHaveBeenCalled();
    expect(props.setSelectedFiles).toHaveBeenCalledWith(new Set([101]));
  });

  it('preserves recent-file open flow by navigating to the parent and preparing preview state', async () => {
    const props = createDefaultProps({
      navigateToExplorerPath: jest.fn().mockResolvedValue(undefined),
    });
    const file = {
      path: '/docs/report.txt',
      basename: 'report.txt',
      name: 'report.txt',
      type: 'file',
      isRecentFile: true,
    };
    const { result } = renderHook(() => useExplorerInteraction(props));

    await act(async () => {
      await result.current.handleFileClick(file);
    });

    expect(props.recentFileApi.trackRecentFileClick).toHaveBeenCalledWith('/docs/report.txt', '/docs');
    expect(props.navigateToExplorerPath).toHaveBeenCalledWith('/docs');
    expect(props.recentFileApi.setRecentFileToPreview).toHaveBeenCalledWith(expect.objectContaining({
      filePath: '/docs/report.txt',
      fileName: 'report.txt',
      parentPath: '/docs',
    }));
  });

  it('shows the permission denied message instead of opening unreadable folders', async () => {
    const props = createDefaultProps();
    const file = {
      path: '/private',
      basename: 'private',
      name: 'private',
      type: 'directory',
      hasReadPermission: false,
    };
    const { result } = renderHook(() => useExplorerInteraction(props));

    await act(async () => {
      await result.current.handleFileClick(file);
    });

    expect(props.showError).toHaveBeenCalledWith('errors.permissionDenied');
    expect(props.openExplorerFolder).not.toHaveBeenCalled();
  });

  it('falls back to path-based navigation when a directory has no nodeId yet', async () => {
    const props = createDefaultProps();
    const file = {
      path: '/legacy/dir',
      basename: 'dir',
      name: 'dir',
      type: 'directory',
      hasReadPermission: true,
    };
    const { result } = renderHook(() => useExplorerInteraction(props));

    await act(async () => {
      await result.current.handleFileClick(file);
    });

    expect(props.openExplorerFolder).not.toHaveBeenCalled();
    expect(props.navigateToExplorerPath).toHaveBeenCalledWith('/legacy/dir');
  });

  it('opens action sheet on mobile and context menu on desktop from the more button', () => {
    const mobileProps = createDefaultProps({
      isMobile: true,
    });
    const desktopProps = createDefaultProps();
    const file = desktopProps.displayedFiles[0];
    const desktopEvent = { clientX: 10, clientY: 20 };
    const { result: mobileResult } = renderHook(() => useExplorerInteraction(mobileProps));
    const { result: desktopResult } = renderHook(() => useExplorerInteraction(desktopProps));

    act(() => {
      mobileResult.current.handleMoreClick(file);
      desktopResult.current.handleMoreClick(file, desktopEvent);
    });

    expect(mobileProps.setActionSheetFile).toHaveBeenCalledWith(file);
    expect(desktopProps.setContextMenu).toHaveBeenCalledWith({ mouseX: 10, mouseY: 20 });
    expect(desktopProps.setSelectedFile).toHaveBeenCalledWith(file);
  });

  it('opens preview for the current action-sheet file', () => {
    const file = {
      path: '/docs/report.txt',
      basename: 'report.txt',
      name: 'report.txt',
      type: 'file',
    };
    const props = createDefaultProps({
      isMobile: true,
      actionSheetFile: file,
    });
    const { result } = renderHook(() => useExplorerInteraction(props));

    act(() => {
      result.current.handleActionSheetPreview();
    });

    expect(canPreview).toHaveBeenCalledWith('report.txt');
    expect(props.setSelectedFile).toHaveBeenCalledWith(expect.objectContaining({
      path: '/docs/report.txt',
      name: 'report.txt',
      canPreview: true,
    }));
    expect(props.openPreviewDialog).toHaveBeenCalled();
  });
});
