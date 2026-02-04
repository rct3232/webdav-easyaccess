import React from 'react';
import {
  Box,
  Typography,
  IconButton,
  Button,
  TextField,
  CircularProgress,
} from '@mui/material';
import {
  Link as LinkIcon,
  ContentCopy as ContentCopyIcon,
  Check as CheckIcon,
} from '@mui/icons-material';

const ExternalShareSection = ({
  externalShareLink,
  setExternalShareLink,
  externalShareLoading,
  setExternalShareLoading,
  externalShareExpiresInDays,
  setExternalShareExpiresInDays,
  externalShareUnlimited,
  setExternalShareUnlimited,
  linkCopied,
  setLinkCopied,
  createShareLink,
  getShareLinkUrl,
  filePath,
  fileName,
  onMessage,
}) => {
  return (
    <Box sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Typography variant="subtitle2" gutterBottom>
        외부 공유 링크
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {fileName || filePath.split('/').pop()}에 대한 공유 링크를 생성합니다.
      </Typography>
      
      {!externalShareLink ? (
        <>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" gutterBottom>
              유효기간
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Button
                variant={externalShareUnlimited ? 'outlined' : 'contained'}
                size="small"
                onClick={() => {
                  setExternalShareUnlimited(true);
                  setExternalShareExpiresInDays(null);
                }}
              >
                무제한
              </Button>
              <Button
                variant={!externalShareUnlimited ? 'outlined' : 'contained'}
                size="small"
                onClick={() => {
                  setExternalShareUnlimited(false);
                  setExternalShareExpiresInDays(14);
                }}
              >
                지정
              </Button>
              {!externalShareUnlimited && (
                <TextField
                  type="number"
                  size="small"
                  value={externalShareExpiresInDays}
                  onChange={(e) => {
                    const days = parseInt(e.target.value, 10);
                    if (!isNaN(days) && days >= 0) {
                      setExternalShareExpiresInDays(days);
                    }
                  }}
                  inputProps={{ min: 0 }}
                  sx={{ width: 100 }}
                />
              )}
              {!externalShareUnlimited && (
                <Typography variant="body2" color="text.secondary">
                  일
                </Typography>
              )}
            </Box>
          </Box>
          
          <Button
            variant="contained"
            fullWidth
            onClick={async () => {
              setExternalShareLoading(true);
              try {
                const link = await createShareLink(
                  filePath,
                  externalShareUnlimited ? null : externalShareExpiresInDays
                );
                setExternalShareLink(link);
                if (onMessage) {
                  onMessage({
                    text: '공유 링크가 생성되었습니다.',
                    type: 'success',
                  });
                }
              } catch (error) {
                console.error('Failed to create share link:', error);
                if (onMessage) {
                  onMessage({
                    text: error.response?.data?.error || '공유 링크 생성에 실패했습니다.',
                    type: 'error',
                  });
                }
              } finally {
                setExternalShareLoading(false);
              }
            }}
            disabled={externalShareLoading}
            startIcon={externalShareLoading ? <CircularProgress size={20} /> : <LinkIcon />}
          >
            {externalShareLoading ? '생성 중...' : '링크 생성'}
          </Button>
        </>
      ) : (
        <>
          <Box sx={{ mb: 2, p: 1.5, bgcolor: 'grey.100', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
              공유 링크
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Typography
                component="span"
                onClick={() => {
                  const url = getShareLinkUrl(externalShareLink.token);
                  window.open(url, '_blank', 'noopener,noreferrer');
                }}
                sx={{
                  flex: 1,
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  textDecorationColor: 'rgba(0,0,0,0.3)',
                  '&:hover': {
                    textDecorationColor: 'rgba(0,0,0,0.8)',
                  },
                }}
              >
                {getShareLinkUrl(externalShareLink.token)}
              </Typography>
              <IconButton
                size="small"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(getShareLinkUrl(externalShareLink.token));
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 2000);
                    if (onMessage) {
                      onMessage({
                        text: '링크가 클립보드에 복사되었습니다.',
                        type: 'success',
                      });
                    }
                  } catch (error) {
                    console.error('Failed to copy link:', error);
                    if (onMessage) {
                      onMessage({
                        text: '링크 복사에 실패했습니다.',
                        type: 'error',
                      });
                    }
                  }
                }}
              >
                {linkCopied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
              </IconButton>
            </Box>
          </Box>
          
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary">
              만료일: {externalShareLink.expiresAt 
                ? new Date(externalShareLink.expiresAt).toLocaleDateString('ko-KR')
                : '무제한'}
            </Typography>
          </Box>
          
          <Button
            variant="outlined"
            fullWidth
            onClick={() => {
              setExternalShareLink(null);
              setExternalShareExpiresInDays(14);
              setExternalShareUnlimited(false);
            }}
          >
            새 링크 생성
          </Button>
        </>
      )}
    </Box>
  );
};

export default ExternalShareSection;
