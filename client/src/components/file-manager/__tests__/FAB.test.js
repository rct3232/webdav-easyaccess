/**
 * FAB tests.
 * Verifies observable outcomes per spec: SpeedDial actions, shareLinkMode (login vs add-to-shared),
 * returns null when no write permission, disabled disables Fab.
 * @see docs/spec/client/components/file-manager/FAB.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils';
import FAB from '../FAB';

describe('FAB', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders SpeedDial with create folder and upload actions when hasWritePermission', () => {
    const onCreateFolder = jest.fn();
    const onUpload = jest.fn();
    renderWithProviders(
      <FAB onCreateFolder={onCreateFolder} onUpload={onUpload} hasWritePermission={true} />
    );
    const fab = screen.getByRole('button', { name: /file actions/i });
    expect(fab).toBeInTheDocument();
    fireEvent.click(fab);
    expect(screen.getByRole('menuitem', { name: /create folder/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /upload file/i })).toBeInTheDocument();
  });

  it('calls onCreateFolder when create folder action clicked', () => {
    const onCreateFolder = jest.fn();
    const onUpload = jest.fn();
    renderWithProviders(<FAB onCreateFolder={onCreateFolder} onUpload={onUpload} />);
    fireEvent.click(screen.getByRole('button', { name: /file actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /create folder/i }));
    expect(onCreateFolder).toHaveBeenCalled();
  });

  it('calls onUpload when upload action clicked', () => {
    const onCreateFolder = jest.fn();
    const onUpload = jest.fn();
    renderWithProviders(<FAB onCreateFolder={onCreateFolder} onUpload={onUpload} />);
    fireEvent.click(screen.getByRole('button', { name: /file actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /upload file/i }));
    expect(onUpload).toHaveBeenCalled();
  });

  it('returns null when hasWritePermission is false', () => {
    renderWithProviders(
      <FAB onCreateFolder={jest.fn()} onUpload={jest.fn()} hasWritePermission={false} />
    );
    expect(screen.queryByRole('button', { name: /file actions/i })).not.toBeInTheDocument();
  });

  it('renders Login Fab in shareLinkMode when user not logged in', () => {
    const onLoginClick = jest.fn();
    renderWithProviders(
      <FAB
        shareLinkMode={{
          user: null,
          onLoginClick,
          onAddToSharedClick: jest.fn(),
        }}
      />
    );
    const loginFab = screen.getByRole('button', { name: /login/i });
    expect(loginFab).toBeInTheDocument();
    fireEvent.click(loginFab);
    expect(onLoginClick).toHaveBeenCalled();
  });

  it('renders Add to shared Fab in shareLinkMode when user logged in', () => {
    const onAddToSharedClick = jest.fn();
    renderWithProviders(
      <FAB
        shareLinkMode={{
          user: { id: '1', username: 'u' },
          onLoginClick: jest.fn(),
          onAddToSharedClick,
        }}
      />
    );
    const addFab = screen.getByRole('button', { name: /add to shared/i });
    expect(addFab).toBeInTheDocument();
    fireEvent.click(addFab);
    expect(onAddToSharedClick).toHaveBeenCalled();
  });

  it('disables Fab when disabled prop is true', () => {
    renderWithProviders(<FAB onCreateFolder={jest.fn()} onUpload={jest.fn()} disabled={true} />);
    const fab = screen.getByRole('button', { name: /file actions/i });
    expect(fab).toBeDisabled();
  });

  it('opens the SpeedDial from trigger click on mobile', () => {
    renderWithProviders(<FAB onCreateFolder={jest.fn()} onUpload={jest.fn()} isMobile={true} />);

    const fab = screen.getByRole('button', { name: /file actions/i });
    expect(fab).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(fab);

    expect(fab).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: /create folder/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /upload file/i })).toBeInTheDocument();
  });
});
