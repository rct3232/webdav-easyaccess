import { renderHook, act } from '@testing-library/react';
import { useBulkOperations } from '../useBulkOperations';
import * as fileService from '../../services/fileService';
import { useFileOperationProgress } from '../useFileOperationProgress';

jest.mock('../../services/fileService');
jest.mock('../useFileOperationProgress');

describe('useBulkOperations', () => {
  const mockUpdateProgress = jest.fn();
  const mockSetSelectedFiles = jest.fn();
  const mockSetSelectionMode = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useFileOperationProgress.mockReturnValue({
      progressItems: [],
      updateProgress: mockUpdateProgress,
    });
  });

  it('opens folder picker for bulk move', () => {
    const { result } = renderHook(() => useBulkOperations(
      new Set(['/f1', '/f2']),
      [],
      null, null, null, mockSetSelectedFiles, mockSetSelectionMode, () => '/'
    ));

    act(() => {
      result.current.handleBulkMove();
    });

    expect(result.current.folderPickerOpen).toBe(true);
    expect(result.current.folderPickerAction).toBe('move');
  });

  it('handles bulk delete', async () => {
    const { result } = renderHook(() => useBulkOperations(
      new Set(['/f1', '/f2']),
      [],
      null, null, null, mockSetSelectedFiles, mockSetSelectionMode, () => '/'
    ));

    fileService.batchDeleteFiles.mockResolvedValue({ succeeded: ['/f1', '/f2'], failed: [], skipped: [] });

    await act(async () => {
      await result.current.handleBulkDelete();
    });

    expect(fileService.batchDeleteFiles).toHaveBeenCalledWith(['/f1', '/f2']);
    expect(mockUpdateProgress).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed'
    }));
  });

  it('handles bulk download', async () => {
    const { result } = renderHook(() => useBulkOperations(
      new Set(['/f1', '/f2']),
      [],
      null, null, null, mockSetSelectedFiles, mockSetSelectionMode, () => '/'
    ));

    fileService.downloadMultipleFiles.mockResolvedValue({ success: true });

    await act(async () => {
      await result.current.handleBulkDownload();
    });

    expect(fileService.downloadMultipleFiles).toHaveBeenCalledWith(['/f1', '/f2'], expect.any(Function));
  });
});
