import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ConflictResolveDialog from '../ConflictResolveDialog';

describe('ConflictResolveDialog', () => {
  const mockOnClose = jest.fn();
  const mockOnResolve = jest.fn();
  const conflicts = [{ path: '/test/file.txt', type: 'file' }];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the dialog when open', () => {
    render(
      <ConflictResolveDialog
        open={true}
        onClose={mockOnClose}
        onResolve={mockOnResolve}
        conflicts={conflicts}
      />
    );

    expect(screen.getByText('중복 항목 처리')).toBeInTheDocument();
    expect(screen.getByText('file.txt')).toBeInTheDocument();
  });

  it('calls onResolve with overwrite when button clicked', () => {
    render(
      <ConflictResolveDialog
        open={true}
        onClose={mockOnClose}
        onResolve={mockOnResolve}
        conflicts={conflicts}
      />
    );

    fireEvent.click(screen.getByText('병합/덮어쓰기'));
    expect(mockOnResolve).toHaveBeenCalledWith('overwrite');
  });

  it('calls onResolve with skip when button clicked', () => {
    render(
      <ConflictResolveDialog
        open={true}
        onClose={mockOnClose}
        onResolve={mockOnResolve}
        conflicts={conflicts}
      />
    );

    fireEvent.click(screen.getByText('중복 건너뛰기'));
    expect(mockOnResolve).toHaveBeenCalledWith('skip');
  });

  it('calls onClose when cancel clicked', () => {
    render(
      <ConflictResolveDialog
        open={true}
        onClose={mockOnClose}
        onResolve={mockOnResolve}
        conflicts={conflicts}
      />
    );

    fireEvent.click(screen.getByText('취소'));
    expect(mockOnClose).toHaveBeenCalled();
  });
});
