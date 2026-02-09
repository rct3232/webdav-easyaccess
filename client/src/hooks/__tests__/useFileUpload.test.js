import { renderHook, act } from '@testing-library/react';
import { useFileUpload } from '../useFileUpload';
import * as fileService from '../../services/fileService';

jest.mock('../../services/fileService');

describe('useFileUpload', () => {
  const mockUpdateProgress = jest.fn();
  const mockOnOperationComplete = jest.fn();

  const options = {
    updateProgress: mockUpdateProgress,
    onOperationComplete: mockOnOperationComplete,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handles file upload start', async () => {
    const { result } = renderHook(() => useFileUpload(options));
    const files = [new File(['content'], 'test.txt', { type: 'text/plain' })];
    
    fileService.listFiles.mockResolvedValue([]);
    fileService.uploadFile.mockResolvedValue({ success: true });

    await act(async () => {
      await result.current.handleUploadStart(files, '/path');
    });

    expect(fileService.uploadFile).toHaveBeenCalled();
    expect(mockUpdateProgress).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      progress: 1,
      total: 1
    }));
    expect(mockOnOperationComplete).toHaveBeenCalled();
  });

  it('handles duplicate file error during start', async () => {
    const { result } = renderHook(() => useFileUpload(options));
    const files = [new File(['content'], 'test.txt', { type: 'text/plain' })];
    
    // File already exists
    fileService.listFiles.mockResolvedValue([{ basename: 'test.txt' }]);

    await act(async () => {
      await result.current.handleUploadStart(files, '/path', 'error');
    });

    expect(fileService.uploadFile).not.toHaveBeenCalled();
    expect(mockUpdateProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      keepOnError: true,
    }));
  });

  it('handles upload cancellation', async () => {
    const { result } = renderHook(() => useFileUpload(options));
    const files = [new File(['content'], 'test.txt', { type: 'text/plain' })];
    
    fileService.listFiles.mockResolvedValue([]);
    fileService.uploadFile.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));

    let uploadPromise;
    await act(async () => {
      uploadPromise = result.current.handleUploadStart(files, '/path');
    });

    const progressId = mockUpdateProgress.mock.calls[0][0].id;

    act(() => {
      result.current.handleCancelAllUpload(progressId, [{ id: progressId, fileItems: [{ fileName: 'test.txt', status: 'uploading' }] }]);
    });

    await uploadPromise;

    expect(mockUpdateProgress).toHaveBeenCalledWith(expect.objectContaining({
      status: 'warning',
      error: '업로드가 취소되었습니다.'
    }));
  });
});
