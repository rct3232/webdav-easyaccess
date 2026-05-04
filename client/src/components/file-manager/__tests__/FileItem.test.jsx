/**
 * FileItem tests.
 * Verifies observable outcomes for the FileItem container component.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';

jest.mock('../../../hooks/useLongPress', () => ({
  useLongPress: () => ({
    onTouchStart: () => {},
    onTouchEnd: () => {},
    onTouchMove: () => {},
    onMouseDown: () => {},
    onMouseUp: () => {},
    onMouseLeave: () => {},
    wasLongPress: () => false,
  }),
}));

jest.mock('../hooks/useLongPressSelect', () => ({
  useLongPressSelect: () => ({
    isLongPressEnabled: false,
    onLongPressSelect: null,
  }),
}));

import FileItem from '../FileItem';

const mockFile = {
  path: '/test.pdf',
  basename: 'test.pdf',
  size: 1024,
  lastmod: '2025-01-15T10:00:00Z',
  type: 'file',
};

const mockDirFile = {
  path: '/myfolder',
  basename: 'myfolder',
  size: 0,
  lastmod: '2025-01-15T10:00:00Z',
  type: 'directory',
};

const defaultHandlers = {
  onFileClick: jest.fn(),
  onMoreClick: jest.fn(),
  onContextMenu: jest.fn(),
};

const defaultProps = {
  file: mockFile,
  index: 0,
  ...defaultHandlers,
  showMoreButton: false,
  isDisabled: false,
  isProcessing: false,
  isSelected: false,
  selectionMode: false,
  isMobile: false,
};

describe('FileItem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders file name in list mode', () => {
    renderWithProviders(<FileItem {...defaultProps} />);
    expect(screen.getByText('test.pdf')).toBeInTheDocument();
  });

  it('renders file name in grid mode (isMobile=true)', () => {
    renderWithProviders(<FileItem {...defaultProps} isMobile />);
    expect(screen.getByText('test.pdf')).toBeInTheDocument();
  });

  it('click calls onFileClick with correct args', () => {
    const onFileClick = jest.fn();
    const { container } = renderWithProviders(
      <FileItem {...defaultProps} onFileClick={onFileClick} />,
    );
    const box = container.querySelector('[data-file-path="/test.pdf"]');
    fireEvent.click(box);
    expect(onFileClick).toHaveBeenCalledWith(mockFile, expect.any(Object), 0);
  });

  it('context menu calls onContextMenu', () => {
    const onContextMenu = jest.fn();
    renderWithProviders(<FileItem {...defaultProps} onContextMenu={onContextMenu} />);
    fireEvent.contextMenu(screen.getByText('test.pdf'));
    expect(onContextMenu).toHaveBeenCalled();
  });

  it('directory item renders with different icon than file', () => {
    const { container: fileContainer } = renderWithProviders(
      <FileItem {...defaultProps} file={mockFile} />,
    );
    const { container: dirContainer } = renderWithProviders(
      <FileItem {...defaultProps} file={mockDirFile} />,
    );

    const fileIcon = fileContainer.querySelector('.MuiSvgIcon-root');
    const dirIcon = dirContainer.querySelector('.MuiSvgIcon-root');

    expect(fileIcon).toBeTruthy();
    expect(dirIcon).toBeTruthy();
    expect(fileIcon.className).not.toBe(dirIcon.className);
  });
});
