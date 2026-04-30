import React from 'react';
import { Alert, Box, Button, CircularProgress, Link, Paper, TextField, Typography } from '@mui/material';

import { EmailNotificationMessage } from '../../components/feedback';

const RegisterFormView = ({
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
  onSubmit,
  viewModel,
}) => {
  const {
    logoAlt,
    title,
    usernameLabel,
    emailLabel,
    passwordLabel,
    confirmPasswordLabel,
    submitButtonText,
    hasAccountText,
    successTitle,
    successBody,
  } = viewModel;

  return (
    <Paper elevation={0} sx={{ p: 4, width: '100%' }}>
      <Box
        component="img"
        src="/logo.png"
        alt={logoAlt}
        sx={{
          height: '96px',
          maxWidth: '100%',
          objectFit: 'contain',
          display: 'block',
          margin: '0 auto 16px',
        }}
      />

      <Typography variant="subtitle1" gutterBottom align="center" color="text.secondary" sx={{ mb: 3 }}>
        {title}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            {successTitle}
          </Typography>
          <Typography variant="body2">
            {successBody}
            {emailEnabled && (
              <>
                <br />
                <EmailNotificationMessage />
              </>
            )}
          </Typography>
        </Alert>
      )}

      {settingsLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <form onSubmit={onSubmit}>
           <TextField
             fullWidth
             name="username"
             label={usernameLabel}
             variant="outlined"
             margin="normal"
             value={username}
             onChange={onUsernameChange}
             required
             autoFocus
           />
           <TextField
             fullWidth
             name="email"
             label={emailLabel}
             type="email"
             variant="outlined"
             margin="normal"
             value={email}
             onChange={onEmailChange}
             required
           />
           <TextField
             fullWidth
             name="password"
             label={passwordLabel}
             type="password"
             variant="outlined"
             margin="normal"
             value={password}
             onChange={onPasswordChange}
             required
           />
           <TextField
             fullWidth
             name="confirmPassword"
             label={confirmPasswordLabel}
             type="password"
             variant="outlined"
             margin="normal"
             value={confirmPassword}
             onChange={onConfirmPasswordChange}
             required
           />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            color="primary"
            sx={{ mt: 3, mb: 2 }}
            disabled={loading || success}
          >
            {submitButtonText}
          </Button>

          <Box textAlign="center">
            <Link
              href={loginPath}
              underline="none"
              color="inherit"
              onClick={onNavigateToLogin}
            >
              <Typography variant="body2" color="primary">
                {hasAccountText}
              </Typography>
            </Link>
          </Box>
        </form>
      )}
    </Paper>
  );
};

export default RegisterFormView;

