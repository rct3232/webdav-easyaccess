import React, { createContext, useContext, useMemo } from 'react';
import { useAuthSession } from '../hooks/useAuthSession';

export const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const { user, loading, login, register, logout, isAuthenticated } = useAuthSession();

  const value = useMemo(
    () => ({ user, loading, login, register, logout, isAuthenticated }),
    [user, loading, login, register, logout, isAuthenticated]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
