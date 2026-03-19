import { act, renderHook, waitFor } from '@testing-library/react';

import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../../../contexts/AuthContext';
import { getPublicSettings } from '../../../../services/settingsService';
import { useRegisterForm } from '../useRegisterForm';

jest.mock('react-i18next', () => ({
  useTranslation: jest.fn(),
}));

jest.mock('react-router-dom', () => ({
  useNavigate: jest.fn(),
}));

jest.mock('../../../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../../../services/settingsService', () => ({
  getPublicSettings: jest.fn(),
}));

describe('useRegisterForm', () => {
  const navigateMock = jest.fn();
  const registerMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useNavigate.mockReturnValue(navigateMock);
    useTranslation.mockReturnValue({ t: (key) => key });
    useAuth.mockReturnValue({ register: registerMock });
    getPublicSettings.mockResolvedValue({ email_enabled: true });
  });

  it('loads settings and exposes login navigation props', async () => {
    const { result } = renderHook(() => useRegisterForm());

    await waitFor(() => {
      expect(result.current.settingsLoading).toBe(false);
    });

    expect(result.current.emailEnabled).toBe(true);
    expect(result.current.loginPath).toBe('/login');

    const preventDefault = jest.fn();
    act(() => {
      result.current.onNavigateToLogin({ preventDefault });
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/login');
  });

  it('shows pending success without navigating when registration stays pending', async () => {
    registerMock.mockResolvedValue({ success: true, status: 'pending' });

    const { result } = renderHook(() => useRegisterForm());

    await waitFor(() => {
      expect(result.current.settingsLoading).toBe(false);
    });

    act(() => {
      result.current.onUsernameChange({ target: { value: 'newuser' } });
      result.current.onEmailChange({ target: { value: 'new@example.com' } });
      result.current.onPasswordChange({ target: { value: 'ValidPass123!' } });
      result.current.onConfirmPasswordChange({ target: { value: 'ValidPass123!' } });
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: jest.fn() });
    });

    expect(result.current.success).toBe(true);
    expect(navigateMock).not.toHaveBeenCalledWith('/files');
  });

  it('navigates to /files after immediate approval', async () => {
    registerMock.mockResolvedValue({ success: true, status: 'approved' });

    const { result } = renderHook(() => useRegisterForm());

    await waitFor(() => {
      expect(result.current.settingsLoading).toBe(false);
    });

    act(() => {
      result.current.onUsernameChange({ target: { value: 'approveduser' } });
      result.current.onEmailChange({ target: { value: 'approved@example.com' } });
      result.current.onPasswordChange({ target: { value: 'ValidPass123!' } });
      result.current.onConfirmPasswordChange({ target: { value: 'ValidPass123!' } });
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: jest.fn() });
    });

    expect(navigateMock).toHaveBeenCalledWith('/files');
  });
});
