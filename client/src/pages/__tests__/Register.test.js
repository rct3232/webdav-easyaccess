/**
 * Register page integration tests.
 * Uses MSW (no authService mock). Verifies form, registration flow, success/error states.
 * @see docs/TESTING_STRATEGY.md
 * @see docs/spec/client/pages/Register.md 2.6
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { server } from '../../setupTests';
import { AuthProvider } from '../../contexts/AuthContext';
import Register from '../Register';
import '../../i18n';

const theme = createTheme({ palette: { primary: { main: '#4167ba' } } });

function renderRegister(initialEntries = ['/register']) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/register" element={<Register />} />
            <Route path="/files" element={<div data-testid="files-page">Files</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

describe('Register', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renders register form with all fields', async () => {
    render(renderRegister());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    const passwordLabels = screen.getAllByLabelText(/password/i);
    expect(passwordLabels.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText(/confirm/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign up|register/i })).toBeInTheDocument();
  });

  it('shows error when submitting empty form', async () => {
    const user = userEvent.setup();
    render(renderRegister());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /sign up|register/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('successful register with pending shows success message', async () => {
    server.use(
      http.post('/api/auth/register', async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json(
          {
            messageCode: 'serverMessages.auth.registerSuccess',
            status: 'pending',
            user: { id: '1', username: body.username, email: body.email, status: 'pending' },
          },
          { status: 201 }
        );
      })
    );
    const user = userEvent.setup();
    render(renderRegister());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/username/i), 'newuser');
    await user.type(screen.getByLabelText(/email/i), 'new@example.com');
    const passwordInputs = screen.getAllByLabelText(/password/i);
    await user.type(passwordInputs[0], 'ValidPass123!');
    await user.type(screen.getByLabelText(/confirm/i), 'ValidPass123!');
    await user.click(screen.getByRole('button', { name: /sign up|register/i }));
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/Registration complete|administrator approval/i);
    });
  });

  it('successful register with approved navigates to /files', async () => {
    server.use(
      http.post('/api/auth/register', async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json(
          {
            messageCode: 'serverMessages.auth.registerSuccess',
            token: 'mock-token',
            refreshToken: 'mock-refresh',
            user: {
              id: '1',
              username: body.username,
              email: body.email,
              is_admin: false,
              status: 'approved',
            },
          },
          { status: 201 }
        );
      })
    );
    const user = userEvent.setup();
    render(renderRegister());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/username/i), 'approveduser');
    await user.type(screen.getByLabelText(/email/i), 'approved@example.com');
    const passwordInputs = screen.getAllByLabelText(/password/i);
    await user.type(passwordInputs[0], 'ValidPass123!');
    await user.type(screen.getByLabelText(/confirm/i), 'ValidPass123!');
    await user.click(screen.getByRole('button', { name: /sign up|register/i }));
    await waitFor(
      () => {
        expect(screen.getByTestId('files-page')).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });

  it('register 400 shows error', async () => {
    server.use(
      http.post('/api/auth/register', () => {
        return HttpResponse.json(
          { errorCode: 'serverErrors.auth.emailTaken' },
          { status: 400 }
        );
      })
    );
    const user = userEvent.setup();
    render(renderRegister());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/username/i), 'existing');
    await user.type(screen.getByLabelText(/email/i), 'taken@example.com');
    const passwordInputs = screen.getAllByLabelText(/password/i);
    await user.type(passwordInputs[0], 'ValidPass123!');
    await user.type(screen.getByLabelText(/confirm/i), 'ValidPass123!');
    await user.click(screen.getByRole('button', { name: /sign up|register/i }));
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveClass('MuiAlert-standardError');
    });
  });

  it('shows login link', async () => {
    render(renderRegister());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(screen.getByText(/already have an account|login/i)).toBeInTheDocument();
  });

  it('EmailNotificationMessage shown when email_enabled and pending', async () => {
    server.use(
      http.get('/api/settings/public', () => {
        return HttpResponse.json({ registration_enabled: true, email_enabled: true });
      }),
      http.post('/api/auth/register', async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json(
          {
            messageCode: 'serverMessages.auth.registerSuccess',
            status: 'pending',
            user: { id: '1', username: body.username, email: body.email, status: 'pending' },
          },
          { status: 201 }
        );
      })
    );
    const user = userEvent.setup();
    render(renderRegister());
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/username/i), 'emailuser');
    await user.type(screen.getByLabelText(/email/i), 'email@example.com');
    const passwordInputs = screen.getAllByLabelText(/password/i);
    await user.type(passwordInputs[0], 'ValidPass123!');
    await user.type(screen.getByLabelText(/confirm/i), 'ValidPass123!');
    await user.click(screen.getByRole('button', { name: /sign up|register/i }));
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/Registration complete|administrator approval/i);
    });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/Approval result will be sent to your email/i)).toBeInTheDocument();
  });
});
