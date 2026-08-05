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
  Stack,
  Typography,
  IconButton,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  ContentCopy as ContentCopyIcon,
  Check as CheckIcon,
  OpenInNew as OpenInNewIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import { ShareDialog } from '../../dialogs';
import {
  getShareLinks,
  deleteShareLink,
  getShareLinkUrl,
  updateShareLink,
} from '../../../services/shareLinkService';
import {
  cancelPermissionRequest,
  listInboxPermissionRequests,
  listOutboxPermissionRequests,
  rejectPermissionRequest,
  approvePermissionRequest,
} from '../../../services/permissionRequestService';
import { grantPermission } from '../../../services/permissionService';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import { formatDate, formatDateOnly } from '../../../utils/format';
import { getServerErrorDisplay } from '../../../utils/errorUtils';
import { usePageHeader } from '../../../contexts/PageHeaderContext';
import { copyToClipboard } from '../../../utils/clipboard';

const formatPermissionLabel = (p, t) => {
  if (p === PERMISSIONS.READ) return t('mypage.read');
  if (p === PERMISSIONS.WRITE) return t('mypage.write');
  return String(p || '');
};

const formatStatusLabel = (s, t) => {
  if (s === 'pending') return { label: t('mypage.pending'), color: 'warning' };
  if (s === 'approved') return { label: t('mypage.approved'), color: 'success' };
  if (s === 'rejected') return { label: t('mypage.rejected'), color: 'error' };
  if (s === 'cancelled') return { label: t('mypage.cancelled'), color: 'default' };
  return { label: String(s || ''), color: 'default' };
};

