import React from 'react';
import { useTranslation } from 'react-i18next';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import {
  Box,
  Button,
  Typography,
} from '@mui/material';
import {
  Edit as EditIcon,
  ExitToApp as ExitToAppIcon,
  Visibility as VisibilityIcon,
} from '@mui/icons-material';

/**
 * Normalize folder or file permission inputs into 4 levels (0|1).
 * @param {boolean} isDirectory
 * @param {{ hasReadPermission?: boolean, hasWritePermission?: boolean }} folderProps - when isDirectory
 * @param {{ pathPermission?: string, filePermissionLevel?: string|null }} fileProps - when !isDirectory
 */
function getPermissionLevels(isDirectory, folderProps, fileProps) {
  if (isDirectory) {
    return {
      pathReadLevel: folderProps.hasReadPermission ? 1 : 0,
      pathWriteLevel: folderProps.hasWritePermission ? 1 : 0,
      fileReadLevel: 0,
      fileWriteLevel: 0,
    };
  }
  const p = fileProps.pathPermission ?? 'none';
  const f = fileProps.filePermissionLevel;
  return {
    pathReadLevel: (p === 'read' || p === 'write') ? 1 : 0,
    pathWriteLevel: p === 'write' ? 1 : 0,
    fileReadLevel: (f === 'read' || f === 'write') ? 1 : 0,
    fileWriteLevel: f === 'write' ? 1 : 0,
  };
}

/**
 * 통합 공유 권한 목록 (폴더/파일).
 * - 폴더: hasReadPermission, hasWritePermission 기반.
 * - 파일: pathPermission, filePermissionLevel 기반. 4개 레벨 + 5개 수식으로 버튼 노출.
 */
export default function SharedPermissionList({
  isDirectory,
  hasReadPermission,
  hasWritePermission,
  pathPermission,
  filePermissionLevel,
  pendingRequest,
  loading,
  ownerExists,
  onRequestPermission,
  onCancelPendingRequest,
  onRevokeClick,
}) {
  const { t } = useTranslation();
  const { pathReadLevel, pathWriteLevel, fileReadLevel, fileWriteLevel } = getPermissionLevels(
    isDirectory,
    { hasReadPermission, hasWritePermission },
    { pathPermission, filePermissionLevel }
  );

  const showRequestRead = !pathReadLevel && !fileReadLevel;
  const showRequestWrite = !pathWriteLevel && !fileWriteLevel;
  const showRevokeSingle = isDirectory && (pathReadLevel || pathWriteLevel);
  const showRevokeRead = !isDirectory && fileReadLevel && !pathReadLevel;
  const showRevokeWrite = !isDirectory && fileWriteLevel && !pathWriteLevel;

  const requestDisabled =
    loading || ownerExists === false || ownerExists === null || pendingRequest.read.pending || pendingRequest.write.pending;
  const writeRequestDisabled =
    loading || ownerExists === false || ownerExists === null || pendingRequest.write.pending;
  const revokeDisabled = loading || ownerExists === false || ownerExists === null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {showRequestRead && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Button
            variant="outlined"
            startIcon={<VisibilityIcon />}
            onClick={() => onRequestPermission('read')}
            fullWidth
            disabled={requestDisabled}
            sx={{ py: 1.5 }}
          >
            {t('dialogs.requestReadPermission')}
          </Button>
          {pendingRequest.read.pending && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="caption" color="text.secondary">
                {t('dialogs.requestedRead')}
              </Typography>
              <Button
                variant="text"
                size="small"
                onClick={() => onCancelPendingRequest(PERMISSIONS.READ)}
                disabled={loading || ownerExists === false || ownerExists === null}
                sx={{ minWidth: 'auto', px: 0.5, py: 0 }}
              >
                {t('dialogs.cancelRequest')}
              </Button>
            </Box>
          )}
        </Box>
      )}

      {showRequestWrite && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Button
            variant="outlined"
            startIcon={<EditIcon />}
            onClick={() => onRequestPermission('write')}
            fullWidth
            disabled={writeRequestDisabled}
            sx={{ py: 1.5 }}
          >
            {t('dialogs.requestWritePermission')}
          </Button>
          {pendingRequest.write.pending && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="caption" color="text.secondary">
                {t('dialogs.requestedWrite')}
              </Typography>
              <Button
                variant="text"
                size="small"
                onClick={() => onCancelPendingRequest(PERMISSIONS.WRITE)}
                disabled={loading || ownerExists === false || ownerExists === null}
                sx={{ minWidth: 'auto', px: 0.5, py: 0 }}
              >
                {t('dialogs.cancelRequest')}
              </Button>
            </Box>
          )}
        </Box>
      )}

      {showRevokeSingle && (
        <Button
          variant="outlined"
          color="error"
          startIcon={<ExitToAppIcon />}
          onClick={onRevokeClick}
          fullWidth
          disabled={revokeDisabled}
          sx={{ py: 1.5 }}
        >
          {t('dialogs.revokePermission')}
        </Button>
      )}

      {Boolean(showRevokeRead) && (
        <Button
          variant="outlined"
          color="error"
          startIcon={<ExitToAppIcon />}
          onClick={onRevokeClick}
          fullWidth
          disabled={revokeDisabled}
          sx={{ py: 1.5 }}
        >
          {t('dialogs.revokeRead')}
        </Button>
      )}

      {Boolean(showRevokeWrite) && (
        <Button
          variant="outlined"
          color="error"
          startIcon={<ExitToAppIcon />}
          onClick={onRevokeClick}
          fullWidth
          disabled={revokeDisabled}
          sx={{ py: 1.5 }}
        >
          {t('dialogs.revokeWrite')}
        </Button>
      )}
    </Box>
  );
}
