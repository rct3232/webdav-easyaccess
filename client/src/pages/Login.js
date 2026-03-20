import React from 'react';
import { Container, Box } from '@mui/material';

import { useLoginForm } from './Login/hooks/useLoginForm';
import LoginFormView from './Login/LoginFormView';

/**
 * Reusable login form. Use redirectAfterLogin=false and onSuccess for modal (e.g. share link).
 * @param {Object} props
 * @param {boolean} [props.redirectAfterLogin=true] - If true, navigate to user home on success; if false, call onSuccess only.
 * @param {function(Object): void} [props.onSuccess] - Called on login success with { user }. Used when redirectAfterLogin is false.
 */
export const LoginForm = ({
  redirectAfterLogin = true,
  onSuccess,
}) => {
  const {
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
  } = useLoginForm({ redirectAfterLogin, onSuccess });

  return (
    <LoginFormView
      username={username}
      password={password}
      error={error}
      warning={warning}
      loading={loading}
      settingsLoading={settingsLoading}
      registrationEnabled={registrationEnabled}
      registerPath={registerPath}
      onNavigateToRegister={onNavigateToRegister}
      onUsernameChange={onUsernameChange}
      onPasswordChange={onPasswordChange}
      onSubmit={handleSubmit}
      viewModel={viewModel}
    />
  );
};

const Login = () => (
  <Container maxWidth="sm">
    <Box
      sx={{
        minHeight: 'var(--app-height)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <LoginForm redirectAfterLogin />
    </Box>
  </Container>
);

export default Login;
