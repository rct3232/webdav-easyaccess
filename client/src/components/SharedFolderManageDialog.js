import React, { useState } from 'react';
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
} from '@mui/icons-material';
import axios from 'axios';

const SharedFolderManageDialog = ({ 
  open, 
  onClose, 
  folderPath, 
  folderName,
  user,
  onMessage,
  onActionComplete
}) => {
  const [loading, setLoading] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  const handleWritePermissionRequest = () => {
    // 더미 기능 - 나중에 구현
    if (onMessage) {
      onMessage({
        show: true,
        text: '쓰기 권한 요청 기능은 준비 중입니다.',
        type: 'info'
      });
      setTimeout(() => {
        onMessage({ show: false, text: '', type: 'success' });
      }, 3000);
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
            <Button
              variant="outlined"
              startIcon={<EditIcon />}
              onClick={handleWritePermissionRequest}
              fullWidth
              sx={{ py: 1.5 }}
            >
              쓰기 권한 요청
            </Button>
            
            <Button
              variant="outlined"
              color="error"
              startIcon={<ExitToAppIcon />}
              onClick={() => setConfirmDialogOpen(true)}
              fullWidth
              sx={{ py: 1.5 }}
            >
              권한 반납
            </Button>
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

