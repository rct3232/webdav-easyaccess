import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography, IconButton, Button, TextField, CircularProgress } from '@mui/material';
import { formatDateOnly } from '../../utils/format';
import { getServerErrorDisplay } from '../../utils/errorUtils';
import { copyToClipboard } from '../../utils/clipboard';
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
  onOpenShareLink,
  fileNodeId,
  fileName,
  onMessage,
}) => {
  const { t } = useTranslation();
  const displayName = fileName || '';
  return (
    <Box sx={{ mb: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Typography variant="subtitle2" gutterBottom>
        {t('share.externalLink')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('share.createLinkFor', { name: displayName })}
      </Typography>

      {!externalShareLink ? (
        <>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" gutterBottom>
              {t('share.expiresIn')}
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
                {t('share.unlimited')}
              </Button>
              <Button
                variant={!externalShareUnlimited ? 'outlined' : 'contained'}
                size="small"
                onClick={() => {
                  setExternalShareUnlimited(false);
                  setExternalShareExpiresInDays(14);
                }}
              >
                {t('share.specify')}
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
                  {t('share.days')}
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
                  fileNodeId,
                  externalShareUnlimited ? null : externalShareExpiresInDays
                );
                setExternalShareLink(link);
                if (onMessage) {
                  onMessage({
                    text: t('share.linkCreated'),
                    type: 'success',
                  });
                }
              } catch (error) {
                console.error('Failed to create share link:', error);
                if (onMessage) {
                  onMessage({
                    text:
                      getServerErrorDisplay(error?.response?.data, t) || t('share.linkCreateFail'),
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
            {externalShareLoading ? t('share.creating') : t('share.createLink')}
          </Button>
        </>
      ) : (
        <>
          <Box sx={{ mb: 2, p: 1.5, bgcolor: 'grey.100', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
              {t('share.linkLabel')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Typography
                component="span"
                onClick={() => {
                  const url = getShareLinkUrl(externalShareLink.token);
                  onOpenShareLink?.(url);
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
                    await copyToClipboard(getShareLinkUrl(externalShareLink.token));
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 2000);
                    if (onMessage) {
                      onMessage({
                        show: true,
                        text: t('share.linkCopied'),
                        type: 'success',
                      });
                    }
                  } catch (error) {
                    console.error('Failed to copy link:', error);
                    if (onMessage) {
                      onMessage({
                        show: true,
                        text: t('share.linkCopyFail'),
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
              {t('share.expiresAt')}{' '}
              {externalShareLink.expiresAt
                ? formatDateOnly(externalShareLink.expiresAt)
                : t('share.unlimited')}
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
            {t('share.newLink')}
          </Button>
        </>
      )}
    </Box>
  );
};

export default ExternalShareSection;
