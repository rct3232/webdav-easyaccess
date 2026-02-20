/**
 * MyPage page tests.
 * Verifies account info, permission requests (inbox approve/reject, outbox cancel) per spec.
 * Uses server.use to control inbox/outbox responses (per RCA).
 * @see docs/spec/client/pages/MyPage.md 2.6
 */
jest.mock('../../components/dialogs/FilePreviewDialog', () => () => null);

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test-utils';
import { server } from '../../setupTests';
import MyPage from '../MyPage';

const inboxRequest = (overrides = {}) => ({
  id: 'pr-inbox-1',
  requester_id: '2',
  requester_username: 'alice',
  owner_id: '1',
  folder_path: '/testuser/shared',
  file_path: null,
  target_type: 'folder',
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
  folder_path: '/owner/folder',
  file_path: null,
  target_type: 'folder',
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
  });

  it('renders without crashing and shows main content', async () => {
    renderWithProviders(<MyPage />, { initialEntries: ['/mypage'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });

    expect(document.body.textContent.length).toBeGreaterThan(100);
    expect(document.body.textContent).toMatch(/inbox|outbox|link|permission|account|username|mypage/i);
  });

  it('displays account info for current user', async () => {
    renderWithProviders(<MyPage />, { initialEntries: ['/mypage'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });

    expect(screen.getByText(/account info/i)).toBeInTheDocument();
    expect(screen.getByText(/testuser/)).toBeInTheDocument();
    expect(screen.getByText(/user@example\.com/)).toBeInTheDocument();
  });

  it('share links tab: shows list when API returns links', async () => {
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

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });

    const linksTab = screen.getByRole('tab', { name: /links \(\d+\)/i });
    await user.click(linksTab);

    await waitFor(() => {
      expect(screen.getByText(/doc\.pdf/)).toBeInTheDocument();
    });
  });

  it('share links tab: shows empty state when no links', async () => {
    server.use(
      http.get('/api/share-links', () => HttpResponse.json([])),
      http.get('/api/permission-requests/inbox', () => HttpResponse.json([])),
      http.get('/api/permission-requests/outbox', () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    renderWithProviders(<MyPage />, { initialEntries: ['/mypage'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });

    const linksTab = screen.getByRole('tab', { name: /links \(\d+\)/i });
    await user.click(linksTab);

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

    renderWithProviders(<MyPage />, { initialEntries: ['/mypage'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /rejected/i })).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('inbox: approve file request shows success', async () => {
    const req = inboxRequest({
      id: 'pr-inbox-approve',
      requester_username: 'bob',
      target_type: 'file',
      file_path: '/testuser/docs/file.pdf',
      folder_path: null,
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

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });

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

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });

    await user.click(screen.getByRole('tab', { name: /my requests/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancelled/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /cancelled/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/cancelled|success/i);
    });
  });
});
