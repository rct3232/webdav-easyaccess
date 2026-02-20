/**
 * PrivateRoute tests.
 * Verifies: loading spinner when loading, Navigate to /login when unauthenticated,
 * renders children when authenticated.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import PrivateRoute from '../PrivateRoute';
import { AuthProvider } from '../../../contexts/AuthContext';
import * as authService from '../../../services/authService';

jest.mock('../../../services/authService', () => ({
  getMe: jest.fn(),
}));

function renderPrivateRoute(initialEntries = ['/protected']) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route
            path="/protected"
            element={
              <PrivateRoute>
                <span>Protected content</span>
              </PrivateRoute>
            }
          />
          <Route path="/login" element={<span>Login page</span>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('PrivateRoute', () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.clearAllMocks();
  });

  it('shows loading spinner while loading', () => {
    authService.getMe.mockImplementation(() => new Promise(() => {}));
    sessionStorage.setItem('token', 'test-token');

    renderPrivateRoute();

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('redirects to /login when unauthenticated', async () => {
    authService.getMe.mockResolvedValue(null);

    renderPrivateRoute();

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    expect(screen.getByText(/login page/i)).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('renders children when authenticated', async () => {
    authService.getMe.mockResolvedValue({
      id: '1',
      username: 'user',
      email: 'u@x.com',
      is_admin: false,
      status: 'approved',
    });
    sessionStorage.setItem('token', 'test-token');
    sessionStorage.setItem('refreshToken', 'refresh');

    renderPrivateRoute();

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Protected content')).toBeInTheDocument();
    expect(screen.queryByText(/login page/i)).not.toBeInTheDocument();
  });
});
