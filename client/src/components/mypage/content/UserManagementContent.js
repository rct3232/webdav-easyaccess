import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Chip,
  Paper,
  Typography,
  IconButton,
  CircularProgress,
  Alert,
  Snackbar,
  Card,
  CardContent,
  CardActions,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
} from '@mui/material';
import {
  Add as AddIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import * as adminService from '../../../services/adminService';
import {
  validateRequired,
  validateUsername,
  validateEmail,
  validatePassword,
  validateMatch,
} from '@webdav-easyaccess/shared/validation';
import { getValidationMessage } from '../../../utils/validationMessage';
import { getServerErrorDisplay } from '../../../utils/errorUtils';
import { ShareDialog } from '../../dialogs';
import { formatDate } from '../../../utils/format';
import { usePageHeader } from '../../../contexts/PageHeaderContext';

const UserManagementContent = () => {
  const { t } = useTranslation();
  const { setTitle, setActions } = usePageHeader();

  const [users, setUsers] = useState([]);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, userId: null, username: '' });
  const [createDialog, setCreateDialog] = useState({ open: false });
  const [newUser, setNewUser] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [permissionDialog, setPermissionDialog] = useState({
    open: false,
    userId: null,
    username: '',
  });
  const [initialLoading, setInitialLoading] = useState(true);
  const [actionLoadingIds, setActionLoadingIds] = useState(new Set());
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [createUserLoading, setCreateUserLoading] = useState(false);

  const loadPendingUsers = useCallback(async () => {
    try {
      const data = await adminService.getPendingUsers();
      setPendingUsers(data);
    } catch (error) {
      console.error('Failed to load pending users:', error);
    }
  }, []);

  const loadAllUsers = useCallback(async () => {
    try {
      const data = await adminService.getUsers();
      setUsers(data);
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setInitialLoading(true);
      try {
        await Promise.all([loadPendingUsers(), loadAllUsers()]);
      } finally {
        setInitialLoading(false);
      }
    };
    loadData();
  }, [loadPendingUsers, loadAllUsers]);

  const getUserList = () => {
    const userMap = new Map();
    pendingUsers.forEach((u) => userMap.set(u.id, u));
    users.forEach((u) => {
      if (u.status !== 'pending' || !userMap.has(u.id)) userMap.set(u.id, u);
    });
    return Array.from(userMap.values()).sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  };

  const userList = getUserList();

  const getStatusChip = (status) => {
    const statusMap = {
      pending: { label: t('admin.statusPending'), color: 'warning' },
      approved: { label: t('admin.statusApproved'), color: 'success' },
      rejected: { label: t('admin.statusRejected'), color: 'error' },
    };
    const config = statusMap[status] || { label: status, color: 'default' };
    return <Chip label={config.label} color={config.color} size="small" />;
  };

  const handleApprove = async (userId, username) => {
    setActionLoadingIds((prev) => new Set(prev).add(userId));
    try {
      await adminService.approveUser(userId);
      setMessage({ type: 'success', text: t('admin.approveSuccess', { name: username }) });
      await Promise.all([loadPendingUsers(), loadAllUsers()]);
    } catch (error) {
      setMessage({
        type: 'error',
        text: getServerErrorDisplay(error?.response?.data, t) || t('admin.approveFail'),
      });
    } finally {
      setActionLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  const handleReject = async (userId, username) => {
    setActionLoadingIds((prev) => new Set(prev).add(userId));
    try {
      await adminService.rejectUser(userId);
      setMessage({ type: 'success', text: t('admin.rejectSuccess', { name: username }) });
      await Promise.all([loadPendingUsers(), loadAllUsers()]);
    } catch (error) {
      setMessage({
        type: 'error',
        text: getServerErrorDisplay(error?.response?.data, t) || t('admin.rejectFail'),
      });
    } finally {
      setActionLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  const handleDeleteClick = (userId, username) => setDeleteDialog({ open: true, userId, username });
  const handleDeleteCancel = () => setDeleteDialog({ open: false, userId: null, username: '' });

  const handleDeleteConfirm = async () => {
    const { userId, username } = deleteDialog;
    setDeleteLoading(true);
    try {
      await adminService.deleteUser(userId);
      setDeleteDialog({ open: false, userId: null, username: '' });
      setMessage({ type: 'success', text: t('admin.deleteSuccess', { name: username }) });
      await Promise.all([loadPendingUsers(), loadAllUsers()]);
    } catch (error) {
      setMessage({
        type: 'error',
        text: getServerErrorDisplay(error?.response?.data, t) || t('admin.deleteFail'),
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleCreateClick = useCallback(() => {
    setCreateDialog({ open: true });
    setNewUser({ username: '', email: '', password: '', confirmPassword: '' });
  }, []);
  const handleCreateCancel = () => {
    setCreateDialog({ open: false });
    setNewUser({ username: '', email: '', password: '', confirmPassword: '' });
  };

  const handleCreateSubmit = async () => {
    const requiredError =
      validateRequired(newUser.username, t('admin.username')) ||
      validateRequired(newUser.email, t('admin.email')) ||
      validateRequired(newUser.password, t('login.password'));
    if (requiredError) {
      setMessage({ type: 'error', text: getValidationMessage(requiredError, t) });
      return;
    }
    const usernameError = validateUsername(newUser.username);
    if (usernameError) {
      setMessage({ type: 'error', text: getValidationMessage(usernameError, t) });
      return;
    }
    const emailError = validateEmail(newUser.email);
    if (emailError) {
      setMessage({ type: 'error', text: getValidationMessage(emailError, t) });
      return;
    }
    const matchError = validateMatch(
      newUser.password,
      newUser.confirmPassword,
      t('login.password')
    );
    if (matchError) {
      setMessage({ type: 'error', text: getValidationMessage(matchError, t) });
      return;
    }
    const passwordError = validatePassword(newUser.password);
    if (passwordError) {
      setMessage({ type: 'error', text: getValidationMessage(passwordError, t) });
      return;
    }
    setCreateUserLoading(true);
    try {
      await adminService.createUser({
        username: newUser.username,
        email: newUser.email,
        password: newUser.password,
      });
      setMessage({ type: 'success', text: t('admin.addUserSuccess', { name: newUser.username }) });
      setCreateDialog({ open: false });
      setNewUser({ username: '', email: '', password: '', confirmPassword: '' });
      await Promise.all([loadPendingUsers(), loadAllUsers()]);
    } catch (error) {
      setMessage({
        type: 'error',
        text: getServerErrorDisplay(error?.response?.data, t) || t('admin.addUserFail'),
      });
    } finally {
      setCreateUserLoading(false);
    }
  };

  const handleUserClick = (userId, username) => {
    if (userId == null) return;
    setPermissionDialog({ open: true, userId, username });
  };
  const handleClosePermissionDialog = () =>
    setPermissionDialog({ open: false, userId: null, username: '' });

  useEffect(() => {
    setTitle(t('admin.users'));
    setActions(
      <IconButton
        color="primary"
        onClick={handleCreateClick}
        size="small"
        aria-label={t('common.add')}
      >
        <AddIcon />
      </IconButton>
    );
  }, [t, handleCreateClick, setTitle, setActions]);

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}
    >
      {initialLoading ? (
        <Box
          sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}
        >
          <CircularProgress />
        </Box>
      ) : (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            WebkitOverflowScrolling: 'touch',
            p: 2,
          }}
        >
          {userList.length === 0 ? (
            <Paper sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body1" color="text.secondary">
                {t('admin.noUsers')}
              </Typography>
            </Paper>
          ) : (
            userList.map((u) => (
              <Card
                key={u.id}
                sx={{
                  cursor: u.status !== 'pending' && !u.is_admin ? 'pointer' : 'default',
                  '&:hover': u.status !== 'pending' && !u.is_admin ? { boxShadow: 3 } : {},
                  flexShrink: 0,
                }}
                onClick={() =>
                  u.status !== 'pending' && !u.is_admin && handleUserClick(u.id, u.username)
                }
              >
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
                    {u.username}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {u.email}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                    {getStatusChip(u.status)}
                    {u.is_admin ? (
                      <Chip label={t('admin.adminRole')} color="primary" size="small" />
                    ) : (
                      <Chip label={t('admin.normalRole')} size="small" />
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {t('admin.joinedAtLabel', { date: formatDate(u.created_at) })}
                  </Typography>
                </CardContent>
                <CardActions sx={{ px: 2, pb: 2, pt: 0 }} onClick={(e) => e.stopPropagation()}>
                  {u.status === 'pending' ? (
                    <>
                      <Button
                        variant="contained"
                        color="success"
                        size="small"
                        startIcon={
                          actionLoadingIds.has(u.id) ? (
                            <CircularProgress size={16} color="inherit" />
                          ) : (
                            <CheckIcon />
                          )
                        }
                        onClick={() => handleApprove(u.id, u.username)}
                        disabled={actionLoadingIds.has(u.id)}
                        sx={{ flex: 1 }}
                      >
                        {t('admin.approve')}
                      </Button>
                      <Button
                        variant="contained"
                        color="error"
                        size="small"
                        startIcon={
                          actionLoadingIds.has(u.id) ? (
                            <CircularProgress size={16} color="inherit" />
                          ) : (
                            <CloseIcon />
                          )
                        }
                        onClick={() => handleReject(u.id, u.username)}
                        disabled={actionLoadingIds.has(u.id)}
                        sx={{ flex: 1 }}
                      >
                        {t('admin.reject')}
                      </Button>
                    </>
                  ) : (
                    !u.is_admin && (
                      <IconButton
                        color="error"
                        size="small"
                        onClick={() => handleDeleteClick(u.id, u.username)}
                        title={t('admin.deleteUser')}
                        sx={{ ml: 'auto' }}
                      >
                        <DeleteIcon />
                      </IconButton>
                    )
                  )}
                </CardActions>
              </Card>
            ))
          )}
        </Box>
      )}

      <ShareDialog
        open={permissionDialog.open}
        onClose={handleClosePermissionDialog}
        mode="admin"
        userId={permissionDialog.userId}
        username={permissionDialog.username}
        onSave={() => loadAllUsers()}
        onMessage={(msg) => msg?.text && setMessage({ type: msg.type || 'info', text: msg.text })}
      />

      <Dialog open={deleteDialog.open} onClose={handleDeleteCancel} fullScreen>
        <DialogTitle>{t('admin.deleteUserConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            {t('admin.deleteUserConfirmBody', { name: deleteDialog.username })}
            <br />
            <br />
            {t('admin.deleteUserConfirmNote')}
            <ul>
              <li>{t('admin.deleteUserConfirmItem1')}</li>
              <li>{t('admin.deleteUserConfirmItem2')}</li>
            </ul>
            <strong>{t('admin.deleteUserConfirmWebdavNote')}</strong>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} color="primary" disabled={deleteLoading}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            autoFocus
            disabled={deleteLoading}
          >
            {deleteLoading ? <CircularProgress size={20} color="inherit" /> : t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={createDialog.open}
        onClose={handleCreateCancel}
        maxWidth="sm"
        fullWidth
        fullScreen
      >
        <DialogTitle>{t('admin.newUserTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>{t('admin.newUserDesc')}</DialogContentText>
          <TextField
            fullWidth
            label={t('admin.username')}
            value={newUser.username}
            onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
            margin="normal"
            autoFocus
            required
          />
          <TextField
            fullWidth
            label={t('admin.email')}
            type="email"
            value={newUser.email}
            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label={t('login.password')}
            type="password"
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            margin="normal"
            helperText={t('admin.passwordMinLength')}
            required
          />
          <TextField
            fullWidth
            label={t('admin.confirmPassword')}
            type="password"
            value={newUser.confirmPassword}
            onChange={(e) => setNewUser({ ...newUser, confirmPassword: e.target.value })}
            margin="normal"
            required
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCreateCancel} color="primary" disabled={createUserLoading}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleCreateSubmit}
            color="primary"
            variant="contained"
            disabled={createUserLoading}
          >
            {createUserLoading ? <CircularProgress size={20} color="inherit" /> : t('admin.add')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!message.text}
        autoHideDuration={6000}
        onClose={() => setMessage({ type: '', text: '' })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setMessage({ type: '', text: '' })}
          severity={message.type || 'info'}
          sx={{ width: '100%' }}
        >
          {message.text}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default UserManagementContent;
