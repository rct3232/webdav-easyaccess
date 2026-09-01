import React from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Link,
  Paper,
  TextField,
  Typography,
} from '@mui/material';

const LoginFormView = ({
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
  onSubmit,
  viewModel,
}) => {
  const { logoAlt, title, usernameLabel, passwordLabel, submitButtonText, noAccountText } =
    viewModel;

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

      <Typography
        variant="subtitle1"
        gutterBottom
        align="center"
        color="text.secondary"
        sx={{ mb: 3 }}
      >
        {title}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {warning && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {warning}
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
            label={usernameLabel}
            variant="outlined"
            margin="normal"
            name="username"
            value={username}
            onChange={onUsernameChange}
            required
            autoFocus
          />
          <TextField
            fullWidth
            label={passwordLabel}
            type="password"
            variant="outlined"
            margin="normal"
            name="password"
            value={password}
            onChange={onPasswordChange}
            required
          />
          <Button
            type="submit"
            fullWidth
            variant="contained"
            color="primary"
            sx={{ mt: 3, mb: 2 }}
            disabled={loading}
          >
            {submitButtonText}
          </Button>

          {registrationEnabled && (
            <Box textAlign="center">
              <Link
                href={registerPath}
                underline="none"
                color="inherit"
                onClick={onNavigateToRegister}
              >
                <Typography variant="body2" color="primary">
                  {noAccountText}
                </Typography>
              </Link>
            </Box>
          )}
        </form>
      )}
    </Paper>
  );
};

export default LoginFormView;
