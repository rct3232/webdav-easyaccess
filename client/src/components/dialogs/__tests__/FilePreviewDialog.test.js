/**
 * FilePreviewDialog tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/dialogs/FilePreviewDialog.md
 * Uses MSW for getFileBlob (files/download); react-pdf mocked in setupTests.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import FilePreviewDialog from '../FilePreviewDialog/index';

const mockGetFileBlob = jest.fn();
const mockGetVideoPreviewStreamUrl = jest.fn();
const mockDownloadFile = jest.fn();

jest.mock('../../../services/fileService', () => ({
  getFileBlob: (...args) => mockGetFileBlob(...args),
  getVideoPreviewStreamUrl: (...args) => mockGetVideoPreviewStreamUrl(...args),
  downloadFile: (...args) => mockDownloadFile(...args),
}));

jest.mock('plyr', () => {
  return function MockPlyr() {
    return {
      destroy: jest.fn(),
      toggleControls: jest.fn(),
    };
  };
});

jest.mock('../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false }),
}));

const fileProps = {
  path: '/docs/readme.txt',
  basename: 'readme.txt',
  name: 'readme.txt',
  type: 'file',
};

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  file: fileProps,
};

describe('FilePreviewDialog', () => {
  let originalGetContext;

  beforeAll(() => {
    // JSDOM throws for canvas.getContext unless a canvas implementation is installed.
    // Our string utils fallback when context is null, so force null for stable tests.
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => null,
    });
  });

  afterAll(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: originalGetContext,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.setItem('token', 'test-token');
    mockGetFileBlob.mockResolvedValue(new Blob(['x']));
    mockGetVideoPreviewStreamUrl.mockResolvedValue('/api/files/preview-stream?path=%2Fv.mp4&ticket=t');
  });

  it('returns null when file is not provided', () => {
    const { container } = renderWithProviders(
      <FilePreviewDialog {...defaultProps} file={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog when open with file', async () => {
    renderWithProviders(<FilePreviewDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('readme.txt')).toBeInTheDocument();
  });

  it('calls onClose when Escape pressed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FilePreviewDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    await user.keyboard('{Escape}');
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows loading state initially', () => {
    renderWithProviders(<FilePreviewDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows download button', async () => {
    renderWithProviders(<FilePreviewDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByTitle(/download/i)).toBeInTheDocument();
  });

  it('uses streaming URL (not blob) for video preview', async () => {
    const videoFile = { path: '/v.mp4', basename: 'v.mp4', name: 'v.mp4', type: 'file' };
    renderWithProviders(<FilePreviewDialog {...defaultProps} file={videoFile} />);

    await waitFor(() => {
      expect(mockGetVideoPreviewStreamUrl).toHaveBeenCalledWith('/v.mp4', expect.any(Object));
    });
    expect(mockGetFileBlob).not.toHaveBeenCalled();
  });

  it('truncates long header filename and shows tooltip on hover (desktop)', async () => {
    const user = userEvent.setup();
    const longName = 'this-is-a-very-very-very-very-very-long-filename-for-preview-dialog-header.txt';

    renderWithProviders(
      <FilePreviewDialog
        {...defaultProps}
        file={{ ...fileProps, name: longName, basename: longName }}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Truncated output should be rendered instead of the full name.
    expect(screen.queryByText(longName)).not.toBeInTheDocument();

    const truncatedEl = screen.getByText((content) => content.includes('...'));
    await user.hover(truncatedEl);

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(longName);
  });
});
