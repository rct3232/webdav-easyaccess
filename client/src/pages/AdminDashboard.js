import React, { useState, useEffect } from 'react';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Chip,
  Alert,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  FormControlLabel,
  Switch,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);
  const [users, setUsers] = useState([]);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, userId: null, username: '' });
  const [createDialog, setCreateDialog] = useState({ open: false });
  const [newUser, setNewUser] = useState({ username: '', email: '', password: '', confirmPassword: '' });
  const [settings, setSettings] = useState({ registration_enabled: 'false' });

  const loadPendingUsers = async () => {
    try {
      const response = await axios.get('/api/admin/users/pending');
      setPendingUsers(response.data);
    } catch (error) {
      console.error('Failed to load pending users:', error);
    }
  };

  const loadAllUsers = async () => {
    try {
      const response = await axios.get('/api/admin/users');
      setUsers(response.data);
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  };

  const loadSettings = async () => {
    try {
      const response = await axios.get('/api/admin/settings');
      setSettings(response.data);
    } catch (error) {
      console.error('Failed to load settings:', error);
      setMessage({ type: 'error', text: '설정을 불러오는데 실패했습니다.' });
    }
  };

  const handleToggleRegistration = async () => {
    try {
      const newValue = settings.registration_enabled === 'true' ? 'false' : 'true';
      await axios.put('/api/admin/settings', { registration_enabled: newValue });
      setMessage({ type: 'success', text: '설정이 저장되었습니다.' });
      await loadSettings();
    } catch (error) {
      console.error('Failed to update settings:', error);
      setMessage({ type: 'error', text: '설정 저장에 실패했습니다.' });
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([loadPendingUsers(), loadAllUsers(), loadSettings()]);
      setLoading(false);
    };
    loadData();
  }, []);

  const handleApprove = async (userId, username) => {
    try {
      await axios.post(`/api/admin/users/${userId}/approve`);
      setMessage({ type: 'success', text: `${username} 계정이 승인되었습니다.` });
      await Promise.all([loadPendingUsers(), loadAllUsers()]);
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.error || '승인에 실패했습니다.' 
      });
    }
  };

  const handleReject = async (userId, username) => {
    try {
      await axios.post(`/api/admin/users/${userId}/reject`);
      setMessage({ type: 'success', text: `${username} 계정이 거절되었습니다.` });
      await Promise.all([loadPendingUsers(), loadAllUsers()]);
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.error || '거절에 실패했습니다.' 
      });
    }
  };

  const handleDeleteClick = (userId, username) => {
    setDeleteDialog({ open: true, userId, username });
  };

  const handleDeleteConfirm = async () => {
    const { userId, username } = deleteDialog;
    setDeleteDialog({ open: false, userId: null, username: '' });
    
    try {
      await axios.delete(`/api/admin/users/${userId}`);
      setMessage({ type: 'success', text: `${username} 계정이 삭제되었습니다.` });
      await Promise.all([loadPendingUsers(), loadAllUsers()]);
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.error || '삭제에 실패했습니다.' 
      });
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialog({ open: false, userId: null, username: '' });
  };

  const handleCreateClick = () => {
    setCreateDialog({ open: true });
    setNewUser({ username: '', email: '', password: '', confirmPassword: '' });
  };

  const handleCreateCancel = () => {
    setCreateDialog({ open: false });
    setNewUser({ username: '', email: '', password: '', confirmPassword: '' });
  };

  const handleCreateSubmit = async () => {
    // Validation
    if (!newUser.username || !newUser.email || !newUser.password) {
      setMessage({ type: 'error', text: '모든 필드를 입력해주세요.' });
      return;
    }

    if (newUser.password !== newUser.confirmPassword) {
      setMessage({ type: 'error', text: '비밀번호가 일치하지 않습니다.' });
      return;
    }

    if (newUser.password.length < 6) {
      setMessage({ type: 'error', text: '비밀번호는 최소 6자 이상이어야 합니다.' });
      return;
    }

    try {
      await axios.post('/api/admin/users', {
        username: newUser.username,
        email: newUser.email,
        password: newUser.password,
      });
      
      setMessage({ type: 'success', text: `${newUser.username} 계정이 추가되었습니다.` });
      setCreateDialog({ open: false });
      setNewUser({ username: '', email: '', password: '', confirmPassword: '' });
      await Promise.all([loadPendingUsers(), loadAllUsers()]);
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.error || '사용자 추가에 실패했습니다.' 
      });
    }
  };

  const getStatusChip = (status) => {
    const statusMap = {
      pending: { label: '승인대기', color: 'warning' },
      approved: { label: '승인됨', color: 'success' },
      rejected: { label: '거절됨', color: 'error' },
    };
    const config = statusMap[status] || { label: status, color: 'default' };
    return <Chip label={config.label} color={config.color} size="small" />;
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString('ko-KR');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="static">
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            onClick={() => navigate('/')}
            sx={{ mr: 2 }}
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            관리자 대시보드
          </Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, p: 3 }}>
        {message.text && (
          <Alert 
            severity={message.type} 
            sx={{ mb: 2 }} 
            onClose={() => setMessage({ type: '', text: '' })}
          >
            {message.text}
          </Alert>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Paper sx={{ flex: 1 }}>
            <Tabs value={tab} onChange={(e, newValue) => setTab(newValue)}>
              <Tab label={`승인 대기 (${pendingUsers.length})`} />
              <Tab label={`전체 사용자 (${users.length})`} />
              <Tab label="설정" />
            </Tabs>
          </Paper>
          {tab !== 2 && (
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              onClick={handleCreateClick}
              sx={{ ml: 2 }}
            >
              사용자 추가
            </Button>
          )}
        </Box>

        {tab === 0 && (
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>사용자명</TableCell>
                  <TableCell>이메일</TableCell>
                  <TableCell>가입일</TableCell>
                  <TableCell align="center">작업</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pendingUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} align="center">
                      승인 대기 중인 사용자가 없습니다.
                    </TableCell>
                  </TableRow>
                ) : (
                  pendingUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>{user.username}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{formatDate(user.created_at)}</TableCell>
                      <TableCell align="center">
                        <Button
                          variant="contained"
                          color="success"
                          size="small"
                          startIcon={<CheckIcon />}
                          onClick={() => handleApprove(user.id, user.username)}
                          sx={{ mr: 1 }}
                        >
                          승인
                        </Button>
                        <Button
                          variant="contained"
                          color="error"
                          size="small"
                          startIcon={<CloseIcon />}
                          onClick={() => handleReject(user.id, user.username)}
                        >
                          거절
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {tab === 1 && (
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>사용자명</TableCell>
                  <TableCell>이메일</TableCell>
                  <TableCell>상태</TableCell>
                  <TableCell>권한</TableCell>
                  <TableCell>가입일</TableCell>
                  <TableCell align="center">작업</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>{user.username}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{getStatusChip(user.status)}</TableCell>
                    <TableCell>
                      {user.is_admin ? (
                        <Chip label="관리자" color="primary" size="small" />
                      ) : (
                        <Chip label="일반" size="small" />
                      )}
                    </TableCell>
                    <TableCell>{formatDate(user.created_at)}</TableCell>
                    <TableCell align="center">
                      {!user.is_admin && (
                        <IconButton
                          color="error"
                          size="small"
                          onClick={() => handleDeleteClick(user.id, user.username)}
                          title="사용자 삭제"
                        >
                          <DeleteIcon />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {tab === 2 && (
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              시스템 설정
            </Typography>
            <Box sx={{ mt: 3 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.registration_enabled === 'true'}
                    onChange={handleToggleRegistration}
                    color="primary"
                  />
                }
                label={
                  <Box>
                    <Typography variant="body1">
                      회원가입 허용
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      활성화 시 로그인 페이지에서 회원가입 버튼이 표시됩니다.
                    </Typography>
                  </Box>
                }
              />
            </Box>
          </Paper>
        )}
      </Box>

      {/* 삭제 확인 다이얼로그 */}
      <Dialog
        open={deleteDialog.open}
        onClose={handleDeleteCancel}
      >
        <DialogTitle>사용자 삭제 확인</DialogTitle>
        <DialogContent>
          <DialogContentText>
            <strong>{deleteDialog.username}</strong> 계정을 정말 삭제하시겠습니까?
            <br />
            <br />
            이 작업은 되돌릴 수 없으며, 다음 항목이 함께 삭제됩니다:
            <ul>
              <li>사용자 계정</li>
              <li>폴더 접근 권한</li>
            </ul>
            <strong>참고:</strong> WebDAV 서버의 사용자 폴더는 자동으로 삭제되지 않습니다.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} color="primary">
            취소
          </Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained" autoFocus>
            삭제
          </Button>
        </DialogActions>
      </Dialog>

      {/* 사용자 추가 다이얼로그 */}
      <Dialog
        open={createDialog.open}
        onClose={handleCreateCancel}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>새 사용자 추가</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            새 사용자를 추가합니다. 즉시 승인된 상태로 생성되며, 전용 폴더가 자동으로 생성됩니다.
          </DialogContentText>
          <TextField
            fullWidth
            label="사용자명"
            value={newUser.username}
            onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
            margin="normal"
            autoFocus
            required
          />
          <TextField
            fullWidth
            label="이메일"
            type="email"
            value={newUser.email}
            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="비밀번호"
            type="password"
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            margin="normal"
            helperText="최소 6자 이상"
            required
          />
          <TextField
            fullWidth
            label="비밀번호 확인"
            type="password"
            value={newUser.confirmPassword}
            onChange={(e) => setNewUser({ ...newUser, confirmPassword: e.target.value })}
            margin="normal"
            required
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCreateCancel} color="primary">
            취소
          </Button>
          <Button onClick={handleCreateSubmit} color="primary" variant="contained">
            추가
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AdminDashboard;

