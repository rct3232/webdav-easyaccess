/**
 * Setup wizard integration tests.
 * Uses MSW handlers (setup status/test/apply). Verifies step navigation,
 * connection-test states, apply flow, post-setup lockout redirect, masked
 * secret prefill from status.current, and i18n rendering. The wizard serves
 * non-T0 only: the metadata (DB connection) step is removed (D7) and the
 * apply body carries no `metadata` block.
 * @see docs/spec/client/pages/Setup.md 2.6
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../setupTests';
import {
  clickButton,
  clickNext,
  fillS3Fields,
  passTest,
  renderSetup,
  setFieldValue,
  waitForReady,
} from '../setupTestUtils';

// Safety net for the wizard's multi-step apply/restart integration flow. The
// root fix is the reduced event/render cost above; this per-suite budget only
// prevents host contention from turning a normally sub-second case into the
// global 5 s default failure. Do not raise this globally.
jest.setTimeout(10000);

describe('Setup wizard', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renders the first step (file storage) after loading setup status', async () => {
    renderSetup();
    await waitForReady();

    expect(screen.getByText('Server setup')).toBeInTheDocument();
    expect(screen.getByLabelText(/S3 \(or S3-compatible\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/WebDAV/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/PostgreSQL/i)).not.toBeInTheDocument();
  });

  it('navigates through all four steps in order', async () => {
    renderSetup();
    await waitForReady();

    expect(screen.getByLabelText(/bucket/i)).toBeInTheDocument();
    fillS3Fields();
    await passTest();

    clickNext();
    expect(screen.getByLabelText(/admin password/i)).toBeInTheDocument();
    setFieldValue(/admin password/i, 'admin123');

    clickNext();
    expect(screen.getByLabelText(/server port/i)).toBeInTheDocument();

    clickNext();
    expect(screen.getByText('AI configuration (optional)')).toBeInTheDocument();

    clickNext();
    expect(screen.getByRole('button', { name: /apply & finish/i })).toBeInTheDocument();
  });

  it('blocks advancing when required fields are missing (admin password)', async () => {
    renderSetup();
    await waitForReady();

    fillS3Fields();
    await passTest();
    clickNext();

    expect(screen.getByLabelText(/admin password/i)).toBeInTheDocument();
    clickNext();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/admin password/i)).toBeInTheDocument();
  });

  it('shows connection-test success for s3', async () => {
    renderSetup();
    await waitForReady();

    fillS3Fields();
    clickButton(/test connection/i);

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
    renderSetup();
    await waitForReady();

    fillS3Fields();
    clickButton(/test connection/i);

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
            errorCode: 'serverErrors.setup.test.s3.unreachable',
            message: 'Cannot reach the S3 endpoint',
            reason: 'ECONNREFUSED 127.0.0.1:9000',
          },
          { status: 400 }
        )
      )
    );
    renderSetup();
    await waitForReady();

    fillS3Fields();
    clickButton(/test connection/i);

    await waitFor(() => {
      expect(screen.getByText(/cannot reach the s3 endpoint/i)).toBeInTheDocument();
    });
    expect(screen.getByText('ECONNREFUSED 127.0.0.1:9000')).toBeInTheDocument();
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
    renderSetup();
    await waitForReady();

    fireEvent.click(screen.getByLabelText(/WebDAV/i));
    setFieldValue(/url/i, 'https://example.com/webdav');
    setFieldValue(/username/i, 'admin');
    setFieldValue(/password/i, 'secret');
    clickButton(/test connection/i);

    await waitFor(() => {
      expect(screen.getByText(/WebDAV test failed: ECONNREFUSED/i)).toBeInTheDocument();
    });
  });

  it('shows the restart-required screen after a successful apply', async () => {
    renderSetup();
    await waitForReady();

    fillS3Fields();
    await passTest();
    clickNext();
    setFieldValue(/admin password/i, 'admin123');
    clickNext();
    clickNext(); // optional
    clickNext(); // AI step (skipped)
    clickButton(/apply & finish/i);

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

    renderSetup();
    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });
    expect(screen.queryByText('Metadata database')).not.toBeInTheDocument();
  });

  it('renders masked prefilled secrets from status.current (no T0 keys required)', async () => {
    server.use(
      http.get('/api/setup/status', () =>
        HttpResponse.json({
          setup_complete: false,
          missing: [],
          current: {
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
    renderSetup();
    await waitForReady();

    expect(screen.getByLabelText(/secret access key/i)).toHaveValue('****');
    expect(screen.getByLabelText(/bucket/i)).toHaveValue('prefilled-bucket');
    await passTest();

    clickNext();
    expect(screen.getByLabelText(/jwt secret/i)).toHaveValue('****');
  });

  it('sends a masked (unchanged) secret as the **** marker and no metadata block', async () => {
    server.use(
      http.get('/api/setup/status', () =>
        HttpResponse.json({
          setup_complete: false,
          missing: [],
          current: {
            WEA_FILE_STORAGE: 's3',
            PORT: '5001',
            S3_BUCKET: 'prefilled-bucket',
            AWS_REGION: 'us-east-1',
            AWS_ACCESS_KEY_ID: 'prefilled-key',
            AWS_SECRET_ACCESS_KEY: '****',
          },
        })
      )
    );

    let applyBody = null;
    server.use(
      http.post('/api/setup/apply', async ({ request }) => {
        applyBody = await request.json();
        return HttpResponse.json({ restart_required: true });
      })
    );

    renderSetup();
    await waitForReady();

    expect(screen.getByLabelText(/secret access key/i)).toHaveValue('****');
    await passTest(); // file storage connection test required
    clickNext();
    setFieldValue(/admin password/i, 'admin123');
    clickNext();
    clickNext(); // optional
    clickNext(); // AI step (skipped — no llm block in the payload)
    clickButton(/apply & finish/i);

    await waitFor(() => {
      expect(applyBody).not.toBeNull();
    });
    expect(applyBody.file.secretAccessKey).toBe('****');
    expect(applyBody.metadata).toBeUndefined();
  });

  it('leaves the JWT secret blank on a fresh setup and advances with a blank secret', async () => {
    renderSetup();
    await waitForReady();

    fillS3Fields();
    await passTest();
    clickNext();

    expect(screen.getByLabelText(/jwt secret/i)).toHaveValue('');
    setFieldValue(/admin password/i, 'admin123');
    clickNext();
    expect(screen.getByLabelText(/server port/i)).toBeInTheDocument();
  });

  it('omits jwt.secret from the apply payload when the JWT secret is left blank', async () => {
    let applyBody = null;
    server.use(
      http.post('/api/setup/apply', async ({ request }) => {
        applyBody = await request.json();
        return HttpResponse.json({ restart_required: true });
      })
    );

    renderSetup();
    await waitForReady();

    fillS3Fields();
    await passTest();
    clickNext();
    setFieldValue(/admin password/i, 'admin123');
    clickNext();
    clickNext(); // optional
    clickNext(); // AI step (skipped — no llm block in the payload)
    clickButton(/apply & finish/i);

    await waitFor(() => {
      expect(applyBody).not.toBeNull();
    });
    expect(applyBody.jwt.secret).toBeUndefined();
    expect(applyBody.jwt.expiresIn).toBe('30m');
  });

  it('sends an operator-supplied JWT secret in the apply payload', async () => {
    let applyBody = null;
    server.use(
      http.post('/api/setup/apply', async ({ request }) => {
        applyBody = await request.json();
        return HttpResponse.json({ restart_required: true });
      })
    );

    renderSetup();
    await waitForReady();

    fillS3Fields();
    await passTest();
    clickNext();
    setFieldValue(/admin password/i, 'admin123');
    setFieldValue(/jwt secret/i, 'an-operator-secret');
    clickNext();
    clickNext(); // optional
    clickNext(); // AI step (skipped — no llm block in the payload)
    clickButton(/apply & finish/i);

    await waitFor(() => {
      expect(applyBody).not.toBeNull();
    });
    expect(applyBody.jwt.secret).toBe('an-operator-secret');
    expect(applyBody.jwt.expiresIn).toBe('30m');
  });

  it('preserves a masked JWT secret prefill as the **** marker in the apply payload', async () => {
    server.use(
      http.get('/api/setup/status', () =>
        HttpResponse.json({
          setup_complete: false,
          missing: [],
          current: {
            WEA_FILE_STORAGE: 's3',
            PORT: '5001',
            JWT_SECRET: '****',
            S3_BUCKET: 'prefilled-bucket',
            AWS_REGION: 'us-east-1',
            AWS_ACCESS_KEY_ID: 'prefilled-key',
            AWS_SECRET_ACCESS_KEY: '****',
          },
        })
      )
    );

    let applyBody = null;
    server.use(
      http.post('/api/setup/apply', async ({ request }) => {
        applyBody = await request.json();
        return HttpResponse.json({ restart_required: true });
      })
    );

    renderSetup();
    await waitForReady();

    expect(screen.getByLabelText(/secret access key/i)).toHaveValue('****');
    await passTest();
    clickNext();
    expect(screen.getByLabelText(/jwt secret/i)).toHaveValue('****');
    setFieldValue(/admin password/i, 'admin123');
    clickNext();
    clickNext(); // optional
    clickNext(); // AI step (skipped — no llm block in the payload)
    clickButton(/apply & finish/i);

    await waitFor(() => {
      expect(applyBody).not.toBeNull();
    });
    expect(applyBody.jwt.secret).toBe('****');
    expect(applyBody.jwt.expiresIn).toBe('30m');
  });

  it('disables Next until the connection test passes (s3 step)', async () => {
    renderSetup();
    await waitForReady();

    fillS3Fields();
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();

    await passTest();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^next$/i })).toBeEnabled();
    });
  });

  it('resets the connection-test result when a value changes', async () => {
    renderSetup();
    await waitForReady();

    fillS3Fields();
    await passTest();

    // Editing a field invalidates the passed test: success message disappears
    // and Next is disabled again until re-testing.
    setFieldValue(/bucket/i, 'test-bucketX');
    await waitFor(() => {
      expect(screen.queryByText('Connection successful.')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();
  });

  it('renders the wizard i18n strings', async () => {
    renderSetup();
    await waitForReady();

    expect(screen.getByText('Server setup')).toBeInTheDocument();
    expect(screen.getByText('File storage')).toBeInTheDocument();
    expect(screen.getByText('Admin & JWT')).toBeInTheDocument();
    expect(screen.getByText('Optional settings')).toBeInTheDocument();
    expect(screen.getByText('Apply')).toBeInTheDocument();
    expect(screen.queryByText('Metadata database')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/S3 \(or S3-compatible\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/WebDAV/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/PostgreSQL/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^next$/i })).toBeInTheDocument();
  });
});
