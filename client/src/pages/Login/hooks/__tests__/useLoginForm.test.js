import { act, renderHook, waitFor } from '@testing-library/react';

import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../../../contexts/AuthContext';
import { getPublicSettings } from '../../../../services/settingsService';
import { useLoginForm } from '../useLoginForm';

jest.mock('react-i18next', () => {
  const { createI18nModuleMock } = require('../../../../testing/mocks/i18nMock');
  return createI18nModuleMock();
});

jest.mock('react-router-dom', () => ({
  useNavigate: jest.fn(),
}));

jest.mock('../../../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../../../services/settingsService', () => ({
  getPublicSettings: jest.fn(),
}));

describe('useLoginForm', () => {
  const navigateMock = jest.fn();
  const loginMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useNavigate.mockReturnValue(navigateMock);
    useAuth.mockReturnValue({ login: loginMock });
    getPublicSettings.mockResolvedValue({ registration_enabled: true });
  });

  it('loads settings and exposes register navigation props', async () => {
    const { result } = renderHook(() => useLoginForm());

    await waitFor(() => {
      expect(result.current.settingsLoading).toBe(false);
    });

    expect(result.current.registrationEnabled).toBe(true);
    expect(result.current.registerPath).toBe('/register');

    const preventDefault = jest.fn();
    act(() => {
      result.current.onNavigateToRegister({ preventDefault });
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/register');
  });

  it('shows a warning for pending login results', async () => {
    loginMock.mockResolvedValue({
      success: false,
      status: 'pending',
      errorCode: 'serverErrors.auth.pendingApproval',
    });

    const { result } = renderHook(() => useLoginForm());

    await waitFor(() => {
      expect(result.current.settingsLoading).toBe(false);
    });

    act(() => {
      result.current.onUsernameChange({ target: { value: 'pendinguser' } });
      result.current.onPasswordChange({ target: { value: 'password123' } });
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: jest.fn() });
    });

    expect(result.current.warning).toBe('serverErrors.auth.pendingApproval');
    expect(result.current.error).toBe('');
  });

  it('navigates to the user home path after successful login', async () => {
    loginMock.mockResolvedValue({
      success: true,
      user: { username: 'alice', is_admin: false },
    });

    const { result } = renderHook(() => useLoginForm());

    await waitFor(() => {
      expect(result.current.settingsLoading).toBe(false);
    });

    act(() => {
      result.current.onUsernameChange({ target: { value: 'alice' } });
      result.current.onPasswordChange({ target: { value: 'password123' } });
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: jest.fn() });
    });

    expect(navigateMock).toHaveBeenCalledWith('/files/alice');
  });
});
