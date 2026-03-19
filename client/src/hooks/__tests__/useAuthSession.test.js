import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock('../../services/authService', () => ({
  getMe: jest.fn(),
  login: jest.fn(),
  register: jest.fn(),
}));

import * as authService from '../../services/authService';
import { useAuthSession } from '../useAuthSession';

describe('useAuthSession', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('becomes unauthenticated after init when no token exists', async () => {
    const { result } = renderHook(() => useAuthSession());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('loads the authenticated user when a token exists', async () => {
    sessionStorage.setItem('token', 'existing-token');
    authService.getMe.mockResolvedValue({
      id: '1',
      username: 'user',
      is_admin: 1,
    });

    const { result } = renderHook(() => useAuthSession());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toEqual({
      id: '1',
      username: 'user',
      is_admin: true,
    });
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('keeps loading true while getMe is pending', () => {
    sessionStorage.setItem('token', 'existing-token');
    authService.getMe.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useAuthSession());

    expect(result.current.loading).toBe(true);
  });

  it('clears auth state when getMe fails', async () => {
    sessionStorage.setItem('token', 'existing-token');
    sessionStorage.setItem('refreshToken', 'existing-refresh-token');
    authService.getMe.mockRejectedValue(new Error('forbidden'));

    const { result } = renderHook(() => useAuthSession());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(sessionStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('refreshToken')).toBeNull();
  });

  it('login success stores tokens and authenticates the user', async () => {
    authService.login.mockResolvedValue({
      token: 'new-token',
      refreshToken: 'new-refresh-token',
      user: { id: '1', username: 'user', is_admin: false },
    });

    const { result } = renderHook(() => useAuthSession());

    await act(async () => {
      await result.current.login('user', 'password');
    });

    expect(sessionStorage.getItem('token')).toBe('new-token');
    expect(sessionStorage.getItem('refreshToken')).toBe('new-refresh-token');
    expect(result.current.user).toEqual({
      id: '1',
      username: 'user',
      is_admin: false,
    });
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('login failure returns a failure result without crashing', async () => {
    authService.login.mockRejectedValue({
      response: { data: { errorCode: 'serverErrors.auth.invalidCredentials', message: 'Bad credentials' } },
    });

    const { result } = renderHook(() => useAuthSession());
    let loginResult;

    await act(async () => {
      loginResult = await result.current.login('user', 'wrong');
    });

    expect(loginResult).toMatchObject({
      success: false,
      message: 'Bad credentials',
    });
    expect(result.current.user).toBeNull();
  });

  it('register pending returns success without storing tokens', async () => {
    authService.register.mockResolvedValue({ status: 'pending' });

    const { result } = renderHook(() => useAuthSession());
    let registerResult;

    await act(async () => {
      registerResult = await result.current.register('user', 'user@example.com', 'password');
    });

    expect(registerResult).toEqual({ success: true, status: 'pending' });
    expect(result.current.user).toBeNull();
    expect(sessionStorage.getItem('token')).toBeNull();
  });

  it('token-refreshed keeps the user authenticated', async () => {
    sessionStorage.setItem('token', 'existing-token');
    authService.getMe.mockResolvedValue({
      id: '1',
      username: 'user',
      is_admin: false,
    });

    const { result } = renderHook(() => useAuthSession());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    act(() => {
      window.dispatchEvent(new CustomEvent('token-refreshed', { detail: { token: 'refreshed-token' } }));
    });

    expect(result.current.user).toEqual({
      id: '1',
      username: 'user',
      is_admin: false,
    });
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('returns a failure result when token storage cannot be persisted', async () => {
    authService.login.mockResolvedValue({
      token: 'new-token',
      refreshToken: 'new-refresh-token',
      user: { id: '1', username: 'user', is_admin: false },
    });
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (this === sessionStorage) {
        throw new Error('QuotaExceeded');
      }
      return originalSetItem.call(this, key, value);
    });

    const { result } = renderHook(() => useAuthSession());
    let loginResult;

    await act(async () => {
      loginResult = await result.current.login('user', 'password');
    });

    expect(loginResult).toEqual({ success: false, error: 'storage_failed' });
    expect(result.current.user).toBeNull();
    setItemSpy.mockRestore();
  });
});
