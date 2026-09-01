/**
 * LoginDialog tests.
 * Verifies observable outcomes per spec: docs/spec/client/components/dialogs/LoginDialog.md
 * Uses MSW for API. LoginForm with redirectAfterLogin=false, onSuccess=onClose.
 * @see docs/TESTING_STRATEGY.md
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../../test-utils';
import { server } from '../../../setupTests';
import LoginDialog from '../LoginDialog';

const defaultProps = {
  open: true,
  onClose: jest.fn(),
};

describe('LoginDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders LoginForm', async () => {
    renderWithProviders(<LoginDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
  });

  it('calls onClose on login success', async () => {
    sessionStorage.setItem('token', 'test-token');
    const user = userEvent.setup();
    renderWithProviders(<LoginDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/username/i), 'testuser');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /login/i }));
    await waitFor(
      () => {
        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
      },
      { timeout: 5000 }
    );
  });

  it('calls onClose on backdrop click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    const backdrop = document.querySelector('.MuiDialog-root .MuiBackdrop-root');
    if (backdrop) {
      await user.click(backdrop);
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    } else {
      await user.keyboard('{Escape}');
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    }
  });

  it('dialog stays open on API failure', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ errorCode: 'serverErrors.auth.invalidCredentials' }, { status: 401 })
      )
    );
    const user = userEvent.setup();
    renderWithProviders(<LoginDialog {...defaultProps} />);
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/username/i), 'wronguser');
    await user.type(screen.getByLabelText(/password/i), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /login/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });
});
