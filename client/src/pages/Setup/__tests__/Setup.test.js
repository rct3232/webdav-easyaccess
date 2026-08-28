/**
 * Setup wizard integration tests.
 * Uses MSW handlers (setup status/test/apply). Verifies step navigation,
 * connection-test states, apply flow, post-setup lockout redirect, masked
 * prefill, and i18n rendering.
 * @see docs/spec/client/pages/Setup.md 2.6
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { server } from '../../../setupTests';
import { AuthProvider } from '../../../contexts/AuthContext';
import Setup from '../Setup';
import '../../../i18n';

const theme = createTheme({ palette: { primary: { main: '#4167ba' } } });

function renderSetup(initialEntries = ['/setup']) {
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
          { path: 'setup', element: <Setup /> },
          { path: 'login', element: <div data-testid="login-page">Login page</div> },
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

const waitForReady = async () => {
  await waitFor(() => {
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
};

const clickNext = async (user) => {
  await user.click(screen.getByRole('button', { name: /^next$/i }));
};

async function fillS3Fields(user) {
  await user.type(screen.getByLabelText(/bucket/i), 'test-bucket');
  await user.type(screen.getByLabelText(/region/i), 'us-east-1');
  await user.type(screen.getByLabelText(/access key id/i), 'AKIAIOSFODNN7EXAMPLE');
  await user.type(
    screen.getByLabelText(/secret access key/i),
    'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
  );
}

async function fillPgFields(user) {
  await user.type(screen.getByLabelText(/^host/i), 'localhost');
  await user.type(screen.getByLabelText(/^port/i), '5432');
  await user.type(screen.getByLabelText(/^database/i), 'webdav');
  await user.type(screen.getByLabelText(/^user/i), 'admin');
  await user.type(screen.getByLabelText(/^password/i), 'secret');
}

describe('Setup wizard', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renders the first step after loading setup status', async () => {
    render(renderSetup());
    await waitForReady();

    expect(screen.getByText('Server setup')).toBeInTheDocument();
    expect(screen.getByLabelText(/SQLite/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/PostgreSQL/i)).toBeInTheDocument();
  });

  it('navigates through all five steps in order', async () => {
    const user = userEvent.setup();
    render(renderSetup());
    await waitForReady();

    expect(screen.getByLabelText(/SQLite/i)).toBeInTheDocument();

    await clickNext(user);
    expect(screen.getByLabelText(/bucket/i)).toBeInTheDocument();
    await fillS3Fields(user);

    await clickNext(user);
    expect(screen.getByLabelText(/admin password/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/admin password/i), 'admin123');

    await clickNext(user);
    expect(screen.getByLabelText(/server port/i)).toBeInTheDocument();

    await clickNext(user);
    expect(screen.getByRole('button', { name: /apply & finish/i })).toBeInTheDocument();
  });

  it('blocks advancing when required fields are missing', async () => {
    const user = userEvent.setup();
    render(renderSetup());
    await waitForReady();

    await clickNext(user);
    expect(screen.getByLabelText(/bucket/i)).toBeInTheDocument();
    await clickNext(user);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/bucket/i)).toBeInTheDocument();
  });

  it('shows connection-test success for postgresql', async () => {
    const user = userEvent.setup();
    render(renderSetup());
    await waitForReady();

    await user.click(screen.getByLabelText(/PostgreSQL/i));
    await fillPgFields(user);
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() => {
      expect(screen.getByText('Connection successful.')).toBeInTheDocument();
    });
  });

  it('shows connection-test success for s3', async () => {
    const user = userEvent.setup();
    render(renderSetup());
    await waitForReady();

    await clickNext(user);
    await fillS3Fields(user);
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() => {
      expect(screen.getByText('Connection successful.')).toBeInTheDocument();
    });
  });

  it('shows a translated message when the connection test fails', async () => {
    server.use(
      http.post('/api/setup/test', () =>
        HttpResponse.json({ ok: false, errorCode: 'serverErrors.setup.complete' }, { status: 403 })
      )
    );
    const user = userEvent.setup();
    render(renderSetup());
    await waitForReady();

    await user.click(screen.getByLabelText(/PostgreSQL/i));
    await fillPgFields(user);
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() => {
      expect(screen.getByText(/already configured/i)).toBeInTheDocument();
    });
  });

  it('renders a translated taxonomy error with a muted reason detail when the connection test fails', async () => {
    server.use(
      http.post('/api/setup/test', () =>
        HttpResponse.json(
          {
            ok: false,
            errorCode: 'serverErrors.setup.test.pg.unreachable',
            message: 'Cannot reach the PostgreSQL server',
            reason: 'ECONNREFUSED 127.0.0.1:5432',
          },
          { status: 400 }
        )
      )
    );
    const user = userEvent.setup();
    render(renderSetup());
    await waitForReady();

    await user.click(screen.getByLabelText(/PostgreSQL/i));
    await fillPgFields(user);
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() => {
      expect(screen.getByText(/cannot reach the postgresql server/i)).toBeInTheDocument();
    });
    expect(screen.getByText('ECONNREFUSED 127.0.0.1:5432')).toBeInTheDocument();
  });

  it('interpolates {{reason}} into the translated connection-test error message', async () => {
    server.use(
      http.post('/api/setup/test', () =>
        HttpResponse.json(
          {
            ok: false,
            errorCode: 'serverErrors.api.webdavTestFailed',
            message: 'WebDAV test failed',
            reason: 'ECONNREFUSED',
          },
          { status: 400 }
        )
      )
    );
    const user = userEvent.setup();
    render(renderSetup());
    await waitForReady();

    await clickNext(user);
    await user.click(screen.getByLabelText(/WebDAV/i));
    await user.type(screen.getByLabelText(/url/i), 'https://example.com/webdav');
    await user.type(screen.getByLabelText(/username/i), 'admin');
    await user.type(screen.getByLabelText(/password/i), 'secret');
    await user.click(screen.getByRole('button', { name: /test connection/i }));

    await waitFor(() => {
      expect(screen.getByText(/WebDAV test failed: ECONNREFUSED/i)).toBeInTheDocument();
    });
  });

  it('shows the restart-required screen after a successful apply', async () => {
    const user = userEvent.setup();
    render(renderSetup());
    await waitForReady();

    await clickNext(user);
    await fillS3Fields(user);
    await clickNext(user);
    await user.type(screen.getByLabelText(/admin password/i), 'admin123');
    await clickNext(user);
    await clickNext(user);
    await user.click(screen.getByRole('button', { name: /apply & finish/i }));

    await waitFor(() => {
      expect(screen.getByText('Restart required')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /^next$/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Metadata database')).not.toBeInTheDocument();
  });

  it('redirects to /login when setup is already complete', async () => {
    server.use(
      http.get('/api/setup/status', () =>
        HttpResponse.json({ setup_complete: true, missing: [], current: {} })
      )
    );

    render(renderSetup());
    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
    expect(screen.queryByText('Metadata database')).not.toBeInTheDocument();
  });

  it('renders masked prefilled secrets from status.current', async () => {
    server.use(
      http.get('/api/setup/status', () =>
        HttpResponse.json({
          setup_complete: false,
          missing: [],
          current: {
            WEA_STORAGE_BACKEND: 'sqlite',
            WEA_FILE_STORAGE: 's3',
            PORT: '5001',
            JWT_SECRET: '****',
            S3_BUCKET: 'prefilled-bucket',
            AWS_REGION: 'us-west-2',
            AWS_ACCESS_KEY_ID: 'prefilled-key',
            AWS_SECRET_ACCESS_KEY: '****',
          },
        })
      )
    );
    const user = userEvent.setup();
    render(renderSetup());
    await waitForReady();

    await clickNext(user);
    expect(screen.getByLabelText(/secret access key/i)).toHaveValue('****');
    expect(screen.getByLabelText(/bucket/i)).toHaveValue('prefilled-bucket');

    await clickNext(user);
    expect(screen.getByLabelText(/jwt secret/i)).toHaveValue('****');
  });

  it('renders the wizard i18n strings', async () => {
    render(renderSetup());
    await waitForReady();

    expect(screen.getByText('Server setup')).toBeInTheDocument();
    expect(screen.getByText('Metadata database')).toBeInTheDocument();
    expect(screen.getByText('File storage')).toBeInTheDocument();
    expect(screen.getByText('Admin & JWT')).toBeInTheDocument();
    expect(screen.getByText('Optional settings')).toBeInTheDocument();
    expect(screen.getByText('Apply')).toBeInTheDocument();
    expect(screen.getByLabelText(/SQLite/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/PostgreSQL/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^next$/i })).toBeInTheDocument();
  });
});
