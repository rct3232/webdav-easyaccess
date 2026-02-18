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
import { EmailNotificationMessage } from '../components/feedback';
import { validateRequired, validateUsername, validateEmail, validatePassword, validateMatch } from '@webdav-easyaccess/shared/validation';
import { getValidationMessage } from '../utils/validationMessage';
import { getPublicSettings } from '../services/settingsService';

const Register = () => {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const { register } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const loadSettings = async () => {
      setSettingsLoading(true);
      try {
        const data = await getPublicSettings();
        setEmailEnabled(data.email_enabled || false);
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setSettingsLoading(false);
      }
    };
    loadSettings();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    const requiredError = validateRequired(username, t('register.username')) || validateRequired(email, t('register.email'));
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
      setError(result.error);
    }
    
    setLoading(false);
  };

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
        <Paper elevation={0} sx={{ p: 4, width: '100%' }}>
          <Box
            component="img"
            src="/logo.png"
            alt={t('register.logoAlt')}
            sx={{
              height: '96px',
              maxWidth: '100%',
              objectFit: 'contain',
              display: 'block',
              margin: '0 auto 16px',
            }}
          />
          <Typography variant="subtitle1" gutterBottom align="center" color="text.secondary" sx={{ mb: 3 }}>
            {t('register.title')}
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mb: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                {t('register.successTitle')}
              </Typography>
              <Typography variant="body2">
                {t('register.successBody')}
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
            <form onSubmit={handleSubmit}>
              <TextField
                fullWidth
                label={t('register.username')}
                variant="outlined"
                margin="normal"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
              <TextField
                fullWidth
                label={t('register.email')}
                type="email"
                variant="outlined"
                margin="normal"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <TextField
                fullWidth
                label={t('register.password')}
                type="password"
                variant="outlined"
                margin="normal"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <TextField
                fullWidth
                label={t('register.confirmPassword')}
                type="password"
                variant="outlined"
                margin="normal"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
                {loading ? t('register.registering') : t('register.submit')}
              </Button>
              <Box textAlign="center">
                <Link to="/login" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <Typography variant="body2" color="primary">
                    {t('register.hasAccount')}
                  </Typography>
                </Link>
              </Box>
            </form>
          )}
        </Paper>
      </Box>
    </Container>
  );
};

export default Register;

