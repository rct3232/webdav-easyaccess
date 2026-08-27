/**
 * AdminContent settings-tab tests for the Storage migration row.
 * Verifies the Storage migration action row opens MigrationDialog.
 * @see docs/spec/client/components/mypage/content/MigrationDialog.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../test-utils';
import MyPageContentPanel from '../../MyPageContentPanel';
import AdminContent from '../AdminContent';

const mockAdminUser = {
  id: 'admin1',
  username: 'adminuser',
  email: 'admin@example.com',
  status: 'approved',
  is_admin: true,
};

function renderAdminSettings() {
  return renderWithProviders(
    <MyPageContentPanel>
      <AdminContent
        selectedContentItem="settings"
        onSelectContentItem={jest.fn()}
        user={mockAdminUser}
        onMessage={jest.fn()}
      />
    </MyPageContentPanel>
  );
}

describe('AdminContent settings tab', () => {
  it('shows the storage migration action row and opens MigrationDialog', async () => {
    renderAdminSettings();

    const migrationButton = await waitFor(() => screen.getByRole('button', { name: /run storage migration/i }));
    expect(screen.getByText(/storage migration/i)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(migrationButton);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /storage migration/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('radio', { name: /webdav → s3/i })).toBeInTheDocument();
  });
});
