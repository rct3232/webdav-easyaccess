import { useState, useEffect, useCallback } from 'react';

import * as authService from '../services/authService';
import {
  getAccessToken,
  getRefreshToken,
  removeTokens,
  setAccessToken,
  setRefreshToken,
} from '../services/authTokenStore';
import { normalizeAuthUser } from '../utils/normalizeAuthUser';

export function useAuthSession() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Session-only auth: closing the browser should log out.
  const [token, setToken] = useState(() => {
    try {
      // Legacy cleanup: remove older localStorage persistence.
      localStorage.removeItem('token');
    } catch {
      // ignore
    }

    try {
      return getAccessToken();
    } catch {
      return null;
    }
  });

  const logout = useCallback(() => {
    removeTokens();

    try {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
    } catch {
      // ignore
    }

    setToken(null);
    setUser(null);
  }, []);

  const fetchUser = useCallback(async () => {
    try {
      const userData = await authService.getMe();
      setUser(normalizeAuthUser(userData));
    } catch (error) {
      // Preserve existing observable behavior: clear auth state on failure.
      console.error('Failed to fetch user:', error);
      logout();
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    if (token) {
      if (!user) fetchUser();
    } else {
      setLoading(false);
    }
  }, [token, fetchUser, user]);

  // Subscribe to token refresh events from apiClient/authTokenStore.
  useEffect(() => {
    const handleTokenRefresh = (event) => {
      const newToken = event?.detail?.token;
      if (newToken) setToken(newToken);
    };

    window.addEventListener('token-refreshed', handleTokenRefresh);
    return () => window.removeEventListener('token-refreshed', handleTokenRefresh);
  }, []);

  const login = useCallback(
    async (username, password) => {
      try {
        const data = await authService.login(username, password);
        if (!data) {
          setLoading(false);
          return { success: false, error: 'auth_skipped', message: 'auth_skipped' };
        }
        const { token: newToken, refreshToken: newRefreshToken, user: userData } = data || {};

        setAccessToken(newToken);
        if (newRefreshToken) {
          setRefreshToken(newRefreshToken);
        }

        const accessTokenStored = getAccessToken() === newToken;
        const refreshTokenStored = !newRefreshToken || getRefreshToken() === newRefreshToken;
        if (!accessTokenStored || !refreshTokenStored) {
          // Defensive: do not crash; return a failure result.
          logout();
          setLoading(false);
          return { success: false, error: 'storage_failed' };
        }

        setToken(newToken);
        const normalizedUser = normalizeAuthUser(userData);
        setUser(normalizedUser);
        setLoading(false);

        return { success: true, user: normalizedUser };
      } catch (error) {
        const errorData = error?.response?.data || {};
        return {
          success: false,
          ...errorData,
          error: errorData.error || errorData.message || errorData.errorCode,
          status: errorData.status,
          message: errorData.message,
        };
      }
    },
    [logout]
  );

  const register = useCallback(
    async (username, email, password) => {
      try {
        const data = await authService.register(username, email, password);
        if (!data) {
          setLoading(false);
          return { success: false, error: 'auth_skipped', message: 'auth_skipped' };
        }
        const { status: accountStatus } = data || {};

        if (accountStatus === 'pending') {
          return { success: true, status: 'pending' };
        }

        const { token: newToken, refreshToken: newRefreshToken, user: userData } = data || {};

        setAccessToken(newToken);
        if (newRefreshToken) {
          setRefreshToken(newRefreshToken);
        }

        const accessTokenStored = getAccessToken() === newToken;
        const refreshTokenStored = !newRefreshToken || getRefreshToken() === newRefreshToken;
        if (!accessTokenStored || !refreshTokenStored) {
          logout();
          setLoading(false);
          return { success: false, error: 'storage_failed' };
        }

        setToken(newToken);
        const normalizedUser = normalizeAuthUser(userData);
        setUser(normalizedUser);
        setLoading(false);

        return { success: true };
      } catch (error) {
        const data = error?.response?.data || {};
        return { success: false, ...data, error: data.error || data.message || data.errorCode };
      }
    },
    [logout]
  );

  const isAuthenticated = !!user;

  return {
    user,
    loading,
    login,
    register,
    logout,
    isAuthenticated,
  };
}
