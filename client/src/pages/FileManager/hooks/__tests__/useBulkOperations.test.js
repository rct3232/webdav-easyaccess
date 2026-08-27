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
  [{ nodeId: 1, type: 'file', basename: 'file1.txt' }, { nodeId: 2, type: 'file', basename: 'file2.txt' }],
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
    fileService.batchDeleteFiles.mockResolvedValue({ jobId: 'job-del' });
    fileService.batchMoveFiles.mockResolvedValue({ jobId: 'job-move' });
    fileService.batchCopyFiles.mockResolvedValue({ jobId: 'job-copy' });
    fileService.downloadMultipleFiles.mockResolvedValue({});
    fileService.checkConflicts.mockResolvedValue([]);
    fileService.getBulkOperationStatus.mockImplementation((jobId) =>
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

    expect(fileService.batchDeleteFiles).toHaveBeenCalledWith(
      expect.arrayContaining([1, 2])
    );

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

    expect(onConfirm).toHaveBeenCalledWith(
      expect.arrayContaining([1, 2])
    );
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
    expect(fileService.batchMoveFiles).toHaveBeenCalledWith(
      expect.any(Array),
      'error'
    );

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
    expect(fileService.batchCopyFiles).toHaveBeenCalledWith(
      expect.any(Array),
      'error'
    );

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

    expect(fileService.batchMoveFiles).toHaveBeenCalledWith(
      expect.any(Array),
      'overwrite'
    );

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
});
