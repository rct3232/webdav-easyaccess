import React, { useState, useEffect } from 'react';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Paper,
  TextField,
  Button,
  Alert,
  Divider,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Share as ShareIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ShareDialog from '../components/ShareDialog';
import axios from 'axios';

const MyPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    if (user) {
      setEmail(user.email || '');
    }
  }, [user]);

  const handleEmailUpdate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });

    try {
      await axios.put(`/api/users/${user.id}/email`, { email });
      setMessage({ type: 'success', text: '이메일이 성공적으로 변경되었습니다.' });
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.error || '이메일 변경에 실패했습니다.' 
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });

    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: '비밀번호가 일치하지 않습니다.' });
      setLoading(false);
      return;
    }

    if (password.length < 4) {
      setMessage({ type: 'error', text: '비밀번호는 최소 4자 이상이어야 합니다.' });
      setLoading(false);
      return;
    }

    try {
      await axios.put(`/api/users/${user.id}/password`, { password });
      setMessage({ type: 'success', text: '비밀번호가 성공적으로 변경되었습니다.' });
      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.error || '비밀번호 변경에 실패했습니다.' 
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    navigate('/');
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: 'var(--app-height)',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <AppBar position="sticky" sx={{ top: 0, zIndex: (theme) => theme.zIndex.appBar }}>
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            onClick={handleBack}
            sx={{ mr: 2 }}
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            마이페이지
          </Typography>
        </Toolbar>
      </AppBar>

      <Box
        sx={{
          flex: 1,
          p: 3,
          maxWidth: 600,
          mx: 'auto',
          width: '100%',
          overflow: 'auto',
          minHeight: 0,
          // Enable smooth scrolling and bounce effect on iOS
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {message.text && (
          <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage({ type: '', text: '' })}>
            {message.text}
          </Alert>
        )}

        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            계정 정보
          </Typography>
          <Divider sx={{ mb: 2 }} />
          
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              사용자명
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 500 }}>
              {user?.username}
            </Typography>
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              계정 상태
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 500 }}>
              {user?.status === 'approved' ? '승인됨' : user?.status}
            </Typography>
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              권한
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 500 }}>
              {user?.is_admin ? '관리자' : '일반 사용자'}
            </Typography>
          </Box>
        </Paper>

        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            이메일 변경
          </Typography>
          <Divider sx={{ mb: 2 }} />
          
          <Box component="form" onSubmit={handleEmailUpdate}>
            <TextField
              fullWidth
              label="이메일"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              sx={{ mb: 2 }}
            />
            <Button
              type="submit"
              variant="contained"
              disabled={loading}
              fullWidth
            >
              이메일 변경
            </Button>
          </Box>
        </Paper>

        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            비밀번호 변경
          </Typography>
          <Divider sx={{ mb: 2 }} />
          
          <Box component="form" onSubmit={handlePasswordUpdate}>
            <TextField
              fullWidth
              label="새 비밀번호"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="비밀번호 확인"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              sx={{ mb: 2 }}
            />
            <Button
              type="submit"
              variant="contained"
              disabled={loading}
              fullWidth
            >
              비밀번호 변경
            </Button>
          </Box>
        </Paper>

        {!user?.is_admin && (
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              공유 관리
            </Typography>
            <Divider sx={{ mb: 2 }} />
            
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              내 홈 디렉토리 하위의 모든 폴더에 대한 권한을 설정할 수 있습니다.
            </Typography>
            
            <Button
              variant="contained"
              startIcon={<ShareIcon />}
              onClick={() => setShareDialogOpen(true)}
              fullWidth
            >
              공유 관리 열기
            </Button>
          </Paper>
        )}
      </Box>

      {!user?.is_admin && (
        <ShareDialog
          open={shareDialogOpen}
          onClose={() => setShareDialogOpen(false)}
          mode="share"
          folderPath={user?.username ? `/${user.username}` : null}
          folderName={user?.username || '홈 디렉토리'}
          user={user}
          onMessage={(msg) => {
            setMessage({ type: msg.type, text: msg.text });
          }}
        />
      )}
    </Box>
  );
};

export default MyPage;


