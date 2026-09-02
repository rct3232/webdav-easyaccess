/**
 * Login page integration tests.
 * Uses MSW (no authService mock). Verifies form, login flow, redirect, error states.
 * @see docs/TESTING_STRATEGY.md
 * @see docs/spec/client/pages/Login.md 2.6
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { server } from '../../setupTests';
import { AuthProvider } from '../../contexts/AuthContext';
import Login from '../Login';
import '../../i18n';

const theme = createTheme({ palette: { primary: { main: '#4167ba' } } });

function renderLogin(initialEntries = ['/login']) {
  const rootEl = (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    </ThemeProvider>
  );

  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: rootEl,
        children: [
          { path: 'login', element: <Login /> },
          { path: 'files/*', element: <div data-testid="files-page">Files</div> },
          { path: 'setup', element: <div data-testid="setup-page">Setup</div> },
        ],
      },
    ],
    {
      initialEntries,
      future: { v7_relativeSplatPath: true },
    }
  );

  return (
    <RouterProvider
      router={router}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    />
  );
}

describe('Login', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renders login form with username and password fields', async () => {
    render(renderLogin());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
  });

  it('shows error when submitting empty form', async () => {
    const user = userEvent.setup();
    render(renderLogin());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /login/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('login success navigates to user home', async () => {
    const user = userEvent.setup();
    render(renderLogin());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/username/i), 'testuser');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /login/i }));
    await waitFor(
      () => {
        expect(screen.getByTestId('files-page')).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });

  it('login 401 shows error', async () => {
    server.use(
      http.post('/api/auth/login', () => {
        return HttpResponse.json(
          { errorCode: 'serverErrors.auth.invalidCredentials' },
          { status: 401 }
        );
      })
    );
    const user = userEvent.setup();
    render(renderLogin());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/username/i), 'wronguser');
    await user.type(screen.getByLabelText(/password/i), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /login/i }));
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveClass('MuiAlert-standardError');
    });
  });

  it('login pending shows warning', async () => {
    server.use(
      http.post('/api/auth/login', () => {
        return HttpResponse.json(
          { errorCode: 'serverErrors.auth.pendingApproval', status: 'pending' },
          { status: 403 }
        );
      })
    );
    const user = userEvent.setup();
    render(renderLogin());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/username/i), 'pendinguser');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /login/i }));
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveClass('MuiAlert-standardWarning');
    });
  });

  it('login rejected shows error', async () => {
    server.use(
      http.post('/api/auth/login', () => {
        return HttpResponse.json(
          { errorCode: 'serverErrors.auth.rejected', status: 'rejected' },
          { status: 403 }
        );
      })
    );
    const user = userEvent.setup();
    render(renderLogin());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/username/i), 'rejecteduser');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /login/i }));
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveClass('MuiAlert-standardError');
    });
  });

  it('registration link visible when registration_enabled', async () => {
    render(renderLogin());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    const link = screen.getByRole('link', { name: /sign up|don't have an account/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/register');
  });

  it('registration link hidden when registration_disabled', async () => {
    server.use(
      http.get('/api/settings/public', () => {
        return HttpResponse.json({ registration_enabled: false, email_enabled: false });
      })
    );
    render(renderLogin());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(
      screen.queryByRole('link', { name: /sign up|don't have an account|no account/i })
    ).not.toBeInTheDocument();
  });

  it('navigates to /setup when setup_complete is false', async () => {
    server.use(
      http.get('/api/settings/public', () => {
        return HttpResponse.json({
          registration_enabled: true,
          email_enabled: false,
          setup_complete: false,
        });
      })
    );
    render(renderLogin());
    await waitFor(() => {
      expect(screen.getByTestId('setup-page')).toBeInTheDocument();
    });
  });

  it('stays on login when setup_complete is true', async () => {
    render(renderLogin());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('setup-page')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
  });

  it('stays on login when setup_complete is missing', async () => {
    server.use(
      http.get('/api/settings/public', () => {
        return HttpResponse.json({ registration_enabled: true, email_enabled: false });
      })
    );
    render(renderLogin());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('setup-page')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
  });
});
