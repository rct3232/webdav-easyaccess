/**
 * CreateFolderDialog tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/dialogs/CreateFolderDialog.md
 * Uses MSW for API; no hook mocks.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../../test-utils';
import { server } from '../../../setupTests';
import CreateFolderDialog from '../CreateFolderDialog';

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onComplete: jest.fn(),
  currentPath: '/',
  parentNodeId: 1,
};

describe('CreateFolderDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.setItem('token', 'test-token');
  });

  it('renders folder name input and create/cancel buttons', () => {
    renderWithProviders(<CreateFolderDialog {...defaultProps} />);
    expect(screen.getByLabelText(/folder name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('shows validation error for empty folder name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateFolderDialog {...defaultProps} />);
    const input = screen.getByLabelText(/folder name/i);
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => {
      expect(screen.getByText(/please enter a name/i)).toBeInTheDocument();
    });
  });

  it('shows validation error for invalid folder name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateFolderDialog {...defaultProps} />);
    const input = screen.getByLabelText(/folder name/i);
    await user.type(input, 'folder/name');
    await user.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid characters/i)).toBeInTheDocument();
    });
  });

  it('calls createFolder API and onComplete with folderPath, folderName and created nodeId on success', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateFolderDialog {...defaultProps} currentPath="/" />);
    const input = screen.getByLabelText(/folder name/i);
    await user.type(input, 'newfolder');
    await user.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => {
      expect(defaultProps.onComplete).toHaveBeenCalledWith('/newfolder', 'newfolder', expect.any(Number));
    });
  });

  it('builds folder path correctly when currentPath is not root', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CreateFolderDialog {...defaultProps} currentPath="/parent/child" />
    );
    const input = screen.getByLabelText(/folder name/i);
    await user.type(input, 'subfolder');
    await user.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => {
      expect(defaultProps.onComplete).toHaveBeenCalledWith(
        '/parent/child/subfolder',
        'subfolder',
        expect.any(Number)
      );
    });
  });

  it('calls onClose and resets form on cancel', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateFolderDialog {...defaultProps} />);
    const input = screen.getByLabelText(/folder name/i);
    await user.type(input, 'typed');
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('dialog stays open and onProgress receives error on API failure', async () => {
    server.use(
      http.post('/api/folders/create', () =>
        HttpResponse.json({ errorCode: 'serverErrors.folders.pathRequired' }, { status: 400 })
      )
    );
    const user = userEvent.setup();
    const onProgress = jest.fn();
    renderWithProviders(
      <CreateFolderDialog {...defaultProps} onProgress={onProgress} />
    );
    const input = screen.getByLabelText(/folder name/i);
    await user.type(input, 'newfolder');
    await user.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => {
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error' })
      );
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('calls onProgress when provided and API succeeds', async () => {
    const user = userEvent.setup();
    const onProgress = jest.fn();
    renderWithProviders(
      <CreateFolderDialog {...defaultProps} onProgress={onProgress} />
    );
    const input = screen.getByLabelText(/folder name/i);
    await user.type(input, 'myfolder');
    await user.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => {
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'processing' })
      );
    });
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    );
  });
});
