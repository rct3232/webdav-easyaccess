/**
 * MaintenancePage tests.
 * The generic public page shown while the migration gate is active to regular
 * users and anonymous visitors. It must render NO operational metadata (no
 * type/jobId/timing). An authenticated session gets a plain "Log out" link;
 * anonymous visitors get no action.
 * @see docs/features/migration-mode.md "Role-aware lock UX"
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '../../../test-utils';
import MaintenancePage from '../MaintenancePage';

jest.mock('../../../contexts/AuthContext', () => {
  const actual = jest.requireActual('../../../contexts/AuthContext');
  return { ...actual, useAuth: jest.fn() };
});

const { useAuth } = jest.requireMock('../../../contexts/AuthContext');

let currentPath = null;
function LocationProbe() {
  const location = useLocation();
  currentPath = location.pathname;
  return null;
}

function mockSession({ signedIn }) {
  const logout = jest.fn();
  const user = signedIn ? { id: '1', username: 'regular', is_admin: false } : null;
  useAuth.mockReturnValue({
    user,
    loading: false,
    isAuthenticated: Boolean(user),
    login: jest.fn(),
    register: jest.fn(),
    logout,
  });
  return logout;
}

describe('MaintenancePage', () => {
  beforeEach(() => {
    currentPath = null;
    jest.clearAllMocks();
    mockSession({ signedIn: true });
  });

  it('renders a generic maintenance message without operational metadata', () => {
    renderWithProviders(
      <>
        <MaintenancePage />
        <LocationProbe />
      </>
    );

    expect(screen.getByText(/system maintenance in progress/i)).toBeInTheDocument();
    expect(screen.queryByText(/job/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/blobs/i)).not.toBeInTheDocument();
  });

  it('shows a plain "Log out" link to an authenticated session', () => {
    renderWithProviders(<MaintenancePage />);

    expect(screen.getByRole('link', { name: /log out/i })).toBeInTheDocument();
  });

  it('logs the session out and navigates to /login when "Log out" is clicked', async () => {
    const logout = mockSession({ signedIn: true });
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <MaintenancePage />
        <LocationProbe />
      </>
    );

    await user.click(screen.getByRole('link', { name: /log out/i }));

    await waitFor(() => {
      expect(logout).toHaveBeenCalledTimes(1);
      expect(currentPath).toBe('/login');
    });
  });

  it('renders no action to an anonymous visitor', () => {
    mockSession({ signedIn: false });
    renderWithProviders(<MaintenancePage />);

    expect(screen.getByText(/system maintenance in progress/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /log out/i })).not.toBeInTheDocument();
  });
});
