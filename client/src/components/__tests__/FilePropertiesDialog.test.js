import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FilePropertiesDialog from '../dialogs/FilePropertiesDialog';

describe('FilePropertiesDialog', () => {
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

  it('should render file properties correctly', () => {
    render(<FilePropertiesDialog {...defaultProps} />);
    
    expect(screen.getByText('속성')).toBeInTheDocument();
    expect(screen.getAllByText('test.txt')[0]).toBeInTheDocument();
    expect(screen.getByText('1 KB')).toBeInTheDocument();
    expect(screen.getByText('text/plain')).toBeInTheDocument();
    expect(screen.getByText('/test.txt')).toBeInTheDocument();
  });

  it('should render folder properties correctly', () => {
    const mockFolder = {
      basename: 'my-folder',
      type: 'directory',
      lastmod: '2024-01-02',
      path: '/my-folder',
    };
    
    render(<FilePropertiesDialog {...defaultProps} file={mockFolder} />);
    
    expect(screen.getAllByText('my-folder')[0]).toBeInTheDocument();
    expect(screen.getByText('폴더')).toBeInTheDocument();
    expect(screen.queryByText('크기')).not.toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', () => {
    render(<FilePropertiesDialog {...defaultProps} />);
    
    const closeButton = screen.getByText('닫기');
    fireEvent.click(closeButton);
    
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('should return null if no file is provided', () => {
    const { container } = render(<FilePropertiesDialog {...defaultProps} file={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
