import React from 'react';
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

export default function SharedFolderPermissionList({
  hasReadPermission,
  hasWritePermission,
  pendingRequest,
  loading,
  ownerExists,
  onRequestPermission,
  onCancelPendingRequest,
  onRevokeClick,
}) {
  const requestDisabled =
    loading || ownerExists === false || ownerExists === null || pendingRequest.read.pending || pendingRequest.write.pending;
  const writeRequestDisabled =
    loading || ownerExists === false || ownerExists === null || pendingRequest.write.pending;
  const revokeDisabled =
    loading || ownerExists === false || ownerExists === null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {!hasReadPermission && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Button
            variant="outlined"
            startIcon={<VisibilityIcon />}
            onClick={() => onRequestPermission('read')}
            fullWidth
            disabled={requestDisabled}
            sx={{ py: 1.5 }}
          >
            읽기 권한 요청
          </Button>
          {pendingRequest.read.pending && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="caption" color="text.secondary">
                읽기 권한 요청됨
              </Typography>
              <Button
                variant="text"
                size="small"
                onClick={() => onCancelPendingRequest(PERMISSIONS.READ)}
                disabled={loading || ownerExists === false || ownerExists === null}
                sx={{ minWidth: 'auto', px: 0.5, py: 0 }}
              >
                요청 회수
              </Button>
            </Box>
          )}
        </Box>
      )}

      {!hasWritePermission && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Button
            variant="outlined"
            startIcon={<EditIcon />}
            onClick={() => onRequestPermission('write')}
            fullWidth
            disabled={writeRequestDisabled}
            sx={{ py: 1.5 }}
          >
            쓰기 권한 요청
          </Button>
          {pendingRequest.write.pending && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="caption" color="text.secondary">
                쓰기 권한 요청됨
              </Typography>
              <Button
                variant="text"
                size="small"
                onClick={() => onCancelPendingRequest(PERMISSIONS.WRITE)}
                disabled={loading || ownerExists === false || ownerExists === null}
                sx={{ minWidth: 'auto', px: 0.5, py: 0 }}
              >
                요청 회수
              </Button>
            </Box>
          )}
        </Box>
      )}

      {hasReadPermission && (
        <Button
          variant="outlined"
          color="error"
          startIcon={<ExitToAppIcon />}
          onClick={onRevokeClick}
          fullWidth
          disabled={revokeDisabled}
          sx={{ py: 1.5 }}
        >
          권한 반납
        </Button>
      )}
    </Box>
  );
}
