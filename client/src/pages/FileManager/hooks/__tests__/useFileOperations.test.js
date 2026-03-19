/**
 * useFileOperations tests.
 * @see docs/spec/client/hooks/useFileOperations.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileOperations } from '../useFileOperations';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

jest.mock('../../../../services/fileService', () => ({
  downloadFile: jest.fn(),
  downloadMultipleFiles: jest.fn(),
  renameFile: jest.fn(),
}));

jest.mock('../../../../services/recentFilesRepository', () => ({
  applyRecentFilesAfterRename: jest.fn(),
}));

import * as fileService from '../../../../services/fileService';
import * as recentFilesRepository from '../../../../services/recentFilesRepository';

const mockOnProgress = jest.fn();
const mockOnClose = jest.fn();
const mockOnActionComplete = jest.fn();
const mockSetProcessingMap = jest.fn();
const mockOnProcessingStart = jest.fn();
const mockOnProcessingEnd = jest.fn();

describe('useFileOperations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    fileService.downloadFile.mockResolvedValue();
    fileService.downloadMultipleFiles.mockResolvedValue({});
    fileService.renameFile.mockResolvedValue();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns handleFileDownload and handleFileRename', () => {
    const { result } = renderHook(() => useFileOperations({}));

    expect(typeof result.current.handleFileDownload).toBe('function');
    expect(typeof result.current.handleFileRename).toBe('function');
  });

  it('handleFileDownload for file calls downloadFile and onClose on success', async () => {
    const file = { path: '/file.txt', basename: 'file.txt', type: 'file' };
    const { result } = renderHook(() =>
      useFileOperations({ onClose: mockOnClose })
    );

    await act(async () => {
      await result.current.handleFileDownload(file);
    });

    expect(fileService.downloadFile).toHaveBeenCalledWith('/file.txt', { fileName: 'file.txt' });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handleFileDownload for directory calls downloadMultipleFiles and onClose on success', async () => {
    const file = { path: '/folder', basename: 'folder', type: 'directory' };
    const { result } = renderHook(() =>
      useFileOperations({ onClose: mockOnClose, onProgress: mockOnProgress })
    );

    await act(async () => {
      await result.current.handleFileDownload(file);
    });

    expect(fileService.downloadMultipleFiles).toHaveBeenCalledWith(
      ['/folder'],
      expect.any(Function)
    );
    expect(mockOnProgress).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handleFileDownload on API failure does not call onClose', async () => {
    fileService.downloadFile.mockRejectedValue(new Error('Network error'));
    const file = { path: '/file.txt', basename: 'file.txt', type: 'file' };
    const { result } = renderHook(() =>
      useFileOperations({ onClose: mockOnClose, onProgress: mockOnProgress })
    );

    await act(async () => {
      await result.current.handleFileDownload(file).catch(() => {});
    });

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('handleFileDownload on failure with onProgress calls onProgress with status error', async () => {
    fileService.downloadFile.mockRejectedValue(new Error('Download failed'));
    const file = { path: '/file.txt', basename: 'file.txt', type: 'file' };
    const { result } = renderHook(() =>
      useFileOperations({ onClose: mockOnClose, onProgress: mockOnProgress })
    );

    await act(async () => {
      await result.current.handleFileDownload(file).catch(() => {});
    });

    expect(mockOnClose).not.toHaveBeenCalled();
    expect(mockOnProgress).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' })
    );
  });

  it('handleFileRename calls renameFile and onClose on success', async () => {
    const file = { path: '/doc.pdf', basename: 'doc.pdf', type: 'file' };
    const { result } = renderHook(() =>
      useFileOperations({ onClose: mockOnClose })
    );

    await act(async () => {
      await result.current.handleFileRename(file, 'new.pdf');
    });

    expect(fileService.renameFile).toHaveBeenCalledWith('/doc.pdf', 'new.pdf');
    expect(recentFilesRepository.applyRecentFilesAfterRename).toHaveBeenCalledWith(
      '/doc.pdf',
      '/new.pdf',
      expect.objectContaining({ name: 'new.pdf', basename: 'new.pdf' })
    );
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handleFileRename calls onActionComplete on success', async () => {
    const file = { path: '/doc.pdf', basename: 'doc.pdf', type: 'file' };
    const { result } = renderHook(() =>
      useFileOperations({ onClose: mockOnClose, onActionComplete: mockOnActionComplete })
    );

    await act(async () => {
      await result.current.handleFileRename(file, 'new.pdf', { startedPath: '/folder' });
    });

    expect(mockOnActionComplete).toHaveBeenCalledWith({
      opType: 'rename',
      startedPath: '/folder',
    });
  });

  it('handleFileRename with onProgress updates progress', async () => {
    const file = { path: '/doc.pdf', basename: 'doc.pdf', type: 'file' };
    const { result } = renderHook(() =>
      useFileOperations({ onProgress: mockOnProgress })
    );

    await act(async () => {
      await result.current.handleFileRename(file, 'new.pdf');
    });

    expect(mockOnProgress).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'rename', status: 'preparing' })
    );
    expect(mockOnProgress).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'processing' })
    );
    expect(mockOnProgress).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('handleFileRename on API failure does not call onClose', async () => {
    fileService.renameFile.mockRejectedValue(new Error('Rename failed'));
    const file = { path: '/doc.pdf', basename: 'doc.pdf', type: 'file' };
    const { result } = renderHook(() =>
      useFileOperations({ onClose: mockOnClose, onProgress: mockOnProgress })
    );

    await act(async () => {
      await result.current.handleFileRename(file, 'new.pdf').catch(() => {});
    });

    expect(mockOnClose).not.toHaveBeenCalled();
    expect(mockOnProgress).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' })
    );
  });

  it('handleFileRename with empty newName reports validation error via onProgress', async () => {
    const file = { path: '/doc.pdf', basename: 'doc.pdf', type: 'file' };
    const { result } = renderHook(() =>
      useFileOperations({ onProgress: mockOnProgress })
    );

    await act(async () => {
      await result.current.handleFileRename(file, '   ');
    });

    expect(fileService.renameFile).not.toHaveBeenCalled();
    expect(mockOnProgress).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', type: 'rename' })
    );
  });

  it('handleFileRename succeeds when setProcessingMap provided', async () => {
    const file = { path: '/doc.pdf', basename: 'doc.pdf', type: 'file' };
    const { result } = renderHook(() =>
      useFileOperations({
        setProcessingMap: mockSetProcessingMap,
        onClose: mockOnClose,
      })
    );

    await act(async () => {
      await result.current.handleFileRename(file, 'new.pdf');
    });

    expect(fileService.renameFile).toHaveBeenCalledWith('/doc.pdf', 'new.pdf');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handleFileRename keeps success UX when recent-file sync unexpectedly throws', async () => {
    recentFilesRepository.applyRecentFilesAfterRename.mockImplementationOnce(() => {
      throw new Error('unexpected recent sync failure');
    });
    const file = { path: '/doc.pdf', basename: 'doc.pdf', type: 'file' };
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useFileOperations({ onClose: mockOnClose, onActionComplete: mockOnActionComplete })
    );

    await act(async () => {
      await result.current.handleFileRename(file, 'new.pdf', { startedPath: '/folder' });
    });

    expect(fileService.renameFile).toHaveBeenCalledWith('/doc.pdf', 'new.pdf');
    expect(mockOnClose).toHaveBeenCalled();
    expect(mockOnActionComplete).toHaveBeenCalledWith({
      opType: 'rename',
      startedPath: '/folder',
    });

    consoleErrorSpy.mockRestore();
  });
});
