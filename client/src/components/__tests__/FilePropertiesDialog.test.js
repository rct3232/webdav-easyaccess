import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FilePropertiesDialog from '../dialogs/FilePropertiesDialog';
import * as permissionService from '../../services/permissionService';

jest.mock('../../services/permissionService');

describe('FilePropertiesDialog', () => {
  beforeEach(() => {
    permissionService.getFolderPermissions.mockResolvedValue([]);
  });

  const mockFile = {
    basename: 'test.txt',
    type: 'file',
    size: 1024,
    mime: 'text/plain',
    lastmod: '2024-01-01',
    path: '/test.txt',
  };

  const defaultProps = {
    open: true,
    onClose: jest.fn(),
    file: mockFile,
  };

  it('should render file properties correctly', async () => {
    render(<FilePropertiesDialog {...defaultProps} />);

    expect(screen.getByText('속성')).toBeInTheDocument();
    expect(screen.getAllByText('test.txt')[0]).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('1 KB')).toBeInTheDocument();
      expect(screen.getByText('text/plain')).toBeInTheDocument();
      expect(screen.getByText('/test.txt')).toBeInTheDocument();
    });
  });

  it('should render folder properties correctly', async () => {
    const mockFolder = {
      basename: 'my-folder',
      type: 'directory',
      lastmod: '2024-01-02',
      path: '/my-folder',
    };

    render(<FilePropertiesDialog {...defaultProps} file={mockFolder} />);

    expect(screen.getAllByText('my-folder')[0]).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('폴더')).toBeInTheDocument();
    });
    expect(screen.queryByText('크기')).not.toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', async () => {
    render(<FilePropertiesDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('닫기')).toBeInTheDocument();
    });

    const closeButton = screen.getByText('닫기');
    fireEvent.click(closeButton);

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('should return null if no file is provided', () => {
    const { container } = render(<FilePropertiesDialog {...defaultProps} file={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('should show permission block with 소유자, 편집자, 열람자 labels', async () => {
    render(<FilePropertiesDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('소유자')).toBeInTheDocument();
      expect(screen.getByText('편집자')).toBeInTheDocument();
      expect(screen.getByText('열람자')).toBeInTheDocument();
    });
  });
});
