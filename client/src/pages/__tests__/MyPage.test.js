/**
 * MyPage page tests.
 * Verifies account info, permission requests (inbox approve/reject, outbox cancel),
 * Admin category (Users, Settings) per spec. Chrome-style layout: category sidebar + list/detail.
 * Uses server.use to control inbox/outbox responses (per RCA).
 * @see docs/spec/client/pages/MyPage.md
 */
jest.mock('../../components/dialogs/FilePreviewDialog', () => () => null);
jest.mock('../../hooks/useResponsive', () => ({
  useResponsive: jest.fn(),
}));

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useResponsive } from '../../hooks/useResponsive';
import { renderWithProviders } from '../../test-utils';
import { server } from '../../setupTests';
import MyPage from '../MyPage';

/** Select Sharing category, then a sub-item (inbox/outbox/links). Non-admin user sees Sharing. Uses label pattern; count is shown via Badge. */
const selectSharingAndItem = async (user, labelPattern) => {
  const sharingButton = await screen.findByRole(
    'button',
    { name: /share management/i },
    { timeout: 5000 }
  );
  await user.click(sharingButton);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: labelPattern })).toBeInTheDocument();
  }, { timeout: 3000 });
  await user.click(screen.getByRole('button', { name: labelPattern }));
};

const waitForMyPageReady = async () => {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  }, { timeout: 5000 });
};

const inboxRequest = (overrides = {}) => ({
  id: 'pr-inbox-1',
  requester_id: '2',
  requester_username: 'alice',
  owner_id: '1',
  file_node_id: 101,
  targetType: 'folder',
  requested_permission: 'read',
  status: 'pending',
  created_at: new Date().toISOString(),
  ...overrides,
});

const outboxRequest = (overrides = {}) => ({
  id: 'pr-outbox-cancel',
  requester_id: '1',
  owner_id: '2',
  owner_username: 'owner',
  file_node_id: 202,
  targetType: 'folder',
  requested_permission: 'read',
  status: 'pending',
  created_at: new Date().toISOString(),
  ...overrides,
});

describe('MyPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('token', 'test-token');
    sessionStorage.setItem('refreshToken', 'refresh-token');
    useResponsive.mockReturnValue({
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      isSmallMobile: false,
    });
  });

  it('renders without crashing and shows main content', async () => {
    renderWithProviders(<MyPage />, { initialEntries: ['/mypage'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /account info/i })).toBeInTheDocument();
      expect(screen.getByText(/testuser/)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('displays account info for current user', async () => {
    renderWithProviders(<MyPage />, { initialEntries: ['/mypage'] });

    await waitForMyPageReady();

    expect(await screen.findByRole('heading', { name: /account info/i })).toBeInTheDocument();
    expect(screen.getByText(/testuser/)).toBeInTheDocument();
    expect(screen.getByText(/user@example\.com/)).toBeInTheDocument();
  });

  it('share links: shows list when API returns links', async () => {
    const link = {
      token: 'link-t1',
      filePath: '/testuser/docs/doc.pdf',
      fileName: 'doc.pdf',
      expiresAt: null,
      isExpired: false,
      downloadCount: 0,
    };
    server.use(
      http.get('/api/share-links', () => HttpResponse.json([link])),
      http.get('/api/permission-requests/inbox', () => HttpResponse.json([])),
      http.get('/api/permission-requests/outbox', () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    renderWithProviders(<MyPage />, { initialEntries: ['/mypage'] });

    await waitForMyPageReady();

    await selectSharingAndItem(user, /links/i);

    await waitFor(() => {
      expect(screen.getByText(/doc\.pdf/)).toBeInTheDocument();
    });
  });

  it('share links: shows empty state when no links', async () => {
    server.use(
      http.get('/api/share-links', () => HttpResponse.json([])),
      http.get('/api/permission-requests/inbox', () => HttpResponse.json([])),
      http.get('/api/permission-requests/outbox', () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    renderWithProviders(<MyPage />, { initialEntries: ['/mypage'] });

    await waitForMyPageReady();

    await selectSharingAndItem(user, /links/i);

    await waitFor(() => {
      expect(screen.getByText(/no share links created/i)).toBeInTheDocument();
    });
  });

  it('inbox: shows pending request with Review and Rejected buttons', async () => {
    const req = inboxRequest({ id: 'pr-inbox-1' });
    server.use(
      http.get('/api/permission-requests/inbox', () => HttpResponse.json([req])),
      http.get('/api/permission-requests/outbox', () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    renderWithProviders(<MyPage />, { initialEntries: ['/mypage'] });

    await waitForMyPageReady();

    await selectSharingAndItem(user, /received requests/i);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /rejected/i })).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('inbox: approve file request shows success', async () => {
    const req = inboxRequest({
      id: 'pr-inbox-approve',
      requester_username: 'bob',
      targetType: 'file',
      file_node_id: 101,
    });
    server.use(
      http.get('/api/permission-requests/inbox', () => HttpResponse.json([req])),
      http.get('/api/permission-requests/outbox', () => HttpResponse.json([])),
      http.post('/api/permissions/grant', () => HttpResponse.json({})),
      http.post('/api/permission-requests/:id/approve', () =>
        HttpResponse.json({ messageCode: 'serverMessages.permissionRequest.approved' }))
    );

    const user = userEvent.setup();
    renderWithProviders(<MyPage />, { initialEntries: ['/mypage'] });

    await waitForMyPageReady();

    await selectSharingAndItem(user, /received requests/i);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approved/i })).toBeInTheDocument();
    }, { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: /approved/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/approved|success/i);
    });
  });

  it('inbox: reject request shows success', async () => {
    const req = inboxRequest({ id: 'pr-inbox-reject', requester_username: 'bob' });
    server.use(
      http.get('/api/permission-requests/inbox', () => HttpResponse.json([req])),
      http.get('/api/permission-requests/outbox', () => HttpResponse.json([])),
      http.post('/api/permission-requests/:id/reject', () =>
        HttpResponse.json({ messageCode: 'serverMessages.permissionRequest.rejected' }))
    );

    const user = userEvent.setup();
    renderWithProviders(<MyPage />, { initialEntries: ['/mypage'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });

    await selectSharingAndItem(user, /received requests/i);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /rejected/i })).toBeInTheDocument();
    }, { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: /rejected/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/rejected|success/i);
    });
  });

  it('outbox: cancel request shows success', async () => {
    const req = outboxRequest();
    server.use(
      http.get('/api/permission-requests/outbox', () => HttpResponse.json([req])),
      http.post('/api/permission-requests/:id/cancel', () =>
        HttpResponse.json({ messageCode: 'serverMessages.permissionRequest.cancelled' }))
    );

    const user = userEvent.setup();
    renderWithProviders(<MyPage />, { initialEntries: ['/mypage'] });

    await waitForMyPageReady();

    await selectSharingAndItem(user, /my requests/i);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancelled/i })).toBeInTheDocument();
    }, { timeout: 3000 });

    await user.click(screen.getByRole('button', { name: /cancelled/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/cancelled|success/i);
    });
  });

  it('mobile: opens the category drawer and closes it after selecting a category', async () => {
    useResponsive.mockReturnValue({
      isMobile: true,
      isTablet: false,
      isDesktop: false,
      isSmallMobile: false,
    });

    const user = userEvent.setup();
    renderWithProviders(<MyPage />, { initialEntries: ['/mypage'] });

    await waitForMyPageReady();

    expect(screen.queryByRole('button', { name: /preferences/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /my page|mypage/i }));

    const preferencesButton = await screen.findByRole('button', { name: /preferences/i });
    await user.click(preferencesButton);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /preferences/i })).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /share management/i })).not.toBeInTheDocument();
    });
  });
});

