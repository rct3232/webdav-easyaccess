import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MobileBreadcrumb from '../MobileBreadcrumb';
import axios from 'axios';

jest.mock('axios');

describe('MobileBreadcrumb', () => {
  const mockOnPathClick = jest.fn();
  const mockOnToggleFolderTree = jest.fn();
  const mockUser = { username: 'testuser', id: 1, is_admin: false };

  beforeEach(() => {
    jest.clearAllMocks();
    axios.get.mockResolvedValue({ data: [] });
  });

  it('renders home chip for home path', () => {
    render(
      <MobileBreadcrumb
        currentPath="/testuser"
        onPathClick={mockOnPathClick}
        user={mockUser}
        onToggleFolderTree={mockOnToggleFolderTree}
        isFolderTreeOpen={false}
      />
    );

    expect(screen.getByText('홈')).toBeInTheDocument();
  });

  it('renders segments for subfolder', () => {
    render(
      <MobileBreadcrumb
        currentPath="/testuser/folder1/folder2"
        onPathClick={mockOnPathClick}
        user={mockUser}
        onToggleFolderTree={mockOnToggleFolderTree}
        isFolderTreeOpen={false}
      />
    );

    expect(screen.getByText('홈')).toBeInTheDocument();
    expect(screen.getByText('folder1')).toBeInTheDocument();
    expect(screen.getByText('folder2')).toBeInTheDocument();
  });

  it('calls onPathClick when chip is clicked', () => {
    render(
      <MobileBreadcrumb
        currentPath="/testuser/folder1"
        onPathClick={mockOnPathClick}
        user={mockUser}
        onToggleFolderTree={mockOnToggleFolderTree}
        isFolderTreeOpen={false}
      />
    );

    fireEvent.click(screen.getByText('홈'));
    expect(mockOnPathClick).toHaveBeenCalledWith('/testuser');

    fireEvent.click(screen.getByText('folder1'));
    expect(mockOnPathClick).toHaveBeenCalledWith('/testuser/folder1');
  });

  it('renders shared view correctly', () => {
    render(
      <MobileBreadcrumb
        currentPath="/__shared__"
        onPathClick={mockOnPathClick}
        user={mockUser}
        onToggleFolderTree={mockOnToggleFolderTree}
        isFolderTreeOpen={false}
      />
    );

    expect(screen.getByText('공유됨')).toBeInTheDocument();
  });

  it('renders recent view correctly', () => {
    render(
      <MobileBreadcrumb
        currentPath="/__recent__"
        onPathClick={mockOnPathClick}
        user={mockUser}
        onToggleFolderTree={mockOnToggleFolderTree}
        isFolderTreeOpen={false}
      />
    );

    expect(screen.getByText('최근항목')).toBeInTheDocument();
  });

  it('calls onToggleFolderTree when toggle button is clicked', () => {
    render(
      <MobileBreadcrumb
        currentPath="/testuser"
        onPathClick={mockOnPathClick}
        user={mockUser}
        onToggleFolderTree={mockOnToggleFolderTree}
        isFolderTreeOpen={false}
      />
    );

    const toggleBtn = screen.getByTitle('폴더 트리 열기');
    fireEvent.click(toggleBtn);
    expect(mockOnToggleFolderTree).toHaveBeenCalled();
  });
});
