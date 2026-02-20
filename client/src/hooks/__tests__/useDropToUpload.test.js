/**
 * useDropToUpload tests.
 * @see docs/spec/client/hooks/useDropToUpload.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDropToUpload } from '../useDropToUpload';

describe('useDropToUpload', () => {
  it('returns isDraggingOver, uploadProgress, handlers in main mode', () => {
    const { result } = renderHook(() => useDropToUpload({}));

    expect(typeof result.current.isDraggingOver).toBe('boolean');
    expect(result.current.isDraggingOver).toBe(false);
    expect(Array.isArray(result.current.uploadProgress)).toBe(true);
    expect(typeof result.current.handleDragEnter).toBe('function');
    expect(typeof result.current.handleDragOver).toBe('function');
    expect(typeof result.current.handleDragLeave).toBe('function');
    expect(typeof result.current.handleDrop).toBe('function');
    expect(typeof result.current.reset).toBe('function');
  });

  it('returns folder-specific handlers in folder mode', () => {
    const onExplorerDrop = jest.fn();
    const { result } = renderHook(() =>
      useDropToUpload({ path: '/docs', onExplorerDrop })
    );

    expect(typeof result.current.isDropTarget).toBe('boolean');
    expect(typeof result.current.handleFolderDragEnter).toBe('function');
    expect(typeof result.current.handleFolderDragOver).toBe('function');
    expect(typeof result.current.handleFolderDragLeave).toBe('function');
    expect(typeof result.current.handleFolderDrop).toBe('function');
  });

  it('handleDragEnter sets isDraggingOver to true', () => {
    const { result } = renderHook(() => useDropToUpload({}));

    const e = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer: { types: ['Files'] },
    };

    act(() => {
      result.current.handleDragEnter(e);
    });

    expect(result.current.isDraggingOver).toBe(true);
  });

  it('handleDragLeave clears isDraggingOver when leaving element', () => {
    const { result } = renderHook(() => useDropToUpload({}));

    act(() => {
      result.current.handleDragEnter({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        dataTransfer: { types: ['Files'] },
      });
    });
    expect(result.current.isDraggingOver).toBe(true);

    act(() => {
      result.current.handleDragLeave({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        currentTarget: { contains: () => false },
        relatedTarget: null,
      });
    });

    expect(result.current.isDraggingOver).toBe(false);
  });

  it('handleDrop updates uploadProgress when progressUpdater is called', async () => {
    const mockUploadCallback = jest.fn().mockImplementation((files, path, progressUpdater) => {
      progressUpdater([
        { id: '1', name: 'a.txt', status: 'processing', progress: 50 },
      ]);
      return Promise.resolve();
    });

    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    const dataTransfer = {
      items: [
        {
          kind: 'file',
          getAsFile: () => file,
          webkitGetAsEntry: undefined,
          getAsEntry: undefined,
        },
      ],
      getData: () => '',
    };

    const { result } = renderHook(() => useDropToUpload({}));

    await act(async () => {
      await result.current.handleDrop(
        {
          preventDefault: jest.fn(),
          stopPropagation: jest.fn(),
          dataTransfer,
        },
        '/path',
        mockUploadCallback
      );
    });

    await waitFor(() => {
      expect(result.current.uploadProgress).toEqual([
        expect.objectContaining({
          id: '1',
          name: 'a.txt',
          status: 'processing',
          progress: 50,
        }),
      ]);
    });
  });

  it('handleDrop with files calls onUploadComplete and uploadCallback', async () => {
    jest.useFakeTimers();
    const onUploadComplete = jest.fn();
    const mockUploadCallback = jest.fn().mockResolvedValue();

    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    const dataTransfer = {
      items: [
        {
          kind: 'file',
          getAsFile: () => file,
          webkitGetAsEntry: undefined,
          getAsEntry: undefined,
        },
      ],
      getData: () => '',
    };

    const { result } = renderHook(() =>
      useDropToUpload({ onUploadComplete })
    );

    const e = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer,
    };

    await act(async () => {
      await result.current.handleDrop(e, '/path', mockUploadCallback);
    });

    expect(mockUploadCallback).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ file, relativePath: 'test.txt' })]),
      '/path',
      expect.any(Function)
    );
    expect(onUploadComplete).toHaveBeenCalledWith(1);

    jest.useRealTimers();
  });

  it('handleDrop on error calls onUploadError', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onUploadError = jest.fn();
    const mockUploadCallback = jest.fn().mockRejectedValue(new Error('Upload failed'));

    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    const dataTransfer = {
      items: [{ kind: 'file', getAsFile: () => file, webkitGetAsEntry: undefined, getAsEntry: undefined }],
      getData: () => '',
    };

    const { result } = renderHook(() =>
      useDropToUpload({ onUploadError })
    );

    const e = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer,
    };

    await act(async () => {
      await result.current.handleDrop(e, '/path', mockUploadCallback);
    });

    expect(onUploadError).toHaveBeenCalledWith(expect.any(Error));
    consoleErrorSpy.mockRestore();
  });

  it('folder mode with isDisabled does not set isDraggingOver on drag enter', () => {
    const onExplorerDrop = jest.fn();
    const { result } = renderHook(() =>
      useDropToUpload({ path: '/docs', onExplorerDrop, isDisabled: true })
    );

    const e = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer: { types: ['Files'] },
    };

    act(() => {
      result.current.handleFolderDragEnter(e);
    });

    expect(result.current.isDraggingOver).toBe(false);
  });

  it('folder mode with !hasWritePermission does not set isDraggingOver on drag enter', () => {
    const onExplorerDrop = jest.fn();
    const { result } = renderHook(() =>
      useDropToUpload({ path: '/docs', onExplorerDrop, hasWritePermission: false })
    );

    const e = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer: { types: ['Files'] },
    };

    act(() => {
      result.current.handleFolderDragEnter(e);
    });

    expect(result.current.isDraggingOver).toBe(false);
  });

  it('folder mode handleFolderDrop calls onExplorerDrop with files', async () => {
    const onExplorerDrop = jest.fn().mockResolvedValue();
    const file = new File(['x'], 'doc.txt', { type: 'text/plain' });
    const dataTransfer = {
      types: ['Files'],
      items: [{ kind: 'file', getAsFile: () => file, webkitGetAsEntry: undefined, getAsEntry: undefined }],
      getData: () => '',
    };

    const { result } = renderHook(() =>
      useDropToUpload({ path: '/docs', onExplorerDrop })
    );

    const e = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer,
    };

    await act(async () => {
      await result.current.handleFolderDrop(e);
    });

    expect(onExplorerDrop).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ file, relativePath: 'doc.txt' })]),
      '/docs',
      expect.any(Function)
    );
  });

  it('reset clears isDraggingOver and uploadProgress', () => {
    const { result } = renderHook(() => useDropToUpload({}));

    act(() => {
      result.current.handleDragEnter({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        dataTransfer: { types: ['Files'] },
      });
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.isDraggingOver).toBe(false);
  });
});
