/**
 * useFileOperations tests.
 * @see docs/spec/client/hooks/useFileOperations.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileOperations } from '../useFileOperations';

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

const mockOnProgress = jest.fn();
const mockOnClose = jest.fn();
const mockOnActionComplete = jest.fn();
const mockSetProcessingMap = jest.fn();
const mockOnProcessingStart = jest.fn();
const mockOnProcessingEnd = jest.fn();

describe('useFileOperations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fileService.downloadFile.mockResolvedValue();
    fileService.downloadMultipleFiles.mockResolvedValue({});
    fileService.renameFile.mockResolvedValue({ messageCode: 'serverMessages.files.renameSuccess', nodeId: 1, newName: 'new.pdf' });
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
    const file = { nodeId: 1, basename: 'file.txt', type: 'file' };
    const { result } = renderHook(() =>
      useFileOperations({ onClose: mockOnClose })
    );

    await act(async () => {
      await result.current.handleFileDownload(file);
    });

    expect(fileService.downloadFile).toHaveBeenCalledWith(1, { fileName: 'file.txt' });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handleFileDownload for directory calls downloadMultipleFiles and onClose on success', async () => {
    const file = { nodeId: 2, basename: 'folder', type: 'directory' };
    const { result } = renderHook(() =>
      useFileOperations({ onClose: mockOnClose, onProgress: mockOnProgress })
    );

    await act(async () => {
      await result.current.handleFileDownload(file);
    });

    expect(fileService.downloadMultipleFiles).toHaveBeenCalledWith(
      [2],
      expect.any(Function)
    );
    expect(mockOnProgress).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handleFileDownload on API failure does not call onClose', async () => {
    fileService.downloadFile.mockRejectedValue(new Error('Network error'));
    const file = { nodeId: 1, basename: 'file.txt', type: 'file' };
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
    const file = { nodeId: 1, basename: 'file.txt', type: 'file' };
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
    const file = { nodeId: 1, basename: 'doc.pdf', type: 'file' };
    const { result } = renderHook(() =>
      useFileOperations({ onClose: mockOnClose })
    );

    await act(async () => {
      await result.current.handleFileRename(file, 'new.pdf');
    });

    expect(fileService.renameFile).toHaveBeenCalledWith(1, 'new.pdf');
    expect(notifyRecentFilesChange).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handleFileRename calls onActionComplete on success', async () => {
    const file = { nodeId: 1, basename: 'doc.pdf', type: 'file' };
    const { result } = renderHook(() =>
      useFileOperations({ onClose: mockOnClose, onActionComplete: mockOnActionComplete })
    );

    await act(async () => {
      await result.current.handleFileRename(file, 'new.pdf', { startedNodeId: 5 });
    });

    expect(mockOnActionComplete).toHaveBeenCalledWith({
      opType: 'rename',
      startedNodeId: 5,
    });
  });

  it('handleFileRename with onProgress updates progress', async () => {
    const file = { nodeId: 1, basename: 'doc.pdf', type: 'file' };
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
    const file = { nodeId: 1, basename: 'doc.pdf', type: 'file' };
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
    const file = { nodeId: 1, basename: 'doc.pdf', type: 'file' };
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
    const file = { nodeId: 1, basename: 'doc.pdf', type: 'file' };
    const { result } = renderHook(() =>
      useFileOperations({
        setProcessingMap: mockSetProcessingMap,
        onClose: mockOnClose,
      })
    );

    await act(async () => {
      await result.current.handleFileRename(file, 'new.pdf');
    });

    expect(fileService.renameFile).toHaveBeenCalledWith(1, 'new.pdf');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handleFileRename keeps success UX when recent-file refresh unexpectedly throws', async () => {
    notifyRecentFilesChange.mockImplementationOnce(() => {
      throw new Error('unexpected recent sync failure');
    });
    const file = { nodeId: 1, basename: 'doc.pdf', type: 'file' };
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useFileOperations({ onClose: mockOnClose, onActionComplete: mockOnActionComplete })
    );

    await act(async () => {
      await result.current.handleFileRename(file, 'new.pdf', { startedNodeId: 5 });
    });

    expect(fileService.renameFile).toHaveBeenCalledWith(1, 'new.pdf');
    expect(mockOnClose).toHaveBeenCalled();
    expect(mockOnActionComplete).toHaveBeenCalledWith({
      opType: 'rename',
      startedNodeId: 5,
    });

    consoleErrorSpy.mockRestore();
  });
});
