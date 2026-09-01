/**
 * SharedPermissionList tests.
 * Verifies observable outcomes per spec: SharedPermissionList.md.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import SharedPermissionList from '../SharedPermissionList';

const defaultPendingRequest = {
  read: { pending: false, id: null },
  write: { pending: false, id: null },
};

const defaultProps = {
  isDirectory: true,
  hasReadPermission: false,
  hasWritePermission: false,
  pathPermission: null,
  filePermissionLevel: null,
  pendingRequest: defaultPendingRequest,
  loading: false,
  ownerExists: true,
  onRequestPermission: jest.fn(),
  onCancelPendingRequest: jest.fn(),
  onRevokeClick: jest.fn(),
};

describe('SharedPermissionList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('folder mode', () => {
    it('shows request read button when no read permission', () => {
      renderWithProviders(<SharedPermissionList {...defaultProps} />);
      expect(screen.getByRole('button', { name: /request read permission/i })).toBeInTheDocument();
    });

    it('shows request write button when no write permission', () => {
      renderWithProviders(<SharedPermissionList {...defaultProps} />);
      expect(screen.getByRole('button', { name: /request write permission/i })).toBeInTheDocument();
    });

    it('calls onRequestPermission when request read clicked', () => {
      renderWithProviders(<SharedPermissionList {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /request read permission/i }));
      expect(defaultProps.onRequestPermission).toHaveBeenCalledWith('read');
    });

    it('calls onRequestPermission when request write clicked', () => {
      renderWithProviders(<SharedPermissionList {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /request write permission/i }));
      expect(defaultProps.onRequestPermission).toHaveBeenCalledWith('write');
    });

    it('shows revoke button when has read or write permission', () => {
      renderWithProviders(
        <SharedPermissionList {...defaultProps} hasReadPermission hasWritePermission />
      );
      expect(screen.getByRole('button', { name: /revoke permission/i })).toBeInTheDocument();
    });

    it('calls onRevokeClick when revoke clicked', () => {
      renderWithProviders(
        <SharedPermissionList {...defaultProps} hasReadPermission hasWritePermission />
      );
      fireEvent.click(screen.getByRole('button', { name: /revoke permission/i }));
      expect(defaultProps.onRevokeClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('pending request', () => {
    it('shows cancel request when read pending', () => {
      renderWithProviders(
        <SharedPermissionList
          {...defaultProps}
          pendingRequest={{
            read: { pending: true, id: 'pr1' },
            write: { pending: false, id: null },
          }}
        />
      );
      expect(screen.getByText(/read permission requested/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel request/i })).toBeInTheDocument();
    });

    it('calls onCancelPendingRequest when cancel request clicked', () => {
      renderWithProviders(
        <SharedPermissionList
          {...defaultProps}
          pendingRequest={{
            read: { pending: true, id: 'pr1' },
            write: { pending: false, id: null },
          }}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /cancel request/i }));
      expect(defaultProps.onCancelPendingRequest).toHaveBeenCalled();
    });
  });

  describe('owner deleted', () => {
    it('disables request buttons when ownerExists is false', () => {
      renderWithProviders(<SharedPermissionList {...defaultProps} ownerExists={false} />);
      expect(screen.getByRole('button', { name: /request read permission/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /request write permission/i })).toBeDisabled();
    });

    it('disables revoke button when ownerExists is false', () => {
      renderWithProviders(
        <SharedPermissionList
          {...defaultProps}
          hasReadPermission
          hasWritePermission
          ownerExists={false}
        />
      );
      expect(screen.getByRole('button', { name: /revoke permission/i })).toBeDisabled();
    });
  });
});
