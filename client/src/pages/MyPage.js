import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Paper,
  Button,
  Alert,
  Divider,
  Tabs,
  Tab,
  Chip,
  Stack,
  CircularProgress,
  Menu,
  MenuItem,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Share as ShareIcon,
  Edit as EditIcon,
  ContentCopy as ContentCopyIcon,
  Check as CheckIcon,
  Language as LanguageIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ShareDialog, AccountEditDialog } from '../components/dialogs';
import { getShareLinks, deleteShareLink, getShareLinkUrl, updateShareLink } from '../services/shareLinkService';
import { updateEmail as updateEmailApi, updatePassword as updatePasswordApi } from '../services/userService';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import { validateEmail, validatePassword, validateMatch } from '@webdav-easyaccess/shared/validation';
import {
  cancelPermissionRequest,
  listInboxPermissionRequests,
  listOutboxPermissionRequests,
  rejectPermissionRequest,
  approvePermissionRequest,
} from '../services/permissionRequestService';
import { grantPermission } from '../services/permissionService';
import { formatDate, formatDateOnly } from '../utils/format';
import { getValidationMessage } from '../utils/validationMessage';
import { getServerErrorDisplay } from '../utils/errorUtils';
import { getFlagEmoji } from '../utils/flagEmoji';
import i18n from '../i18n';

