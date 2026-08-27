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
      http.get('/api/admin/settings', () =>
        HttpResponse.json({ registration_enabled: 'false' })
      ),
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
        return HttpResponse.json({ updatedUsers: 0, upgradedPaths: 0, grantedPaths: 0, errors: [] });
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

  it('opens with S3 destination fields default for webdav-to-s3', async () => {
    const user = userEvent.setup();
    renderSystemSettingsContent();

    const migrationButton = await screen.findByRole('button', { name: /run storage migration/i });
    await user.click(migrationButton);

    const dialog = await screen.findByRole('dialog', { name: /storage migration/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /webdav → s3/i })).toBeChecked();
    expect(screen.getByLabelText(/bucket \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/access key \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/secret key \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/region/i)).toHaveValue('us-east-1');
  });
});
