import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';
import axios from 'axios';
import apiClient, { get as apiGet, post as apiPost } from '../../services/apiClient';

// Mock apiClient (authService uses apiClient; prevents interceptors error on load)
jest.mock('../../services/apiClient', () => ({
  __esModule: true,
  default: {
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
  },
  get: jest.fn(),
  post: jest.fn(),
}));

// Mock axios (AuthContext uses axios.interceptors and axios.defaults)
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
    defaults: { headers: { common: {} } },
  },
}));

// Test component to consume the auth context
const TestComponent = () => {
  const { user, loading, login, logout, register, isAuthenticated } = useAuth();
  
  if (loading) return <div data-testid="loading">Loading...</div>;
  
  return (
    <div>
      <div data-testid="user">{user ? (user.username || 'unknown') : 'no user'}</div>
      <div data-testid="auth-status">{isAuthenticated ? 'authenticated' : 'not authenticated'}</div>
      <button onClick={() => login('testuser', 'password')}>Login</button>
      <button onClick={() => logout()}>Logout</button>
      <button onClick={() => register('newuser', 'email@test.com', 'password')}>Register</button>
    </div>
  );
};

describe('AuthContext', () => {
  const mockUser = { id: 1, username: 'testuser', is_admin: false };
  const mockToken = 'mock-token';

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    jest.clearAllMocks();

    // authService uses apiClient get/post
    apiGet.mockResolvedValue({ data: mockUser });
    apiPost.mockResolvedValue({ data: { token: mockToken, user: mockUser } });

    // AuthContext uses axios.defaults
    axios.defaults.headers.common = {};
  });

  it('provides loading state initially and then shows user if token exists', async () => {
    sessionStorage.setItem('token', 'valid-token');

    let resolveGet;
    const getPromise = new Promise((resolve) => {
      resolveGet = () => resolve({ data: mockUser });
    });
    apiGet.mockReturnValue(getPromise);

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    expect(screen.getByTestId('loading')).toBeInTheDocument();
    
    await act(async () => {
      resolveGet();
    });

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      expect(screen.getByTestId('user')).toHaveTextContent('testuser');
    });
  });

  it('handles login success', async () => {
    apiGet.mockRejectedValue(new Error('No token')); // initial check

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Login'));

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('testuser');
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    });

    expect(sessionStorage.getItem('token')).toBe(mockToken);
  });

  it('should return user data on successful login (INIT1)', async () => {
    apiGet.mockRejectedValue(new Error('No token')); // initial check

    let loginResult;
    const TestLoginComponent = () => {
      const { login } = useAuth();
      const handleLogin = async () => {
        loginResult = await login('testuser', 'password');
      };
      return <button onClick={handleLogin}>Login</button>;
    };

    render(
      <AuthProvider>
        <TestLoginComponent />
      </AuthProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Login'));
    });

    await waitFor(() => {
      expect(loginResult).toMatchObject({
        success: true,
        user: expect.objectContaining({
          id: 1,
          username: 'testuser',
        }),
      });
    });
  });

  it('handles logout', async () => {
    sessionStorage.setItem('token', 'valid-token');
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('testuser');
    });

    fireEvent.click(screen.getByText('Logout'));

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('no user');
    });

    expect(sessionStorage.getItem('token')).toBeNull();
  });

  it('handles registration success (immediate login)', async () => {
    apiGet.mockRejectedValue(new Error('No token'));

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Register'));

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('testuser');
    });

    expect(sessionStorage.getItem('token')).toBe(mockToken);
  });

  it('handles registration success (pending approval)', async () => {
    apiGet.mockRejectedValue(new Error('No token'));
    apiPost.mockResolvedValue({ data: { status: 'pending' } });

    let result;
    const TestRegisterComponent = () => {
      const { register } = useAuth();
      const handleRegister = async () => {
        result = await register('newuser', 'email@test.com', 'password');
      };
      return <button onClick={handleRegister}>Register</button>;
    };

    render(
      <AuthProvider>
        <TestRegisterComponent />
      </AuthProvider>
    );

    fireEvent.click(screen.getByText('Register'));

    await waitFor(() => {
      expect(result).toMatchObject({ success: true, status: 'pending' });
    });
  });

  it('logs out automatically on 401 response via interceptor', async () => {
    sessionStorage.setItem('token', 'some-token');

    // AuthContext uses axios.interceptors - capture error callback
    let responseInterceptor;
    axios.interceptors.response.use.mockImplementation((onSuccess, onError) => {
      responseInterceptor = onError;
      return 'interceptor-id';
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated');
    });

    // Simulate 401 error through interceptor
    await act(async () => {
      try {
        await responseInterceptor({
          response: { status: 401 },
          config: {}
        });
      } catch (e) {
        // ignore
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('auth-status')).toHaveTextContent('not authenticated');
    });

    expect(sessionStorage.getItem('token')).toBeNull();
  });
});