const MyPage = () => {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewPermissionRequest, setReviewPermissionRequest] = useState(null);
  const [requestTab, setRequestTab] = useState(0); // 0: inbox, 1: outbox, 2: links
  const [requestLoading, setRequestLoading] = useState(false);
  const [inboxRequests, setInboxRequests] = useState([]);
  const [outboxRequests, setOutboxRequests] = useState([]);
  const [requestActionLoadingIds, setRequestActionLoadingIds] = useState(new Set());
  
  const [email, setEmail] = useState('');
  const [originalEmail, setOriginalEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  
  // 공유 링크 관리 상태
  const [shareLinks, setShareLinks] = useState([]);
  const [shareLinksLoading, setShareLinksLoading] = useState(false);
  const [linkCopied, setLinkCopied] = useState(null);

  // 언어 선택 메뉴
  const [languageMenuAnchor, setLanguageMenuAnchor] = useState(null);
  const LANGUAGES = [
    { code: 'ko', label: 'ko' },
    { code: 'en', label: 'en' },
  ];

  useEffect(() => {
    if (user) {
      setEmail(user.email || '');
      setOriginalEmail(user.email || '');
    }
  }, [user]);

  const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

  const emailChanged = normalizeEmail(email) !== normalizeEmail(originalEmail);
  const passwordEntered = password.length > 0 || confirmPassword.length > 0;
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const passwordTooShort = passwordEntered && password.length > 0 && password.length < 4;
  const passwordConfirmMissing = passwordEntered && confirmPassword.length === 0;
  const emailEmpty = emailChanged && normalizeEmail(email).length === 0;

  const canSave =
    ((emailChanged && !emailEmpty) || passwordEntered) &&
    !(passwordEntered && (passwordMismatch || passwordTooShort || passwordConfirmMissing));

  const formatPermissionLabel = (p) => {
    if (p === PERMISSIONS.READ) return t('mypage.read');
    if (p === PERMISSIONS.WRITE) return t('mypage.write');
    return String(p || '');
  };

  const formatStatusLabel = (s) => {
    if (s === 'pending') return { label: t('mypage.pending'), color: 'warning' };
    if (s === 'approved') return { label: t('mypage.approved'), color: 'success' };
    if (s === 'rejected') return { label: t('mypage.rejected'), color: 'error' };
    if (s === 'cancelled') return { label: t('mypage.cancelled'), color: 'default' };
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
        text: getServerErrorDisplay(error?.response?.data, t) || t('mypage.requestListLoadFail'),
      });
    } finally {
      setRequestLoading(false);
    }
  };

  useEffect(() => {
    if (user?.id) {
      loadPermissionRequests();
      // 어드민이 아닐 때만 공유 링크 로드
      if (!user.is_admin) {
        loadShareLinks();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadShareLinks = async () => {
    if (!user || user.is_admin) return;
    setShareLinksLoading(true);
    try {
      const links = await getShareLinks();
      setShareLinks(links);
    } catch (error) {
      console.error('Failed to load share links:', error);
      setShareLinks([]);
    } finally {
      setShareLinksLoading(false);
    }
  };

  const handleCopyLink = async (token) => {
    try {
      const url = getShareLinkUrl(token);
      await navigator.clipboard.writeText(url);
      setLinkCopied(token);
      setTimeout(() => setLinkCopied(null), 2000);
      setMessage({ type: 'success', text: t('mypage.linkCopied') });
    } catch (error) {
      console.error('Failed to copy link:', error);
      setMessage({ type: 'error', text: t('mypage.linkCopyFail') });
    }
  };

  const handleDeleteLink = async (token) => {
    try {
      await deleteShareLink(token);
      setMessage({ type: 'success', text: t('mypage.linkDeleted') });
      await loadShareLinks();
    } catch (error) {
      console.error('Failed to delete share link:', error);
      setMessage({ type: 'error', text: getServerErrorDisplay(error?.response?.data, t) || t('mypage.linkDeleteFail') });
    }
  };

  const handleExtendLink = async (token, days) => {
    try {
      await updateShareLink(token, { expiresInDays: days });
      setMessage({ type: 'success', text: t('mypage.linkExtended') });
      await loadShareLinks();
    } catch (error) {
      console.error('Failed to extend link:', error);
      setMessage({ type: 'error', text: getServerErrorDisplay(error?.response?.data, t) || t('mypage.linkExtendFail') });
    }
  };

  const handleOpenEditDialog = () => {
    if (!user) return;
    setOriginalEmail(email || user.email || '');
    setPassword('');
    setConfirmPassword('');
    setMessage({ type: '', text: '' });
    setEditDialogOpen(true);
  };

  const handleCloseEditDialog = () => {
    setEmail(originalEmail || '');
    setPassword('');
    setConfirmPassword('');
    setEditDialogOpen(false);
  };

  const handleSaveAccountChanges = async () => {
    if (!user) return;
    if (!canSave) return;

    const trimmedEmail = String(email || '').trim();
    const shouldUpdateEmail = emailChanged;
    const shouldUpdatePassword = passwordEntered;

    // Defensive validation (button should be disabled already, but keep safe).
    if (shouldUpdateEmail) {
      const emailError = validateEmail(trimmedEmail);
      if (emailError) {
        setMessage({ type: 'error', text: getValidationMessage(emailError, t) });
        return;
      }
    }

      if (shouldUpdatePassword) {
        if (passwordConfirmMissing) {
          setMessage({ type: 'error', text: t('mypage.confirmPasswordRequired') });
          return;
        }
      const matchError = validateMatch(password, confirmPassword, t('login.password'));
      if (matchError) {
        setMessage({ type: 'error', text: getValidationMessage(matchError, t) });
        return;
      }
      const passwordError = validatePassword(password, { minLength: 4 });
      if (passwordError) {
        setMessage({ type: 'error', text: getValidationMessage(passwordError, t) });
        return;
      }
    }

    setLoading(true);
    setMessage({ type: '', text: '' });

    let emailUpdated = false;
    try {
      if (shouldUpdateEmail) {
        await updateEmailApi(user.id, trimmedEmail);
        emailUpdated = true;
        setOriginalEmail(trimmedEmail);
      }

      if (shouldUpdatePassword) {
        await updatePasswordApi(user.id, password);
        setMessage({
          type: 'success',
          text: t('mypage.passwordChangedSuccess'),
        });
        setPassword('');
        setConfirmPassword('');
        setEditDialogOpen(false);
        // Password change rotates token_version on the server, invalidating existing tokens.
        logout();
        return;
      }

      if (shouldUpdateEmail) {
        setMessage({ type: 'success', text: t('mypage.emailChangedSuccess') });
        setEditDialogOpen(false);
      }
    } catch (error) {
      const serverMsg = getServerErrorDisplay(error?.response?.data, t);
      if (emailUpdated && shouldUpdatePassword) {
        setMessage({
          type: 'error',
          text: serverMsg
            ? `${t('mypage.emailChangedPasswordFail')}: ${serverMsg}`
            : t('mypage.emailChangedPasswordFail'),
        });
      } else {
        setMessage({
          type: 'error',
          text: serverMsg || t('mypage.saveFail'),
        });
      }
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
      <AppBar 
        position="sticky" 
        sx={{ 
          top: 0, 
          zIndex: (theme) => theme.zIndex.appBar,
          backgroundColor: 'transparent',
          backgroundImage: 'none',
        }}
        elevation={0}
      >
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
            {t('nav.mypage')}
          </Typography>
          <IconButton
            edge="end"
            color="inherit"
            onClick={(e) => setLanguageMenuAnchor(e.currentTarget)}
            aria-label={t('mypage.language')}
            aria-controls={languageMenuAnchor ? 'language-menu' : undefined}
            aria-haspopup="true"
            aria-expanded={languageMenuAnchor ? 'true' : undefined}
          >
            <LanguageIcon />
          </IconButton>
          <Menu
            id="language-menu"
            anchorEl={languageMenuAnchor}
            open={Boolean(languageMenuAnchor)}
            onClose={() => setLanguageMenuAnchor(null)}
            MenuListProps={{ 'aria-labelledby': 'language-button' }}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            {LANGUAGES.map(({ code, label }) => (
              <MenuItem
                key={code}
                onClick={() => {
                  i18n.changeLanguage(code);
                  setLanguageMenuAnchor(null);
                }}
                selected={i18n.language === code || i18n.language?.startsWith(code)}
              >
                <span style={{ marginRight: 8 }}>{getFlagEmoji(code)}</span>
                {label}
              </MenuItem>
            ))}
          </Menu>
        </Toolbar>
      </AppBar>

      <Box
        sx={{
          flex: 1,
          p: 3,
          maxWidth: { xs: 600, md: 1000, lg: 1200 },
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

        <Box
          sx={{
            display: 'grid',
            gap: 3,
            alignItems: 'start',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(auto-fit, minmax(320px, 1fr))',
            },
          }}
        >
          <Paper sx={{ p: 3 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="h6">{t('mypage.accountInfo')}</Typography>
              <IconButton aria-label={t('mypage.editAccountInfo')} onClick={handleOpenEditDialog} size="small">
                <EditIcon />
              </IconButton>
            </Stack>
            <Divider sx={{ mb: 2 }} />

            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t('login.username')}
              </Typography>
              <Typography variant="body1" sx={{ fontWeight: 500 }}>
                {user?.username}
              </Typography>
            </Box>

            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t('dialogs.email')}
              </Typography>
              <Typography variant="body1" sx={{ fontWeight: 500 }}>
                {email || user?.email || '-'}
              </Typography>
            </Box>

            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t('mypage.accountStatus')}
              </Typography>
              <Typography variant="body1" sx={{ fontWeight: 500 }}>
                {user?.status === 'approved' ? t('mypage.approvedStatus') : (user?.status === 'pending' ? t('mypage.pending') : user?.status === 'rejected' ? t('mypage.rejected') : user?.status)}
              </Typography>
            </Box>

            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t('mypage.permission')}
              </Typography>
              <Typography variant="body1" sx={{ fontWeight: 500 }}>
                {user?.is_admin ? t('mypage.admin') : t('mypage.normalUser')}
              </Typography>
            </Box>
          </Paper>

          {!user?.is_admin && (
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                {t('mypage.shareManage')}
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('mypage.shareManageDescription')}
              </Typography>

              <Button
                variant="contained"
                startIcon={<ShareIcon />}
                onClick={() => setShareDialogOpen(true)}
                fullWidth
                sx={{ mb: 3 }}
              >
                {t('mypage.openShareManage')}
              </Button>

              <Divider sx={{ mb: 2 }} />

              <Tabs value={requestTab} onChange={(e, v) => setRequestTab(v)} sx={{ mb: 2 }}>
                <Tab label={t('mypage.inboxRequestsCount', { count: inboxRequests.length })} />
                <Tab label={t('mypage.outboxRequestsCount', { count: outboxRequests.length })} />
                {!user?.is_admin && (
                  <Tab label={t('mypage.linksCount', { count: shareLinks.length })} />
                )}
              </Tabs>

              {requestTab === 2 && !user?.is_admin ? (
                // 링크 탭
                shareLinksLoading ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                    <CircularProgress size={24} />
                  </Box>
                ) : shareLinks.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    {t('mypage.noShareLinks')}
                  </Typography>
                ) : (
                  <Stack spacing={1.5}>
                    {shareLinks.map((link) => (
                      <Paper key={link.token} variant="outlined" sx={{ p: 2 }}>
                        <Stack spacing={1}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="body2" sx={{ wordBreak: 'break-all', mb: 0.5 }}>
                                {link.filePath.split('/').pop()}
                              </Typography>
                              <Typography
                                component="span"
                                onClick={() => {
                                  const url = getShareLinkUrl(link.token);
                                  window.open(url, '_blank', 'noopener,noreferrer');
                                }}
                                color="text.secondary"
                                sx={{
                                  display: 'block',
                                  wordBreak: 'break-all',
                                  fontSize: '0.75rem',
                                  fontFamily: 'monospace',
                                  cursor: 'pointer',
                                  textDecoration: 'underline',
                                  textDecorationColor: 'rgba(0,0,0,0.3)',
                                  '&:hover': {
                                    textDecorationColor: 'rgba(0,0,0,0.8)',
                                  },
                                }}
                              >
                                {getShareLinkUrl(link.token)}
                              </Typography>
                            </Box>
                            <IconButton
                              size="small"
                              onClick={() => handleCopyLink(link.token)}
                              sx={{ ml: 1 }}
                            >
                              {linkCopied === link.token ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                            </IconButton>
                          </Box>
                          
                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            <Chip
                              size="small"
                              label={link.isExpired ? t('mypage.expired') : link.expiresAt ? t('mypage.expiresAtDate', { date: formatDateOnly(link.expiresAt) }) : t('mypage.unlimited')}
                              color={link.isExpired ? 'error' : 'default'}
                            />
                            <Chip
                              size="small"
                              label={t('mypage.downloadCount', { count: link.downloadCount || 0 })}
                            />
                          </Box>
                          
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            {!link.isExpired && link.expiresAt && (
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => {
                                  const currentExpiry = new Date(link.expiresAt);
                                  const now = new Date();
                                  const daysLeft = Math.ceil((currentExpiry - now) / (1000 * 60 * 60 * 24));
                                  handleExtendLink(link.token, daysLeft + 7);
                                }}
                              >
                                {t('mypage.extend7Days')}
                              </Button>
                            )}
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              onClick={() => {
                                if (window.confirm(t('mypage.confirmDeleteLink'))) {
                                  handleDeleteLink(link.token);
                                }
                              }}
                            >
                              {t('common.delete')}
                            </Button>
                          </Stack>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                )
              ) : requestLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : (
                <Stack spacing={1.5}>
                  {(requestTab === 0 ? inboxRequests : outboxRequests).length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {t('mypage.noRequestsToShow')}
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
                                color={r.requested_permission === PERMISSIONS.WRITE ? 'primary' : 'default'}
                              />
                              <Chip size="small" label={statusInfo.label} color={statusInfo.color} />
                              <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                                {r.created_at ? formatDate(r.created_at) : ''}
                              </Typography>
                            </Stack>

                            <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                              {r.target_type === 'file' ? t('mypage.file') : t('mypage.folder')}: {r.file_path ?? r.folder_path}
                            </Typography>

                            {requestTab === 0 ? (
                              <Typography variant="caption" color="text.secondary">
                                {t('mypage.requester')}: {r.requester_username || r.requester_id}
                              </Typography>
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                {t('mypage.owner')}: {r.owner_username || r.owner_id}
                              </Typography>
                            )}

                            {r.message ? (
                              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                                {t('mypage.messageLabel')}: {r.message}
                              </Typography>
                            ) : null}

                            <Stack direction="row" spacing={1} justifyContent="flex-end">
                              {requestTab === 0 ? (
                                <>
                                  {r.target_type === 'file' && r.file_path ? (
                                    <Button
                                      size="small"
                                      variant="contained"
                                      disabled={!isPending || isActionLoading}
                                      onClick={() =>
                                        withRequestActionLoading(r.id, async () => {
                                          await grantPermission({
                                            userId: r.requester_id,
                                            folderPath: r.file_path,
                                            permission: r.requested_permission || PERMISSIONS.READ,
                                            target: 'file',
                                          });
                                          await approvePermissionRequest(r.id);
                                          setMessage({ type: 'success', text: t('mypage.permissionApproved') });
                                          await loadPermissionRequests();
                                        })
                                      }
                                    >
                                      {t('mypage.approved')}
                                    </Button>
                                  ) : (
                                    <Button
                                      size="small"
                                      variant="contained"
                                      disabled={!isPending || isActionLoading}
                                      onClick={() => {
                                        setReviewPermissionRequest(r);
                                        setReviewDialogOpen(true);
                                      }}
                                    >
                                      {t('mypage.review')}
                                    </Button>
                                  )}
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    color="error"
                                    disabled={!isPending || isActionLoading}
                                    onClick={() =>
                                      withRequestActionLoading(r.id, async () => {
                                        await rejectPermissionRequest(r.id);
                                        setMessage({ type: 'success', text: t('mypage.requestRejected') });
                                        await loadPermissionRequests();
                                      })
                                    }
                                  >
                                    {t('mypage.rejected')}
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
                                      setMessage({ type: 'success', text: t('mypage.requestCancelled') });
                                      await loadPermissionRequests();
                                    })
                                  }
                                >
                                  {t('mypage.cancelled')}
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
      </Box>

      {!user?.is_admin && (
        <>
          <ShareDialog
            open={shareDialogOpen}
            onClose={() => setShareDialogOpen(false)}
            mode="share"
            folderPath={user?.username ? `/${user.username}` : null}
            folderName={user?.username || t('mypage.homeDir')}
            user={user}
            onMessage={(msg) => {
              setMessage({ type: msg.type, text: msg.text });
            }}
          />
          <ShareDialog
            open={reviewDialogOpen}
            onClose={() => {
              setReviewDialogOpen(false);
              setReviewPermissionRequest(null);
            }}
            mode="review"
            permissionRequest={reviewPermissionRequest}
            folderPath={reviewPermissionRequest?.folder_path || null}
            folderName={reviewPermissionRequest?.folder_path?.split('/').filter(Boolean).pop() || t('mypage.folder')}
            user={user}
            onMessage={(msg) => {
              setMessage({ type: msg.type, text: msg.text });
            }}
            onApprove={async () => {
              await loadPermissionRequests();
            }}
          />
        </>
      )}

      <AccountEditDialog
        open={editDialogOpen}
        onClose={handleCloseEditDialog}
        email={email}
        onEmailChange={(v) => setEmail(v)}
        password={password}
        onPasswordChange={(v) => setPassword(v)}
        confirmPassword={confirmPassword}
        onConfirmPasswordChange={(v) => setConfirmPassword(v)}
        loading={loading}
        canSave={canSave}
        onSave={handleSaveAccountChanges}
        message={message}
        onClearMessage={() => setMessage({ type: '', text: '' })}
      />
    </Box>
  );
};

export default MyPage;


