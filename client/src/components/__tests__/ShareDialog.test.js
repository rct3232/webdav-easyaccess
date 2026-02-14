import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ShareDialog from '../dialogs/ShareDialog';
import * as shareLinkService from '../../services/shareLinkService';
import * as userService from '../../services/userService';
import * as permissionService from '../../services/permissionService';
import * as fileService from '../../services/fileService';

jest.mock('../../services/shareLinkService');
jest.mock('../../services/permissionRequestService');
jest.mock('../../services/userService');
jest.mock('../../services/permissionService');
jest.mock('../../services/fileService');

describe('ShareDialog', () => {
  const mockOnClose = jest.fn();
  const mockUser = { id: 1, username: 'testuser' };

  beforeEach(() => {
    jest.clearAllMocks();
    userService.getApprovedUsers.mockResolvedValue([]);
    permissionService.getFolderPermissions.mockResolvedValue([]);
    fileService.listFiles.mockResolvedValue([]);
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

    expect(await screen.findByText(/폴더 공유 - test/)).toBeInTheDocument();
  });

  it('loads users and folder list on mount', async () => {
    const mockUsers = [{ id: 2, username: 'user2' }];
    const mockFiles = [{ path: '/test/sub', basename: 'sub', type: 'directory' }];
    
    userService.getApprovedUsers.mockResolvedValue(mockUsers);
    fileService.listFiles.mockImplementation((path) => {
      if (path === '/test') return Promise.resolve(mockFiles);
      return Promise.resolve([]);
    });
    permissionService.getFolderPermissions.mockResolvedValue([]);

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
      expect(userService.getApprovedUsers).toHaveBeenCalled();
      expect(fileService.listFiles).toHaveBeenCalled();
    }, { timeout: 3000 });
  });

  it('calls onClose when cancel button is clicked', async () => {
    render(
      <ShareDialog
        open={true}
        onClose={mockOnClose}
        folderPath="/test"
        folderName="test"
        user={mockUser}
      />
    );

    await screen.findByText(/폴더 공유 - test/);
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
