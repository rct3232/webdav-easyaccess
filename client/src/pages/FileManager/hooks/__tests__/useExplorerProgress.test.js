/**
 * useExplorerProgress tests.
 * @see docs/spec/client/hooks/useExplorerProgress.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act } from '@testing-library/react';
import { useExplorerProgress } from '../useExplorerProgress';

describe('useExplorerProgress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens and closes the progress drawer through the returned controls', () => {
    const { result } = renderHook(() => useExplorerProgress({
      progressItems: [],
      updateProgress: jest.fn(),
      handleRetry: jest.fn(),
      executeExplorerUpload: jest.fn(),
      explorerUploadFilesRef: { current: new Map() },
      explorerUploadAbortControllersRef: { current: new Map() },
      explorerUploadCancelledRef: { current: new Map() },
      explorerUploadCancelAllRequestedRef: { current: new Set() },
      handleCancelBulkOperation: jest.fn(),
      handleOperationComplete: jest.fn(),
      setTreeUpdateTrigger: jest.fn(),
      currentPathRef: { current: '/docs' },
      t: (key) => key,
    }));

    act(() => {
      result.current.openProgressDrawer();
    });
    expect(result.current.isProgressDrawerOpen).toBe(true);

    act(() => {
      result.current.closeProgressDrawer();
    });
    expect(result.current.isProgressDrawerOpen).toBe(false);
  });

  it('retries only failed upload files using the original target nodeId', async () => {
    const executeExplorerUpload = jest.fn().mockResolvedValue(undefined);
    const updateProgress = jest.fn();

    const { result } = renderHook(() => useExplorerProgress({
      progressItems: [{
        id: 'upload_drop_1',
        type: 'upload',
        retryData: { type: 'upload', parentNodeId: 42 },
        fileItems: [
          { fileName: 'a.txt', status: 'completed' },
          { fileName: 'b.txt', status: 'error' },
        ],
      }],
      updateProgress,
      handleRetry: jest.fn(),
      executeExplorerUpload,
      explorerUploadFilesRef: {
        current: new Map([
          ['upload_drop_1', [
            { file: { name: 'a.txt' }, relativePath: 'a.txt' },
            { file: { name: 'b.txt' }, relativePath: 'b.txt' },
          ]],
        ]),
      },
      explorerUploadAbortControllersRef: { current: new Map() },
      explorerUploadCancelledRef: { current: new Map() },
      explorerUploadCancelAllRequestedRef: { current: new Set() },
      handleCancelBulkOperation: jest.fn(),
      handleOperationComplete: jest.fn(),
      setTreeUpdateTrigger: jest.fn(),
      currentPathRef: { current: '/fallback' },
      t: (key) => key,
    }));

    await act(async () => {
      await result.current.retryProgress('upload_drop_1');
    });

    expect(updateProgress).toHaveBeenCalledWith({ id: 'upload_drop_1', remove: true });
    expect(executeExplorerUpload).toHaveBeenCalledWith(
      [{ file: { name: 'b.txt' }, relativePath: 'b.txt' }],
      42
    );
  });

  it('cancels all upload items, updates progress, and triggers completion refresh wiring', () => {
    const updateProgress = jest.fn();
    const handleOperationComplete = jest.fn();
    const setTreeUpdateTrigger = jest.fn();
    const abortA = { abort: jest.fn() };
    const abortB = { abort: jest.fn() };

    const { result } = renderHook(() => useExplorerProgress({
      progressItems: [{
        id: 'upload_drop_2',
        type: 'upload',
        retryData: { parentNodeId: 42 },
        fileItems: [
          { fileName: 'a.txt', status: 'pending' },
          { fileName: 'b.txt', status: 'uploading' },
          { fileName: 'c.txt', status: 'completed' },
        ],
      }],
      updateProgress,
      handleRetry: jest.fn(),
      executeExplorerUpload: jest.fn(),
      explorerUploadFilesRef: { current: new Map() },
      explorerUploadAbortControllersRef: {
        current: new Map([['upload_drop_2', new Map([['a.txt', abortA], ['b.txt', abortB]])]]),
      },
      explorerUploadCancelledRef: {
        current: new Map([['upload_drop_2', new Set()]]),
      },
      explorerUploadCancelAllRequestedRef: { current: new Set() },
      handleCancelBulkOperation: jest.fn(),
      handleOperationComplete,
      setTreeUpdateTrigger,
      currentPathRef: { current: '/fallback' },
      t: (key) => key,
    }));

    act(() => {
      result.current.cancelAllProgress('upload_drop_2');
    });

    expect(abortA.abort).toHaveBeenCalled();
    expect(abortB.abort).toHaveBeenCalled();
    expect(updateProgress).toHaveBeenCalledWith(expect.objectContaining({
      id: 'upload_drop_2',
      status: 'warning',
      error: 'fileManager.uploadCancelled',
    }));
    expect(handleOperationComplete).toHaveBeenCalledWith({
      opType: 'upload',
      startedNodeId: 42,
    });
    expect(setTreeUpdateTrigger).toHaveBeenCalledWith(expect.objectContaining({ type: 'refresh' }));
  });
});
