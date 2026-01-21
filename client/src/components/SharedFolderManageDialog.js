import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
} from '@mui/material';
import {
  Edit as EditIcon,
  ExitToApp as ExitToAppIcon,
  Visibility as VisibilityIcon,
} from '@mui/icons-material';
import axios from 'axios';
import { checkPermission } from '../services/fileService';
import {
  cancelPermissionRequest,
  createPermissionRequest,
  listOutboxPermissionRequests,
} from '../services/permissionRequestService';

const SharedFolderManageDialog = ({ 
  open, 
  onClose, 
  folderPath, 
  folderName,
  user,
  // Direct permission flags from file list (used to decide which request buttons to show)
  directHasReadPermission,
  onMessage,
  onActionComplete
}) => {
  const [loading, setLoading] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [permissionInfo, setPermissionInfo] = useState({ hasRead: false, hasWrite: false });
  const [pendingRequest, setPendingRequest] = useState({
    read: { pending: false, id: null },
    write: { pending: false, id: null },
  });

  const normalizeLocalPath = (p) => {
    if (!p) return '/';
    let n = String(p).trim().replace(/\\/g, '/').replace(/\/+/g, '/');
    if (!n.startsWith('/')) n = '/' + n;
    if (n !== '/' && n.endsWith('/')) n = n.slice(0, -1);
    return n;
  };

  // 폴더 경로가 변경되거나 다이얼로그가 열릴 때 쓰기 권한 확인
  useEffect(() => {
    const loadPermissionInfo = async () => {
      if (!open || !folderPath || !user) {
        return;
      }

      // 관리자는 항상 권한이 있음
      if (user.is_admin) {
        setPermissionInfo({ hasRead: true, hasWrite: true });
        return;
      }

      try {
        const permission = await checkPermission(folderPath);
        setPermissionInfo({ hasRead: Boolean(permission.hasRead), hasWrite: Boolean(permission.hasWrite) });
      } catch (error) {
        console.error('Failed to check write permission:', error);
        // 에러 발생 시 기본값으로 false 설정
        setPermissionInfo({ hasRead: false, hasWrite: false });
      }
    };

    loadPermissionInfo();
  }, [open, folderPath, user]);

  // 이미 요청한 권한(대기중) 로드: 해당 권한 요청 버튼 disable + "요청됨" 표시
  useEffect(() => {
    const loadPendingRequests = async () => {
      if (!open || !folderPath || !user || user.is_admin) {
        setPendingRequest({
          read: { pending: false, id: null },
          write: { pending: false, id: null },
        });
        return;
      }

      try {
        const outbox = await listOutboxPermissionRequests({ status: 'pending' });
        const normalizedTarget = normalizeLocalPath(folderPath);
        const list = Array.isArray(outbox) ? outbox : [];

        const findPending = (perm) =>
          list.find((r) => normalizeLocalPath(r.folder_path) === normalizedTarget && r.requested_permission === perm);

        const pendingRead = findPending('read');
        const pendingWrite = findPending('write');
        setPendingRequest({
          read: { pending: Boolean(pendingRead), id: pendingRead?.id ?? null },
          write: { pending: Boolean(pendingWrite), id: pendingWrite?.id ?? null },
        });
      } catch (error) {
        // 조용히 실패 처리 (요청 버튼은 기본 활성으로 둠)
        setPendingRequest({
          read: { pending: false, id: null },
          write: { pending: false, id: null },
        });
      }
    };

    loadPendingRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, folderPath, user?.id]);

  const hasReadPermission =
    typeof directHasReadPermission === 'boolean' ? directHasReadPermission : permissionInfo.hasRead;
  const hasWritePermission = permissionInfo.hasWrite;

  const handleCancelPendingRequest = async (permissionToCancel) => {
    const target = pendingRequest?.[permissionToCancel];
    if (!target?.pending || !target?.id) return;

    setLoading(true);
    try {
      await cancelPermissionRequest(target.id);
      setPendingRequest((prev) => ({
        ...prev,
        [permissionToCancel]: { pending: false, id: null },
      }));

      if (onMessage) {
        onMessage({
          show: true,
          text: `${permissionToCancel === 'read' ? '읽기' : '쓰기'} 권한 요청을 회수했습니다.`,
          type: 'success',
        });
        setTimeout(() => {
          onMessage({ show: false, text: '', type: 'success' });
        }, 3000);
      }
    } catch (error) {
      console.error('Failed to cancel permission request:', error);
      const errorMsg = error.response?.data?.error || '요청 회수에 실패했습니다.';
      if (onMessage) {
        onMessage({
          show: true,
          text: errorMsg,
          type: 'error',
        });
        setTimeout(() => {
          onMessage({ show: false, text: '', type: 'success' });
        }, 5000);
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePermissionRequest = async (requestedPermission) => {
    if (!folderPath || !user) return;
    setLoading(true);
    try {
      // If user is permission-less and already requested read, upgrading to write should cancel read request first.
      if (
        requestedPermission === 'write' &&
        !hasReadPermission &&
        pendingRequest.read.pending &&
        pendingRequest.read.id
      ) {
        await cancelPermissionRequest(pendingRequest.read.id);
        setPendingRequest((prev) => ({
          ...prev,
          read: { pending: false, id: null },
        }));
      }

      const created = await createPermissionRequest({
        folderPath,
        permission: requestedPermission,
      });

      setPendingRequest((prev) => ({
        ...prev,
        [requestedPermission]: { pending: true, id: created?.id ?? prev[requestedPermission]?.id ?? null },
      }));

      if (onMessage) {
        onMessage({
          show: true,
          text: `${requestedPermission === 'read' ? '읽기' : '쓰기'} 권한 요청을 보냈습니다.`,
          type: 'success',
        });
        setTimeout(() => {
          onMessage({ show: false, text: '', type: 'success' });
        }, 3000);
      }
    } catch (error) {
      console.error('Failed to create permission request:', error);
      const errorMsg = error.response?.data?.error || '권한 요청에 실패했습니다.';
      if (onMessage) {
        onMessage({
          show: true,
          text: errorMsg,
          type: 'error',
        });
        setTimeout(() => {
          onMessage({ show: false, text: '', type: 'success' });
        }, 5000);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRevokePermission = async () => {
    if (!user || !user.id || !folderPath) return;

    setLoading(true);
    try {
      // 해당 폴더와 하위 폴더의 모든 권한 삭제 (서버에서 일괄 처리)
      await axios.delete('/api/permissions/revoke', {
        params: {
          userId: user.id,
          folderPath: folderPath,
          includeSubfolders: 'true'
        }
      });
      
      if (onMessage) {
        onMessage({
          show: true,
          text: `"${folderName}" 폴더와 하위 폴더의 권한이 반납되었습니다.`,
          type: 'success'
        });
        setTimeout(() => {
          onMessage({ show: false, text: '', type: 'success' });
        }, 3000);
      }
      
      if (onActionComplete) {
        onActionComplete();
      }
      
      onClose();
    } catch (error) {
      console.error('Failed to revoke permissions:', error);
      const errorMsg = error.response?.data?.error || '권한 반납에 실패했습니다.';
      if (onMessage) {
        onMessage({
          show: true,
          text: errorMsg,
          type: 'error'
        });
        setTimeout(() => {
          onMessage({ show: false, text: '', type: 'success' });
        }, 5000);
      }
    } finally {
      setLoading(false);
      setConfirmDialogOpen(false);
    }
  };

  return (
    <>
      <Dialog 
        open={open && !confirmDialogOpen} 
        onClose={onClose}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>공유 관리</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            폴더: {folderName}
          </Typography>
          
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {!hasReadPermission && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Button
                  variant="outlined"
                  startIcon={<VisibilityIcon />}
                  onClick={() => handlePermissionRequest('read')}
                  fullWidth
                  disabled={loading || pendingRequest.read.pending || pendingRequest.write.pending}
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
                      onClick={() => handleCancelPendingRequest('read')}
                      disabled={loading}
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
                  onClick={() => handlePermissionRequest('write')}
                  fullWidth
                  disabled={loading || pendingRequest.write.pending}
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
                      onClick={() => handleCancelPendingRequest('write')}
                      disabled={loading}
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
                onClick={() => setConfirmDialogOpen(true)}
                fullWidth
                disabled={loading}
                sx={{ py: 1.5 }}
              >
                권한 반납
              </Button>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={loading}>
            닫기
          </Button>
        </DialogActions>
      </Dialog>

      {/* 확인 다이얼로그 */}
      <Dialog 
        open={confirmDialogOpen} 
        onClose={() => !loading && setConfirmDialogOpen(false)}
      >
        <DialogTitle>권한 반납 확인</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 1 }}>
            정말로 "{folderName}" 폴더와 하위 폴더의 모든 권한을 반납하시겠습니까?
          </Typography>
          <Typography variant="body2" color="text.secondary">
            이 작업은 되돌릴 수 없습니다.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => setConfirmDialogOpen(false)} 
            disabled={loading}
          >
            취소
          </Button>
          <Button 
            onClick={handleRevokePermission} 
            variant="contained" 
            color="error"
            disabled={loading}
          >
            {loading ? '처리 중...' : '확인'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default SharedFolderManageDialog;

