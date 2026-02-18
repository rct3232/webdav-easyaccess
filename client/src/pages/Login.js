import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  Alert,
  CircularProgress,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { validateRequired } from '@webdav-easyaccess/shared/validation';
import { getValidationMessage } from '../utils/validationMessage';
import { getPublicSettings } from '../services/settingsService';

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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const loadSettings = async () => {
      setSettingsLoading(true);
      try {
        const data = await getPublicSettings();
        setRegistrationEnabled(data.registration_enabled);
      } catch (err) {
        console.error('Failed to load settings:', err);
        setRegistrationEnabled(false);
      } finally {
        setSettingsLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleSubmit = async (e) => {
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
        const userHomeDir = result.user?.is_admin ? '/files' : (result.user?.username ? `/files/${result.user.username}` : '/files');
        navigate(userHomeDir);
      } else {
        onSuccess?.(result);
      }
    } else {
      if (result.status === 'pending') {
        setWarning(result.message || t('login.pendingApproval'));
      } else if (result.status === 'rejected') {
        setError(result.message || t('login.rejected'));
      } else {
        setError(result.error || t('login.failed'));
      }
    }

    setLoading(false);
  };

  return (
    <Paper elevation={0} sx={{ p: 4, width: '100%' }}>
      <Box
        component="img"
        src="/logo.png"
        alt={t('login.logoAlt')}
        sx={{
          height: '96px',
          maxWidth: '100%',
          objectFit: 'contain',
          display: 'block',
          margin: '0 auto 16px',
        }}
      />
      <Typography variant="subtitle1" gutterBottom align="center" color="text.secondary" sx={{ mb: 3 }}>
        {t('login.title')}
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
        <>
          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label={t('login.username')}
              variant="outlined"
              margin="normal"
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
            <TextField
              fullWidth
              label={t('login.password')}
              type="password"
              variant="outlined"
              margin="normal"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
              {loading ? t('login.loggingIn') : t('login.submit')}
            </Button>
            {registrationEnabled && (
              <Box textAlign="center">
                <Link to="/register" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <Typography variant="body2" color="primary">
                    {t('login.noAccount')}
                  </Typography>
                </Link>
              </Box>
            )}
          </form>
        </>
      )}
    </Paper>
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
