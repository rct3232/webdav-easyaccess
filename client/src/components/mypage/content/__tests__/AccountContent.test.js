/**
 * AccountContent tests.
 * Verifies observable outcomes per spec: user info display, Edit dialog, save APIs,
 * logout + navigate, message feedback.
 * @see docs/spec/client/components/mypage/content/AccountContent.md
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../../../test-utils';
import { server } from '../../../../setupTests';
import MyPageContentPanel from '../../MyPageContentPanel';
import AccountContent from '../AccountContent';

const mockLogout = jest.fn();
const mockNavigate = jest.fn();

jest.mock('../../../../contexts/AuthContext', () => {
  const actual = jest.requireActual('../../../../contexts/AuthContext');
  return {
    ...actual,
    useAuth: () => ({ logout: mockLogout }),
  };
});

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockUser = {
  id: '1',
  username: 'testuser',
  email: 'user@example.com',
  status: 'approved',
  is_admin: false,
};

describe('AccountContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('displays user info (username, email, status, permission)', () => {
    renderWithProviders(
      <MyPageContentPanel>
        <AccountContent user={mockUser} />
      </MyPageContentPanel>
    );

    expect(screen.getByText('testuser')).toBeInTheDocument();
    expect(screen.getByText('user@example.com')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
  });

  it('edit button opens AccountEditDialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MyPageContentPanel>
        <AccountContent user={mockUser} />
      </MyPageContentPanel>
    );

    await user.click(screen.getByRole('button', { name: /edit account info/i }));

    expect(screen.getByRole('dialog', { name: /edit profile/i })).toBeInTheDocument();
  });

  it('AccountEditDialog: save email calls update API and shows success', async () => {
    let putPayload;
    server.use(
      http.put('/api/users/:id/email', async ({ params, request }) => {
        putPayload = await request.json();
        return HttpResponse.json({ messageCode: 'serverMessages.users.emailUpdated' });
      })
    );

    const user = userEvent.setup();
    renderWithProviders(
      <MyPageContentPanel>
        <AccountContent user={mockUser} />
      </MyPageContentPanel>
    );

    await user.click(screen.getByRole('button', { name: /edit account info/i }));

    const emailInput = screen.getByLabelText(/email/i);
    await user.clear(emailInput);
    await user.type(emailInput, 'new@example.com');

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(putPayload).toEqual({ email: 'new@example.com' });
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/email changed successfully/i);
    });
  });

  it('AccountEditDialog: password change triggers logout', async () => {
    server.use(
      http.put('/api/users/:id/password', () =>
        HttpResponse.json({ messageCode: 'serverMessages.users.passwordUpdated' }))
    );

    const user = userEvent.setup();
    renderWithProviders(
      <MyPageContentPanel>
        <AccountContent user={mockUser} />
      </MyPageContentPanel>
    );

    await user.click(screen.getByRole('button', { name: /edit account info/i }));

    const passwordInput = screen.getByLabelText(/new password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    await user.type(passwordInput, 'newpass');
    await user.type(confirmInput, 'newpass');

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/password changed successfully/i);
    });
    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalled();
    });
  });

  it('logout button calls logout and navigates to /login', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MyPageContentPanel>
        <AccountContent user={mockUser} />
      </MyPageContentPanel>
    );

    await user.click(screen.getByRole('button', { name: /log out/i }));

    expect(mockLogout).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });

  it('message display when API returns error', async () => {
    server.use(
      http.put('/api/users/:id/email', () =>
        HttpResponse.json(
          { errorCode: 'serverErrors.users.emailTaken' },
          { status: 409 }
        ))
    );

    const user = userEvent.setup();
    renderWithProviders(
      <MyPageContentPanel>
        <AccountContent user={mockUser} />
      </MyPageContentPanel>
    );

    await user.click(screen.getByRole('button', { name: /edit account info/i }));

    const emailInput = screen.getByLabelText(/email/i);
    await user.clear(emailInput);
    await user.type(emailInput, 'taken@example.com');

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(/fail|error/i);
    });
  });
});
