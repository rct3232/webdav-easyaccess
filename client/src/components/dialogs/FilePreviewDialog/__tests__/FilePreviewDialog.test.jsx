/**
 * FilePreviewDialog tests.
 * Consolidated from the legacy dialogs/__tests__/FilePreviewDialog.test.js (service-layer
 * mocks + real hooks) and the colocated smoke suite. Mocks the service layer so the real
 * hook logic (usePreviewLoader streaming-vs-blob, useGalleryNavigation index sync, header
 * truncation, Escape close) is exercised per docs/TESTING_STRATEGY.md black-box principle.
 * @see docs/spec/client/components/dialogs/FilePreviewDialog.md
 */

import React from 'react';
import { screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../test-utils';
import FilePreviewDialog from '../FilePreviewDialog';

jest.mock('plyr', () => {
  return function MockPlyr() {
    return {
      destroy: jest.fn(),
      toggleControls: jest.fn(),
    };
  };
});

jest.mock('react-i18next', () => {
  const { createI18nModuleMock } = require('../../../../testing/mocks/i18nMock');
  return {
    ...createI18nModuleMock(),
    initReactI18next: { type: '3rdParty' },
  };
});

jest.mock('../../../../hooks/useResponsive', () => {
  const { createUseResponsiveModuleMock } = require('../../../../testing/mocks/useResponsiveMock');
  return createUseResponsiveModuleMock();
});

jest.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({ children }) => <div data-testid="react-pdf-document">{children}</div>,
  Page: () => <div data-testid="react-pdf-page" />,
}));

jest.mock('../../../../services/fileService', () => {
  const { createFileServiceMock } = require('../../../../testing/mocks/serviceMocks');
  return createFileServiceMock({
    getFileBlob: (...args) => mockGetFileBlob(...args),
    getVideoPreviewStreamUrl: (...args) => mockGetVideoPreviewStreamUrl(...args),
    downloadFile: (...args) => mockDownloadFile(...args),
  });
});

const mockGetFileBlob = jest.fn();
const mockGetVideoPreviewStreamUrl = jest.fn();
const mockDownloadFile = jest.fn();
const onCloseMock = jest.fn();

const imageFile = {
  nodeId: 10,
  name: 'test.jpg',
  basename: 'test.jpg',
  path: '/test/path.jpg',
  type: 'file',
};
const videoFile = {
  nodeId: 20,
  name: 'video.mp4',
  basename: 'video.mp4',
  path: '/test/video.mp4',
  type: 'file',
};
const pdfFile = {
  nodeId: 30,
  name: 'doc.pdf',
  basename: 'doc.pdf',
  path: '/test/doc.pdf',
  type: 'file',
};
const unsupportedFile = {
  nodeId: 40,
  name: 'file.xyz',
  basename: 'file.xyz',
  path: '/test/file.xyz',
  type: 'file',
};

function renderDialog(file, extraProps = {}) {
  return renderWithProviders(
    <FilePreviewDialog
      open
      onClose={onCloseMock}
      file={file}
      mediaFiles={[]}
      shareToken={null}
      {...extraProps}
    />
  );
}

