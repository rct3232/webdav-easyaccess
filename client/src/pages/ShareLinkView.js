import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  CircularProgress,
  IconButton,
  AppBar,
  Toolbar,
} from '@mui/material';
import {
  Download as DownloadIcon,
} from '@mui/icons-material';
import axios from 'axios';
import { pdfjs } from 'react-pdf';
import { useResponsive } from '../hooks/useResponsive';
import { getPublicShareLinkInfo, getPublicShareLinkPreviewUrl, getPublicShareLinkDownloadUrl } from '../services/shareLinkService';
import {
  ShareLinkPreviewImage,
  ShareLinkPreviewVideo,
  ShareLinkPreviewAudio,
  ShareLinkPreviewPdf,
  ShareLinkPreviewText,
  ShareLinkPreviewUnsupported,
  PREVIEW_MAX_HEIGHT,
} from './ShareLinkView/ShareLinkPreviewComponents';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

const ShareLinkView = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const { isMobile } = useResponsive();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [linkInfo, setLinkInfo] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const previewUrlRef = useRef(null); // cleanup을 위한 ref
  const [previewBlob, setPreviewBlob] = useState(null);
  const [textContent, setTextContent] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [containerWidth, setContainerWidth] = useState(null);
  const [containerHeight, setContainerHeight] = useState(null);
  const [pageInfo, setPageInfo] = useState(null);
  const pdfContainerRef = useRef(null);
  const stableWidthRef = useRef(null);

  // Configure pdf.js worker for react-pdf v10
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const workerPath = window.location.origin + (process.env.PUBLIC_URL || '') + '/pdf.worker.min.js';
      pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
    }
  }, []);

  // PDF 페이지 크기 계산
  const calculatedWidth = useMemo(() => {
    if (!containerWidth) {
      return isMobile ? undefined : Math.min(800, window.innerWidth - 100);
    }

    if (!containerHeight || !pageInfo) {
      return containerWidth;
    }

    if (stableWidthRef.current !== null) {
      return stableWidthRef.current;
    }

    const { width: pageWidth, height: pageHeight } = pageInfo;
    const widthRatio = containerWidth / pageWidth;
    const heightRatio = containerHeight / pageHeight;
    const scale = Math.min(widthRatio, heightRatio, 1);
    const width = pageWidth * scale;
    
    stableWidthRef.current = width;
    
    return width;
  }, [containerWidth, containerHeight, pageInfo, isMobile]);

  // 페이지 배열 메모이제이션
  const pageArray = useMemo(() => {
    if (!numPages) return [];
    return Array.from(new Array(numPages), (_, index) => index + 1);
  }, [numPages]);

  // 링크 정보 및 미리보기 로드
  const loadShareLink = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      // 링크 정보 조회
      const info = await getPublicShareLinkInfo(token);
      setLinkInfo(info);

      // 미리보기 로드
      const previewUrl = getPublicShareLinkPreviewUrl(token);
      const response = await axios.get(previewUrl, {
        responseType: 'blob',
      });

      const blob = response.data;
      const fileType = info.fileType;

      if (fileType === 'text') {
        const text = await blob.text();
        setTextContent(text);
      } else if (fileType === 'pdf') {
        setPreviewBlob(blob);
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        previewUrlRef.current = url; // ref 동기 업데이트
      } else {
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        previewUrlRef.current = url; // ref 동기 업데이트
      }

      setLoading(false);
    } catch (err) {
      console.error('Share link load error:', err);
      if (err.response?.status === 404) {
        setError('공유 링크를 찾을 수 없습니다.');
      } else if (err.response?.status === 410) {
        setError('공유 링크가 만료되었습니다.');
      } else {
        setError(err.message || '파일을 불러올 수 없습니다.');
      }
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      loadShareLink();
    }

    return () => {
      // cleanup: ref를 사용하여 최신 previewUrl revoke
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, [token, loadShareLink]);

  // 컨테이너 크기 측정
  useEffect(() => {
    if (!linkInfo || !pdfContainerRef.current) {
      return;
    }

    const updateContainerSize = () => {
      if (pdfContainerRef.current) {
        const width = pdfContainerRef.current.clientWidth;
        const height = pdfContainerRef.current.clientHeight;
        setContainerWidth(width - 32);
        setContainerHeight(height - 32);
      }
    };

    updateContainerSize();

    const resizeObserver = new ResizeObserver(updateContainerSize);
    resizeObserver.observe(pdfContainerRef.current);

    window.addEventListener('resize', updateContainerSize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateContainerSize);
    };
  }, [linkInfo, previewUrl]);

  const handleDownload = () => {
    if (!token) return;
    
    const downloadUrl = getPublicShareLinkDownloadUrl(token);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = linkInfo?.fileName || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  const renderPreview = () => {
    if (loading) {
      return (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight={PREVIEW_MAX_HEIGHT}>
          <CircularProgress />
        </Box>
      );
    }

    if (error) {
      return (
        <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" minHeight={PREVIEW_MAX_HEIGHT} gap={2} px={2}>
          <Typography variant="h6" color="error">{error}</Typography>
          <Typography variant="body2" color="text.secondary">
            링크가 만료되었거나 파일을 찾을 수 없습니다.
          </Typography>
        </Box>
      );
    }

    if (!linkInfo) return null;

    const fileType = linkInfo.fileType;

    switch (fileType) {
      case 'image':
        return <ShareLinkPreviewImage previewUrl={previewUrl} fileName={linkInfo.fileName} />;

      case 'video':
        return <ShareLinkPreviewVideo previewUrl={previewUrl} />;

      case 'audio':
        return <ShareLinkPreviewAudio previewUrl={previewUrl} fileName={linkInfo.fileName} />;

      case 'pdf':
        return (
          <ShareLinkPreviewPdf
            previewBlob={previewBlob}
            previewUrl={previewUrl}
            pdfContainerRef={pdfContainerRef}
            numPages={numPages}
            pageArray={pageArray}
            calculatedWidth={calculatedWidth}
            pageInfo={pageInfo}
            setPageInfo={setPageInfo}
            setNumPages={setNumPages}
            setError={setError}
          />
        );

      case 'text':
        return <ShareLinkPreviewText textContent={textContent} />;

      default:
        return <ShareLinkPreviewUnsupported />;
    }
  };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AppBar 
        position="static" 
        sx={{ 
          flexShrink: 0,
          backgroundColor: 'transparent',
          backgroundImage: 'none',
        }}
        elevation={0}
      >
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flex: 1, mr: 2 }} noWrap>
            {linkInfo?.fileName || '공유 파일'}
          </Typography>
          <IconButton onClick={handleDownload} color="inherit" title="다운로드">
            <DownloadIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Box sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {renderPreview()}
      </Box>
    </Box>
  );
};

export default ShareLinkView;
