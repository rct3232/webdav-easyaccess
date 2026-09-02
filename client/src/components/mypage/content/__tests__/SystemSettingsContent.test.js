/**
 * SystemSettingsContent tests.
 * Verifies registration toggle, show hidden files toggle, data cleanup, permission cleanup,
 * and the Storage migration row + MigrationDialog per spec.
 * @see docs/spec/client/components/mypage/content/SystemSettingsContent.md
 * @see docs/spec/client/components/mypage/content/MigrationDialog.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../../../test-utils';
import { server } from '../../../../setupTests';
import MyPageContentPanel from '../../MyPageContentPanel';
import SystemSettingsContent from '../SystemSettingsContent';

const mockGetShowHiddenFiles = jest.fn();
const mockSetShowHiddenFiles = jest.fn();
jest.mock('../../../../utils/localStorage', () => ({
  getShowHiddenFiles: () => mockGetShowHiddenFiles(),
  setShowHiddenFiles: (value) => mockSetShowHiddenFiles(value),
}));

function renderSystemSettingsContent() {
  return renderWithProviders(
    <MyPageContentPanel>
      <SystemSettingsContent onMessage={jest.fn()} />
    </MyPageContentPanel>
  );
}

describe('SystemSettingsContent', () => {
  beforeEach(() => {
    mockGetShowHiddenFiles.mockReturnValue(false);
    mockSetShowHiddenFiles.mockClear();
  });

  it('renders registration and show hidden files toggles', async () => {
    renderSystemSettingsContent();

    await waitFor(() => {
      expect(screen.getByText(/allow registration/i)).toBeInTheDocument();
      expect(screen.getByText(/show sign-up button on login page/i)).toBeInTheDocument();
      expect(screen.getByText(/show hidden files and folders/i)).toBeInTheDocument();
    });

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(2);
  });

  it('registration toggle auto-saves on change', async () => {
    const user = userEvent.setup();
    let putBody;
    server.use(
      http.get('/api/admin/settings', () => HttpResponse.json({ registration_enabled: 'false' })),
      http.put('/api/admin/settings', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({ messageCode: 'serverMessages.admin.settingsSaved' });
      })
    );

    renderSystemSettingsContent();

    await waitFor(() => {
      expect(screen.getByText(/allow registration/i)).toBeInTheDocument();
    });

    const switches = screen.getAllByRole('switch');
    const registrationSwitch = switches[0];
    await user.click(registrationSwitch);

    await waitFor(() => {
      expect(putBody).toEqual({ registration_enabled: 'true' });
    });
    expect(screen.getByText(/registration setting saved/i)).toBeInTheDocument();
  });

  it('toggle show hidden files persists to localStorage', async () => {
    mockGetShowHiddenFiles.mockReturnValue(false);
    const user = userEvent.setup();

    renderSystemSettingsContent();

    await waitFor(() => {
      expect(screen.getByText(/show hidden files and folders/i)).toBeInTheDocument();
    });

    const switches = screen.getAllByRole('switch');
    const showHiddenSwitch = switches[1];
    await user.click(showHiddenSwitch);

    expect(mockSetShowHiddenFiles).toHaveBeenCalledWith(true);
    expect(screen.getByText(/show hidden files setting saved/i)).toBeInTheDocument();
  });

  it('data cleanup shows confirm dialog and runs on confirm', async () => {
    const user = userEvent.setup();
    let cleanupCalled = false;
    server.use(
      http.post('/api/admin/cleanup/orphaned', () => {
        cleanupCalled = true;
        return HttpResponse.json({
          results: {
            deletedPermissionFiles: 0,
            deletedUserFiles: 0,
            deletedEmailIndexFiles: 0,
            cleanedPermissionRequests: 0,
            errors: [],
          },
        });
      })
    );

    renderSystemSettingsContent();

    await waitFor(() => {
      expect(screen.getByText(/data cleanup/i)).toBeInTheDocument();
    });

    const dataCleanupButton = screen.getByRole('button', { name: /clean up/i });
    await user.click(dataCleanupButton);

    const dialog = screen.getByRole('dialog', { name: /confirm orphaned data cleanup/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/delete permission files for non-existent users/i)).toBeInTheDocument();

    const confirmButton = within(dialog).getByRole('button', { name: /clean up/i });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(cleanupCalled).toBe(true);
    });
    expect(screen.getByText(/no data to clean up/i)).toBeInTheDocument();
  });

  it('permission cleanup shows confirm dialog and runs on confirm', async () => {
    const user = userEvent.setup();
    let permissionCleanupCalled = false;
    server.use(
      http.post('/api/admin/permissions/ensure-home-owner-admin', () => {
        permissionCleanupCalled = true;
        return HttpResponse.json({
          updatedUsers: 0,
          upgradedPaths: 0,
          grantedPaths: 0,
          errors: [],
        });
      })
    );

    renderSystemSettingsContent();

    await waitFor(() => {
      expect(screen.getByText(/permission cleanup/i)).toBeInTheDocument();
    });

    const permissionTrigger = screen.getByRole('button', { name: /^run$/i });
    await user.click(permissionTrigger);

    const dialog = screen.getByRole('dialog', { name: /confirm permission cleanup/i });
    expect(dialog).toBeInTheDocument();

    const confirmButton = within(dialog).getByRole('button', { name: /^run$/i });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(permissionCleanupCalled).toBe(true);
    });
    expect(screen.getByText(/no permissions to fix/i)).toBeInTheDocument();
  });

  it('renders the Storage migration row alongside the existing cleanup rows', async () => {
    renderSystemSettingsContent();

    expect(await screen.findByText(/data cleanup/i)).toBeInTheDocument();
    expect(screen.getByText(/permission cleanup/i)).toBeInTheDocument();
    expect(screen.getByText(/storage migration/i)).toBeInTheDocument();
    expect(screen.getByText(/move blobs between webdav and s3/i)).toBeInTheDocument();
  });

  it('renders the Metadata migration row alongside the Storage migration row', async () => {
    renderSystemSettingsContent();

    expect(await screen.findByText(/metadata migration/i)).toBeInTheDocument();
    expect(screen.getByText(/copy metadata between sqlite and postgresql/i)).toBeInTheDocument();
    expect(screen.getByText(/storage migration/i)).toBeInTheDocument();
  });

  it('clicking the metadata migration action button opens MetadataMigrationDialog', async () => {
    const user = userEvent.setup();
    renderSystemSettingsContent();

    const metadataMigrationButton = await screen.findByRole('button', {
      name: /run metadata migration/i,
    });
    await user.click(metadataMigrationButton);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /metadata migration/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /scan target/i })).toBeInTheDocument();
  });

  it('shows the ".env setup needed" banner when the non-active backend holds metadata', async () => {
    server.use(
      http.get('/api/admin/migration/presence', () =>
        HttpResponse.json({ otherBackend: 'postgresql', otherHasData: true, settingsRows: 5 })
      )
    );

    const user = userEvent.setup();
    renderSystemSettingsContent();

    const banner = await screen.findByTestId('env-setup-needed-banner');
    expect(within(banner).getByText(/.env setup needed/i)).toBeInTheDocument();
    expect(within(banner).getByText(/metadata was detected in postgresql/i)).toBeInTheDocument();

    await user.click(within(banner).getByRole('button', { name: /open metadata migration/i }));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /metadata migration/i })).toBeInTheDocument();
    });
  });

  it('hides the ".env setup needed" banner when the non-active backend holds no metadata', async () => {
    server.use(
      http.get('/api/admin/migration/presence', () =>
        HttpResponse.json({ otherBackend: 'sqlite', otherHasData: false, settingsRows: null })
      )
    );

    renderSystemSettingsContent();

    await waitFor(() => {
      expect(screen.getByText(/allow registration/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('env-setup-needed-banner')).not.toBeInTheDocument();
  });

  it('hides the ".env setup needed" banner when the presence endpoint fails', async () => {
    server.use(
      http.get('/api/admin/migration/presence', () =>
        HttpResponse.json({ errorCode: 'serverErrors.msw.unhandled' }, { status: 500 })
      )
    );

    renderSystemSettingsContent();

    await waitFor(() => {
      expect(screen.getByText(/allow registration/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('env-setup-needed-banner')).not.toBeInTheDocument();
  });

  it('clicking the migration action button opens MigrationDialog', async () => {
    const user = userEvent.setup();
    renderSystemSettingsContent();

    const migrationButton = await screen.findByRole('button', { name: /run storage migration/i });
    await user.click(migrationButton);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /storage migration/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument();
  });

  it('opens with S3 destination fields default for a webdav source', async () => {
    const user = userEvent.setup();
    renderSystemSettingsContent();

    const migrationButton = await screen.findByRole('button', { name: /run storage migration/i });
    await user.click(migrationButton);

    const dialog = await screen.findByRole('dialog', { name: /storage migration/i });
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByText(/source: webdav/i)).toBeInTheDocument();
    expect(screen.getByText(/destination: s3/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bucket \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/access key \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/secret key \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/region/i)).toHaveValue('us-east-1');
  });

  it('renders the Advanced settings accordion and fetches config on expand', async () => {
    const user = userEvent.setup();
    renderSystemSettingsContent();

    const accordionTitle = await screen.findByText(/advanced settings/i);
    expect(accordionTitle).toBeInTheDocument();

    // Collapsed → no config groups rendered yet (config fetched lazily on expand).
    expect(screen.queryByText(/file storage/i)).not.toBeInTheDocument();

    await user.click(accordionTitle);

    expect(await screen.findByText(/server & security/i)).toBeInTheDocument();
    expect(screen.getAllByText(/file storage/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/email/i)).toBeInTheDocument();
    expect(screen.getAllByText(/set in .env/i).length).toBeGreaterThan(0);
  });

  it('shows a key-lost warning banner when the config status reports it', async () => {
    server.use(
      http.get('/api/admin/config', () => HttpResponse.json({ config: {}, key_lost_warning: true }))
    );

    renderSystemSettingsContent();

    expect(await screen.findByTestId('key-lost-warning')).toBeInTheDocument();
    expect(screen.getByText(/encryption key lost/i)).toBeInTheDocument();
  });

  it('hides the backend-health card when no backend is failing', async () => {
    renderSystemSettingsContent();

    await waitFor(() => {
      expect(screen.getByText(/allow registration/i)).toBeInTheDocument();
    });

    // Default MSW: postgresql ok, s3 unknown, webdav ok — nothing wrong → no card.
    expect(screen.queryByTestId('backend-health-card')).not.toBeInTheDocument();
  });

  it('renders only the failing backends on the backend-health card', async () => {
    server.use(
      http.get('/api/admin/config', () =>
        HttpResponse.json({
          config: {
            WEA_STORAGE_BACKEND: { value: 'postgresql', source: 'env', tier: 'T0', secret: false },
            WEA_FILE_STORAGE: { value: 's3', source: 'default', tier: 'T1', secret: false },
          },
          key_lost_warning: false,
        })
      ),
      http.get('/api/admin/health', () =>
        HttpResponse.json({
          backends: {
            postgresql: {
              status: 'fail',
              code: 'unreachable',
              hint: 'Cannot reach host',
              lastCheckedAt: '2026-01-01T00:00:00Z',
            },
            s3: { status: 'unknown' },
            webdav: { status: 'ok' },
          },
        })
      )
    );

    renderSystemSettingsContent();

    const card = await screen.findByTestId('backend-health-card');
    expect(within(card).getByText(/backend health/i)).toBeInTheDocument();
    expect(within(card).getByText(/postgresql/i)).toBeInTheDocument();
    expect(within(card).getByText(/FAIL/i)).toBeInTheDocument();
    expect(within(card).getByText(/Cannot reach host/i)).toBeInTheDocument();
    expect(within(card).getByText(/last checked/i)).toBeInTheDocument();
    // Healthy/unknown backends are not listed.
    expect(within(card).queryByText(/s3/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/webdav/i)).not.toBeInTheDocument();
  });

  it('ignores failures from backends not in use', async () => {
    server.use(
      http.get('/api/admin/health', () =>
        HttpResponse.json({
          backends: {
            postgresql: { status: 'ok' },
            s3: { status: 'unknown' },
            // WebDAV is failing but NOT the active file backend (s3 is) → no alert.
            webdav: { status: 'fail', code: 'unreachable', hint: 'Cannot reach host' },
          },
        })
      )
    );

    renderSystemSettingsContent();

    await waitFor(() => {
      expect(screen.getByText(/allow registration/i)).toBeInTheDocument();
    });

    // Default MSW config: WEA_STORAGE_BACKEND=sqlite, WEA_FILE_STORAGE=s3 → active = { s3 }.
    expect(screen.queryByTestId('backend-health-card')).not.toBeInTheDocument();
  });

  it('does not show a key-lost warning banner when the master key is present', async () => {
    renderSystemSettingsContent();

    await waitFor(() => {
      expect(screen.getByText(/allow registration/i)).toBeInTheDocument();
    });

    expect(screen.queryByTestId('key-lost-warning')).not.toBeInTheDocument();
  });
});
