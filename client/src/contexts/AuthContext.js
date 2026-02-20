import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import * as authService from '../services/authService';

export const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(() => {
    // Session-only auth: closing the browser should log out.
    const sessionToken = sessionStorage.getItem('token');
    // Cleanup legacy persistence from older versions.
    try {
      localStorage.removeItem('token');
    } catch {
      // ignore
    }
    return sessionToken;
  });

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('refreshToken');
    } catch {
      // ignore
    }
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
      setUser({
        ...userData,
        is_admin: Boolean(userData.is_admin),
      });
    } catch (error) {
      console.error('Failed to fetch user:', error);
      logout();
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    if (token) {
      if (!user) {
        fetchUser();
      }
    } else {
      setLoading(false);
    }
  }, [token, fetchUser, user]);

  // Listen for token refresh events from apiClient
  useEffect(() => {
    const handleTokenRefresh = (event) => {
      const { token: newToken } = event.detail;
      if (newToken) {
        setToken(newToken);
      }
    };

    window.addEventListener('token-refreshed', handleTokenRefresh);
    return () => {
      window.removeEventListener('token-refreshed', handleTokenRefresh);
    };
  }, []);

  const login = async (username, password) => {
    try {
      const data = await authService.login(username, password);
      const { token: newToken, refreshToken: newRefreshToken, user: userData } = data;

      sessionStorage.setItem('token', newToken);
      if (newRefreshToken) sessionStorage.setItem('refreshToken', newRefreshToken);
      setToken(newToken);
      const normalizedUser = {
        ...userData,
        is_admin: Boolean(userData.is_admin),
      };
      setUser(normalizedUser);

      return { success: true, user: normalizedUser };
    } catch (error) {
      const errorData = error.response?.data || {};
      return {
        success: false,
        ...errorData,
        error: errorData.error || errorData.message,
        status: errorData.status,
        message: errorData.message,
      };
    }
  };

  const register = async (username, email, password) => {
    try {
      const data = await authService.register(username, email, password);
      const { status: accountStatus } = data;
      
      if (accountStatus === 'pending') {
        return { success: true, status: 'pending' };
      }

      const { token: newToken, refreshToken: newRefreshToken, user: userData } = data;
      sessionStorage.setItem('token', newToken);
      if (newRefreshToken) sessionStorage.setItem('refreshToken', newRefreshToken);
      setToken(newToken);
      setUser(userData);

      return { success: true };
    } catch (error) {
      const data = error.response?.data || {};
      return { success: false, ...data, error: data.error || data.message };
    }
  };

  const value = {
    user,
    loading,
    login,
    register,
    logout,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

