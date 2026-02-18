import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Box, Typography, CircularProgress } from '@mui/material';
import { getPublicShareLinkInfo } from '../services/shareLinkService';
import FileManager from './FileManager';
import ShareLinkSingleFileView from './ShareLinkSingleFileView';

/**
 * 공유 링크 라우트 `/share/:token` 로더
 * linkInfo 조회 후:
 * - isDirectory → FileManager
 * - 단일 파일 → ShareLinkSingleFileView (전체 화면 미리보기)
 */
const ShareLinkLoader = () => {
  const { t } = useTranslation();
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [linkInfo, setLinkInfo] = useState(null);

  useEffect(() => {
    if (!token) {
      setError(t('shareLink.invalidLink'));
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const info = await getPublicShareLinkInfo(token);
        if (!cancelled) {
          setLinkInfo(info);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Share link load error:', err);
          const msg = err.message || t('shareLink.loadFail');
          setError(msg.includes('만료') || msg.includes('expired') ? t('shareLink.expired') : msg);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  if (loading) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        gap={2}
      >
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">
          {t('shareLink.loading')}
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        gap={2}
        px={2}
      >
        <Typography variant="h6" color="error">
          {error}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('shareLink.expiredOrNotFound')}
        </Typography>
      </Box>
    );
  }

  if (!linkInfo) return null;

  if (linkInfo.isDirectory) {
    return <FileManager shareToken={token} linkInfo={linkInfo} />;
  }

  return (
    <ShareLinkSingleFileView token={token} linkInfo={linkInfo} />
  );
};

export default ShareLinkLoader;
