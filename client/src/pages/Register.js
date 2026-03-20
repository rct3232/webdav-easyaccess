import React from 'react';
import { Box, Container } from '@mui/material';

import { useRegisterForm } from './Register/hooks/useRegisterForm';
import RegisterFormView from './Register/RegisterFormView';

const Register = () => {
  const {
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
  } = useRegisterForm();

  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          minHeight: 'var(--app-height)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <RegisterFormView
          username={username}
          email={email}
          password={password}
          confirmPassword={confirmPassword}
          error={error}
          success={success}
          loading={loading}
          emailEnabled={emailEnabled}
          settingsLoading={settingsLoading}
          loginPath={loginPath}
          onNavigateToLogin={onNavigateToLogin}
          onUsernameChange={onUsernameChange}
          onEmailChange={onEmailChange}
          onPasswordChange={onPasswordChange}
          onConfirmPasswordChange={onConfirmPasswordChange}
          onSubmit={handleSubmit}
          viewModel={viewModel}
        />
      </Box>
    </Container>
  );
};

export default Register;

