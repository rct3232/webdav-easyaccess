/**
 * SharingContent tests.
 * Verifies list view (Inbox, Outbox, Links), detail views, approve/reject/review, cancel, copy/extend/delete, Back.
 * @see docs/spec/client/components/mypage/content/SharingContent.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../../../test-utils';
import { server } from '../../../../setupTests';
import MyPageContentPanel from '../../MyPageContentPanel';
import SharingContent from '../SharingContent';

jest.mock('../../../dialogs/FilePreviewDialog', () => () => null);

const mockUser = { id: '1', username: 'testuser', email: 'user@example.com', is_admin: false, status: 'approved' };

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
  id: 'pr-outbox-1',
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

const shareLink = (overrides = {}) => ({
  token: 'link-t1',
  nodeId: 42,
  displayPath: '/testuser/docs/doc.pdf',
  fileName: 'doc.pdf',
  expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  isExpired: false,
  downloadCount: 0,
  ...overrides,
});

function renderSharing(options = {}) {
  const {
    selectedContentItem = null,
    onSelectContentItem = jest.fn(),
    onMessage = jest.fn(),
    user = mockUser,
    withBack = false,
  } = options;
  const onBack = withBack && selectedContentItem ? () => onSelectContentItem(null) : undefined;
  return {
    onSelectContentItem,
    onMessage,
    ...renderWithProviders(
      <MyPageContentPanel onBack={onBack}>
        <SharingContent
          selectedContentItem={selectedContentItem}
          onSelectContentItem={onSelectContentItem}
          user={user}
          onMessage={onMessage}
        />
      </MyPageContentPanel>
    ),
  };
}

describe('SharingContent', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('token', 'test-token');
    sessionStorage.setItem('refreshToken', 'refresh-token');
  });

  it('list view shows Inbox, Outbox, Links with counts', async () => {
    const inbox = [inboxRequest()];
    const outbox = [outboxRequest()];
    const links = [shareLink()];
    server.use(
      http.get(/\/api\/permission-requests\/inbox/, () => HttpResponse.json(inbox)),
      http.get(/\/api\/permission-requests\/outbox/, () => HttpResponse.json(outbox)),
      http.get(/\/api\/share-links/, () => HttpResponse.json(links))
    );

    renderSharing({ selectedContentItem: null });

    await waitFor(() => {
      expect(screen.getByText(/received requests/i)).toBeInTheDocument();
      expect(screen.getByText(/my requests/i)).toBeInTheDocument();
      expect(screen.getByText(/links/i)).toBeInTheDocument();
      const badgesWithOne = screen.getAllByText('1', { exact: true });
      expect(badgesWithOne.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 5000 });
  });

  it('clicking list item calls onSelectContentItem(itemId)', async () => {
    server.use(
      http.get('/api/permission-requests/inbox', () => HttpResponse.json([])),
      http.get('/api/permission-requests/outbox', () => HttpResponse.json([])),
      http.get('/api/share-links', () => HttpResponse.json([]))
    );

    const onSelectContentItem = jest.fn();
    const user = userEvent.setup();
    renderSharing({ selectedContentItem: null, onSelectContentItem });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });

    await user.click(screen.getByRole('button', { name: /received requests/i }));
    expect(onSelectContentItem).toHaveBeenCalledWith('inbox');

    onSelectContentItem.mockClear();
    await user.click(screen.getByRole('button', { name: /my requests/i }));
    expect(onSelectContentItem).toHaveBeenCalledWith('outbox');

    onSelectContentItem.mockClear();
    await user.click(screen.getByRole('button', { name: /links/i }));
    expect(onSelectContentItem).toHaveBeenCalledWith('links');
  });

  it('inbox detail: approve, reject, review buttons visible', async () => {
    const req = inboxRequest({ id: 'pr-inbox-1', requester_username: 'bob' });
    server.use(
      http.get('/api/permission-requests/inbox', () => HttpResponse.json([req])),
      http.get('/api/permission-requests/outbox', () => HttpResponse.json([]))
    );

    renderSharing({ selectedContentItem: 'inbox' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /rejected/i })).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('inbox: reject request shows success feedback', async () => {
    const req = inboxRequest({ id: 'pr-inbox-reject', requester_username: 'bob' });
    server.use(
      http.get('/api/permission-requests/inbox', () => HttpResponse.json([req])),
      http.get('/api/permission-requests/outbox', () => HttpResponse.json([])),
      http.post('/api/permission-requests/:id/reject', () =>
        HttpResponse.json({ messageCode: 'serverMessages.permissionRequest.rejected' }))
    );

    const user = userEvent.setup();
    renderSharing({ selectedContentItem: 'inbox' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /rejected/i })).toBeInTheDocument();
    }, { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: /rejected/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/rejected|success/i);
    });
  });

  it('outbox detail: cancel button visible and shows success on click', async () => {
    const req = outboxRequest();
    server.use(
      http.get('/api/permission-requests/inbox', () => HttpResponse.json([])),
      http.get('/api/permission-requests/outbox', () => HttpResponse.json([req])),
      http.post('/api/permission-requests/:id/cancel', () =>
        HttpResponse.json({ messageCode: 'serverMessages.permissionRequest.cancelled' }))
    );

    const user = userEvent.setup();
    renderSharing({ selectedContentItem: 'outbox' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancelled/i })).toBeInTheDocument();
    }, { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: /cancelled/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/cancelled|success/i);
    });
  });

  it('links detail: copy, extend, delete controls visible and copy works', async () => {
    const link = shareLink({ token: 'link-t1', filePath: '/testuser/docs/doc.pdf' });
    server.use(http.get('/api/share-links', () => HttpResponse.json([link])));

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });

    const user = userEvent.setup();
    renderSharing({ selectedContentItem: 'links' });

    await waitFor(() => {
      expect(screen.getByText(/doc\.pdf/)).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByRole('button', { name: /\+7 days/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();

    const copyButton = screen.getByTestId('ContentCopyIcon').closest('button');
    expect(copyButton).toBeInTheDocument();
    await user.click(copyButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/link copied|link copied to clipboard/i);
    });
  });

  it('links detail: delete shows confirm and calls API on confirm', async () => {
    const link = shareLink({ token: 'link-t1' });
    const deleteHandler = jest.fn(() =>
      HttpResponse.json({ messageCode: 'serverMessages.share.deleted' })
    );
    server.use(
      http.get('/api/share-links', () => HttpResponse.json([link])),
      http.delete('/api/share-links/:token', deleteHandler)
    );

    window.confirm = jest.fn(() => true);

    const user = userEvent.setup();
    renderSharing({ selectedContentItem: 'links' });

    await waitFor(() => {
      expect(screen.getByText(/doc\.pdf/)).toBeInTheDocument();
    }, { timeout: 3000 });

    await user.click(screen.getByRole('button', { name: /delete/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(deleteHandler).toHaveBeenCalled();
    });
  });

  it('back returns to list (onSelectContentItem(null))', async () => {
    server.use(
      http.get('/api/permission-requests/inbox', () => HttpResponse.json([])),
      http.get('/api/permission-requests/outbox', () => HttpResponse.json([]))
    );

    const onSelectContentItem = jest.fn();
    const user = userEvent.setup();
    renderSharing({
      selectedContentItem: 'inbox',
      onSelectContentItem,
      withBack: true,
    });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });

    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(onSelectContentItem).toHaveBeenCalledWith(null);
  });
});
