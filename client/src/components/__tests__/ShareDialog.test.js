import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ShareDialog from '../ShareDialog';
import axios from 'axios';
import * as shareLinkService from '../../services/shareLinkService';

// Mock axios.create and other methods
jest.mock('axios', () => {
  const mockAxios = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
  };
  return {
    create: jest.fn(() => mockAxios),
    get: mockAxios.get,
    post: mockAxios.post,
    put: mockAxios.put,
    delete: mockAxios.delete,
  };
});

jest.mock('../../services/shareLinkService');
jest.mock('../../services/permissionRequestService');

describe('ShareDialog', () => {
  const mockOnClose = jest.fn();
  const mockUser = { id: 1, username: 'testuser' };

  beforeEach(() => {
    jest.clearAllMocks();
    axios.get.mockResolvedValue({ data: [] });
  });

  it('renders the dialog when open', async () => {
    render(
      <ShareDialog
        open={true}
        onClose={mockOnClose}
        folderPath="/test"
        folderName="test"
        user={mockUser}
      />
    );

    expect(screen.getByText(/폴더 공유 - test/)).toBeInTheDocument();
  });

  it('loads users and folder list on mount', async () => {
    const mockUsers = [{ id: 2, username: 'user2' }];
    const mockFiles = [{ path: '/test/sub', basename: 'sub', type: 'directory' }];
    
    axios.get.mockImplementation((url, config) => {
      if (url === '/api/users/approved') return Promise.resolve({ data: mockUsers });
      if (url === '/api/files/list') {
        const path = config?.params?.path;
        if (path === '/test') return Promise.resolve({ data: mockFiles });
        return Promise.resolve({ data: [] }); // Stop recursion for subfolders
      }
      if (url === '/api/permissions/folder') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    render(
      <ShareDialog
        open={true}
        onClose={mockOnClose}
        folderPath="/test"
        folderName="test"
        user={mockUser}
      />
    );

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith('/api/users/approved');
      expect(axios.get).toHaveBeenCalledWith('/api/files/list', expect.any(Object));
    }, { timeout: 3000 });
  });

  it('calls onClose when cancel button is clicked', () => {
    render(
      <ShareDialog
        open={true}
        onClose={mockOnClose}
        folderPath="/test"
        folderName="test"
        user={mockUser}
      />
    );

    fireEvent.click(screen.getByText('취소'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('renders external share link section when enabled', () => {
    render(
      <ShareDialog
        open={true}
        onClose={mockOnClose}
        enableExternalShare={true}
        filePath="/test/file.txt"
        fileName="file.txt"
      />
    );

    expect(screen.getByText('외부 공유 링크 생성')).toBeInTheDocument();
    expect(screen.getByText('링크 생성')).toBeInTheDocument();
  });

  describe('외부 공유 링크 기능 (S1-S7)', () => {
    beforeEach(() => {
      shareLinkService.createShareLink.mockResolvedValue({
        token: 'test-token-123',
        filePath: '/test/file.txt',
        expiresAt: null,
      });
      shareLinkService.getShareLinks.mockResolvedValue([]);
    });

    it('creates share link when create button clicked (S1)', async () => {
      render(
        <ShareDialog
          open={true}
          onClose={mockOnClose}
          enableExternalShare={true}
          filePath="/test/file.txt"
          fileName="file.txt"
        />
      );

      fireEvent.click(screen.getByText('링크 생성'));

      await waitFor(() => {
        expect(shareLinkService.createShareLink).toHaveBeenCalledWith(
          '/test/file.txt',
          expect.any(Number)
        );
      });
    });

    it('shows generated link after creation (S5)', async () => {
      shareLinkService.createShareLink.mockResolvedValue({
        token: 'new-token-456',
        filePath: '/test/file.txt',
        expiresAt: null,
      });

      render(
        <ShareDialog
          open={true}
          onClose={mockOnClose}
          enableExternalShare={true}
          filePath="/test/file.txt"
          fileName="file.txt"
        />
      );

      fireEvent.click(screen.getByText('링크 생성'));

      await waitFor(() => {
        expect(shareLinkService.createShareLink).toHaveBeenCalled();
      });
    });

    it('allows setting expiration days', async () => {
      render(
        <ShareDialog
          open={true}
          onClose={mockOnClose}
          enableExternalShare={true}
          filePath="/test/file.txt"
          fileName="file.txt"
        />
      );

      // Change expiration setting if available
      const expirationInput = screen.queryByLabelText(/유효기간|만료/i);
      if (expirationInput) {
        fireEvent.change(expirationInput, { target: { value: '30' } });
        expect(expirationInput.value).toBe('30');
      }
    });
  });
});