describe('FilePreviewDialog', () => {
  let originalScrollTo;

  beforeAll(() => {
    // JSDOM does not implement scrollTo on elements; PreviewThumbnailBar uses it.
    originalScrollTo = Element.prototype.scrollTo;
    // eslint-disable-next-line no-extend-native
    Element.prototype.scrollTo = () => {};
  });

  afterAll(() => {
    // eslint-disable-next-line no-extend-native
    Element.prototype.scrollTo = originalScrollTo;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.setItem('token', 'test-token');
    const blob = new Blob(['x'], { type: 'text/plain' });
    // Some test environments/polyfills do not provide Blob.text().
    if (typeof blob.text !== 'function') {
      // eslint-disable-next-line no-param-reassign
      blob.text = async () => 'x';
    }
    mockGetFileBlob.mockResolvedValue(blob);
    mockGetVideoPreviewStreamUrl.mockResolvedValue(
      '/api/files/preview-stream?path=%2Fv.mp4&ticket=t'
    );
  });

  it('returns null when file is not provided', () => {
    const { container } = renderWithProviders(
      <FilePreviewDialog open onClose={onCloseMock} file={null} mediaFiles={[]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog when open with file', async () => {
    const fileProps = {
      nodeId: 10,
      path: '/docs/readme.txt',
      basename: 'readme.txt',
      name: 'readme.txt',
      type: 'file',
    };
    renderDialog(fileProps);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('readme.txt')).toBeInTheDocument();
    // Wait for async preview loader to settle to avoid act warnings.
    await screen.findByText('x');
  });

  it('opens when open=true and closes on onClose click', async () => {
    const { container, rerender } = renderWithProviders(
      <FilePreviewDialog open={false} onClose={onCloseMock} file={imageFile} mediaFiles={[]} />
    );
    expect(container.querySelector('[data-testid="file-preview-dialog"]')).toBeNull();

    rerender(<FilePreviewDialog open onClose={onCloseMock} file={imageFile} mediaFiles={[]} />);
    expect(screen.getByTestId('file-preview-dialog')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    const closeButtons = screen.getAllByRole('button');
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(onCloseMock).toHaveBeenCalled();
  });

  it('calls onClose when Escape pressed', async () => {
    const user = userEvent.setup();
    renderDialog(imageFile);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    await user.keyboard('{Escape}');
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('shows CircularProgress while loading preview', async () => {
    let resolveBlob;
    mockGetFileBlob.mockReturnValue(
      new Promise((resolve) => {
        resolveBlob = resolve;
      })
    );

    renderDialog(imageFile);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    await act(async () => {
      resolveBlob(new Blob(['x'], { type: 'image/jpeg' }));
    });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(document.querySelector('img')).toBeInTheDocument();
  });

  it('renders ImagePreview for image files', async () => {
    renderDialog(imageFile);
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('file-preview-dialog')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeInTheDocument();
  });

  it('renders VideoPreview for video files', async () => {
    renderDialog(videoFile);
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    const dialogEl = screen.getByTestId('file-preview-dialog');
    expect(within(dialogEl).queryByTestId('react-pdf-document')).not.toBeInTheDocument();
    expect(document.querySelector('img')).not.toBeInTheDocument();
    expect(screen.queryByText('preview.notSupported')).not.toBeInTheDocument();
  });

  it('renders PdfPreview for PDF files', async () => {
    renderDialog(pdfFile);
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('file-preview-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('react-pdf-document')).toBeInTheDocument();
  });

  it('renders PreviewUnsupported for unsupported file types', async () => {
    renderDialog(unsupportedFile);
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('file-preview-dialog')).toBeInTheDocument();
    expect(screen.getByText('preview.notSupported')).toBeInTheDocument();
  });

  it('shows download button and calls downloadFile with nodeId', async () => {
    renderDialog(imageFile);
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    const downloadBtn = screen.getByTitle(/download/i);
    expect(downloadBtn).toBeInTheDocument();
    fireEvent.click(downloadBtn);
    expect(mockDownloadFile).toHaveBeenCalledWith(10, {
      fileName: 'test.jpg',
      shareToken: null,
    });
  });

  it('uses streaming URL (not blob) for video preview', async () => {
    renderDialog(videoFile);
    await waitFor(() => {
      expect(mockGetVideoPreviewStreamUrl).toHaveBeenCalledWith(20, expect.any(Object));
    });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(mockGetFileBlob).not.toHaveBeenCalled();
  });

  it('syncs gallery index from file.path (non-first) without locking to the first file', async () => {
    const mediaFiles = [
      { nodeId: 1, path: '/a.jpg', basename: 'a.jpg', name: 'a.jpg', type: 'file' },
      { nodeId: 2, path: '/b.jpg', basename: 'b.jpg', name: 'b.jpg', type: 'file' },
      { nodeId: 3, path: '/c.jpg', basename: 'c.jpg', name: 'c.jpg', type: 'file' },
    ];
    const openedFile = mediaFiles[1];

    renderDialog(openedFile, { mediaFiles });

    await waitFor(() => {
      expect(mockGetFileBlob).toHaveBeenCalledWith(2, expect.any(Object));
    });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  it('does not lock gallery index to 0 when mediaFiles arrives after open', async () => {
    const openedFile = {
      nodeId: 2,
      path: '/b.jpg',
      basename: 'b.jpg',
      name: 'b.jpg',
      type: 'file',
    };
    const mediaFilesLater = [
      { nodeId: 1, path: '/a.jpg', basename: 'a.jpg', name: 'a.jpg', type: 'file' },
      openedFile,
    ];

    const { rerender } = renderWithProviders(
      <FilePreviewDialog
        open
        onClose={onCloseMock}
        file={openedFile}
        mediaFiles={[]}
        shareToken={null}
      />
    );

    // Should not eagerly fall back to index 0 of mediaFiles (because mediaFiles is empty).
    await waitFor(() => {
      expect(mockGetFileBlob).toHaveBeenCalledWith(2, expect.any(Object));
    });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    rerender(
      <FilePreviewDialog
        open
        onClose={onCloseMock}
        file={openedFile}
        mediaFiles={mediaFilesLater}
        shareToken={null}
      />
    );

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    // Must have loaded b.jpg (opened file), never a.jpg (index 0)
    expect(mockGetFileBlob).toHaveBeenCalledWith(2, expect.any(Object));
    expect(mockGetFileBlob).not.toHaveBeenCalledWith(1, expect.any(Object));
  });

  it('truncates long header filename and shows tooltip on hover (desktop)', async () => {
    const user = userEvent.setup();
    const longName =
      'this-is-a-very-very-very-very-very-long-filename-for-preview-dialog-header.txt';

    renderWithProviders(
      <FilePreviewDialog
        open
        onClose={onCloseMock}
        file={{ ...imageFile, name: longName, basename: longName }}
        mediaFiles={[]}
        shareToken={null}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    // Truncated output should be rendered instead of the full name.
    expect(screen.queryByText(longName)).not.toBeInTheDocument();

    const truncatedEl = screen.getByText((content) => content.includes('...'));
    await user.hover(truncatedEl);

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(longName);
  });
});
