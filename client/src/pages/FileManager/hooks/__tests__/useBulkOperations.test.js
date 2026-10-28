/**
 * useBulkOperations tests.
 * @see docs/spec/client/hooks/useBulkOperations.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBulkOperations } from '../useBulkOperations';

import * as fileService from '../../../../services/fileService';
import { notifyRecentFilesChange } from '../../../../services/recentFilesNotifier';

jest.mock('react-i18next', () => {
  const { createI18nModuleMock } = require('../../../../testing/mocks/i18nMock');
  return createI18nModuleMock();
});

jest.mock('../../../../services/fileService', () => {
  const { createFileServiceMock } = require('../../../../testing/mocks/serviceMocks');
  return createFileServiceMock();
});

jest.mock('../../../../services/recentFilesNotifier', () => {
  const { createRecentFilesNotifierMock } = require('../../../../testing/mocks/serviceMocks');
  return createRecentFilesNotifierMock();
});

const mockSetTreeUpdateTrigger = jest.fn();
const mockOnOperationComplete = jest.fn();
const mockSetSelectedFiles = jest.fn();
const mockSetSelectionMode = jest.fn();
const mockGetCurrentNodeId = jest.fn(() => 0);

const defaultArgs = [
  new Set([1, 2]),
  [
    { nodeId: 1, type: 'file', basename: 'file1.txt' },
    { nodeId: 2, type: 'file', basename: 'file2.txt' },
  ],
  mockOnOperationComplete,
  mockSetTreeUpdateTrigger,
  undefined,
  mockSetSelectedFiles,
  mockSetSelectionMode,
  mockGetCurrentNodeId,
  {},
];

describe('useBulkOperations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // CRA's Jest config resets mock implementations between tests.
    mockGetCurrentNodeId.mockReturnValue(0);
    fileService.batchDeleteFiles.mockResolvedValue({ jobId: 'job-del' });
    fileService.batchMoveFiles.mockResolvedValue({ jobId: 'job-move' });
    fileService.batchCopyFiles.mockResolvedValue({ jobId: 'job-copy' });
    fileService.downloadMultipleFiles.mockResolvedValue({});
    fileService.checkConflicts.mockResolvedValue([]);
    fileService.getBulkOperationStatus.mockImplementation(() =>
      Promise.resolve({
        status: 'completed',
        progress: 2,
        total: 2,
        results: [
          {
            nodeId: 1,
            sourceNodeId: 1,
            destinationParentNodeId: 99,
            status: 'succeeded',
          },
          {
            nodeId: 2,
            sourceNodeId: 2,
            destinationParentNodeId: 99,
            status: 'succeeded',
          },
        ],
      })
    );
    fileService.cancelBulkOperation.mockResolvedValue();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns folderPickerOpen, folderPickerAction, handlers, progressItems', () => {
    const { result } = renderHook(() => useBulkOperations(...defaultArgs));

    expect(typeof result.current.folderPickerOpen).toBe('boolean');
    expect(result.current.folderPickerAction).toBeNull();
    expect(typeof result.current.handleBulkMove).toBe('function');
    expect(typeof result.current.handleBulkCopy).toBe('function');
    expect(typeof result.current.handleBulkDelete).toBe('function');
    expect(typeof result.current.handleBulkDownload).toBe('function');
    expect(typeof result.current.handleFolderPickerSelect).toBe('function');
    expect(Array.isArray(result.current.progressItems)).toBe(true);
  });

  it('handleBulkMove opens folder picker with action move', () => {
    const { result } = renderHook(() => useBulkOperations(...defaultArgs));

    act(() => {
      result.current.handleBulkMove();
    });

    expect(result.current.folderPickerOpen).toBe(true);
    expect(result.current.folderPickerAction).toBe('move');
  });

  it('handleBulkCopy opens folder picker with action copy', () => {
    const { result } = renderHook(() => useBulkOperations(...defaultArgs));

    act(() => {
      result.current.handleBulkCopy();
    });

    expect(result.current.folderPickerOpen).toBe(true);
    expect(result.current.folderPickerAction).toBe('copy');
  });

  it('handleBulkDelete without onConfirm clears selection and starts delete job', async () => {
    const { result } = renderHook(() => useBulkOperations(...defaultArgs));

    await act(async () => {
      result.current.handleBulkDelete();
    });

    expect(fileService.batchDeleteFiles).toHaveBeenCalledWith(expect.arrayContaining([1, 2]));

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(mockOnOperationComplete).toHaveBeenCalledWith(
      expect.objectContaining({ opType: 'delete' })
    );
    expect(notifyRecentFilesChange).toHaveBeenCalled();
  });

  it('handleBulkDelete with onConfirm calls onConfirm without starting delete', async () => {
    const onConfirm = jest.fn();
    const { result } = renderHook(() => useBulkOperations(...defaultArgs));

    await act(async () => {
      await result.current.handleBulkDelete(null, onConfirm);
    });

    expect(onConfirm).toHaveBeenCalledWith(expect.arrayContaining([1, 2]));
    expect(fileService.batchDeleteFiles).not.toHaveBeenCalled();
  });

  it('handleBulkDownload calls downloadMultipleFiles and clears selection on success', async () => {
    const { result } = renderHook(() => useBulkOperations(...defaultArgs));

    await act(async () => {
      await result.current.handleBulkDownload();
    });

    expect(fileService.downloadMultipleFiles).toHaveBeenCalledWith(
      expect.arrayContaining([1, 2]),
      expect.any(Function),
      undefined
    );
    expect(mockSetSelectedFiles).toHaveBeenCalledWith(new Set());
  });

  it('handleFolderPickerSelect with no conflicts triggers batch move', async () => {
    const { result } = renderHook(() => useBulkOperations(...defaultArgs));

    act(() => {
      result.current.handleBulkMove();
    });

    await act(async () => {
      await result.current.handleFolderPickerSelect(99);
    });

    expect(fileService.checkConflicts).toHaveBeenCalled();
    expect(fileService.batchMoveFiles).toHaveBeenCalledWith(expect.any(Array), 'error');

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(mockOnOperationComplete).toHaveBeenCalledWith(
      expect.objectContaining({ opType: 'move', targetParentNodeId: 99 })
    );
    expect(notifyRecentFilesChange).toHaveBeenCalled();
  });

  it('handleFolderPickerSelect with no conflicts triggers batch copy and completes operation', async () => {
    const { result } = renderHook(() => useBulkOperations(...defaultArgs));

    act(() => {
      result.current.handleBulkCopy();
    });

    await act(async () => {
      await result.current.handleFolderPickerSelect(99);
    });

    expect(fileService.checkConflicts).toHaveBeenCalled();
    expect(fileService.batchCopyFiles).toHaveBeenCalledWith(expect.any(Array), 'error');

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(mockOnOperationComplete).toHaveBeenCalledWith(
      expect.objectContaining({ opType: 'copy', targetParentNodeId: 99 })
    );
  });

  it('bulk move syncs recent files for only the succeeded subset when other items are skipped', async () => {
    fileService.getBulkOperationStatus.mockResolvedValue({
      status: 'completed',
      progress: 2,
      total: 2,
      results: [
        {
          nodeId: 1,
          sourceNodeId: 1,
          destinationParentNodeId: 99,
          status: 'succeeded',
        },
        {
          nodeId: 2,
          sourceNodeId: 2,
          destinationParentNodeId: 99,
          status: 'skippedByPermission',
        },
      ],
    });

    const { result } = renderHook(() => useBulkOperations(...defaultArgs));

    act(() => {
      result.current.handleBulkMove();
    });

    await act(async () => {
      await result.current.handleFolderPickerSelect(99);
    });

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(notifyRecentFilesChange).toHaveBeenCalled();
  });

  it('handleFolderPickerSelect with conflicts sets bulkConflictData', async () => {
    fileService.checkConflicts.mockResolvedValue([
      { sourceNodeId: 1, destinationParentNodeId: 99 },
    ]);
    const { result } = renderHook(() => useBulkOperations(...defaultArgs));

    act(() => {
      result.current.handleBulkMove();
    });

    await act(async () => {
      await result.current.handleFolderPickerSelect(99);
    });

    expect(result.current.bulkConflictData).not.toBeNull();
    expect(result.current.bulkConflictData.conflicts).toHaveLength(1);
  });

  it('resolveBulkConflict with overwrite proceeds with operation', async () => {
    fileService.checkConflicts.mockResolvedValue([
      { sourceNodeId: 1, destinationParentNodeId: 99 },
    ]);
    const { result } = renderHook(() => useBulkOperations(...defaultArgs));

    act(() => {
      result.current.handleBulkMove();
    });

    await act(async () => {
      await result.current.handleFolderPickerSelect(99);
    });

    expect(result.current.bulkConflictData).not.toBeNull();

    await act(async () => {
      await result.current.resolveBulkConflict('overwrite');
    });

    expect(fileService.batchMoveFiles).toHaveBeenCalledWith(expect.any(Array), 'overwrite');

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(mockOnOperationComplete).toHaveBeenCalledWith(
      expect.objectContaining({ opType: 'move', targetParentNodeId: 99 })
    );
  });

  it('setFolderPickerOpen closes picker', () => {
    const { result } = renderHook(() => useBulkOperations(...defaultArgs));

    act(() => {
      result.current.handleBulkMove();
    });
    expect(result.current.folderPickerOpen).toBe(true);

    act(() => {
      result.current.setFolderPickerOpen(false);
    });
    expect(result.current.folderPickerOpen).toBe(false);
  });

  it('handleRetry retries failed move and completes on second attempt', async () => {
    let moveCallCount = 0;
    fileService.batchMoveFiles.mockImplementation(() => {
      moveCallCount++;
      return moveCallCount === 1
        ? Promise.reject(new Error('Network error'))
        : Promise.resolve({ jobId: 'job-retry' });
    });
    fileService.getBulkOperationStatus.mockResolvedValue({
      status: 'completed',
      progress: 2,
      total: 2,
      results: [
        { nodeId: 1, sourceNodeId: 1, destinationParentNodeId: 99, status: 'succeeded' },
        { nodeId: 2, sourceNodeId: 2, destinationParentNodeId: 99, status: 'succeeded' },
      ],
    });

    const { result } = renderHook(() => useBulkOperations(...defaultArgs));

    act(() => {
      result.current.handleBulkMove();
    });

    await act(async () => {
      await result.current.handleFolderPickerSelect(99);
    });

    const errorItem = result.current.progressItems.find(
      (item) => item.status === 'error' && item.retryData
    );
    expect(errorItem).toBeDefined();
    const progressId = errorItem.id;

    await act(async () => {
      await result.current.handleRetry(progressId);
    });

    expect(fileService.batchMoveFiles).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(mockOnOperationComplete).toHaveBeenCalledWith(
        expect.objectContaining({ opType: 'move', targetParentNodeId: 99 })
      );
    });
  });

  it('handleCancelBulkOperation calls cancelBulkOperation with jobId', async () => {
    fileService.batchMoveFiles.mockResolvedValue({ jobId: 'job-to-cancel' });
    let pollCount = 0;
    fileService.getBulkOperationStatus.mockImplementation(() => {
      pollCount++;
      return Promise.resolve(
        pollCount <= 2
          ? { status: 'running', progress: 0, total: 2, results: [] }
          : {
              status: 'completed',
              progress: 2,
              total: 2,
              results: [
                { nodeId: 1, sourceNodeId: 1, destinationParentNodeId: 99, status: 'succeeded' },
                { nodeId: 2, sourceNodeId: 2, destinationParentNodeId: 99, status: 'succeeded' },
              ],
            }
      );
    });

    const { result } = renderHook(() => useBulkOperations(...defaultArgs));

    act(() => {
      result.current.handleBulkMove();
    });

    await act(async () => {
      await result.current.handleFolderPickerSelect(99);
    });

    await waitFor(() => {
      const itemWithJobId = result.current.progressItems.find(
        (item) => item.jobId === 'job-to-cancel'
      );
      expect(itemWithJobId).toBeDefined();
    });

    const progressId = result.current.progressItems.find(
      (item) => item.jobId === 'job-to-cancel'
    )?.id;
    expect(progressId).toBeDefined();

    await act(async () => {
      await result.current.handleCancelBulkOperation(progressId);
    });

    expect(fileService.cancelBulkOperation).toHaveBeenCalledWith('job-to-cancel');
  });

  // ─── Bulk undo-command seam (options.onUndoable — useBulkOperations.md §2.6) ───

  describe('bulk undo-command seam (options.onUndoable)', () => {
    const undoableMoveResult = {
      status: 'completed',
      progress: 2,
      total: 2,
      results: [
        { sourceNodeId: 1, destinationParentNodeId: 99, status: 'succeeded' },
        { sourceNodeId: 2, destinationParentNodeId: 99, status: 'succeeded' },
      ],
      undo: { action_id: 77 },
    };

    function renderWithUndoable(options = {}) {
      const onUndoable = jest.fn();
      const { result } = renderHook(() =>
        useBulkOperations(
          new Set([1, 2]),
          defaultArgs[1],
          mockOnOperationComplete,
          mockSetTreeUpdateTrigger,
          undefined,
          mockSetSelectedFiles,
          mockSetSelectionMode,
          mockGetCurrentNodeId,
          { ...options, onUndoable }
        )
      );
      return { result, onUndoable };
    }

    it('routes a journaled MOVE terminal result to onUndoable exactly once with the move label', async () => {
      fileService.getBulkOperationStatus.mockResolvedValue(undoableMoveResult);
      const { result, onUndoable } = renderWithUndoable();

      act(() => {
        result.current.handleBulkMove();
      });
      await act(async () => {
        await result.current.handleFolderPickerSelect(99);
      });
      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      expect(onUndoable).toHaveBeenCalledTimes(1);
      const [payload, labelKey, params, meta] = onUndoable.mock.calls[0];
      expect(payload).toMatchObject({ undo: { action_id: 77 } });
      expect(labelKey).toBe('fileManager.bulkMoveToast');
      expect(params).toEqual({ count: 2 });
      expect(meta).toEqual({ action: 'move' });
    });

    it('routes a journaled COPY terminal result with the copy label', async () => {
      fileService.getBulkOperationStatus.mockResolvedValue(undoableMoveResult);
      const { result, onUndoable } = renderWithUndoable();

      act(() => {
        result.current.handleBulkCopy();
      });
      await act(async () => {
        await result.current.handleFolderPickerSelect(99);
      });
      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      expect(onUndoable).toHaveBeenCalledTimes(1);
      expect(onUndoable.mock.calls[0][1]).toBe('fileManager.bulkCopyToast');
      expect(onUndoable.mock.calls[0][3]).toEqual({ action: 'copy' });
    });

    it('fires for a cancelled job that still carries the journal pointer', async () => {
      fileService.getBulkOperationStatus.mockResolvedValue({
        ...undoableMoveResult,
        status: 'cancelled',
      });
      const { result, onUndoable } = renderWithUndoable();

      act(() => {
        result.current.handleBulkMove();
      });
      await act(async () => {
        await result.current.handleFolderPickerSelect(99);
      });
      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      expect(onUndoable).toHaveBeenCalledTimes(1);
    });

    it('stays silent when the terminal result carries no undo pointer (delete jobs / undo null)', async () => {
      fileService.getBulkOperationStatus.mockResolvedValue({
        ...undoableMoveResult,
        undo: null,
      });
      const { result, onUndoable } = renderWithUndoable();

      act(() => {
        result.current.handleBulkMove();
      });
      await act(async () => {
        await result.current.handleFolderPickerSelect(99);
      });
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      // plus the delete channel — never journaled at all
      fileService.batchDeleteFiles.mockResolvedValue({ jobId: 'job-del' });
      await act(async () => {
        await result.current.handleBulkDelete();
      });
      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      expect(onUndoable).not.toHaveBeenCalled();
    });

    it('never throws when the host passes no onUndoable and a journaled job lands', async () => {
      fileService.getBulkOperationStatus.mockResolvedValue(undoableMoveResult);
      const { result } = renderHook(() => useBulkOperations(...defaultArgs));

      act(() => {
        result.current.handleBulkMove();
      });
      await act(async () => {
        await result.current.handleFolderPickerSelect(99);
      });
      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      expect(mockOnOperationComplete).toHaveBeenCalledWith(
        expect.objectContaining({ opType: 'move' })
      );
    });
  });

  // -- §2.6.1 job-status failures (stalled / expired / cancel force-check) ------

  describe('§2.6.1 (unreadable job status)', () => {
    const advance = async (ms = 0) => {
      await act(async () => {
        jest.advanceTimersByTime(ms);
      });
    };

    async function startDelete(result) {
      await act(async () => {
        result.current.handleBulkDelete();
      });
      // The first read is scheduled on a 0 ms timer.
      await advance(0);
    }

    it('five consecutive read failures surface the stalled item and refresh the listing once', async () => {
      fileService.getBulkOperationStatus.mockRejectedValue(new Error('network down'));
      const { result } = renderHook(() => useBulkOperations(...defaultArgs));

      await startDelete(result);
      await advance(400);
      await advance(800);
      await advance(1600);
      await advance(3200);

      const item = result.current.progressItems.find((entry) => entry.type === 'delete');
      expect(item).toMatchObject({
        status: 'error',
        stalled: true,
        keepOnError: true,
        error: 'fileManager.bulkStatusUnavailable',
      });
      expect(mockOnOperationComplete).toHaveBeenCalledTimes(1);
      expect(mockOnOperationComplete).toHaveBeenCalledWith(
        expect.objectContaining({ opType: 'delete', startedNodeId: 0 })
      );

      // No auto-removal for a stalled item.
      await advance(30_000);
      expect(result.current.progressItems.some((entry) => entry.id === item.id)).toBe(true);
    });

    it('a 404 job-expired read lands in the same stalled state immediately (no retry)', async () => {
      const expired = Object.assign(new Error('not found'), { response: { status: 404 } });
      fileService.getBulkOperationStatus.mockRejectedValue(expired);
      const { result } = renderHook(() => useBulkOperations(...defaultArgs));

      await startDelete(result);

      expect(fileService.getBulkOperationStatus).toHaveBeenCalledTimes(1);
      const item = result.current.progressItems.find((entry) => entry.type === 'delete');
      expect(item).toMatchObject({ status: 'error', stalled: true });
      expect(mockOnOperationComplete).toHaveBeenCalledTimes(1);
    });

    it('a throwing notification cannot skip the terminal refresh', async () => {
      notifyRecentFilesChange.mockImplementationOnce(() => {
        throw new Error('notifier boom');
      });
      const { result } = renderHook(() => useBulkOperations(...defaultArgs));

      await act(async () => {
        result.current.handleBulkDelete();
      });
      await advance(500);

      expect(mockOnOperationComplete).toHaveBeenCalledTimes(1);
      expect(notifyRecentFilesChange).toHaveBeenCalled();
    });

    it('cancel forces one status read and completes through the normal terminal path', async () => {
      const { result } = renderHook(() => useBulkOperations(...defaultArgs));

      await act(async () => {
        result.current.handleBulkDelete();
      });
      const progressId = result.current.progressItems[0].id;

      await act(async () => {
        await result.current.handleCancelBulkOperation(progressId);
      });

      expect(fileService.cancelBulkOperation).toHaveBeenCalledWith('job-del');
      expect(mockOnOperationComplete).toHaveBeenCalledTimes(1);
      expect(result.current.progressItems[0].stalled).toBeUndefined();
    });

    it('a failed forced read after the cancel surfaces the stalled state (refresh included)', async () => {
      fileService.getBulkOperationStatus.mockRejectedValueOnce(new Error('status down'));
      const { result } = renderHook(() => useBulkOperations(...defaultArgs));

      await act(async () => {
        result.current.handleBulkDelete();
      });
      const progressId = result.current.progressItems[0].id;

      await act(async () => {
        await result.current.handleCancelBulkOperation(progressId);
      });

      expect(fileService.cancelBulkOperation).toHaveBeenCalledWith('job-del');
      expect(result.current.progressItems[0]).toMatchObject({
        status: 'error',
        stalled: true,
        error: 'fileManager.bulkStatusUnavailable',
      });
      expect(mockOnOperationComplete).toHaveBeenCalledTimes(1);
      expect(mockOnOperationComplete).toHaveBeenCalledWith(
        expect.objectContaining({ opType: 'delete' })
      );
    });
  });
});
