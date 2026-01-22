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
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await axios.get('/api/settings/public');
        setRegistrationEnabled(response.data.registration_enabled);
      } catch (error) {
        console.error('Failed to load settings:', error);
        // Default to false if settings can't be loaded
        setRegistrationEnabled(false);
      }
    };
    loadSettings();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setWarning('');
    setLoading(true);

    const result = await login(username, password);
    
    if (result.success) {
      navigate('/files');
    } else {
      if (result.status === 'pending') {
        setWarning(result.message || '계정이 승인 대기 중입니다. 관리자의 승인을 기다려 주세요.');
      } else if (result.status === 'rejected') {
        setError(result.message || '계정 가입이 거절되었습니다. 관리자에게 문의하세요.');
      } else {
        setError(result.error || '로그인에 실패했습니다.');
      }
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
            alt="WebDAV EasyAccess"
            sx={{
              height: '96px',
              maxWidth: '100%',
              objectFit: 'contain',
              display: 'block',
              margin: '0 auto 16px',
            }}
          />
          <Typography variant="subtitle1" gutterBottom align="center" color="text.secondary" sx={{ mb: 3 }}>
            로그인
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

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="사용자명"
              variant="outlined"
              margin="normal"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
            <TextField
              fullWidth
              label="비밀번호"
              type="password"
              variant="outlined"
              margin="normal"
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
              {loading ? '로그인 중...' : '로그인'}
            </Button>
            {registrationEnabled && (
              <Box textAlign="center">
                <Link to="/register" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <Typography variant="body2" color="primary">
                    계정이 없으신가요? 회원가입
                  </Typography>
                </Link>
              </Box>
            )}
          </form>
        </Paper>
      </Box>
    </Container>
  );
};

export default Login;

