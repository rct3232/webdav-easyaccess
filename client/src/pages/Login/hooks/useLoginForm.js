import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { validateRequired } from '@webdav-easyaccess/shared/validation';

import { useAuth } from '../../../contexts/AuthContext';
import { getServerErrorDisplay } from '../../../utils/errorUtils';
import { getValidationMessage } from '../../../utils/validationMessage';
import { getPublicSettings } from '../../../services/settingsService';

export function useLoginForm({ redirectAfterLogin = true, onSuccess } = {}) {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(false);

  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      setSettingsLoading(true);
      try {
        const data = await getPublicSettings();
        setRegistrationEnabled(!!data?.registration_enabled);
      } catch (err) {
        // Preserve existing observable behavior: registration link disappears on failure.
        // eslint-disable-next-line no-console
        console.error('Failed to load settings:', err);
        setRegistrationEnabled(false);
      } finally {
        setSettingsLoading(false);
      }
    };

    loadSettings();
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();

    setError('');
    setWarning('');

    const requiredError = validateRequired(username, t('login.username')) || validateRequired(password, t('login.password'));
    if (requiredError) {
      setError(getValidationMessage(requiredError, t));
      return;
    }

    setLoading(true);
    const result = await login(username, password);

    if (result.success) {
      if (redirectAfterLogin) {
        const userHomeDir = result.user?.is_admin
          ? '/files'
          : (result.user?.username ? `/files/${result.user.username}` : '/files');
        navigate(userHomeDir);
      } else {
        onSuccess?.(result);
      }
    } else {
      const msg = getServerErrorDisplay(result, t);

      if (result.status === 'pending') {
        setWarning(msg || t('login.pendingApproval'));
      } else if (result.status === 'rejected') {
        setError(msg || t('login.rejected'));
      } else {
        setError(msg || t('login.failed'));
      }
    }

    setLoading(false);
  }, [login, navigate, onSuccess, password, redirectAfterLogin, t, username]);

  const onUsernameChange = useCallback((e) => setUsername(e.target.value), []);
  const onPasswordChange = useCallback((e) => setPassword(e.target.value), []);
  const registerPath = '/register';
  const onNavigateToRegister = useCallback((e) => {
    e.preventDefault();
    navigate(registerPath);
  }, [navigate]);

  const viewModel = useMemo(() => ({
    logoAlt: t('login.logoAlt'),
    title: t('login.title'),
    usernameLabel: t('login.username'),
    passwordLabel: t('login.password'),
    submitButtonText: loading ? t('login.loggingIn') : t('login.submit'),
    noAccountText: t('login.noAccount'),
  }), [loading, t]);

  return {
    username,
    password,
    error,
    warning,
    loading,
    settingsLoading,
    registrationEnabled,
    registerPath,
    onNavigateToRegister,
    onUsernameChange,
    onPasswordChange,
    handleSubmit,
    viewModel,
  };
}

