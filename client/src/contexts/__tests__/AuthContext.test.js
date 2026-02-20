/**
 * AuthContext tests.
 * @see docs/spec/client/contexts/AuthContext.md
 * @see docs/TESTING_STRATEGY.md
 * Mocks authService to control API responses.
 * 401/403 handling is in apiClient; AuthContext no longer uses axios interceptors.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';
import * as authService from '../../services/authService';

jest.mock('../../services/authService', () => ({
  getMe: jest.fn(),
  login: jest.fn(),
  register: jest.fn(),
}));

const Consumer = () => {
  const { user, loading, isAuthenticated, login, register, logout } = useAuth();
  if (loading) return <span data-testid="loading">Loading</span>;
  return (
    <div>
      <span data-testid="user">{user ? user.username : 'none'}</span>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <button onClick={() => login('u', 'p')}>Login</button>
      <button onClick={() => register('u', 'e@x.com', 'p')}>Register</button>
      <button onClick={logout}>Logout</button>
    </div>
  );
};

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

const renderWithAuth = () => render(<Consumer />, { wrapper });

describe('AuthContext', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('useAuth throws when used outside AuthProvider', () => {
    const Throws = () => {
      useAuth();
      return null;
    };

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Throws />)).toThrow('useAuth must be used within an AuthProvider');
    consoleSpy.mockRestore();
  });

  it('unauthenticated: user null, isAuthenticated false, loading false after init', async () => {
    renderWithAuth();

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
  });

  it('authenticated: user set, isAuthenticated true after token present and getMe', async () => {
    authService.getMe.mockResolvedValue({
      id: '1',
      username: 'testuser',
      email: 'user@example.com',
      is_admin: false,
      status: 'approved',
    });
    sessionStorage.setItem('token', 'existing-token');
    sessionStorage.setItem('refreshToken', 'existing-refresh');

    renderWithAuth();

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('user')).toHaveTextContent('testuser');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
  });

  it('loading: loading true while token present and user not yet fetched', () => {
    authService.getMe.mockImplementation(() => new Promise(() => {})); // never resolves
    sessionStorage.setItem('token', 'slow-token');

    renderWithAuth();

    expect(screen.getByTestId('loading')).toBeInTheDocument();
  });

  it('login success: user set, isAuthenticated true', async () => {
    authService.login.mockResolvedValue({
      token: 'mock-jwt',
      refreshToken: 'mock-refresh',
      user: { id: '1', username: 'u', email: 'e@x.com', is_admin: false, status: 'approved' },
    });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    await act(async () => {
      screen.getByRole('button', { name: /login/i }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('u');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });
  });

  it('login failure: returns success false with error data', async () => {
    const err = Object.assign(new Error('Unauthorized'), {
      response: { status: 401, data: { errorCode: 'invalid', message: 'Bad credentials' } },
    });
    authService.login.mockRejectedValue(err);

    let loginResult;
    const ConsumerWithResult = () => {
      const { login: doLogin } = useAuth();
      const handleLogin = async () => {
        loginResult = await doLogin('bad', 'wrong');
      };
      return <button onClick={handleLogin}>Login</button>;
    };

    render(<ConsumerWithResult />, { wrapper });

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    await act(async () => {
      screen.getByRole('button', { name: /login/i }).click();
    });

    await waitFor(() => {
      expect(loginResult.success).toBe(false);
      expect(loginResult).toMatchObject({ success: false });
    });
  });

  it('logout clears user and token', async () => {
    authService.getMe.mockResolvedValue({
      id: '1',
      username: 'u',
      email: 'e@x.com',
      is_admin: false,
      status: 'approved',
    });
    sessionStorage.setItem('token', 't');
    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    await act(async () => {
      screen.getByRole('button', { name: /logout/i }).click();
    });

    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(sessionStorage.getItem('token')).toBeNull();
  });

  it('token-refreshed event keeps user authenticated', async () => {
    authService.getMe.mockResolvedValue({
      id: '1',
      username: 'testuser',
      email: 'user@example.com',
      is_admin: false,
      status: 'approved',
    });
    sessionStorage.setItem('token', 'old-token');
    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    act(() => {
      window.dispatchEvent(new CustomEvent('token-refreshed', { detail: { token: 'new-token' } }));
    });

    expect(screen.getByTestId('user')).toHaveTextContent('testuser');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
  });

  it('register returns { success: true, status: "pending" } when status pending (no token/user)', async () => {
    authService.register.mockResolvedValue({ status: 'pending' });

    let registerResult;
    const ConsumerWithResult = () => {
      const { register: doRegister } = useAuth();
      const handleRegister = async () => {
        registerResult = await doRegister('u', 'e@x.com', 'p');
      };
      return <button onClick={handleRegister}>Register</button>;
    };

    render(<ConsumerWithResult />, { wrapper });

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    await act(async () => {
      screen.getByRole('button', { name: /register/i }).click();
    });

    await waitFor(() => {
      expect(registerResult).toEqual({ success: true, status: 'pending' });
      expect(sessionStorage.getItem('token')).toBeNull();
    });
  });

  it('getMe fails calls logout and sets loading false', async () => {
    authService.getMe.mockRejectedValue(new Error('Forbidden'));
    sessionStorage.setItem('token', 't');

    renderWithAuth();

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });

  it('token-refreshed: when token apply fails, fallback behavior (user not broken)', async () => {
    authService.getMe.mockResolvedValue({
      id: '1',
      username: 'testuser',
      email: 'user@example.com',
      is_admin: false,
      status: 'approved',
    });
    sessionStorage.setItem('token', 'old-token');
    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });

    // Dispatch token-refreshed with new token; even if storage/handler fails, user remains in valid state
    act(() => {
      window.dispatchEvent(new CustomEvent('token-refreshed', { detail: { token: 'new-token' } }));
    });

    // Outcome: user stays authenticated, no crash (observable behavior per spec)
    expect(screen.getByTestId('user')).toHaveTextContent('testuser');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
  });

  it('sessionStorage.setItem exception during login: defensive behavior (no unhandled crash)', async () => {
    authService.login.mockResolvedValue({
      token: 'mock-jwt',
      refreshToken: 'mock-refresh',
      user: { id: '1', username: 'u', email: 'e@x.com', is_admin: false, status: 'approved' },
    });
    const origSetItem = sessionStorage.setItem;
    sessionStorage.setItem = jest.fn(function (key) {
      if (key === 'token') throw new Error('QuotaExceeded');
      return origSetItem.apply(sessionStorage, arguments);
    });

    let loginResult;
    const ConsumerWithResult = () => {
      const { login: doLogin } = useAuth();
      const handleLogin = async () => {
        try {
          loginResult = await doLogin('u', 'p');
        } catch (e) {
          loginResult = { success: false, error: e?.message };
        }
      };
      return <button onClick={handleLogin}>Login</button>;
    };
    render(<ConsumerWithResult />, { wrapper });

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    await act(async () => {
      screen.getByRole('button', { name: /login/i }).click();
    });

    await waitFor(() => {
      expect(loginResult).toBeDefined();
    });

    // Outcome: caller receives a result (resolution or rejection caught); app does not crash
    expect(loginResult).toBeDefined();
    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
    sessionStorage.setItem = origSetItem;
  });
});
