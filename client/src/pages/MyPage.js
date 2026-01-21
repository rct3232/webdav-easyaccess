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
  Tabs,
  Tab,
  Chip,
  Stack,
  CircularProgress,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Share as ShareIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ShareDialog from '../components/ShareDialog';
import axios from 'axios';
import {
  approvePermissionRequest,
  cancelPermissionRequest,
  listInboxPermissionRequests,
  listOutboxPermissionRequests,
  rejectPermissionRequest,
} from '../services/permissionRequestService';

const MyPage = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [requestTab, setRequestTab] = useState(0); // 0: inbox, 1: outbox
  const [requestLoading, setRequestLoading] = useState(false);
  const [inboxRequests, setInboxRequests] = useState([]);
  const [outboxRequests, setOutboxRequests] = useState([]);
  const [requestActionLoadingIds, setRequestActionLoadingIds] = useState(new Set());
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    if (user) {
      setEmail(user.email || '');
    }
  }, [user]);

  const formatPermissionLabel = (p) => {
    if (p === 'read') return '읽기';
    if (p === 'write') return '쓰기';
    return String(p || '');
  };

  const formatStatusLabel = (s) => {
    if (s === 'pending') return { label: '대기', color: 'warning' };
    if (s === 'approved') return { label: '승인', color: 'success' };
    if (s === 'rejected') return { label: '거절', color: 'error' };
    if (s === 'cancelled') return { label: '취소', color: 'default' };
    return { label: String(s || ''), color: 'default' };
  };

  const withRequestActionLoading = async (id, fn) => {
    setRequestActionLoadingIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    try {
      return await fn();
    } finally {
      setRequestActionLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const loadPermissionRequests = async () => {
    if (!user) return;
    setRequestLoading(true);
    try {
      const [inbox, outbox] = await Promise.all([
        listInboxPermissionRequests({ status: 'pending' }),
        listOutboxPermissionRequests(),
      ]);
      setInboxRequests(Array.isArray(inbox) ? inbox : []);
      // Hide cancelled requests from the UI list
      const outboxList = Array.isArray(outbox) ? outbox : [];
      setOutboxRequests(outboxList.filter((r) => r?.status !== 'cancelled'));
    } catch (error) {
      setInboxRequests([]);
      setOutboxRequests([]);
      setMessage({
        type: 'error',
        text: error.response?.data?.error || '권한 요청 목록을 불러오는데 실패했습니다.',
      });
    } finally {
      setRequestLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadPermissionRequests();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

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
      setMessage({ type: 'success', text: '비밀번호가 성공적으로 변경되었습니다. 보안을 위해 다시 로그인해주세요.' });
      setPassword('');
      setConfirmPassword('');
      // Password change rotates token_version on the server, invalidating existing tokens.
      logout();
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
          <Paper sx={{ p: 3, mb: 3 }}>
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
              sx={{ mb: 3 }}
            >
              공유 관리 열기
            </Button>

            <Divider sx={{ mb: 2 }} />

            <Tabs
              value={requestTab}
              onChange={(e, v) => setRequestTab(v)}
              sx={{ mb: 2 }}
            >
              <Tab label={`받은 요청 (${inboxRequests.length})`} />
              <Tab label={`내 요청 (${outboxRequests.length})`} />
            </Tabs>

            {requestLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={24} />
              </Box>
            ) : (
              <Stack spacing={1.5}>
                {(requestTab === 0 ? inboxRequests : outboxRequests).length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    표시할 요청이 없습니다.
                  </Typography>
                ) : (
                  (requestTab === 0 ? inboxRequests : outboxRequests).map((r) => {
                    const permLabel = formatPermissionLabel(r.requested_permission);
                    const statusInfo = formatStatusLabel(r.status);
                    const isPending = r.status === 'pending';
                    const isActionLoading = requestActionLoadingIds.has(r.id);

                    return (
                      <Paper key={r.id} variant="outlined" sx={{ p: 2 }}>
                        <Stack spacing={1}>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Chip
                              size="small"
                              label={permLabel}
                              color={r.requested_permission === 'write' ? 'primary' : 'default'}
                            />
                            <Chip size="small" label={statusInfo.label} color={statusInfo.color} />
                            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                              {r.created_at ? new Date(r.created_at).toLocaleString('ko-KR') : ''}
                            </Typography>
                          </Stack>

                          <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                            폴더: {r.folder_path}
                          </Typography>

                          {requestTab === 0 ? (
                            <Typography variant="caption" color="text.secondary">
                              요청자: {r.requester_username || r.requester_id}
                            </Typography>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              소유자: {r.owner_username || r.owner_id}
                            </Typography>
                          )}

                          {r.message ? (
                            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                              메시지: {r.message}
                            </Typography>
                          ) : null}

                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            {requestTab === 0 ? (
                              <>
                                <Button
                                  size="small"
                                  variant="contained"
                                  disabled={!isPending || isActionLoading}
                                  onClick={() =>
                                    withRequestActionLoading(r.id, async () => {
                                      await approvePermissionRequest(r.id);
                                      setMessage({ type: 'success', text: '요청을 승인했습니다.' });
                                      await loadPermissionRequests();
                                    })
                                  }
                                >
                                  승인
                                </Button>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  color="error"
                                  disabled={!isPending || isActionLoading}
                                  onClick={() =>
                                    withRequestActionLoading(r.id, async () => {
                                      await rejectPermissionRequest(r.id);
                                      setMessage({ type: 'success', text: '요청을 거절했습니다.' });
                                      await loadPermissionRequests();
                                    })
                                  }
                                >
                                  거절
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="small"
                                variant="outlined"
                                disabled={!isPending || isActionLoading}
                                onClick={() =>
                                  withRequestActionLoading(r.id, async () => {
                                    await cancelPermissionRequest(r.id);
                                    setMessage({ type: 'success', text: '요청을 취소했습니다.' });
                                    await loadPermissionRequests();
                                  })
                                }
                              >
                                취소
                              </Button>
                            )}
                          </Stack>
                        </Stack>
                      </Paper>
                    );
                  })
                )}
              </Stack>
            )}
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


