/**
 * ShareTargetDialog tests.
 * Verifies observable outcomes per spec: ShareTargetDialog.md.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test-utils';
import ShareTargetDialog from '../ShareTargetDialog';

jest.mock('../../../hooks/useResponsive', () => {
  const { createUseResponsiveModuleMock } = require('../../../testing/mocks/useResponsiveMock');
  return createUseResponsiveModuleMock();
});

jest.mock('../../../services/userService', () => {
  const { createUserServiceMock } = require('../../../testing/mocks/serviceMocks');
  return createUserServiceMock();
});

jest.mock('../../../services/sharePermissionGateway', () => ({
  __esModule: true,
  default: {
    getFolderPermissions: jest.fn(),
  },
}));

jest.mock('../../../services/shareTargetPermissionSaveUseCase', () => ({
  shareTargetPermissionSaveUseCase: jest.fn(),
}));

jest.mock('../../../hooks/useSharedManage', () => ({
  useSharedManage: jest.fn(),
}));

jest.mock('../ExternalShareSection', () => {
  function MockExternalShareSection({ fileName }) {
    return <div data-testid="external-share-section">{fileName}</div>;
  }

  return {
    __esModule: true,
    default: MockExternalShareSection,
  };
});

jest.mock('../SharedManageBody', () => {
  function MockSharedManageBody() {
    return <div data-testid="shared-manage-body">shared manage body</div>;
  }

  return {
    __esModule: true,
    default: MockSharedManageBody,
  };
});

import { getApprovedUsers } from '../../../services/userService';
import sharePermissionGateway from '../../../services/sharePermissionGateway';
import { shareTargetPermissionSaveUseCase } from '../../../services/shareTargetPermissionSaveUseCase';
import { useSharedManage } from '../../../hooks/useSharedManage';

const adminFile = {
  path: '/testuser/docs/file.pdf',
  nodeId: 10,
  parentId: 5,
  basename: 'file.pdf',
  type: 'file',
  hasAdminPermission: true,
};

const adminFolder = {
  path: '/testuser/docs',
  nodeId: 5,
  basename: 'docs',
  type: 'directory',
  hasAdminPermission: true,
};

const nonAdminFile = {
  path: '/testuser/docs/file.pdf',
  nodeId: 10,
  parentId: 5,
  basename: 'file.pdf',
  type: 'file',
  hasReadPermission: true,
};

const adminUser = { id: '1', username: 'admin', is_admin: true };
const nonAdminUser = { id: '2', username: 'user', is_admin: false };

function createProps(overrides = {}) {
  return {
    open: true,
    onClose: jest.fn(),
    file: adminFolder,
    user: adminUser,
    onMessage: jest.fn(),
    onSave: jest.fn(),
    ...overrides,
  };
}

describe('ShareTargetDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.setItem('token', 'test-token');
    getApprovedUsers.mockResolvedValue([]);
    sharePermissionGateway.getFolderPermissions.mockResolvedValue([]);
    shareTargetPermissionSaveUseCase.mockResolvedValue(undefined);
    useSharedManage.mockReturnValue({
      loading: false,
      initialLoading: false,
      confirmDialogOpen: false,
      setConfirmDialogOpen: jest.fn(),
      hasReadPermission: true,
      hasWritePermission: false,
      pathPermission: 'read',
      filePermissionLevel: null,
      pendingRequest: {
        read: { pending: false, id: null },
        write: { pending: false, id: null },
      },
      ownerExists: true,
      handleCancelPendingRequest: jest.fn(),
      handlePermissionRequest: jest.fn(),
      handleRevokePermission: jest.fn(),
    });
  });

  it('renders admin search and save actions when opened', async () => {
    renderWithProviders(<ShareTargetDialog {...createProps()} />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search|user/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('shows shared-manage content with a close-only footer for non-admin users', async () => {
    renderWithProviders(
      <ShareTargetDialog
        {...createProps({
          file: nonAdminFile,
          user: nonAdminUser,
        })}
      />
    );

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('shared-manage-body')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('shows the external share section for admin file targets', async () => {
    renderWithProviders(<ShareTargetDialog {...createProps({ file: adminFile })} />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('external-share-section')).toHaveTextContent('file.pdf');
  });

  it('successful admin save calls onSave, closes the dialog, and surfaces success', async () => {
    const user = userEvent.setup();
    const props = createProps();

    renderWithProviders(<ShareTargetDialog {...props} />);

    await user.click(await screen.findByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(props.onSave).toHaveBeenCalledTimes(1);
      expect(props.onClose).toHaveBeenCalledTimes(1);
    });
    expect(props.onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' })
    );
  });

  it('failed admin save keeps the dialog open and surfaces an error', async () => {
    const user = userEvent.setup();
    const props = createProps();
    shareTargetPermissionSaveUseCase.mockRejectedValueOnce(new Error('save failed'));

    renderWithProviders(<ShareTargetDialog {...props} />);

    await user.click(await screen.findByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(props.onMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' })
      );
    });
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
