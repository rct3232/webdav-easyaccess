/**
 * UserManagementContent tests.
 * Verifies observable outcomes per spec: Add button, user list, approve/reject,
 * delete with confirm, create user with validation, ShareDialog on user card click.
 * @see docs/spec/client/components/mypage/content/UserManagementContent.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../../../test-utils';
import { server } from '../../../../setupTests';
import MyPageContentPanel from '../../MyPageContentPanel';
import UserManagementContent from '../UserManagementContent';

const mockAdminUser = {
  id: 'admin1',
  username: 'adminuser',
  email: 'admin@example.com',
  status: 'approved',
  is_admin: true,
};

const mockPendingUser = {
  id: 'p1',
  username: 'pending1',
  email: 'pending1@example.com',
  status: 'pending',
  created_at: new Date().toISOString(),
  is_admin: false,
};

const mockApprovedUser = {
  id: '1',
  username: 'user1',
  email: 'user1@example.com',
  status: 'approved',
  created_at: new Date().toISOString(),
  is_admin: false,
};

function setupHandlers({ pending = [mockPendingUser], approved = [mockApprovedUser] } = {}) {
  server.use(
    http.get('/api/admin/users/pending', () => HttpResponse.json(pending)),
    http.get('/api/admin/users', () => HttpResponse.json(approved))
  );
}

describe('UserManagementContent', () => {
  beforeEach(() => {
    setupHandlers();
  });

  it('renders Add button and user list after loading', async () => {
    renderWithProviders(
      <MyPageContentPanel>
        <UserManagementContent user={mockAdminUser} onMessage={jest.fn()} />
      </MyPageContentPanel>
    );

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
    expect(screen.getByText('pending1')).toBeInTheDocument();
    expect(screen.getByText('user1')).toBeInTheDocument();
  });

  it('approve for pending users calls API and shows success', async () => {
    let approveCalled = false;
    server.use(
      http.post('/api/admin/users/:id/approve', ({ params }) => {
        approveCalled = true;
        return HttpResponse.json({ messageCode: 'serverMessages.admin.userApproved' });
      })
    );

    const user = userEvent.setup();
    renderWithProviders(
      <MyPageContentPanel>
        <UserManagementContent user={mockAdminUser} onMessage={jest.fn()} />
      </MyPageContentPanel>
    );

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(approveCalled).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/approved/i);
    });
  });

  it('reject for pending users calls API and shows success', async () => {
    let rejectCalled = false;
    server.use(
      http.post('/api/admin/users/:id/reject', ({ params }) => {
        rejectCalled = true;
        return HttpResponse.json({ messageCode: 'serverMessages.admin.userRejected' });
      })
    );

    const user = userEvent.setup();
    renderWithProviders(
      <MyPageContentPanel>
        <UserManagementContent user={mockAdminUser} onMessage={jest.fn()} />
      </MyPageContentPanel>
    );

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /reject/i }));

    await waitFor(() => {
      expect(rejectCalled).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/rejected/i);
    });
  });

  it('delete for non-admin approved users: confirm dialog and API call', async () => {
    let deleteCalled = false;
    server.use(
      http.delete('/api/admin/users/:id', ({ params }) => {
        deleteCalled = true;
        return HttpResponse.json({ messageCode: 'serverMessages.admin.userDeleted' });
      })
    );

    const user = userEvent.setup();
    renderWithProviders(
      <MyPageContentPanel>
        <UserManagementContent user={mockAdminUser} onMessage={jest.fn()} />
      </MyPageContentPanel>
    );

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    const deleteButton = screen.getByRole('button', { name: /delete user/i });
    await user.click(deleteButton);

    expect(screen.getByRole('dialog', { name: /confirm delete user/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(deleteCalled).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/deleted/i);
    });
  });

  it('create user opens dialog; invalid submit shows validation error', async () => {
    let createApiCalled = false;
    server.use(
      http.post('/api/admin/users', () => {
        createApiCalled = true;
        return HttpResponse.json({}, { status: 201 });
      })
    );

    const user = userEvent.setup();
    renderWithProviders(
      <MyPageContentPanel>
        <UserManagementContent user={mockAdminUser} onMessage={jest.fn()} />
      </MyPageContentPanel>
    );

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /add/i }));

    const createDialog = screen.getByRole('dialog', { name: /add new user/i });
    expect(createDialog).toBeInTheDocument();

    const submitButton = within(createDialog).getByRole('button', { name: /add/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(createDialog).toBeInTheDocument();
      expect(createApiCalled).toBe(false);
    });
    expect(screen.getByText(/please enter|required/i)).toBeInTheDocument();
  });

  it('create user with valid data calls create API', async () => {
    let createPayload;
    server.use(
      http.post('/api/admin/users', async ({ request }) => {
        createPayload = await request.json();
        return HttpResponse.json(
          {
            id: 'u_new',
            username: createPayload.username,
            email: createPayload.email,
            status: 'approved',
            created_at: new Date().toISOString(),
            is_admin: false,
          },
          { status: 201 }
        );
      })
    );

    const user = userEvent.setup();
    renderWithProviders(
      <MyPageContentPanel>
        <UserManagementContent user={mockAdminUser} onMessage={jest.fn()} />
      </MyPageContentPanel>
    );

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /add/i }));

    const createDialog = screen.getByRole('dialog', { name: /add new user/i });
    const usernameInput = within(createDialog).getByLabelText(/username/i);
    const emailInput = within(createDialog).getByLabelText(/email/i);
    const passwordInputs = within(createDialog).getAllByLabelText(/password/i);
    const passwordInput = passwordInputs[0];
    const confirmInput = within(createDialog).getByLabelText(/confirm password/i);

    await user.type(usernameInput, 'newuser');
    await user.type(emailInput, 'newuser@example.com');
    await user.type(passwordInput, 'password123');
    await user.type(confirmInput, 'password123');

    await user.click(within(createDialog).getByRole('button', { name: /add/i }));

    await waitFor(() => {
      expect(createPayload).toEqual({
        username: 'newuser',
        email: 'newuser@example.com',
        password: 'password123',
      });
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/added/i);
    });
  });

  it('ShareDialog opens when non-pending, non-admin user card is clicked', async () => {
    server.use(
      http.get('/api/permissions/user/:userId', () => HttpResponse.json([]))
    );

    const user = userEvent.setup();
    renderWithProviders(
      <MyPageContentPanel>
        <UserManagementContent user={mockAdminUser} onMessage={jest.fn()} />
      </MyPageContentPanel>
    );

    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    const user1Card = screen.getByText('user1').closest('[class*="MuiCard"]');
    await user.click(user1Card);

    await waitFor(() => {
      const dialogs = screen.getAllByRole('dialog');
      expect(dialogs.length).toBeGreaterThanOrEqual(1);
    });
  });
});
