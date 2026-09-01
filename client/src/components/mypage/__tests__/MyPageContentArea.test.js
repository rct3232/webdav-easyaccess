/**
 * MyPageContentArea tests.
 * Verifies correct content for each category, list/detail patterns, Back and onSelectContentItem.
 * @see docs/spec/client/components/mypage/MyPageContentArea.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../../test-utils';
import { server } from '../../../setupTests';
import MyPageContentArea from '../MyPageContentArea';

jest.mock('../../../components/dialogs/FilePreviewDialog', () => () => null);

const mockUser = {
  id: '1',
  username: 'testuser',
  email: 'user@example.com',
  is_admin: false,
  status: 'approved',
};

const adminHandlers = () => [
  http.get('/api/auth/me', () => HttpResponse.json({ ...mockUser, is_admin: true })),
  http.get('/api/admin/users/pending', () => HttpResponse.json([])),
  http.get('/api/admin/users', () =>
    HttpResponse.json([{ id: '2', username: 'user2', status: 'approved' }])
  ),
  http.get('/api/admin/settings', () => HttpResponse.json({ registration_enabled: 'false' })),
];

describe('MyPageContentArea', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('token', 'test-token');
    sessionStorage.setItem('refreshToken', 'refresh-token');
  });

  describe('renders correct content for each selectedCategory', () => {
    it('account: shows AccountContent with username', async () => {
      renderWithProviders(
        <MyPageContentArea
          selectedCategory="account"
          selectedContentItem={null}
          onSelectContentItem={jest.fn()}
          user={mockUser}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /account info/i })).toBeInTheDocument();
      });
      expect(screen.getByText('testuser')).toBeInTheDocument();
    });

    it('preferences: shows PreferencesContent with language option', async () => {
      renderWithProviders(
        <MyPageContentArea
          selectedCategory="preferences"
          selectedContentItem={null}
          onSelectContentItem={jest.fn()}
          user={mockUser}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /preferences/i })).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /language/i })).toBeInTheDocument();
    });

    it('sharing: shows list with Inbox, Outbox, Links after loading', async () => {
      server.use(
        http.get('/api/permission-requests/inbox', () => HttpResponse.json([])),
        http.get('/api/permission-requests/outbox', () => HttpResponse.json([])),
        http.get('/api/share-links', () => HttpResponse.json([]))
      );

      renderWithProviders(
        <MyPageContentArea
          selectedCategory="sharing"
          selectedContentItem={null}
          onSelectContentItem={jest.fn()}
          user={mockUser}
        />
      );

      await waitFor(
        () => {
          expect(screen.getByText(/received requests/i)).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
      expect(screen.getByText(/my requests/i)).toBeInTheDocument();
      expect(screen.getByText(/links/i)).toBeInTheDocument();
    });

    it('admin-users: shows UserManagementContent when user is admin', async () => {
      server.use(...adminHandlers());

      renderWithProviders(
        <MyPageContentArea
          selectedCategory="admin-users"
          selectedContentItem={null}
          onSelectContentItem={jest.fn()}
          user={{ ...mockUser, is_admin: true }}
        />
      );

      await waitFor(
        () => {
          expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        },
        { timeout: 5000 }
      );

      expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
      expect(screen.getByText('user2')).toBeInTheDocument();
    });

    it('admin-settings: shows SystemSettingsContent when user is admin', async () => {
      server.use(...adminHandlers());

      renderWithProviders(
        <MyPageContentArea
          selectedCategory="admin-settings"
          selectedContentItem={null}
          onSelectContentItem={jest.fn()}
          user={{ ...mockUser, is_admin: true }}
        />
      );

      await waitFor(
        () => {
          expect(screen.getByText(/system settings/i)).toBeInTheDocument();
        },
        { timeout: 5000 }
      );
      expect(screen.getByText(/registration/i)).toBeInTheDocument();
    });
  });

  describe('single-item categories show content directly', () => {
    it('account: no Back button, direct content', async () => {
      renderWithProviders(
        <MyPageContentArea
          selectedCategory="account"
          selectedContentItem={null}
          onSelectContentItem={jest.fn()}
          user={mockUser}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('testuser')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
    });

    it('preferences: no Back button, direct content', async () => {
      renderWithProviders(
        <MyPageContentArea
          selectedCategory="preferences"
          selectedContentItem={null}
          onSelectContentItem={jest.fn()}
          user={mockUser}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /language/i })).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
    });
  });

  describe('multi-item categories', () => {
    it('null selectedContentItem shows list with Inbox, Outbox, Links', async () => {
      server.use(
        http.get('/api/permission-requests/inbox', () => HttpResponse.json([])),
        http.get('/api/permission-requests/outbox', () => HttpResponse.json([])),
        http.get('/api/share-links', () => HttpResponse.json([]))
      );

      renderWithProviders(
        <MyPageContentArea
          selectedCategory="sharing"
          selectedContentItem={null}
          onSelectContentItem={jest.fn()}
          user={mockUser}
        />
      );

      await waitFor(
        () => {
          expect(screen.getByText(/received requests/i)).toBeInTheDocument();
          expect(screen.getByText(/my requests/i)).toBeInTheDocument();
          expect(screen.getByText(/links/i)).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
    });

    it('non-null selectedContentItem shows detail with Back button', async () => {
      server.use(
        http.get('/api/permission-requests/inbox', () => HttpResponse.json([])),
        http.get('/api/permission-requests/outbox', () => HttpResponse.json([])),
        http.get('/api/share-links', () => HttpResponse.json([]))
      );

      renderWithProviders(
        <MyPageContentArea
          selectedCategory="sharing"
          selectedContentItem="inbox"
          onSelectContentItem={jest.fn()}
          user={mockUser}
        />
      );

      await waitFor(
        () => {
          expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
      expect(screen.getByText(/received requests/i)).toBeInTheDocument();
    });
  });

  describe('Back and list item interactions', () => {
    it('Back button calls onSelectContentItem(null)', async () => {
      const onSelectContentItem = jest.fn();
      server.use(
        http.get('/api/permission-requests/inbox', () => HttpResponse.json([])),
        http.get('/api/permission-requests/outbox', () => HttpResponse.json([])),
        http.get('/api/share-links', () => HttpResponse.json([]))
      );

      const user = userEvent.setup();
      renderWithProviders(
        <MyPageContentArea
          selectedCategory="sharing"
          selectedContentItem="inbox"
          onSelectContentItem={onSelectContentItem}
          user={mockUser}
        />
      );

      await waitFor(
        () => {
          expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      await user.click(screen.getByRole('button', { name: /back/i }));
      expect(onSelectContentItem).toHaveBeenCalledWith(null);
    });

    it('list item click calls onSelectContentItem with item id', async () => {
      const onSelectContentItem = jest.fn();
      server.use(
        http.get('/api/permission-requests/inbox', () => HttpResponse.json([])),
        http.get('/api/permission-requests/outbox', () => HttpResponse.json([])),
        http.get('/api/share-links', () => HttpResponse.json([]))
      );

      const user = userEvent.setup();
      renderWithProviders(
        <MyPageContentArea
          selectedCategory="sharing"
          selectedContentItem={null}
          onSelectContentItem={onSelectContentItem}
          user={mockUser}
        />
      );

      await waitFor(
        () => {
          expect(screen.getByText(/received requests/i)).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      await user.click(screen.getByText(/received requests/i));
      expect(onSelectContentItem).toHaveBeenCalledWith('inbox');
    });
  });
});
