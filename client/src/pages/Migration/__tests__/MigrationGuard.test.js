/**
 * MigrationGuard tests.
 * Verifies the role-aware app-wide migration guard (D3 double safety): while a
 * migration is active an authenticated admin is force-redirected to /migration
 * (operator progress), authenticated regular users and anonymous visitors go to
 * the generic /maintenance page, and /login stays reachable for every session.
 * There is no redirect loop when already on the correct screen, and no redirect
 * happens while the gate is inactive.
 * @see docs/features/migration-mode.md (D3)
 */
import React from 'react';
import { act, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '../../../test-utils';
import MigrationGuard from '../MigrationGuard';
import * as migrationService from '../../../services/migrationService';
import { useAuth } from '../../../contexts/AuthContext';

jest.mock('../../../services/migrationService', () => ({
  getMigrationStatus: jest.fn(),
}));

// Mock useAuth so each test controls the session role independently of the real
// AuthProvider (which still mounts real, unauthenticated in renderWithProviders).
jest.mock('../../../contexts/AuthContext', () => {
  const actual = jest.requireActual('../../../contexts/AuthContext');
  return { ...actual, useAuth: jest.fn() };
});

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

function mockSession({ isAdmin, signedIn }) {
  const user = signedIn ? { id: '1', username: 'testuser', is_admin: isAdmin } : null;
  useAuth.mockReturnValue({
    user,
    loading: false,
    isAuthenticated: Boolean(user),
    login: jest.fn(),
    register: jest.fn(),
    logout: jest.fn(),
  });
}

function mockActiveStatus() {
  migrationService.getMigrationStatus.mockResolvedValue({
    active: true,
    type: 'blobs',
    jobId: 'job-1',
    startedAt: new Date().toISOString(),
  });
}

describe('MigrationGuard', () => {
  beforeEach(() => {
    currentPath = null;
    jest.resetAllMocks();
    mockSession({ isAdmin: false, signedIn: false });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('redirects an authenticated admin from any other route to /migration while a migration is active', async () => {
    mockSession({ isAdmin: true, signedIn: true });
    mockActiveStatus();

    renderGuard('/mypage');

    await waitFor(() => {
      expect(currentPath).toBe('/migration');
    });
  });

  it('redirects an authenticated regular user to /maintenance while a migration is active', async () => {
    mockSession({ isAdmin: false, signedIn: true });
    mockActiveStatus();

    renderGuard('/mypage');

    await waitFor(() => {
      expect(currentPath).toBe('/maintenance');
    });
  });

  it('redirects an anonymous visitor to /maintenance while a migration is active', async () => {
    mockActiveStatus();

    renderGuard('/mypage');

    await waitFor(() => {
      expect(currentPath).toBe('/maintenance');
    });
  });

  it('moves a non-admin off /migration (never shows the operator page)', async () => {
    mockSession({ isAdmin: false, signedIn: true });
    mockActiveStatus();

    renderGuard('/migration');

    await waitFor(() => {
      expect(currentPath).toBe('/maintenance');
    });
  });

  it('moves an admin off /maintenance onto /migration', async () => {
    mockSession({ isAdmin: true, signedIn: true });
    mockActiveStatus();

    renderGuard('/maintenance');

    await waitFor(() => {
      expect(currentPath).toBe('/migration');
    });
  });

  it('does not redirect an admin when already on /migration (no redirect loop)', async () => {
    jest.useFakeTimers();
    mockSession({ isAdmin: true, signedIn: true });
    mockActiveStatus();

    renderGuard('/migration');

    await act(async () => {});
    expect(currentPath).toBe('/migration');
    await act(async () => {
      jest.advanceTimersByTime(12000);
    });
    expect(currentPath).toBe('/migration');
  });

  it('does not redirect a non-admin when already on /maintenance (no redirect loop)', async () => {
    jest.useFakeTimers();
    mockSession({ isAdmin: false, signedIn: true });
    mockActiveStatus();

    renderGuard('/maintenance');

    await act(async () => {});
    expect(currentPath).toBe('/maintenance');
    await act(async () => {
      jest.advanceTimersByTime(12000);
    });
    expect(currentPath).toBe('/maintenance');
  });

  it('leaves /login reachable for an anonymous visitor while a migration is active', async () => {
    mockActiveStatus();

    renderGuard('/login');

    await act(async () => {});
    expect(currentPath).toBe('/login');
  });

  it('leaves /login reachable for an admin while a migration is active', async () => {
    mockSession({ isAdmin: true, signedIn: true });
    mockActiveStatus();

    renderGuard('/login');

    await act(async () => {});
    expect(currentPath).toBe('/login');
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
