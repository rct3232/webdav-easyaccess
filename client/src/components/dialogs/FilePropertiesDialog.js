import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Avatar,
  Tooltip,
  Skeleton,
  Tabs,
  Tab,
  IconButton,
  Chip,
  Alert,
} from '@mui/material';
import { Download as DownloadIcon, Restore as RestoreIcon } from '@mui/icons-material';
import ConfirmDialog from './ConfirmDialog';
import { formatFileSize, formatDate } from '../../utils/format';
import { getFileIcon, getThumbnail } from '../../utils/fileIconUtils';
import { useResponsive } from '../../hooks/useResponsive';
import { getFolderPermissions } from '../../services/permissionService';
import {
  getFolderStats,
  getFileVersions,
  restoreFileVersion,
  downloadFileVersion,
} from '../../services/fileService';
import { getServerErrorDisplay } from '../../utils/errorUtils';
import { getPermissionLabels, PERMISSION_ORDER } from '../../constants/permissions';

const FilePropertiesDialog = ({ open, onClose, file, activeFileStorage = null }) => {
  const { t } = useTranslation();
  const permissionLabels = getPermissionLabels(t);
  const { isMobile } = useResponsive();
  const [activeTab, setActiveTab] = useState('info');
  const [permissions, setPermissions] = useState([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [folderStats, setFolderStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [versions, setVersions] = useState(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState(null);
  const [versionsRequested, setVersionsRequested] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [notice, setNotice] = useState(null);

  const isDirectory = file?.type === 'directory';
  // DEF-11: the versions tab is offered only for files in S3 storage mode.
  const versionsAvailable = activeFileStorage === 's3' && file?.type === 'file';

  useEffect(() => {
    if (!open || !file) {
      setPermissions([]);
      return;
    }
    const isDir = file.type === 'directory';
    const parentNodeId = file.parentNodeId ?? null;

    setPermissionsLoading(true);
    if (isDir) {
      getFolderPermissions(file.nodeId)
        .then((data) => setPermissions(Array.isArray(data) ? data : []))
        .catch(() => setPermissions([]))
        .finally(() => setPermissionsLoading(false));
    } else {
      getFolderPermissions(parentNodeId ?? file.nodeId, file.nodeId)
        .then((data) => setPermissions(Array.isArray(data) ? data : []))
        .catch(() => setPermissions([]))
        .finally(() => setPermissionsLoading(false));
    }

    if (isDir) {
      setStatsLoading(true);
      getFolderStats(file.nodeId)
        .then((data) => setFolderStats(data))
        .catch(() => setFolderStats(null))
        .finally(() => setStatsLoading(false));
    } else {
      setFolderStats(null);
    }
  }, [open, file]);

  const loadVersions = useCallback(() => {
    if (!file?.nodeId) return;
    setVersionsLoading(true);
    setVersionsError(null);
    getFileVersions(file.nodeId)
      .then((data) => setVersions(data))
      .catch((error) => {
        setVersions(null);
        setVersionsError(
          error?.response?.data
            ? getServerErrorDisplay(error.response.data, t)
            : t('dialogs.versionsLoadFail')
        );
      })
      .finally(() => setVersionsLoading(false));
  }, [file?.nodeId, t]);

  useEffect(() => {
    if (!open) {
      setActiveTab('info');
      setVersions(null);
      setVersionsError(null);
      setVersionsRequested(false);
      setRestoreTarget(null);
      setNotice(null);
      return;
    }
    // Load once per dialog-open: a failed load must not re-trigger
    // indefinitely via the null-versions condition.
    if (activeTab === 'versions' && versionsAvailable && !versionsRequested && !versionsLoading) {
      setVersionsRequested(true);
      loadVersions();
    }
  }, [open, activeTab, versionsAvailable, versionsRequested, versionsLoading, loadVersions]);

  if (!file) return null;

  const permissionGroups = PERMISSION_ORDER.reduce((acc, perm) => {
    acc[perm] = permissions.filter(
      (p) => (p.file_permission ?? p.permission) === perm && !p.is_admin
    );
    return acc;
  }, {});

  const propertyItems = [
    {
      label: t('dialogs.type'),
      value: isDirectory ? t('actions.folder') : (file.mime ?? file.mimeType ?? t('actions.file')),
    },
    {
      label: t('dialogs.size'),
      value: isDirectory
        ? folderStats
          ? t('fileManager.folderStatsFormat', {
              count: folderStats.fileCount,
              size: formatFileSize(folderStats.totalSize),
            })
          : statsLoading
            ? '...'
            : '-'
        : formatFileSize(file.size),
    },
    {
      label: t('dialogs.modifiedDate'),
      value: formatDate(file.lastmod ?? file.modifiedAt),
    },
    {
      label: t('dialogs.path'),
      value: file.display_path || file.path || '-',
    },
  ];

  const typoCommon = { variant: 'body2', sx: { wordBreak: 'break-word' } };
  const thumbnailUrl = getThumbnail(file);

  const handleRestoreConfirm = async () => {
    if (!restoreTarget) return;
    setRestoreLoading(true);
    try {
      await restoreFileVersion(file.nodeId, restoreTarget.versionNumber);
      setNotice({
        type: 'success',
        text: t('dialogs.versionsRestoreSuccess', { version: restoreTarget.versionNumber }),
      });
      setRestoreTarget(null);
      setVersions(null);
      setVersionsRequested(false);
    } catch (error) {
      setNotice({
        type: 'error',
        text: error?.response?.data
          ? getServerErrorDisplay(error.response.data, t)
          : t('dialogs.versionsRestoreFail'),
      });
      setRestoreTarget(null);
    } finally {
      setRestoreLoading(false);
    }
  };

  const handleDownloadVersion = async (versionNumber) => {
    try {
      await downloadFileVersion(file.nodeId, versionNumber);
    } catch (error) {
      setNotice({
        type: 'error',
        text: getServerErrorDisplay(error?.response?.data, t) || t('errors.downloadFailed'),
      });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullScreen={isMobile} maxWidth="sm" fullWidth>
      <DialogTitle>{t('dialogs.propertiesTitle')}</DialogTitle>
      {/* DEF-11: tab bar between the title and the gradient thumbnail header */}
      <Tabs
        value={versionsAvailable ? activeTab : 'info'}
        onChange={(_event, nextTab) => setActiveTab(nextTab)}
        sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label={t('dialogs.propertiesTabInfo')} value="info" />
        {versionsAvailable && <Tab label={t('dialogs.propertiesTabVersions')} value="versions" />}
      </Tabs>
      <DialogContent>
        {activeTab === 'versions' && versionsAvailable ? (
          <Box sx={{ mt: 2 }}>
            {notice && (
              <Alert severity={notice.type} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
                {notice.text}
              </Alert>
            )}
            {versionsLoading && <Skeleton variant="rectangular" height={48} />}
            {!versionsLoading && versionsError && <Alert severity="error">{versionsError}</Alert>}
            {!versionsLoading && !versionsError && versions && versions.versions.length === 0 && (
              <Typography variant="body2" color="text.secondary">
                {t('dialogs.versionsEmpty')}
              </Typography>
            )}
            {!versionsLoading &&
              !versionsError &&
              versions &&
              versions.versions.map((version) => (
                <Box
                  key={version.versionNumber}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    py: 1,
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="body2" sx={{ minWidth: 56, fontWeight: 600 }}>
                    v{version.versionNumber}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                    {formatDate(version.createdAt)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {version.size != null
                      ? formatFileSize(version.size)
                      : t('dialogs.versionsUnknownSize')}
                  </Typography>
                  {version.isCurrent && (
                    <Chip
                      label={t('dialogs.versionsCurrentBadge')}
                      size="small"
                      color="primary"
                      sx={{ height: 20 }}
                    />
                  )}
                  {!version.isCurrent && version.status === 'orphaned' && (
                    <Typography variant="caption" color="text.disabled">
                      {t('dialogs.versionsExpired')}
                    </Typography>
                  )}
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Tooltip title={t('dialogs.versionsDownloadTitle')}>
                      <IconButton
                        size="small"
                        aria-label={t('dialogs.versionsDownloadTitle')}
                        onClick={() => handleDownloadVersion(version.versionNumber)}
                      >
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {!version.isCurrent && (
                      <Tooltip title={t('dialogs.versionsRestoreTitle')}>
                        <IconButton
                          size="small"
                          aria-label={t('dialogs.versionsRestoreTitle')}
                          onClick={() => setRestoreTarget(version)}
                        >
                          <RestoreIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </Box>
              ))}
          </Box>
        ) : (
          <>
            {/* 1. 아이콘/이름 블록: 좌측 정렬, 썸네일 배경 + 그래디언트 */}
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                mb: 3,
                mt: 2,
                mx: -2,
                px: 2,
                py: 2,
                minHeight: 120,
                position: 'relative',
                overflow: 'hidden',
                borderRadius: 1,
                background: 'linear-gradient(135deg, #4167ba 0%, #52c597 100%)',
                '&::before': thumbnailUrl
                  ? {
                      content: '""',
                      position: 'absolute',
                      inset: 0,
                      backgroundImage: `url(${thumbnailUrl})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      zIndex: 0,
                    }
                  : {
                      content: '""',
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(255, 255, 255, 0.82)', // 화이트 오버레이 추가
                      zIndex: 1,
                    },
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  inset: 0,
                  background: thumbnailUrl
                    ? 'linear-gradient(to right, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.6) 35%, transparent 65%)'
                    : 'radial-gradient(circle at 20% 50%, rgba(251, 229, 89, 0.15) 0%, transparent 100%)',
                  zIndex: thumbnailUrl ? 1 : 2,
                },
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  position: 'relative',
                  zIndex: 3,
                }}
              >
                <Avatar
                  variant="rounded"
                  sx={{
                    width: 64,
                    height: 64,
                    bgcolor: 'primary.main',
                    mb: 2,
                    boxShadow: thumbnailUrl ? 'none' : '0 2px 8px rgba(0,0,0,0.1)',
                    '& svg': {
                      color: 'white',
                      fontSize: 36,
                    },
                  }}
                >
                  {getFileIcon(file)}
                </Avatar>
                <Typography
                  variant="h6"
                  sx={{
                    textAlign: (file.basename || file.name || '').length > 20 ? 'left' : 'center',
                    wordBreak: 'break-word',
                    minWidth: 64,
                    color: 'text.primary',
                  }}
                >
                  {file.basename || file.name}
                </Typography>
              </Box>
            </Box>

            {/* 2. 권한정보 블록: 제목 상단 / 아바타 하단 (호버 시 아이디 툴팁), admin 계정 미표시, 없는 권한 종류 미표시 */}
            <Box sx={{ mb: 2 }}>
              {PERMISSION_ORDER.map((perm) => {
                const users = permissionGroups[perm] || [];
                if (!permissionsLoading && users.length === 0) return null;
                return (
                  <Box key={perm} sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
                      {permissionLabels[perm]}
                    </Typography>
                    {permissionsLoading ? (
                      <Skeleton variant="circular" width={36} height={36} />
                    ) : (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                        {users.map((u) => (
                          <Tooltip key={u.id} title={u.username || '-'} enterDelay={300}>
                            <Avatar
                              sx={{
                                width: 36,
                                height: 36,
                                bgcolor: 'primary.main',
                                fontSize: '1rem',
                              }}
                            >
                              {(u.username || '').charAt(0).toUpperCase() || '?'}
                            </Avatar>
                          </Tooltip>
                        ))}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>

            {/* 3. 파일/폴더 속성 블록: 제목 상단 / 값 하단, 값당 스켈레톤 */}
            <Box>
              {propertyItems.map((prop) => (
                <Box key={prop.label} sx={{ py: 1 }}>
                  <Typography {...typoCommon} color="text.secondary" sx={{ mb: 0.25 }}>
                    {prop.label}
                  </Typography>
                  {permissionsLoading ||
                  (prop.label === t('dialogs.size') && isDirectory && statsLoading) ? (
                    <Skeleton variant="text" width="60%" />
                  ) : (
                    <Typography {...typoCommon}>{prop.value}</Typography>
                  )}
                </Box>
              ))}
            </Box>
          </>
        )}
      </DialogContent>
      {/* Fixed bottom action bar — identical across tab switches */}
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          {t('common.close')}
        </Button>
      </DialogActions>
      <ConfirmRestoreDialog
        open={restoreTarget != null}
        onClose={() => setRestoreTarget(null)}
        onConfirm={handleRestoreConfirm}
        loading={restoreLoading}
        versionNumber={restoreTarget?.versionNumber ?? null}
      />
    </Dialog>
  );
};

const ConfirmRestoreDialog = ({ open, onClose, onConfirm, versionNumber, loading }) => {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title={t('dialogs.versionsRestoreConfirmTitle')}
      message={t('dialogs.versionsRestoreConfirmBody', { version: versionNumber ?? '' })}
      confirmText={t('common.confirm')}
      cancelText={t('common.cancel')}
      loading={loading}
    />
  );
};

export default FilePropertiesDialog;
