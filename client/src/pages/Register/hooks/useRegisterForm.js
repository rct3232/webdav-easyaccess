import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  validateEmail,
  validateMatch,
  validatePassword,
  validateRequired,
  validateUsername,
} from '@webdav-easyaccess/shared/validation';

import { useAuth } from '../../../contexts/AuthContext';
import { getPublicSettings } from '../../../services/settingsService';
import { getServerErrorDisplay } from '../../../utils/errorUtils';
import { getValidationMessage } from '../../../utils/validationMessage';

export function useRegisterForm() {
  const { t } = useTranslation();
  const { register } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const [emailEnabled, setEmailEnabled] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      setSettingsLoading(true);
      try {
        const data = await getPublicSettings();
        setEmailEnabled(!!data?.email_enabled);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to load settings:', error);
      } finally {
        setSettingsLoading(false);
      }
    };

    loadSettings();
  }, []);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();

      setError('');
      setSuccess(false);

      const requiredError =
        validateRequired(username, t('register.username')) ||
        validateRequired(email, t('register.email'));
      if (requiredError) {
        setError(getValidationMessage(requiredError, t));
        return;
      }

      const usernameError = validateUsername(username);
      if (usernameError) {
        setError(getValidationMessage(usernameError, t));
        return;
      }

      const emailError = validateEmail(email);
      if (emailError) {
        setError(getValidationMessage(emailError, t));
        return;
      }

      const matchError = validateMatch(password, confirmPassword, t('register.password'));
      if (matchError) {
        setError(getValidationMessage(matchError, t));
        return;
      }

      const passwordError = validatePassword(password);
      if (passwordError) {
        setError(getValidationMessage(passwordError, t));
        return;
      }

      setLoading(true);
      const result = await register(username, email, password);

      if (result.success) {
        if (result.status === 'pending') {
          setSuccess(true);
        } else {
          navigate('/files');
        }
      } else {
        setError(getServerErrorDisplay(result, t));
      }

      setLoading(false);
    },
    [confirmPassword, email, navigate, password, register, t, username]
  );

  const onUsernameChange = useCallback((e) => setUsername(e.target.value), []);
  const onEmailChange = useCallback((e) => setEmail(e.target.value), []);
  const onPasswordChange = useCallback((e) => setPassword(e.target.value), []);
  const onConfirmPasswordChange = useCallback((e) => setConfirmPassword(e.target.value), []);
  const loginPath = '/login';
  const onNavigateToLogin = useCallback(
    (e) => {
      e.preventDefault();
      navigate(loginPath);
    },
    [navigate]
  );

  const viewModel = useMemo(
    () => ({
      logoAlt: t('register.logoAlt'),
      title: t('register.title'),
      usernameLabel: t('register.username'),
      emailLabel: t('register.email'),
      passwordLabel: t('register.password'),
      confirmPasswordLabel: t('register.confirmPassword'),
      submitButtonText: loading ? t('register.registering') : t('register.submit'),
      hasAccountText: t('register.hasAccount'),
      successTitle: t('register.successTitle'),
      successBody: t('register.successBody'),
    }),
    [loading, t]
  );

  return {
    username,
    email,
    password,
    confirmPassword,
    error,
    success,
    loading,
    emailEnabled,
    settingsLoading,
    loginPath,
    onNavigateToLogin,
    onUsernameChange,
    onEmailChange,
    onPasswordChange,
    onConfirmPasswordChange,
    handleSubmit,
    viewModel,
  };
}
