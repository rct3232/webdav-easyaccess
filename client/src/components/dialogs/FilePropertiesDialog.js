import React, { useState, useEffect } from 'react';
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
} from '@mui/material';
import { formatFileSize, formatDate } from '../../utils/format';
import { getFileIcon, getThumbnail } from '../../utils/fileIconUtils';
import { useResponsive } from '../../hooks/useResponsive';
import { getFolderPermissions } from '../../services/permissionService';
import { getFolderStats } from '../../services/fileService';
import { getParentPath } from '@webdav-easyaccess/shared/pathUtils';
import { getPermissionLabels, PERMISSION_ORDER } from '../../constants/permissions';

const FilePropertiesDialog = ({ open, onClose, file }) => {
  const { t } = useTranslation();
  const permissionLabels = getPermissionLabels(t);
  const { isMobile } = useResponsive();
  const [permissions, setPermissions] = useState([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [folderStats, setFolderStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    if (!open || !file) {
      setPermissions([]);
      return;
    }
    const isDirectory = file.type === 'directory';
    const path = isDirectory ? file.path : getParentPath(file.path);
    const filePath = isDirectory ? undefined : file.path;

    setPermissionsLoading(true);
    getFolderPermissions(path, false, filePath)
      .then((data) => setPermissions(Array.isArray(data) ? data : []))
      .catch(() => setPermissions([]))
      .finally(() => setPermissionsLoading(false));

    if (isDirectory) {
      setStatsLoading(true);
      getFolderStats(file.path)
        .then((data) => setFolderStats(data))
        .catch(() => setFolderStats(null))
        .finally(() => setStatsLoading(false));
    } else {
      setFolderStats(null);
    }
  }, [open, file]);

  if (!file) return null;

  const isDirectory = file.type === 'directory';

  const permissionGroups = PERMISSION_ORDER.reduce((acc, perm) => {
    acc[perm] = permissions.filter(
      (p) => (p.file_permission ?? p.permission) === perm && !p.is_admin
    );
    return acc;
  }, {});

  const propertyItems = [
    {
      label: t('dialogs.type'),
      value: isDirectory ? t('actions.folder') : (file.mime || t('actions.file')),
    },
    {
      label: t('dialogs.size'),
      value: isDirectory
        ? (folderStats
          ? t('fileManager.folderStatsFormat', {
            count: folderStats.fileCount,
            size: formatFileSize(folderStats.totalSize),
          })
          : (statsLoading ? '...' : '-'))
        : formatFileSize(file.size),
    },
    {
      label: t('dialogs.modifiedDate'),
      value: formatDate(file.lastmod),
    },
    {
      label: t('dialogs.path'),
      value: file.path || '-',
    },
  ];

  const typoCommon = { variant: 'body2', sx: { wordBreak: 'break-word' } };
  const thumbnailUrl = getThumbnail(file);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={isMobile}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>{t('dialogs.propertiesTitle')}</DialogTitle>
      <DialogContent>
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
            ...(thumbnailUrl && {
              '&::before': {
                content: '""',
                position: 'absolute',
                inset: 0,
                backgroundImage: `url(${thumbnailUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                zIndex: 0,
              },
              '&::after': {
                content: '""',
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(to right, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.6) 35%, transparent 65%)',
                zIndex: 1,
              },
            }),
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              position: 'relative',
              zIndex: 2,
            }}
          >
            <Avatar
              variant="rounded"
              sx={{
                width: 64,
                height: 64,
                bgcolor: 'primary.main',
                mb: 2,
                '& svg': {
                  color: 'white',
                  fontSize: 36,
                },
              }}
            >
              {getFileIcon(file)}
            </Avatar>
            <Typography variant="h6" sx={{ textAlign: 'center', wordBreak: 'break-word', minWidth: 64 }}>
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
              {(permissionsLoading || (prop.label === t('dialogs.size') && isDirectory && statsLoading)) ? (
                <Skeleton variant="text" width="60%" />
              ) : (
                <Typography {...typoCommon}>{prop.value}</Typography>
              )}
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          {t('common.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FilePropertiesDialog;
