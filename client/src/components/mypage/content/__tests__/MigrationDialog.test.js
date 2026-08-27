/**
 * MigrationDialog tests.
 * Verifies observable outcomes per spec: info load + read-only source→dest label,
 * destination fields derived from /info, required-field validation,
 * start → poll → progress → completed, cancel, the apply-mode auto-resume note,
 * and the apply-completion restart popup.
 * @see docs/spec/client/components/mypage/content/MigrationDialog.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../../../test-utils';
import { server } from '../../../../setupTests';
import MigrationDialog from '../MigrationDialog';

function renderDialog(options = {}) {
  const { open = true, onClose = jest.fn(), onMessage = jest.fn() } = options;
  return {
    onClose,
    onMessage,
    ...renderWithProviders(<MigrationDialog open={open} onClose={onClose} onMessage={onMessage} />),
  };
}

async function fillS3Fields(user) {
  await user.type(await screen.findByLabelText(/bucket \*/i), 'bucket-1');
  await user.type(screen.getByLabelText(/access key \*/i), 'AKIA123');
  await user.type(screen.getByLabelText(/secret key \*/i), 'secret123');
}

const runningJob = {
  jobId: 'mig-1',
  direction: 'webdav-to-s3',
  mode: 'dry-run',
  status: 'running',
  progress: 5,
  total: 10,
  current: '/testuser/docs/a.txt',
  results: { copied: 3, skipped: 1, failed: 1, errors: [] },
  errorMessage: null,
  createdAt: '2026-01-01T00:00:00Z',
  completedAt: null,
};

