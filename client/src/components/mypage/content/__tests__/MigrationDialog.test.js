/**
 * MigrationDialog tests.
 * Verifies observable outcomes per spec: direction/phase/mode fields,
 * required-field validation, start → poll → progress → completed,
 * cancel, and the s3-to-webdav finalize option.
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
  await user.type(screen.getByLabelText(/bucket \*/i), 'bucket-1');
  await user.type(screen.getByLabelText(/access key \*/i), 'AKIA123');
  await user.type(screen.getByLabelText(/secret key \*/i), 'secret123');
}

const runningJob = {
  jobId: 'mig-1',
  direction: 'webdav-to-s3',
  phase: 'copy',
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
  it('renders S3 destination fields by default with correct direction and no finalize phase', async () => {
    renderDialog();

    expect(screen.getByRole('radio', { name: /webdav → s3/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /s3 → webdav/i })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /dry run/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /apply/i })).not.toBeChecked();

    expect(screen.getByLabelText(/bucket \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/access key \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/secret key \*/i)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/phase/i));
    expect(screen.getByRole('option', { name: /copy/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /finalize/i })).not.toBeInTheDocument();
  });

  it('s3-to-webdav shows WebDAV destination fields and the finalize phase option', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('radio', { name: /s3 → webdav/i }));

    expect(screen.getByLabelText(/url \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/username \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password \*/i)).toBeInTheDocument();

    await user.click(screen.getByLabelText(/phase/i));
    expect(screen.getByRole('option', { name: /copy/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /finalize/i })).toBeInTheDocument();
  });

  it('resume checkbox appears only in apply mode', async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.queryByRole('checkbox', { name: /resume from previous run/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /apply/i }));
    expect(screen.getByRole('checkbox', { name: /resume from previous run/i })).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: /^start$/i }));

    expect(await screen.findByText(/please fill in all required fields/i)).toBeInTheDocument();
    expect(startCalled).toBe(false);
  });

  it('starts migration, polls status, and shows completed summary', async () => {
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
      direction: 'webdav-to-s3',
      phase: 'copy',
      mode: 'dry-run',
      resume: false,
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
  });

  it('shows failed summary with error list when the job fails', async () => {
    let job = runningJob;
    server.use(
      http.post('/api/admin/migration/blobs', () => HttpResponse.json({ jobId: 'mig-1' }, { status: 202 })),
      http.get('/api/admin/migration/jobs/mig-1', () => HttpResponse.json(job))
    );

    const user = userEvent.setup();
    renderDialog();
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

  it('close stops polling and calls onClose', async () => {
    let job = runningJob;
    server.use(
      http.post('/api/admin/migration/blobs', () => HttpResponse.json({ jobId: 'mig-1' }, { status: 202 })),
      http.get('/api/admin/migration/jobs/mig-1', () => HttpResponse.json(job))
    );

    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await fillS3Fields(user);
    await user.click(screen.getByRole('button', { name: /^start$/i }));

    await waitFor(() => {
      expect(screen.getByText(/job id: mig-1/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
