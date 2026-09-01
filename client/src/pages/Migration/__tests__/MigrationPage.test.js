/**
 * MigrationPage tests.
 * Verifies: empty state when no migration is active; a running migration job
 * renders header/type badge/progress/counters for the extended
 * `progress: { percent, currentLabel, counters }` shape (the legacy scalar
 * blob shape is a pending Case A source defect — MigrationPage reads
 * `jobProgress.total/current` but the server job carries `total/current` at
 * the top level; see docs/fail_log.md); failed/cancelled alerts with reasons;
 * the terminal auto-modal for completed-metadata (env guidance), completed-
 * blobs with `configPersist.persisted` and with
 * `configPersist.skippedEnvSourced`; and "Go to settings" navigation.
 * @see docs/features/migration-mode.md (D7/D8/D9)
 */
import React from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '../../../test-utils';
import MigrationPage from '../MigrationPage';
import * as migrationService from '../../../services/migrationService';

jest.mock('../../../services/migrationService', () => ({
  getMigrationStatus: jest.fn(),
  getBlobMigrationStatus: jest.fn(),
}));

const startedAt = new Date().toISOString();
const completedAt = new Date().toISOString();

let currentPath = null;
function LocationProbe() {
  const location = useLocation();
  currentPath = location.pathname;
  return null;
}

function renderPage() {
  return renderWithProviders(
    <>
      <MigrationPage />
      <LocationProbe />
    </>
  );
}

function mockActiveStatus(job) {
  migrationService.getMigrationStatus.mockResolvedValue({
    active: true,
    type: job.type,
    jobId: job.id,
    startedAt,
  });
  migrationService.getBlobMigrationStatus.mockResolvedValue(job);
}

describe('MigrationPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the empty state when no migration is active', async () => {
    migrationService.getMigrationStatus.mockResolvedValue({
      active: false,
      type: null,
      jobId: null,
      startedAt: null,
    });

    renderWithProviders(<MigrationPage />);

    expect(await screen.findByText(/no active migration/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to settings/i })).toBeInTheDocument();
    expect(migrationService.getBlobMigrationStatus).not.toHaveBeenCalled();
  });

  it('renders a running migration job with progress and counters', async () => {
    jest.useFakeTimers();
    const job = {
      id: 'job-1',
      type: 'blobs',
      direction: 'webdav-to-s3',
      status: 'running',
      progress: {
        percent: 50,
        currentLabel: '/testuser/docs/file.bin',
        counters: { copied: 3, failed: 1, skipped: 0 },
      },
      startedAt,
    };
    migrationService.getMigrationStatus.mockResolvedValue({
      active: true,
      type: 'blobs',
      jobId: 'job-1',
      startedAt,
    });
    migrationService.getBlobMigrationStatus.mockResolvedValue(job);

    renderWithProviders(<MigrationPage />);

    await act(async () => {});

    expect(screen.getByText(/Blobs/)).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText(/file\.bin/)).toBeInTheDocument();
    expect(screen.getByText(/copied 3/i)).toBeInTheDocument();
    expect(screen.getByText(/Running/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    jest.useRealTimers();
  });

  it('renders legacy scalar blob progress (top-level progress/total/current)', async () => {
    jest.useFakeTimers();
    const job = {
      id: 'job-1',
      type: 'blobs',
      direction: 'webdav-to-s3',
      status: 'running',
      progress: 7,
      total: 10,
      current: '/testuser/docs/legacy.bin',
      results: { copied: 7, failed: 0, skipped: 3 },
      startedAt,
    };
    migrationService.getMigrationStatus.mockResolvedValue({
      active: true,
      type: 'blobs',
      jobId: 'job-1',
      startedAt,
    });
    migrationService.getBlobMigrationStatus.mockResolvedValue(job);

    renderWithProviders(<MigrationPage />);

    await act(async () => {});

    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText(/legacy\.bin/)).toBeInTheDocument();
    expect(screen.getByText(/copied 7/i)).toBeInTheDocument();

    jest.useRealTimers();
  });

  it('auto-opens the completion modal with a "Go to settings" action for a terminal job', async () => {
    const job = {
      id: 'job-1',
      type: 'metadata',
      direction: 'sqlite-to-postgresql',
      status: 'completed',
      progress: { percent: 100, currentLabel: null },
      startedAt,
      completedAt,
    };
    mockActiveStatus(job);
    renderPage(job);

    expect(await screen.findByText(/migration completed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to settings/i })).toBeInTheDocument();
  });

  it('shows a failed alert with the reason and auto-opens the failed modal', async () => {
    const job = {
      id: 'job-1',
      type: 'blobs',
      direction: 'webdav-to-s3',
      status: 'failed',
      progress: { percent: 30, currentLabel: null },
      errorMessage: 'bucket timeout',
      startedAt,
      completedAt,
    };
    mockActiveStatus(job);
    renderPage(job);

    expect(await screen.findByRole('heading', { name: 'Migration failed' })).toBeInTheDocument();
    expect(screen.getByText('The migration failed. Review the error below.')).toBeInTheDocument();
    expect(screen.getAllByText(/bucket timeout/i).length).toBeGreaterThan(0);
  });

  it('shows a cancelled warning alert and auto-opens the cancelled modal', async () => {
    const job = {
      id: 'job-1',
      type: 'blobs',
      direction: 'webdav-to-s3',
      status: 'cancelled',
      progress: { percent: 40, currentLabel: null },
      startedAt,
      completedAt,
    };
    mockActiveStatus(job);
    renderPage(job);

    expect(await screen.findByRole('heading', { name: 'Migration cancelled' })).toBeInTheDocument();
    expect(screen.getAllByText(/partial progress is preserved and resumes/i).length).toBeGreaterThan(0);
  });

  it('shows persist-result guidance in the completed modal for blobs with persisted config', async () => {
    const job = {
      id: 'job-1',
      type: 'blobs',
      direction: 'webdav-to-s3',
      status: 'completed',
      progress: { percent: 100, currentLabel: null },
      configPersist: { persisted: ['WEA_FILE_STORAGE'], skippedEnvSourced: [] },
      startedAt,
      completedAt,
    };
    mockActiveStatus(job);
    renderPage(job);

    expect(await screen.findByText(/saved to the server settings/i)).toBeInTheDocument();
    expect(screen.getByText(/WEA_FILE_STORAGE/i)).toBeInTheDocument();
  });

  it('shows env-sourced guidance in the completed modal when the destination config is env-owned', async () => {
    const job = {
      id: 'job-1',
      type: 'blobs',
      direction: 'webdav-to-s3',
      status: 'completed',
      progress: { percent: 100, currentLabel: null },
      configPersist: { persisted: [], skippedEnvSourced: ['WEA_FILE_STORAGE'] },
      startedAt,
      completedAt,
    };
    mockActiveStatus(job);
    renderPage(job);

    expect(await screen.findByText(/configured via environment variables/i)).toBeInTheDocument();
    expect(screen.getByText(/WEA_FILE_STORAGE/i)).toBeInTheDocument();
  });

  it('navigates to settings when "Go to settings" is clicked in the terminal modal', async () => {
    const user = userEvent.setup();
    const job = {
      id: 'job-1',
      type: 'metadata',
      direction: 'sqlite-to-postgresql',
      status: 'completed',
      progress: { percent: 100, currentLabel: null },
      startedAt,
      completedAt,
    };
    mockActiveStatus(job);
    renderPage(job);

    expect(await screen.findByText(/migration completed/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /go to settings/i }));

    await waitFor(() => {
      expect(currentPath).toBe('/mypage');
    });
  });
});
