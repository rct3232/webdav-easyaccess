import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Container, Link, Paper, Typography } from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';

// Generic public page shown while the migration gate is active to regular users
// and anonymous visitors. Deliberately carries NO operational metadata (no
// type/jobId/timing) — see docs/features/migration-mode.md "Role-aware lock UX".
// Authenticated sessions get a plain "Log out" link (there is nothing else to
// do on this screen); anonymous visitors get no action.
const MaintenancePage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = (event) => {
    event.preventDefault();
    logout();
    navigate('/login');
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
        <Paper elevation={0} variant="outlined" sx={{ p: 4, textAlign: 'center', width: '100%' }}>
          <Typography variant="h5" gutterBottom>
            {t('maintenance.title')}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            {t('maintenance.body')}
          </Typography>
          {user && (
            <Link component="a" href="/login" underline="hover" onClick={handleLogout}>
              {t('nav.logout')}
            </Link>
          )}
        </Paper>
      </Box>
    </Container>
  );
};

export default MaintenancePage;
