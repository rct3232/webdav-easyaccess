import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Box,
  Button,
  Chip,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
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
  Switch,
} from '@mui/material';
import {
  Check as CheckIcon,
  ChevronRight as ChevronRightIcon,
  Close as CloseIcon,
  Delete as DeleteIcon,
  CleaningServices as CleaningServicesIcon,
} from '@mui/icons-material';
import CategoryIcon from '@mui/icons-material/Category';
import * as adminService from '../../../services/adminService';
import { validateRequired, validateUsername, validateEmail, validatePassword, validateMatch } from '@webdav-easyaccess/shared/validation';
import { getValidationMessage } from '../../../utils/validationMessage';
import { getServerErrorDisplay } from '../../../utils/errorUtils';
import { ShareDialog } from '../../dialogs';
import { formatDate } from '../../../utils/format';
import { getShowHiddenFiles, setShowHiddenFiles as saveShowHiddenFiles } from '../../../utils/localStorage';

const AdminContent = ({ selectedContentItem, onSelectContentItem, user, onMessage }) => {
  const { t } = useTranslation();

  const [users, setUsers] = useState([]);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, userId: null, username: '' });
  const [createDialog, setCreateDialog] = useState({ open: false });
  const [newUser, setNewUser] = useState({ username: '', email: '', password: '', confirmPassword: '' });
  const [tempSettings, setTempSettings] = useState({ registration_enabled: 'false' });
  const [hasSettingsChanges, setHasSettingsChanges] = useState(false);
  const [permissionDialog, setPermissionDialog] = useState({ open: false, userId: null, username: '' });
  const [showHiddenFiles, setShowHiddenFiles] = useState(() => getShowHiddenFiles());
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
  const [permissionCleanupLoading, setPermissionCleanupLoading] = useState(false);
  const [permissionCleanupConfirmOpen, setPermissionCleanupConfirmOpen] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [actionLoadingIds, setActionLoadingIds] = useState(new Set());
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [saveSettingsLoading, setSaveSettingsLoading] = useState(false);
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

  const loadSettings = useCallback(async () => {
    try {
      const data = await adminService.getSettings();
      setTempSettings(data);
      setHasSettingsChanges(false);
    } catch (error) {
      setMessage({ type: 'error', text: t('admin.settingsLoadFail') });
    }
  }, [t]);

  useEffect(() => {
    const loadData = async () => {
      setInitialLoading(true);
      try {
        await Promise.all([loadPendingUsers(), loadAllUsers(), loadSettings()]);
      } finally {
        setInitialLoading(false);
      }
    };
    loadData();
  }, [loadPendingUsers, loadAllUsers, loadSettings]);

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

  const handleToggleRegistration = () => {
    const newValue = tempSettings.registration_enabled === 'true' ? 'false' : 'true';
    setTempSettings({ ...tempSettings, registration_enabled: newValue });
    setHasSettingsChanges(true);
  };

  const handleSaveSettings = async () => {
    setSaveSettingsLoading(true);
    try {
      await adminService.updateSettings(tempSettings);
      setMessage({ type: 'success', text: t('admin.settingsSaveSuccess') });
      await loadSettings();
    } catch (error) {
      setMessage({ type: 'error', text: t('admin.settingsSaveFail') });
    } finally {
      setSaveSettingsLoading(false);
    }
  };

  const handleCleanupOrphaned = async () => {
    setCleanupConfirmOpen(false);
    setCleanupLoading(true);
    try {
      const res = await adminService.cleanupOrphaned();
      const { results } = res;
      const totalCleaned =
        results.deletedPermissionFiles +
        results.deletedUserFiles +
        results.deletedEmailIndexFiles +
        results.cleanedPermissionRequests;
      let messageText;
      if (totalCleaned === 0) messageText = t('admin.noDataToClean');
      else if (results.errors?.length) messageText = t('admin.cleanupDonePartial', { count: totalCleaned });
      else messageText = t('admin.cleanupDone', { count: totalCleaned });
      setMessage({ type: results.errors?.length ? 'warning' : totalCleaned > 0 ? 'success' : 'info', text: messageText });
    } catch (error) {
      setMessage({ type: 'error', text: getServerErrorDisplay(error?.response?.data, t) || t('admin.orphanCleanupFail') });
    } finally {
      setCleanupLoading(false);
    }
  };

  const handlePermissionCleanup = async () => {
    setPermissionCleanupConfirmOpen(false);
    setPermissionCleanupLoading(true);
    try {
      const res = await adminService.ensureHomeOwnerAdmin();
      const { updatedUsers, upgradedPaths, grantedPaths, errors } = res;
      const total = (upgradedPaths || 0) + (grantedPaths || 0);
      let messageText;
      if (total === 0 && (!errors || errors.length === 0)) messageText = t('admin.noPermissionToFix');
      else if (errors?.length) messageText = t('admin.permissionCleanupDonePartial', { users: updatedUsers || 0, paths: total });
      else messageText = t('admin.permissionCleanupDone', { users: updatedUsers || 0, paths: total });
      setMessage({ type: errors?.length ? 'warning' : total > 0 ? 'success' : 'info', text: messageText });
    } catch (error) {
      setMessage({ type: 'error', text: getServerErrorDisplay(error?.response?.data, t) || t('admin.permissionCleanupFail') });
    } finally {
      setPermissionCleanupLoading(false);
    }
  };

  const handleApprove = async (userId, username) => {
    setActionLoadingIds((prev) => new Set(prev).add(userId));
    try {
      await adminService.approveUser(userId);
      setMessage({ type: 'success', text: t('admin.approveSuccess', { name: username }) });
      await Promise.all([loadPendingUsers(), loadAllUsers()]);
    } catch (error) {
      setMessage({ type: 'error', text: getServerErrorDisplay(error?.response?.data, t) || t('admin.approveFail') });
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
      setMessage({ type: 'error', text: getServerErrorDisplay(error?.response?.data, t) || t('admin.rejectFail') });
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
      setMessage({ type: 'error', text: getServerErrorDisplay(error?.response?.data, t) || t('admin.deleteFail') });
    } finally {
      setDeleteLoading(false);
    }
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
    const matchError = validateMatch(newUser.password, newUser.confirmPassword, t('login.password'));
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
      await adminService.createUser({ username: newUser.username, email: newUser.email, password: newUser.password });
      setMessage({ type: 'success', text: t('admin.addUserSuccess', { name: newUser.username }) });
      setCreateDialog({ open: false });
      setNewUser({ username: '', email: '', password: '', confirmPassword: '' });
      await Promise.all([loadPendingUsers(), loadAllUsers()]);
    } catch (error) {
      setMessage({ type: 'error', text: getServerErrorDisplay(error?.response?.data, t) || t('admin.addUserFail') });
    } finally {
      setCreateUserLoading(false);
    }
  };

  const handleUserClick = (userId, username) => {
    if (userId == null) return;
    setPermissionDialog({ open: true, userId, username });
  };
  const handleClosePermissionDialog = () => setPermissionDialog({ open: false, userId: null, username: '' });

  // List view
  if (selectedContentItem === null || selectedContentItem === undefined) {
    return (
      <Box>
        <List disablePadding>
          <ListItem disablePadding divider>
            <ListItemButton onClick={() => onSelectContentItem('users')} sx={{ alignItems: 'center' }}>
              <ListItemText
                primary={
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                    {t('admin.users')}
                    <Badge
                    badgeContent={users.length}
                    color="primary"
                    showZero
                    slotProps={{
                      badge: {
                        sx: {
                          top: '50%',
                          transform: 'scale(1) translate(50%, -50%)',
                        },
                      },
                    }}
                  >
                    <Box component="span" sx={{ width: 10, height: 10 }} aria-hidden />
                  </Badge>
                  </Box>
                }
                sx={{ flex: 1, minWidth: 0 }}
              />
              <ChevronRightIcon sx={{ fontSize: 20, color: 'action.active', flexShrink: 0 }} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => onSelectContentItem('settings')} sx={{ alignItems: 'center' }}>
              <ListItemText primary={t('admin.settingsTab')} />
              <ChevronRightIcon sx={{ fontSize: 20, color: 'action.active', ml: 0.5 }} />
            </ListItemButton>
          </ListItem>
        </List>
      </Box>
    );
  }

  // Detail: Users
  if (selectedContentItem === 'users') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2, flexShrink: 0 }}>
          <Button variant="contained" onClick={handleCreateClick} size="small">
            {t('common.add')}
          </Button>
        </Box>
        {initialLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2, WebkitOverflowScrolling: 'touch' }}>
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
                  onClick={() => u.status !== 'pending' && !u.is_admin && handleUserClick(u.id, u.username)}
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
                      {u.is_admin ? <Chip label={t('admin.adminRole')} color="primary" size="small" /> : <Chip label={t('admin.normalRole')} size="small" />}
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
                          startIcon={actionLoadingIds.has(u.id) ? <CircularProgress size={16} color="inherit" /> : <CheckIcon />}
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
                          startIcon={actionLoadingIds.has(u.id) ? <CircularProgress size={16} color="inherit" /> : <CloseIcon />}
                          onClick={() => handleReject(u.id, u.username)}
                          disabled={actionLoadingIds.has(u.id)}
                          sx={{ flex: 1 }}
                        >
                          {t('admin.reject')}
                        </Button>
                      </>
                    ) : (
                      !u.is_admin && (
                        <IconButton color="error" size="small" onClick={() => handleDeleteClick(u.id, u.username)} title={t('admin.deleteUser')} sx={{ ml: 'auto' }}>
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
            <Button onClick={handleDeleteConfirm} color="error" variant="contained" autoFocus disabled={deleteLoading}>
              {deleteLoading ? <CircularProgress size={20} color="inherit" /> : t('common.delete')}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog open={createDialog.open} onClose={handleCreateCancel} maxWidth="sm" fullWidth fullScreen>
          <DialogTitle>{t('admin.newUserTitle')}</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>{t('admin.newUserDesc')}</DialogContentText>
            <TextField fullWidth label={t('admin.username')} value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} margin="normal" autoFocus required />
            <TextField fullWidth label={t('admin.email')} type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} margin="normal" required />
            <TextField fullWidth label={t('login.password')} type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} margin="normal" helperText={t('admin.passwordMinLength')} required />
            <TextField fullWidth label={t('admin.confirmPassword')} type="password" value={newUser.confirmPassword} onChange={(e) => setNewUser({ ...newUser, confirmPassword: e.target.value })} margin="normal" required />
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCreateCancel} color="primary" disabled={createUserLoading}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreateSubmit} color="primary" variant="contained" disabled={createUserLoading}>
              {createUserLoading ? <CircularProgress size={20} color="inherit" /> : t('admin.add')}
            </Button>
          </DialogActions>
        </Dialog>

        <Snackbar open={!!message.text} autoHideDuration={6000} onClose={() => setMessage({ type: '', text: '' })} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert onClose={() => setMessage({ type: '', text: '' })} severity={message.type || 'info'} sx={{ width: '100%' }}>
            {message.text}
          </Alert>
        </Snackbar>
      </Box>
    );
  }

  // Detail: Settings
  if (selectedContentItem === 'settings') {
    return (
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button
            variant="contained"
            color="primary"
            onClick={handleSaveSettings}
            disabled={!hasSettingsChanges || saveSettingsLoading}
            size="small"
            startIcon={saveSettingsLoading ? <CircularProgress size={18} color="inherit" /> : null}
          >
            {saveSettingsLoading ? t('admin.saving') : t('admin.save')}
          </Button>
        </Box>
        <Typography variant="h6" gutterBottom>
          {t('admin.systemSettings')}
        </Typography>
        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="body1">{t('admin.registrationEnabled')}</Typography>
            <Typography variant="body2" color="text.secondary">{t('admin.registrationEnabledDesc')}</Typography>
          </Box>
          <Switch checked={tempSettings.registration_enabled === 'true'} onChange={handleToggleRegistration} color="primary" sx={{ ml: 2 }} />
        </Box>
        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="body1">{t('admin.showHiddenFiles')}</Typography>
            <Typography variant="body2" color="text.secondary">{t('admin.showHiddenFilesDesc')}</Typography>
          </Box>
          <Switch
            checked={showHiddenFiles}
            onChange={(e) => {
              const newValue = e.target.checked;
              setShowHiddenFiles(newValue);
              saveShowHiddenFiles(newValue);
            }}
            color="primary"
            sx={{ ml: 2 }}
          />
        </Box>
        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="body1">{t('admin.dataCleanup')}</Typography>
            <Typography variant="body2" color="text.secondary">{t('admin.dataCleanupDesc')}</Typography>
          </Box>
          <IconButton onClick={() => setCleanupConfirmOpen(true)} disabled={cleanupLoading} color="primary" sx={{ ml: 2 }} aria-label={t('admin.runCleanup')}>
            {cleanupLoading ? <CircularProgress size={24} /> : <CleaningServicesIcon />}
          </IconButton>
        </Box>
        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="body1">{t('admin.permissionCleanup')}</Typography>
            <Typography variant="body2" color="text.secondary">{t('admin.permissionCleanupDesc')}</Typography>
          </Box>
          <IconButton onClick={() => setPermissionCleanupConfirmOpen(true)} disabled={permissionCleanupLoading} color="primary" sx={{ ml: 2 }} aria-label={t('admin.run')}>
            {permissionCleanupLoading ? <CircularProgress size={24} /> : <CategoryIcon />}
          </IconButton>
        </Box>

        <Dialog open={cleanupConfirmOpen} onClose={() => setCleanupConfirmOpen(false)} fullScreen>
          <DialogTitle>{t('admin.orphanCleanupConfirmTitle')}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {t('admin.orphanCleanupConfirmBody')}
              <br />
              <br />
              {t('admin.orphanCleanupConfirmNote')}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCleanupConfirmOpen(false)} color="primary">
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCleanupOrphaned} color="error" variant="contained" autoFocus>
              {t('admin.runCleanup')}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog open={permissionCleanupConfirmOpen} onClose={() => setPermissionCleanupConfirmOpen(false)} fullScreen>
          <DialogTitle>{t('admin.permissionCleanupConfirmTitle')}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {t('admin.permissionCleanupDesc')}
              <br />
              <br />
              {t('admin.permissionCleanupConfirmQuestion')}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPermissionCleanupConfirmOpen(false)} color="primary">
              {t('common.cancel')}
            </Button>
            <Button onClick={handlePermissionCleanup} color="primary" variant="contained" autoFocus>
              {t('admin.run')}
            </Button>
          </DialogActions>
        </Dialog>

        <Snackbar open={!!message.text} autoHideDuration={6000} onClose={() => setMessage({ type: '', text: '' })} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert onClose={() => setMessage({ type: '', text: '' })} severity={message.type || 'info'} sx={{ width: '100%' }}>
            {message.text}
          </Alert>
        </Snackbar>
      </Box>
    );
  }

  return null;
};

export default AdminContent;
