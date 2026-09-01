/**
 * MigrationDialog tests (config-only).
 * Verifies observable outcomes per spec: info load + read-only source→dest label,
 * destination fields derived from /info, required-field validation, and the
 * config-only start flow (start → close → auto-redirect to /migration). Inline
 * progress polling, progress UI, cancel and terminal popups moved to /migration.
 * @see docs/features/migration-mode.md (D1, D2)
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../../../test-utils';
import { server } from '../../../../setupTests';
import MigrationDialog from '../MigrationDialog';

let currentPath = null;
function LocationProbe() {
  const location = useLocation();
  currentPath = location.pathname;
  return null;
}

function renderDialog(options = {}) {
  const { open = true, onClose = jest.fn(), onMessage = jest.fn() } = options;
  return {
    onClose,
    onMessage,
    ...renderWithProviders(
      <>
        <MigrationDialog open={open} onClose={onClose} onMessage={onMessage} />
        <LocationProbe />
      </>
    ),
  };
}

async function fillS3Fields(user) {
  await user.type(await screen.findByLabelText(/bucket \*/i), 'bucket-1');
  await user.type(screen.getByLabelText(/access key \*/i), 'AKIA123');
  await user.type(screen.getByLabelText(/secret key \*/i), 'secret123');
}

describe('MigrationDialog', () => {
  beforeEach(() => {
    currentPath = null;
  });

  it('loads migration info and shows the read-only source → destination label', async () => {
    renderDialog();

    expect(await screen.findByText(/source: webdav/i)).toBeInTheDocument();
    expect(screen.getByText(/destination: s3/i)).toBeInTheDocument();

    expect(screen.getByRole('radio', { name: /dry run/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /apply/i })).not.toBeChecked();
    expect(screen.queryByRole('radio', { name: /webdav → s3/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /s3 → webdav/i })).not.toBeInTheDocument();
  });

  it('renders S3 destination fields when info source is webdav', async () => {
    renderDialog();

    expect(await screen.findByLabelText(/bucket \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/access key \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/secret key \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/region/i)).toHaveValue('us-east-1');
    expect(screen.queryByLabelText(/url \*/i)).not.toBeInTheDocument();
  });

  it('renders WebDAV destination fields when info source is s3', async () => {
    server.use(
      http.get('/api/admin/migration/info', () => HttpResponse.json({ source: 's3', direction: 's3-to-webdav' }))
    );

    renderDialog();

    expect(await screen.findByText(/destination: webdav/i)).toBeInTheDocument();
    expect(screen.getByText(/source: s3/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/url \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/username \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password \*/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/bucket \*/i)).not.toBeInTheDocument();
  });

  it('shows the auto-resume note only in apply mode', async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByText(/source: webdav/i);
    expect(screen.queryByText(/already migrated files are skipped automatically/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /apply/i }));
    expect(screen.getByText(/already migrated files are skipped automatically/i)).toBeInTheDocument();
  });

  it('blocks start when required fields are missing', async () => {
    let startCalled = false;
    server.use(
      http.post('/api/admin/migration/blobs', async () => {
        startCalled = true;
        return HttpResponse.json({ jobId: 'mig-1' }, { status: 202 });
      })
    );

    const user = userEvent.setup();
    renderDialog();
    await screen.findByText(/source: webdav/i);
    await user.click(screen.getByRole('button', { name: /^start$/i }));

    expect(await screen.findByText(/please fill in all required fields/i)).toBeInTheDocument();
    expect(startCalled).toBe(false);
    expect(currentPath).not.toBe('/migration');
  });

  it('starts a dry-run migration, closes the dialog, and navigates to /migration with no direction in payload', async () => {
    let capturedPayload;
    server.use(
      http.post('/api/admin/migration/blobs', async ({ request }) => {
        capturedPayload = await request.json();
        return HttpResponse.json({ jobId: 'mig-1' }, { status: 202 });
      })
    );

    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await screen.findByText(/source: webdav/i);
    await fillS3Fields(user);
    await user.click(screen.getByRole('button', { name: /^start$/i }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(currentPath).toBe('/migration');
    });

    expect(capturedPayload).toEqual({
      mode: 'dry-run',
      force: false,
      dest: {
        type: 's3',
        bucket: 'bucket-1',
        accessKey: 'AKIA123',
        secretKey: 'secret123',
        endpoint: undefined,
        region: 'us-east-1',
      },
    });
    expect(capturedPayload).not.toHaveProperty('direction');
    expect(capturedPayload).not.toHaveProperty('phase');
    expect(capturedPayload).not.toHaveProperty('resume');
  });

  it('starts an apply migration, closes the dialog, and navigates to /migration', async () => {
    let capturedPayload;
    server.use(
      http.post('/api/admin/migration/blobs', async ({ request }) => {
        capturedPayload = await request.json();
        return HttpResponse.json({ jobId: 'mig-1' }, { status: 202 });
      })
    );

    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await screen.findByText(/source: webdav/i);
    await fillS3Fields(user);
    await user.click(screen.getByRole('radio', { name: /apply/i }));
    await user.click(screen.getByRole('button', { name: /^start$/i }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(currentPath).toBe('/migration');
    });
    expect(capturedPayload.mode).toBe('apply');
  });

  it('shows an inline error and stays on the settings page when the migration fails to start', async () => {
    server.use(
      http.post('/api/admin/migration/blobs', () =>
        HttpResponse.json({ errorCode: 'serverErrors.admin.migrationInvalidPayload' }, { status: 400 })
      )
    );

    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await screen.findByText(/source: webdav/i);
    await fillS3Fields(user);
    await user.click(screen.getByRole('button', { name: /^start$/i }));

    expect(await screen.findByText(/invalid migration request/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(currentPath).not.toBe('/migration');
  });

  it('info-load failure shows an inline error and disables Start', async () => {
    server.use(
      http.get('/api/admin/migration/info', () => HttpResponse.json({ errorCode: 'serverErrors.msw.unhandled' }, { status: 500 }))
    );

    renderDialog();

    expect(await screen.findByText(/failed to load migration info/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^start$/i })).toBeDisabled();
    expect(screen.queryByLabelText(/bucket \*/i)).not.toBeInTheDocument();
  });

  it('close calls onClose', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await screen.findByText(/source: webdav/i);

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
    expect(currentPath).not.toBe('/migration');
  });
});
