/**
 * AdminDashboard page tests.
 * Verifies tabs, user list, approve/reject, delete, create user, settings, cleanup per spec.
 * @see docs/spec/client/pages/AdminDashboard.md 2.6
 */
jest.mock('../../components/dialogs/FilePreviewDialog', () => () => null);

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test-utils';
import { server } from '../../setupTests';
import AdminDashboard from '../AdminDashboard';

const pendingUser = { id: 'p1', username: 'pending1', email: 'p1@ex.com', status: 'pending', created_at: new Date().toISOString(), is_admin: false };
const approvedUser = { id: '1', username: 'user1', email: 'user1@ex.com', status: 'approved', created_at: new Date().toISOString(), is_admin: false };

describe('AdminDashboard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('token', 'admin-token');
    sessionStorage.setItem('refreshToken', 'refresh');
  });

  it('renders admin title and tabs', async () => {
    renderWithProviders(<AdminDashboard />, { initialEntries: ['/admin'] });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 3000 });
    expect(screen.getByText(/admin|dashboard/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /users/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /settings/i })).toBeInTheDocument();
  });

  it('shows user list from API', async () => {
    renderWithProviders(<AdminDashboard />, { initialEntries: ['/admin'] });
    await waitFor(() => {
      expect(screen.getByText(/admin|user1|pending1/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('approves pending user', async () => {
    server.use(
      http.get('/api/admin/users/pending', () => HttpResponse.json([pendingUser])),
      http.get('/api/admin/users', () => HttpResponse.json([approvedUser])),
      http.get('/api/admin/settings', () => HttpResponse.json({ registration_enabled: 'false' })),
      http.post('/api/admin/users/:id/approve', () =>
        HttpResponse.json({ messageCode: 'serverMessages.admin.userApproved' }))
    );

    const user = userEvent.setup();
    renderWithProviders(<AdminDashboard />, { initialEntries: ['/admin'] });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 3000 });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/success|approved/i);
    });
  });

  it('rejects pending user', async () => {
    server.use(
      http.get('/api/admin/users/pending', () => HttpResponse.json([{ ...pendingUser }])),
      http.get('/api/admin/users', () => HttpResponse.json([approvedUser])),
      http.get('/api/admin/settings', () => HttpResponse.json({ registration_enabled: 'false' })),
      http.post('/api/admin/users/:id/reject', () =>
        HttpResponse.json({ messageCode: 'serverMessages.admin.userRejected' }))
    );

    const user = userEvent.setup();
    renderWithProviders(<AdminDashboard />, { initialEntries: ['/admin'] });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 3000 });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /reject/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/success|rejected/i);
    });
  });

  it('deletes user with confirmation', async () => {
    server.use(
      http.get('/api/admin/users/pending', () => HttpResponse.json([])),
      http.get('/api/admin/users', () => HttpResponse.json([approvedUser])),
      http.get('/api/admin/settings', () => HttpResponse.json({ registration_enabled: 'false' })),
      http.delete('/api/admin/users/:id', () =>
        HttpResponse.json({ messageCode: 'serverMessages.admin.userDeleted' }))
    );

    const user = userEvent.setup();
    renderWithProviders(<AdminDashboard />, { initialEntries: ['/admin'] });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 3000 });

    await waitFor(() => {
      expect(screen.getByRole('cell', { name: 'user1' })).toBeInTheDocument();
    });
    const deleteBtns = screen.getAllByRole('button', { name: /delete/i });
    await user.click(deleteBtns[deleteBtns.length - 1]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    const confirmBtn = screen.getByRole('button', { name: /^delete$/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/success|deleted/i);
    });
  });

  it('creates user with validation', async () => {
    jest.setTimeout(10000);
    server.use(
      http.get('/api/admin/users/pending', () => HttpResponse.json([])),
      http.get('/api/admin/users', () => HttpResponse.json([approvedUser])),
      http.get('/api/admin/settings', () => HttpResponse.json({ registration_enabled: 'false' })),
      http.post('/api/admin/users', () =>
        HttpResponse.json({ id: 'u2', username: 'newuser', email: 'new@ex.com', status: 'approved' }, { status: 201 }))
    );

    const user = userEvent.setup();
    renderWithProviders(<AdminDashboard />, { initialEntries: ['/admin'] });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 3000 });

    await user.click(screen.getByRole('button', { name: /add user|add/i }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/username/i), 'newuser');
    await user.type(screen.getByLabelText(/email/i), 'new@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'ValidPass123!');
    await user.type(screen.getByLabelText(/confirm/i), 'ValidPass123!');
    await user.click(screen.getByRole('button', { name: /add|add user/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/success|added/i);
    }, { timeout: 3000 });
  });

  it('settings: toggle registration and save', async () => {
    server.use(
      http.get('/api/admin/users/pending', () => HttpResponse.json([])),
      http.get('/api/admin/users', () => HttpResponse.json([approvedUser])),
      http.get('/api/admin/settings', () => HttpResponse.json({ registration_enabled: 'false' })),
      http.put('/api/admin/settings', () =>
        HttpResponse.json({ messageCode: 'serverMessages.admin.settingsSaved' }))
    );

    const user = userEvent.setup();
    renderWithProviders(<AdminDashboard />, { initialEntries: ['/admin'] });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 3000 });

    await user.click(screen.getByRole('tab', { name: /settings/i }));
    await waitFor(() => {
      expect(screen.getByText(/system settings/i)).toBeInTheDocument();
    });

    // Registration switch is the first switch in Settings
    const switchEl = screen.getAllByRole('switch')[0];
    await user.click(switchEl);
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/success|saved/i);
    });
  });

  it('cleanup orphaned shows success', async () => {
    server.use(
      http.get('/api/admin/users/pending', () => HttpResponse.json([])),
      http.get('/api/admin/users', () => HttpResponse.json([approvedUser])),
      http.get('/api/admin/settings', () => HttpResponse.json({ registration_enabled: 'false' })),
      http.post('/api/admin/cleanup/orphaned', () =>
        HttpResponse.json({ results: { deletedPermissionFiles: 0, deletedUserFiles: 0, deletedEmailIndexFiles: 0, cleanedPermissionRequests: 0, errors: [] } }))
    );

    const user = userEvent.setup();
    renderWithProviders(<AdminDashboard />, { initialEntries: ['/admin'] });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 3000 });

    await user.click(screen.getByRole('tab', { name: /settings/i }));
    await waitFor(() => {
      expect(screen.getByText(/data cleanup|orphan/i)).toBeInTheDocument();
    });

    const dataCleanupTrigger = screen.getByRole('button', { name: /clean up/i });
    await user.click(dataCleanupTrigger);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    const confirmBtn = screen.getByRole('button', { name: /delete|clean|run|confirm/i });
    await user.click(confirmBtn);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('switches to settings tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminDashboard />, { initialEntries: ['/admin'] });
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 3000 });
    await user.click(screen.getByRole('tab', { name: /settings/i }));
    expect(screen.getByText(/system settings/i)).toBeInTheDocument();
  });

  it('non-admin 403 triggers redirect (apiClient history.back) or shows error', async () => {
    const origHistory = window.history;
    const origLocation = window.location;
    const backMock = jest.fn();
    delete window.history;
    window.history = { ...origHistory, length: 2, back: backMock };
    delete window.location;
    window.location = { href: origLocation.href };

    server.use(
      http.get('/api/admin/users/pending', () => HttpResponse.json({ errorCode: 'serverErrors.admin.forbidden' }, { status: 403 })),
      http.get('/api/admin/users', () => HttpResponse.json({ errorCode: 'serverErrors.admin.forbidden' }, { status: 403 })),
      http.get('/api/admin/settings', () => HttpResponse.json({ errorCode: 'serverErrors.admin.forbidden' }, { status: 403 })),
      http.post('/api/auth/refresh', async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        if (!body.refreshToken) {
          return HttpResponse.json({ errorCode: 'serverErrors.auth.refreshTokenInvalid' }, { status: 401 });
        }
        return HttpResponse.json({ token: 'mock-jwt-token-refreshed' });
      })
    );

    renderWithProviders(<AdminDashboard />, { initialEntries: ['/admin'] });

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }, { timeout: 5000 });

    await waitFor(() => {
      expect(backMock).toHaveBeenCalled();
    }, { timeout: 3000 });

    const alert = screen.queryByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveClass('MuiAlert-standardError');

    window.history = origHistory;
    window.location = origLocation;
  });
});
