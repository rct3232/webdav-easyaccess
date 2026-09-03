/**
 * usePreviewLoader tests.
 * @see docs/spec/client/components/dialogs/FilePreviewDialog/hooks/usePreviewLoader.md
 * @see docs/TESTING_STRATEGY.md
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePreviewLoader } from '../usePreviewLoader';

jest.mock('../../../../../services/fileService', () => {
  const { createFileServiceMock } = require('../../../../../testing/mocks/serviceMocks');
  return createFileServiceMock();
});

import * as fileService from '../../../../../services/fileService';

const identityT = (key) => key;

const imageFile = {
  nodeId: 101,
  name: 'img.jpg',
  type: 'file',
};

function makeBaseProps(overrides = {}) {
  return {
    open: true,
    displayFile: imageFile,
    file: imageFile,
    t: identityT,
    ...overrides,
  };
}

describe('usePreviewLoader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    URL.createObjectURL = jest.fn(() => 'blob:mock-preview');
    URL.revokeObjectURL = jest.fn();
  });

  it('clears loading on a successful image load', async () => {
    const { result } = renderHook(() => usePreviewLoader(makeBaseProps()));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.previewUrl).toBeDefined();
  });

  it('resolves a transport timeout to an error instead of spinning forever', async () => {
    // httpClient converts its own timeout into Error with code ECONNABORTED
    // while the caller signal is NOT aborted. This must resolve to an error.
    const timeoutError = new Error('timeout');
    timeoutError.code = 'ECONNABORTED';
    fileService.getFileBlob.mockRejectedValueOnce(timeoutError);

    const { result } = renderHook(() => usePreviewLoader(makeBaseProps()));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('preview.loadFail');
  });

  it('surfaces a server connection-class errorCode via the friendly mapping', async () => {
    fileService.getFileBlob.mockRejectedValueOnce({
      response: {
        data: { errorCode: 'serverErrors.webdav.connectionRefused' },
      },
    });

    const { result } = renderHook(() => usePreviewLoader(makeBaseProps()));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('files.storageUnavailable');
  });

  it('keeps a generic error message when the server responds without an errorCode', async () => {
    fileService.getFileBlob.mockRejectedValueOnce({
      response: { data: { error: 'boom' } },
    });

    const { result } = renderHook(() => usePreviewLoader(makeBaseProps()));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('preview.loadFail');
  });

  it('silently ignores an abort of a superseded request and loads the new file', async () => {
    const nextFile = { nodeId: 202, name: 'next.jpg', type: 'file' };
    let rejectFirst;

    fileService.getFileBlob
      .mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            rejectFirst = reject;
          })
      )
      .mockImplementationOnce(() => Promise.resolve(new Blob(['next']), { type: 'image/jpeg' }));

    const { result, rerender } = renderHook((props) => usePreviewLoader(props), {
      initialProps: makeBaseProps(),
    });

    // Switch files while the first request is still pending → cleanup aborts it.
    act(() => {
      rerender(
        makeBaseProps({
          displayFile: nextFile,
          file: nextFile,
        })
      );
    });

    // Reject the superseded request after abort; it must NOT surface an error.
    await act(async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      abortError.code = 'ECONNABORTED';
      rejectFirst(abortError);
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.previewUrl).toBeDefined();
  });
});
