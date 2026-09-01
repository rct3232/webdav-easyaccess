/**
 * MigrationGuard tests.
 * Verifies the app-wide migration guard (D2/D3 double safety): while a
 * migration is active every non-/migration, non-/login route force-redirects
 * to /migration; /login stays reachable; there is no redirect loop when
 * already on /migration; no redirect happens while inactive.
 * @see docs/features/migration-mode.md (D3)
 */
import React from 'react';
import { act, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '../../../test-utils';
import MigrationGuard from '../MigrationGuard';
import * as migrationService from '../../../services/migrationService';

jest.mock('../../../services/migrationService', () => ({
  getMigrationStatus: jest.fn(),
}));

let currentPath = null;
function LocationProbe() {
  const location = useLocation();
  currentPath = location.pathname;
  return <div data-testid="path">{location.pathname}</div>;
}

function renderGuard(initialPath) {
  return renderWithProviders(
    <>
      <MigrationGuard />
      <LocationProbe />
    </>,
    { initialEntries: [initialPath] }
  );
}

describe('MigrationGuard', () => {
  beforeEach(() => {
    currentPath = null;
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('force-redirects any non-migration route to /migration while a migration is active', async () => {
    migrationService.getMigrationStatus.mockResolvedValue({
      active: true,
      type: 'blobs',
      jobId: 'job-1',
      startedAt: new Date().toISOString(),
    });

    renderGuard('/mypage');

    expect(await screen.findByTestId('path')).toBeInTheDocument();
    await waitFor(() => {
      expect(currentPath).toBe('/migration');
    });
  });

  it('leaves /login reachable while a migration is active', async () => {
    migrationService.getMigrationStatus.mockResolvedValue({
      active: true,
      type: 'blobs',
      jobId: 'job-1',
    });

    renderGuard('/login');

    await act(async () => {});
    expect(currentPath).toBe('/login');
  });

  it('does not redirect when already on /migration (no redirect loop)', async () => {
    jest.useFakeTimers();
    migrationService.getMigrationStatus.mockResolvedValue({
      active: true,
      type: 'blobs',
      jobId: 'job-1',
    });

    renderGuard('/migration');

    await act(async () => {});
    expect(currentPath).toBe('/migration');
    await act(async () => {
      jest.advanceTimersByTime(12000);
    });
    expect(currentPath).toBe('/migration');
  });

  it('does not redirect when no migration is active', async () => {
    jest.useFakeTimers();
    migrationService.getMigrationStatus.mockResolvedValue({ active: false });

    renderGuard('/mypage');

    await act(async () => {});
    expect(currentPath).toBe('/mypage');
    await act(async () => {
      jest.advanceTimersByTime(12000);
    });
    expect(currentPath).toBe('/mypage');
  });
});