describe('MyPage Admin categories (User Management, System Settings)', () => {
  const pendingUser = { id: 'p1', username: 'pending1', email: 'p1@ex.com', status: 'pending', created_at: new Date().toISOString(), is_admin: false };
  const approvedUser = { id: '1', username: 'user1', email: 'user1@ex.com', status: 'approved', created_at: new Date().toISOString(), is_admin: false };

  const adminHandlers = () => [
    http.get('/api/auth/me', () =>
      HttpResponse.json({ id: '1', username: 'admin', email: 'admin@ex.com', is_admin: true, status: 'approved' })),
    http.get('/api/admin/users/pending', () => HttpResponse.json([pendingUser])),
    http.get('/api/admin/users', () => HttpResponse.json([approvedUser])),
    http.get('/api/admin/settings', () => HttpResponse.json({ registration_enabled: 'false' })),
  ];

  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('token', 'admin-token');
    sessionStorage.setItem('refreshToken', 'refresh');
    useResponsive.mockReturnValue({
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      isSmallMobile: false,
    });
  });

  it('admin: shows User Management when admin category (legacy) selected', async () => {
    server.use(...adminHandlers());

    renderWithProviders(<MyPage />, { initialEntries: [{ pathname: '/mypage', state: { category: 'admin' } }] });

    await waitForMyPageReady();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
      expect(screen.getByText('user1')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('admin: shows user list when User Management category selected', async () => {
    server.use(...adminHandlers());

    renderWithProviders(<MyPage />, { initialEntries: [{ pathname: '/mypage', state: { category: 'admin-users' } }] });

    await waitForMyPageReady();

    expect(await screen.findByText('user1')).toBeInTheDocument();
  });

  it('admin: approves pending user', async () => {
    server.use(
      ...adminHandlers(),
      http.post('/api/admin/users/:id/approve', () =>
        HttpResponse.json({ messageCode: 'serverMessages.admin.userApproved' }))
    );

    const user = userEvent.setup();
    renderWithProviders(<MyPage />, { initialEntries: [{ pathname: '/mypage', state: { category: 'admin-users' } }] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    }, { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/success|approved/i);
    });
  });

  it('admin: shows System Settings when Settings category selected', async () => {
    server.use(...adminHandlers());

    const user = userEvent.setup();
    renderWithProviders(<MyPage />, { initialEntries: [{ pathname: '/mypage', state: { category: 'admin-users' } }] });

    await waitForMyPageReady();

    await user.click(await screen.findByRole('button', { name: /settings/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /system settings/i })).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