const SharingContent = ({ selectedContentItem, onSelectContentItem, user, onMessage }) => {
  const { t } = useTranslation();
  const { setTitle, setActions } = usePageHeader();
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewPermissionRequest, setReviewPermissionRequest] = useState(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [inboxRequests, setInboxRequests] = useState([]);
  const [outboxRequests, setOutboxRequests] = useState([]);
  const [requestActionLoadingIds, setRequestActionLoadingIds] = useState(new Set());
  const [shareLinks, setShareLinks] = useState([]);
  const [shareLinksLoading, setShareLinksLoading] = useState(false);
  const [linkCopied, setLinkCopied] = useState(null);
  const [message, setMessage] = useState({ type: '', text: '' });

  const loadPermissionRequests = useCallback(async () => {
    if (!user) return;
    setRequestLoading(true);
    try {
      const [inbox, outbox] = await Promise.all([
        listInboxPermissionRequests({ status: 'pending' }),
        listOutboxPermissionRequests(),
      ]);
      setInboxRequests(Array.isArray(inbox) ? inbox : []);
      const outboxList = Array.isArray(outbox) ? outbox : [];
      setOutboxRequests(outboxList.filter((r) => r?.status !== 'cancelled'));
    } catch (error) {
      setInboxRequests([]);
      setOutboxRequests([]);
      const msg = getServerErrorDisplay(error?.response?.data, t) || t('mypage.requestListLoadFail');
      setMessage({ type: 'error', text: msg });
      onMessage?.({ type: 'error', text: msg });
    } finally {
      setRequestLoading(false);
    }
  }, [user, t, onMessage]);

  const loadShareLinks = useCallback(async () => {
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
  }, [user]);

  useEffect(() => {
    if (user?.id) {
      loadPermissionRequests();
      if (!user.is_admin) loadShareLinks();
    }
  }, [user, loadPermissionRequests, loadShareLinks]);

  useEffect(() => {
    const key =
      selectedContentItem === 'inbox'
        ? 'mypage.inboxRequests'
        : selectedContentItem === 'outbox'
          ? 'mypage.outboxRequests'
          : selectedContentItem === 'links'
            ? 'mypage.links'
            : 'mypage.shareManage';
    setTitle(t(key));
    setActions(null);
  }, [selectedContentItem, t, setTitle, setActions]);

  const withRequestActionLoading = async (id, fn) => {
    setRequestActionLoadingIds((prev) => new Set(prev).add(id));
    try {
      return await fn();
    } finally {
      setRequestActionLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleCopyLink = async (token) => {
    try {
      const url = getShareLinkUrl(token);
      await copyToClipboard(url);
      setLinkCopied(token);
      setTimeout(() => setLinkCopied(null), 2000);
      setMessage({ type: 'success', text: t('mypage.linkCopied') });
    } catch (error) {
      setMessage({ type: 'error', text: t('mypage.linkCopyFail') });
    }
  };

  const handleDeleteLink = async (token) => {
    try {
      await deleteShareLink(token);
      setMessage({ type: 'success', text: t('mypage.linkDeleted') });
      await loadShareLinks();
    } catch (error) {
      setMessage({ type: 'error', text: getServerErrorDisplay(error?.response?.data, t) || t('mypage.linkDeleteFail') });
    }
  };

  const handleExtendLink = async (token, days) => {
    try {
      await updateShareLink(token, { expiresInDays: days });
      setMessage({ type: 'success', text: t('mypage.linkExtended') });
      await loadShareLinks();
    } catch (error) {
      setMessage({ type: 'error', text: getServerErrorDisplay(error?.response?.data, t) || t('mypage.linkExtendFail') });
    }
  };

  const showMessage = message.text;

  // List view
  if (selectedContentItem === null || selectedContentItem === undefined) {
    return (
      <Box>
        {showMessage && (
          <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage({ type: '', text: '' })}>
            {message.text}
          </Alert>
        )}
        <List disablePadding>
          <ListItem disablePadding divider>
            <ListItemButton onClick={() => setShareDialogOpen(true)} sx={{ alignItems: 'center' }}>
              <ListItemText primary={t('mypage.sharePermissionManage')} />
              <OpenInNewIcon sx={{ fontSize: 20, color: 'action.active', ml: 0.5 }} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding divider>
            <ListItemButton onClick={() => onSelectContentItem('inbox')} sx={{ alignItems: 'center' }}>
              <ListItemText
                primary={
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                    {t('mypage.inboxRequests')}
                    <Badge
                      badgeContent={inboxRequests.length}
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
          <ListItem disablePadding divider>
            <ListItemButton onClick={() => onSelectContentItem('outbox')} sx={{ alignItems: 'center' }}>
              <ListItemText
                primary={
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                    {t('mypage.outboxRequests')}
                    <Badge
                      badgeContent={outboxRequests.length}
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
            <ListItemButton onClick={() => onSelectContentItem('links')} sx={{ alignItems: 'center' }}>
              <ListItemText
                primary={
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                    {t('mypage.links')}
                    <Badge
                      badgeContent={shareLinks.length}
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
        </List>
        <ShareDialog
          open={shareDialogOpen}
          onClose={() => setShareDialogOpen(false)}
          mode="share"
          folderPath={user?.username ? `/${user.username}` : null}
          folderNodeId={user?.n ?? null}
          folderName={user?.username || t('mypage.homeDir')}
          user={user}
          onMessage={(msg) => {
            setMessage({ type: msg.type, text: msg.text });
            onMessage?.(msg);
          }}
        />
      </Box>
    );
  }

  // Detail: Inbox
  if (selectedContentItem === 'inbox') {
    return (
      <Box>
        {showMessage && (
          <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage({ type: '', text: '' })}>
            {message.text}
          </Alert>
        )}
        {requestLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : inboxRequests.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('mypage.noRequestsToShow')}
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {inboxRequests.map((r) => {
              const permLabel = formatPermissionLabel(r.requested_permission, t);
              const statusInfo = formatStatusLabel(r.status, t);
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
                      {r.targetType === 'file' ? t('mypage.file') : t('mypage.folder')}:{' '}
                      {r.file_node_id != null ? `#${r.file_node_id}` : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('mypage.requester')}: {r.requester_username || r.requester_id}
                    </Typography>
                    {r.message && (
                      <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                        {t('mypage.messageLabel')}: {r.message}
                      </Typography>
                    )}
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      {r.targetType === 'file' && r.file_node_id != null ? (
                        <Button
                          size="small"
                          variant="contained"
                          disabled={!isPending || isActionLoading}
                          onClick={() =>
                            withRequestActionLoading(r.id, async () => {
                              await grantPermission({
                                userId: r.requester_id,
                                nodeId: r.file_node_id,
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
                    </Stack>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        )}
        <ShareDialog
          open={reviewDialogOpen}
          onClose={() => {
            setReviewDialogOpen(false);
            setReviewPermissionRequest(null);
          }}
          mode="review"
          permissionRequest={reviewPermissionRequest}
          folderNodeId={reviewPermissionRequest?.file_node_id ?? null}
          folderPath={
            reviewPermissionRequest?.file_node_id != null
              ? String(reviewPermissionRequest.file_node_id)
              : null
          }
          folderName={
            reviewPermissionRequest?.file_node_id != null
              ? `#${reviewPermissionRequest.file_node_id}`
              : t('mypage.folder')
          }
          user={user}
          onMessage={(msg) => {
            setMessage({ type: msg.type, text: msg.text });
            onMessage?.(msg);
          }}
          onApprove={loadPermissionRequests}
        />
      </Box>
    );
  }

  // Detail: Outbox
  if (selectedContentItem === 'outbox') {
    return (
      <Box>
        {showMessage && (
          <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage({ type: '', text: '' })}>
            {message.text}
          </Alert>
        )}
        {requestLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : outboxRequests.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('mypage.noRequestsToShow')}
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {outboxRequests.map((r) => {
              const permLabel = formatPermissionLabel(r.requested_permission, t);
              const statusInfo = formatStatusLabel(r.status, t);
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
                      {r.targetType === 'file' ? t('mypage.file') : t('mypage.folder')}:{' '}
                      {r.file_node_id != null ? `#${r.file_node_id}` : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('mypage.owner')}: {r.owner_username || r.owner_id}
                    </Typography>
                    {r.message && (
                      <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                        {t('mypage.messageLabel')}: {r.message}
                      </Typography>
                    )}
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
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
                    </Stack>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        )}
      </Box>
    );
  }

  // Detail: Share links
  if (selectedContentItem === 'links') {
    return (
      <Box>
        {showMessage && (
          <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage({ type: '', text: '' })}>
            {message.text}
          </Alert>
        )}
        {shareLinksLoading ? (
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
                          '&:hover': { textDecorationColor: 'rgba(0,0,0,0.8)' },
                        }}
                      >
                        {getShareLinkUrl(link.token)}
                      </Typography>
                    </Box>
                    <IconButton size="small" onClick={() => handleCopyLink(link.token)} sx={{ ml: 1 }}>
                      {linkCopied === link.token ? (
                        <CheckIcon fontSize="small" />
                      ) : (
                        <ContentCopyIcon fontSize="small" />
                      )}
                    </IconButton>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip
                      size="small"
                      label={
                        link.isExpired
                          ? t('mypage.expired')
                          : link.expiresAt
                            ? t('mypage.expiresAtDate', { date: formatDateOnly(link.expiresAt) })
                            : t('mypage.unlimited')
                      }
                      color={link.isExpired ? 'error' : 'default'}
                    />
                    <Chip size="small" label={t('mypage.downloadCount', { count: link.downloadCount || 0 })} />
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
        )}
      </Box>
    );
  }

  return null;
};

export default SharingContent;
