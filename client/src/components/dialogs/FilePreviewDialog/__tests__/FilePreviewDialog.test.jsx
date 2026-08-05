jest.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({ children }) => <div data-testid="react-pdf-document">{children}</div>,
  Page: ({ children }) => <div data-testid="react-pdf-page">{children}</div>,
}));

jest.mock('../../../../hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty' },
}));

jest.mock('../hooks/usePreviewLoader', () => ({
  usePreviewLoader: () => ({
    loading: false,
    error: null,
    previewUrl: 'https://example.com/preview',
    previewBlob: null,
    textContent: null,
  }),
}));

jest.mock('../hooks/useUIVisibility', () => ({
  useUIVisibility: () => ({
    headerVisible: true,
    controlsVisible: true,
    setHeaderVisible: () => {},
    startHideTimer: () => {},
    clearHideTimer: () => {},
    resetHideTimer: () => {},
  }),
}));

jest.mock('../hooks/useGalleryNavigation', () => ({
  useGalleryNavigation: () => ({
    currentMediaIndex: 0,
    setCurrentMediaIndex: () => {},
    currentDisplayFile: null,
    currentPreviewFileType: null,
    goPrev: () => {},
    goNext: () => {},
    handleTouchStart: () => {},
    handleTouchEnd: () => {},
    touchStartX: 0,
    touchStartedOnPlyrControls: false,
  }),
}));

jest.mock('../hooks/usePlyrPlayer', () => ({
  usePlyrPlayer: () => ({
    videoNotPlayable: false,
    audioContainerRef: null,
    videoContainerRef: null,
    mediaTouchRef: null,
  }),
}));

jest.mock('../hooks/usePdfLayout', () => ({
  usePdfLayout: () => ({
    pdfContainerRef: { current: null },
    pageArray: [1],
    calculatedWidth: 800,
    pageInfo: null,
    setNumPages: () => {},
    setPageInfo: () => {},
  }),
}));

jest.mock('../hooks/useHeaderTruncation', () => ({
  useHeaderTruncation: () => ({
    titleRowRef: { current: null },
    actionsRef: { current: null },
    textContainerRef: { current: null },
    textPreRef: { current: null },
    truncatedHeaderName: 'test.jpg',
    isHeaderTruncated: false,
    textOverflows: false,
    originalHeaderName: 'test.jpg',
  }),
}));

jest.mock('../hooks/usePreviewZoom', () => ({
  usePreviewZoom: () => ({
    zoom: 1,
    zoomIn: () => {},
    zoomOut: () => {},
    resetZoom: () => {},
    setZoom: () => {},
  }),
}));

jest.mock('../hooks/useZoomInputs', () => ({
  useZoomInputs: () => {},
}));

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FilePreviewDialog from '../FilePreviewDialog';
import * as fileService from '../../../../services/fileService';

const downloadFileMock = jest.spyOn(fileService, 'downloadFile').mockImplementation(jest.fn());
const onCloseMock = jest.fn();

beforeEach(() => {
  downloadFileMock.mockReset();
  onCloseMock.mockReset();
});

const imageFile = { nodeId: 10, name: 'test.jpg', basename: 'test.jpg', path: '/test/path.jpg' };
const videoFile = { nodeId: 20, name: 'video.mp4', basename: 'video.mp4', path: '/test/video.mp4' };
const pdfFile = { nodeId: 30, name: 'doc.pdf', basename: 'doc.pdf', path: '/test/doc.pdf' };
const unsupportedFile = { nodeId: 40, name: 'file.xyz', basename: 'file.xyz', path: '/test/file.xyz' };

function renderDialog(file, extraProps = {}) {
  return render(
    <FilePreviewDialog
      open
      onClose={onCloseMock}
      file={file}
      mediaFiles={[]}
      shareToken={null}
      onThumbnailsLoaded={undefined}
      hideCloseButton={false}
      {...extraProps}
    />
  );
}

describe('FilePreviewDialog', () => {
  it('opens when open=true and closes on onClose click', () => {
    const { container, rerender } = render(
      <FilePreviewDialog
        open={false}
        onClose={onCloseMock}
        file={imageFile}
        mediaFiles={[]}
      />
    );
    expect(container.querySelector('[data-testid="file-preview-dialog"]')).toBeNull();

    rerender(
      <FilePreviewDialog
        open
        onClose={onCloseMock}
        file={imageFile}
        mediaFiles={[]}
      />
    );
    expect(screen.getByTestId('file-preview-dialog')).toBeInTheDocument();

    const closeButtons = screen.getAllByRole('button');
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(onCloseMock).toHaveBeenCalled();
  });

  it('renders ImagePreview for image files', () => {
    renderDialog(imageFile);
    expect(screen.getByTestId('file-preview-dialog')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeInTheDocument();
  });

  it('renders VideoPreview for video files', () => {
    renderDialog(videoFile);
    expect(screen.getByTestId('file-preview-dialog')).toBeInTheDocument();
    const dialogEl = screen.getByTestId('file-preview-dialog');
    expect(dialogEl.querySelector('[data-testid="react-pdf-document"]')).not.toBeInTheDocument();
    expect(document.querySelector('img')).not.toBeInTheDocument();
    expect(screen.queryByText('preview.notSupported')).not.toBeInTheDocument();
  });

  it('renders PdfPreview for PDF files', () => {
    renderDialog(pdfFile);
    expect(screen.getByTestId('file-preview-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('react-pdf-document')).toBeInTheDocument();
  });

  it('renders PreviewUnsupported for unsupported file types', () => {
    renderDialog(unsupportedFile);
    expect(screen.getByTestId('file-preview-dialog')).toBeInTheDocument();
    expect(screen.getByText('preview.notSupported')).toBeInTheDocument();
  });

  it('calls downloadFile when download button is clicked', () => {
    renderDialog(imageFile);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 2]);
    expect(downloadFileMock).toHaveBeenCalledWith(10, {
      fileName: 'test.jpg',
      shareToken: null,
    });
  });

  it('shows CircularProgress when loading', () => {
    const mockModule = jest.requireMock('../hooks/usePreviewLoader');
    mockModule.usePreviewLoader = () => ({
      loading: true,
      error: null,
      previewUrl: null,
      previewBlob: null,
      textContent: null,
    });

    renderDialog(imageFile);
    expect(screen.getByTestId('file-preview-dialog')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    mockModule.usePreviewLoader = () => ({
      loading: false,
      error: null,
      previewUrl: 'https://example.com/preview',
      previewBlob: null,
      textContent: null,
    });
  });
});
