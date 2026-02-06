import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import axios from 'axios';

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
    delete axios.defaults.headers.common['Authorization'];
  }, []);

  useEffect(() => {
    // Global auto-logout on invalid/expired auth (covers all API calls).
    const interceptorId = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const status = error?.response?.status;
        if ((status === 401 || status === 403) && sessionStorage.getItem('token')) {
          logout();
        }
        return Promise.reject(error);
      }
    );
    return () => {
      axios.interceptors.response.eject(interceptorId);
    };
  }, [logout]);

  const fetchUser = useCallback(async () => {
    try {
      const response = await axios.get('/api/auth/me');
      const userData = response.data;
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
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
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
        axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
      }
    };

    window.addEventListener('token-refreshed', handleTokenRefresh);
    return () => {
      window.removeEventListener('token-refreshed', handleTokenRefresh);
    };
  }, []);

  const login = async (username, password) => {
    try {
      const response = await axios.post('/api/auth/login', { username, password });
      const { token: newToken, refreshToken: newRefreshToken, user: userData } = response.data;

      sessionStorage.setItem('token', newToken);
      if (newRefreshToken) sessionStorage.setItem('refreshToken', newRefreshToken);
      setToken(newToken);
      const normalizedUser = {
        ...userData,
        is_admin: Boolean(userData.is_admin),
      };
      setUser(normalizedUser);
      axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;

      return { success: true, user: normalizedUser };
    } catch (error) {
      const errorData = error.response?.data || {};
      return { 
        success: false, 
        error: errorData.error || errorData.message || 'Login failed',
        status: errorData.status,
        message: errorData.message
      };
    }
  };

  const register = async (username, email, password) => {
    try {
      const response = await axios.post('/api/auth/register', { username, email, password });
      const { status: accountStatus } = response.data;
      
      if (accountStatus === 'pending') {
        return { success: true, status: 'pending' };
      }

      const { token: newToken, refreshToken: newRefreshToken, user: userData } = response.data;
      sessionStorage.setItem('token', newToken);
      if (newRefreshToken) sessionStorage.setItem('refreshToken', newRefreshToken);
      setToken(newToken);
      setUser(userData);
      axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;

      return { success: true };
    } catch (error) {
      return { success: false, error: error.response?.data?.error || 'Registration failed' };
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

