import { renderHook, act } from '@testing-library/react';
import { useFileOperations } from '../useFileOperations';
import * as fileService from '../../services/fileService';
import * as recentFiles from '../../utils/recentFiles';

jest.mock('../../services/fileService');
jest.mock('../../utils/recentFiles');

describe('useFileOperations', () => {
  const mockOnProgress = jest.fn();
  const mockOnActionComplete = jest.fn();
  const mockOnClose = jest.fn();

  const options = {
    onProgress: mockOnProgress,
    onActionComplete: mockOnActionComplete,
    onClose: mockOnClose,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handles file download for a file', async () => {
    const { result } = renderHook(() => useFileOperations(options));
    const file = { path: '/test.txt', type: 'file' };

    await act(async () => {
      await result.current.handleFileDownload(file);
    });

    expect(fileService.downloadFile).toHaveBeenCalledWith('/test.txt');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handles file rename', async () => {
    const { result } = renderHook(() => useFileOperations(options));
    const file = { path: '/old.txt', basename: 'old.txt', type: 'file' };
    fileService.renameFile.mockResolvedValue({ success: true });

    await act(async () => {
      await result.current.handleFileRename(file, 'new.txt');
    });

    expect(fileService.renameFile).toHaveBeenCalledWith('/old.txt', 'new.txt');
    expect(recentFiles.applyRecentFilesAfterRename).toHaveBeenCalled();
  });

});
