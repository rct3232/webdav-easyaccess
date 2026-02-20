/**
 * Test utilities for component/page tests.
 * Provides ThemeProvider, Router, AuthProvider, i18n.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import './i18n';

const theme = createTheme({
  palette: {
    primary: { main: '#4167ba' },
    secondary: { main: '#52c597' },
  },
});

/** Theme + Auth only (no router). Use with RouterProvider(createMemoryRouter(...)) when you need fixed initial URL. */
function ThemeAndAuthProviders({ children }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        {children}
      </AuthProvider>
    </ThemeProvider>
  );
}

function AllTheProviders({ children, initialEntries = ['/'], initialIndex = 0 }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
          {children}
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

function renderWithProviders(ui, options = {}) {
  const { initialEntries, initialIndex, ...renderOptions } = options;
  const routerEntries = initialEntries !== undefined ? initialEntries : ['/'];
  const routerIndex = initialIndex !== undefined ? initialIndex : 0;
  return render(ui, {
    wrapper: ({ children }) => (
      <AllTheProviders initialEntries={routerEntries} initialIndex={routerIndex}>
        {children}
      </AllTheProviders>
    ),
    ...renderOptions,
  });
}

export { renderWithProviders, AllTheProviders, ThemeAndAuthProviders };