describe('MigrationDialog', () => {
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
  });

  it('starts migration, polls status, and shows completed summary with no direction in payload', async () => {
    let job = runningJob;
    let capturedPayload;
    server.use(
      http.post('/api/admin/migration/blobs', async ({ request }) => {
        capturedPayload = await request.json();
        return HttpResponse.json({ jobId: 'mig-1' }, { status: 202 });
      }),
      http.get('/api/admin/migration/jobs/mig-1', () => HttpResponse.json(job))
    );

    const user = userEvent.setup();
    renderDialog();
    await screen.findByText(/source: webdav/i);
    await fillS3Fields(user);
    await user.click(screen.getByRole('button', { name: /^start$/i }));

    await waitFor(() => {
      expect(screen.getByText(/job id: mig-1/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/progress: 5 \/ 10/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/copied: 3/i)).toBeInTheDocument();
    expect(screen.getByText(/skipped: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/failed: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/migration in progress/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^start$/i })).toBeDisabled();

    job = {
      ...runningJob,
      status: 'completed',
      progress: 10,
      total: 10,
      current: null,
      results: { copied: 8, skipped: 1, failed: 1, errors: [] },
    };

    await waitFor(() => {
      expect(screen.getByText(/migration completed/i)).toBeInTheDocument();
    }, { timeout: 5000 });

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

  it('shows the restart popup when an apply job completes', async () => {
    let job = { ...runningJob, mode: 'apply' };
    server.use(
      http.post('/api/admin/migration/blobs', () => HttpResponse.json({ jobId: 'mig-1' }, { status: 202 })),
      http.get('/api/admin/migration/jobs/mig-1', () => HttpResponse.json(job))
    );

    const user = userEvent.setup();
    renderDialog();
    await screen.findByText(/source: webdav/i);
    await fillS3Fields(user);
    await user.click(screen.getByRole('radio', { name: /apply/i }));
    await user.click(screen.getByRole('button', { name: /^start$/i }));

    job = {
      ...runningJob,
      mode: 'apply',
      status: 'completed',
      progress: 10,
      total: 10,
      current: null,
      results: { copied: 8, skipped: 1, failed: 1, errors: [] },
    };

    const popup = await screen.findByRole('dialog', { name: /restart required/i }, { timeout: 5000 });
    expect(popup).toBeInTheDocument();
    expect(screen.getByText(/update wea_file_storage/i)).toBeInTheDocument();
    expect(screen.getByText(/restart the server process/i)).toBeInTheDocument();
    expect(screen.getByText('Migration completed.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^ok$/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /restart required/i })).not.toBeInTheDocument();
    });
  });

  it('does not show the restart popup when a dry-run job completes', async () => {
    let job = runningJob;
    server.use(
      http.post('/api/admin/migration/blobs', () => HttpResponse.json({ jobId: 'mig-1' }, { status: 202 })),
      http.get('/api/admin/migration/jobs/mig-1', () => HttpResponse.json(job))
    );

    const user = userEvent.setup();
    renderDialog();
    await screen.findByText(/source: webdav/i);
    await fillS3Fields(user);
    await user.click(screen.getByRole('button', { name: /^start$/i }));

    job = {
      ...runningJob,
      status: 'completed',
      progress: 10,
      total: 10,
      current: null,
      results: { copied: 8, skipped: 1, failed: 1, errors: [] },
    };

    await waitFor(() => {
      expect(screen.getByText(/migration completed/i)).toBeInTheDocument();
    }, { timeout: 5000 });

    expect(screen.queryByRole('dialog', { name: /restart required/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/restart the server process/i)).not.toBeInTheDocument();
  });

  it('shows failed summary with error list when the job fails', async () => {
    let job = runningJob;
    server.use(
      http.post('/api/admin/migration/blobs', () => HttpResponse.json({ jobId: 'mig-1' }, { status: 202 })),
      http.get('/api/admin/migration/jobs/mig-1', () => HttpResponse.json(job))
    );

    const user = userEvent.setup();
    renderDialog();
    await screen.findByText(/source: webdav/i);
    await fillS3Fields(user);
    await user.click(screen.getByRole('button', { name: /^start$/i }));

    job = {
      ...runningJob,
      status: 'failed',
      progress: 10,
      total: 10,
      current: null,
      results: {
        copied: 6,
        skipped: 1,
        failed: 3,
        errors: [
          { nodeId: 10, path: '/testuser/docs/a.txt', error: 'Connection refused' },
          { nodeId: 11, path: '/testuser/docs/b.txt', error: 'Access denied' },
        ],
      },
    };

    await waitFor(() => {
      expect(screen.getByText(/migration failed/i)).toBeInTheDocument();
    }, { timeout: 5000 });

    expect(screen.getByText(/\/testuser\/docs\/a\.txt/i)).toBeInTheDocument();
    expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
    expect(screen.getByText(/\/testuser\/docs\/b\.txt/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /restart required/i })).not.toBeInTheDocument();
  });

  it('cancels a running job and stops on cancelled', async () => {
    let job = runningJob;
    let cancelCalled = false;
    server.use(
      http.post('/api/admin/migration/blobs', () => HttpResponse.json({ jobId: 'mig-1' }, { status: 202 })),
      http.get('/api/admin/migration/jobs/mig-1', () => HttpResponse.json(job)),
      http.post('/api/admin/migration/jobs/mig-1/cancel', () => {
        cancelCalled = true;
        job = { ...job, status: 'cancelled' };
        return HttpResponse.json({ messageCode: 'serverMessages.admin.migrationCancelled', jobId: 'mig-1' });
      })
    );

    const user = userEvent.setup();
    const { onMessage } = renderDialog();
    await screen.findByText(/source: webdav/i);
    await fillS3Fields(user);
    await user.click(screen.getByRole('button', { name: /^start$/i }));

    const cancelButton = await waitFor(() => screen.getByRole('button', { name: /cancel job/i }));
    await user.click(cancelButton);

    await waitFor(() => {
      expect(cancelCalled).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText(/migration cancelled/i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(onMessage).toHaveBeenCalledWith({ type: 'info', text: 'Migration cancellation requested.' });
    });
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

  it('close stops polling and calls onClose', async () => {
    let job = runningJob;
    server.use(
      http.post('/api/admin/migration/blobs', () => HttpResponse.json({ jobId: 'mig-1' }, { status: 202 })),
      http.get('/api/admin/migration/jobs/mig-1', () => HttpResponse.json(job))
    );

    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await screen.findByText(/source: webdav/i);
    await fillS3Fields(user);
    await user.click(screen.getByRole('button', { name: /^start$/i }));

    await waitFor(() => {
      expect(screen.getByText(/job id: mig-1/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
