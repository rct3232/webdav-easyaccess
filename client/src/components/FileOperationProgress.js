import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  LinearProgress,
  IconButton,
  Collapse,
  CircularProgress,
  Button,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import {
  Download as DownloadIcon,
  DriveFileMove as MoveIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  UploadFile as UploadIcon,
  DriveFileRenameOutline as RenameIcon,
  CreateNewFolder as CreateFolderIcon,
  CheckCircle as CheckCircleIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  ErrorOutline as ErrorIcon,
  WarningAmber as WarningIcon,
  Refresh as RefreshIcon,
  Close as CloseIcon,
  SkipNext as SkipNextIcon,
} from '@mui/icons-material';
import { keyframes } from '@emotion/react';
import { useResponsive } from '../hooks/useResponsive';

const checkmarkAnimation = keyframes`
  0% {
    transform: scale(0);
    opacity: 0;
  }
  50% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

const progressCompleteAnimation = keyframes`
  0% {
    width: 0%;
  }
  100% {
    width: 100%;
  }
`;

const FileOperationProgress = ({ items, onClose, onRetry, onCancelFile, onCancelAll }) => {
  const [expanded, setExpanded] = useState(true);
  const { isMobile } = useResponsive();

  const prevItemIdsRef = React.useRef(new Set());

  // 새 작업 시작 시 최소화 상태로 설정, 실패 시 자동 확장
  useEffect(() => {
    const currentItemIds = new Set(items?.map(item => item.id) || []);
    const prevItemIds = prevItemIdsRef.current;

    // 새 작업이 시작된 경우 (새로운 id가 추가됨)
    const newItemIds = Array.from(currentItemIds).filter(id => !prevItemIds.has(id));
    if (newItemIds.length > 0) {
      // 새로 추가된 항목 중 preparing 또는 processing 상태인 것이 있으면 최소화 상태로
      const newItems = items?.filter(item => newItemIds.includes(item.id)) || [];
      const hasNewPreparing = newItems.some(item => 
        item.status === 'preparing' || item.status === 'processing' || item.status === 'downloading' || item.status === 'uploading'
      );
      if (hasNewPreparing) {
        setExpanded(false);
      }
    }

    // 에러/경고 시 자동 확장
    const hasErrorOrWarning = items?.some(item => item.status === 'error' || item.status === 'warning');
    if (hasErrorOrWarning) {
      setExpanded(true);
    }

    // 이전 id 집합 업데이트
    prevItemIdsRef.current = currentItemIds;
  }, [items]);

  const getStatusIcon = (type) => {
    switch (type) {
      case 'download':
        return <DownloadIcon />;
      case 'move':
        return <MoveIcon />;
      case 'copy':
        return <CopyIcon />;
      case 'delete':
        return <DeleteIcon />;
      case 'upload':
        return <UploadIcon />;
      case 'rename':
        return <RenameIcon />;
      case 'createFolder':
        return <CreateFolderIcon />;
      default:
        return <DownloadIcon />;
    }
  };

  const getStatusText = (item) => {
    if (item.status === 'preparing') {
      return '준비 중...';
    } else if (item.status === 'downloading' || item.status === 'processing' || item.status === 'uploading') {
      return item.current || '처리 중...';
    } else if (item.status === 'completed') {
      return '완료';
    } else if (item.status === 'warning') {
      return item.error || '일부 제외됨';
    } else if (item.status === 'error') {
      return `오류: ${item.error || '알 수 없는 오류'}`;
    }
    return '대기 중...';
  };

  const getProgress = (item) => {
    if (item.status === 'completed' || item.status === 'warning') {
      return 100;
    }
    // Use percentage if available, otherwise calculate from progress/total
    if (item.percentage !== undefined) {
      return Math.min(100, item.percentage);
    }
    if (item.total === 0) return 0;
    return Math.min(100, (item.progress / item.total) * 100);
  };

  const getOverallProgress = () => {
    if (!items || items.length === 0) return 0;
    // Calculate progress for each item and average
    const totalProgress = items.reduce((sum, item) => {
      const itemProgress = getProgress(item);
      return sum + itemProgress;
    }, 0);
    return Math.round(totalProgress / items.length);
  };

  const getOverallStatus = () => {
    if (!items || items.length === 0) return 'completed';
    const hasProcessing = items.some(item => item.status === 'processing' || item.status === 'preparing' || item.status === 'downloading' || item.status === 'uploading');
    const hasError = items.some(item => item.status === 'error');
    const hasWarning = items.some(item => item.status === 'warning');
    if (hasError) return 'error';
    if (hasProcessing) return 'processing';
    if (hasWarning) return 'warning';
    return 'completed';
  };

  const getOverallType = () => {
    if (!items || items.length === 0) return 'download';
    // Return the type of the first item (or most common type)
    return items[0]?.type || 'download';
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  if (!items || items.length === 0) {
    return null;
  }

  const overallStatus = getOverallStatus();
  const overallProgress = getOverallProgress();
  const overallType = getOverallType();

  // 최소화 UI 렌더링
  const renderMinimizedUI = () => {
    const renderStatusIcon = () => {
      if (overallStatus === 'completed') {
        return (
          <CheckCircleIcon 
            sx={{ 
              color: 'success.main',
              fontSize: 20,
            }} 
          />
        );
      } else if (overallStatus === 'error') {
        return (
          <ErrorIcon 
            sx={{ 
              color: 'error.main',
              fontSize: 20,
            }} 
          />
        );
      } else if (overallStatus === 'warning') {
        return (
          <WarningIcon
            sx={{
              color: 'warning.main',
              fontSize: 20,
            }}
          />
        );
      } else {
        // 작업 중: 스피너 + 내부 아이콘
        const TypeIconComponent = getStatusIcon(overallType);
        return (
          <Box sx={{ position: 'relative', width: 20, height: 20 }}>
            <CircularProgress 
              size={20} 
              thickness={4}
              value={overallStatus === 'processing' && overallProgress > 0 ? overallProgress : undefined}
              variant={overallStatus === 'processing' && overallProgress > 0 ? 'determinate' : 'indeterminate'}
              sx={{ position: 'absolute', top: 0, left: 0 }}
            />
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'primary.main',
                fontSize: '12px',
              }}
            >
              {React.isValidElement(TypeIconComponent) 
                ? React.cloneElement(TypeIconComponent, { sx: { fontSize: 12, color: 'primary.main' } })
                : <Box sx={{ fontSize: 12 }}>{TypeIconComponent}</Box>
              }
            </Box>
          </Box>
        );
      }
    };

    return (
      <Paper
        elevation={6}
        sx={{
          position: 'fixed',
          bottom: 16,
          ...(isMobile 
            ? { left: 16 }
            : { right: 16 }
          ),
          minWidth: 200,
          maxWidth: 300,
          borderRadius: '20px',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          cursor: 'pointer',
          zIndex: 1300,
          backgroundColor: 'background.paper',
        }}
        onClick={() => setExpanded(true)}
      >
        {renderStatusIcon()}
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="caption" sx={{ fontWeight: 'medium', display: 'block' }}>
            {overallStatus === 'completed'
              ? '완료'
              : overallStatus === 'error'
                ? '오류 발생'
                : overallStatus === 'warning'
                  ? '일부 제외됨'
                  : '작업 중'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {overallProgress}%
          </Typography>
        </Box>
        {onClose && (
          <IconButton
            size="small"
            aria-label="dismiss-all"
            onClick={(e) => {
              e.stopPropagation();
              // Dismiss all visible items (best-effort)
              (items || []).forEach((it) => onClose(it.id));
            }}
            sx={{ padding: 0.5 }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
          sx={{ padding: 0.5 }}
        >
          <ExpandLessIcon fontSize="small" />
        </IconButton>
      </Paper>
    );
  };

  // 확장 UI 렌더링
  const renderExpandedUI = () => {
    return (
      <Box
        sx={{
          position: 'fixed',
          bottom: 16,
          ...(isMobile 
            ? { left: 16, right: 16, width: 'auto' }
            : { right: 16, maxWidth: 400, width: '100%' }
          ),
          zIndex: 1300,
        }}
      >
        <Paper
          elevation={6}
          sx={{
            p: 2,
            backgroundColor: 'background.paper',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, flexShrink: 0 }}>
            <Typography variant="subtitle2" sx={{ flexGrow: 1, fontWeight: 'bold' }}>
              진행 중인 작업
            </Typography>
            <IconButton
              size="small"
              onClick={() => setExpanded(false)}
              sx={{ mr: 1 }}
            >
              {expanded ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
            </IconButton>
          </Box>

          <Collapse 
            in={expanded}
            sx={{
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Box
              sx={{
                overflowY: 'auto',
                overflowX: 'hidden',
                maxHeight: 'calc(80vh - 120px)',
                scrollbarWidth: 'none', // Firefox
                '&::-webkit-scrollbar': {
                  display: 'none', // Chrome, Safari, Edge
                },
              }}
            >
              {items.map((item, index) => {
                const canShowDeterminate =
                  item.total > 0 &&
                  item.status !== 'preparing' &&
                  ['move', 'copy', 'delete', 'upload', 'download'].includes(item.type);
                return (
              <Box key={index} sx={{ mb: 2, '&:last-child': { mb: 0 }, display: 'flex', flexDirection: 'column' }}>
                {/* 아이템 헤더 (고정 영역) */}
                <Box sx={{ 
                  flexShrink: 0,
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  backgroundColor: 'background.paper',
                  pt: 1,
                  pb: 0.5,
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                    {item.status === 'completed' ? (
                      <CheckCircleIcon 
                        sx={{ 
                          color: 'success.main',
                          animation: `${checkmarkAnimation} 0.5s ease-in-out`,
                        }} 
                      />
                    ) : item.status === 'warning' ? (
                      <WarningIcon
                        sx={{
                          color: 'warning.main',
                        }}
                      />
                    ) : item.status === 'error' ? (
                      <ErrorIcon 
                        sx={{ 
                          color: 'error.main',
                        }} 
                      />
                    ) : (
                      getStatusIcon(item.type)
                    )}
                    <Typography
                      variant="body2"
                      sx={{
                        ml: 1,
                        flexGrow: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={item.name || item.zipName}
                    >
                      {item.name || item.zipName || '작업 중...'}
                    </Typography>
                    {onClose && (
                      <IconButton
                        size="small"
                        aria-label={`dismiss-${item.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onClose(item.id);
                        }}
                        sx={{ ml: 0.5 }}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Box>
                  
                  {item.status === 'completed' ? (
                    <Box
                      sx={{
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: 'success.main',
                        opacity: 0.2,
                        mb: 0.5,
                        position: 'relative',
                        overflow: 'hidden',
                        '&::after': {
                          content: '""',
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          height: '100%',
                          width: '100%',
                          backgroundColor: 'success.main',
                          animation: `${progressCompleteAnimation} 0.5s ease-in-out`,
                        },
                      }}
                    />
                  ) : (
                    <LinearProgress
                      variant={canShowDeterminate ? 'determinate' : 'indeterminate'}
                      value={canShowDeterminate ? getProgress(item) : undefined}
                      sx={{ 
                        mb: 0.5, 
                        height: 6, 
                        borderRadius: 3,
                        ...(item.status === 'error' && {
                          '& .MuiLinearProgress-bar': {
                            backgroundColor: 'error.main',
                          }
                        }),
                        ...(item.status === 'warning' && {
                          '& .MuiLinearProgress-bar': {
                            backgroundColor: 'warning.main',
                          }
                        })
                      }}
                    />
                  )}
                  
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="caption" color="text.secondary">
                      {getStatusText(item)}
                    </Typography>
                  {(item.total > 0 || item.type === 'move' || item.type === 'copy' || item.type === 'delete') && item.status !== 'completed' && (
                      <Typography variant="caption" color="text.secondary">
                      {item.type === 'upload'
                        ? `${item.progress}/${item.total}`
                        : (item.type === 'move' || item.type === 'copy' || item.type === 'delete'
                          ? `${item.progress}/${item.total} (${Math.round((item.progress / item.total) * 100)}%)`
                          : item.percentage !== undefined
                            ? `${Math.round(item.percentage)}%`
                            : `${formatBytes(item.progress)} / ${formatBytes(item.total)}`
                        )}
                      </Typography>
                    )}
                    {/* 업로드 타입일 때 전체 취소 버튼 */}
                  {item.type === 'upload' && item.cancellable !== false && (item.status === 'preparing' || item.status === 'processing' || item.status === 'uploading') && onCancelAll && (
                      <Typography
                        component="button"
                        variant="caption"
                        onClick={() => onCancelAll(item.id)}
                        sx={{
                          ml: 1,
                          color: 'text.secondary',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          border: 'none',
                          background: 'none',
                          padding: 0,
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 0.5,
                          '&:hover': {
                            color: 'text.primary',
                          },
                        }}
                      >
                        <CloseIcon fontSize="small" sx={{ fontSize: '0.875rem' }} />
                        작업 취소
                      </Typography>
                    )}
                  </Box>
                </Box>
                
                {/* 아이템 본문 (스크롤 가능) */}
                <Box sx={{ 
                  flex: 1, 
                  minHeight: 0,
                }}>

                  {/* 업로드 타입일 때 개별 파일 목록 표시 */}
                  {item.type === 'upload' && item.fileItems && item.fileItems.length > 0 && (
                    <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                      <List dense sx={{ py: 0 }}>
                        {item.fileItems.map((fileItem, fileIndex) => {
                          const fileStatus = fileItem.status;
                          const canCancel = item.cancellable !== false && (fileStatus === 'pending' || fileStatus === 'uploading') && onCancelFile;
                          
                          return (
                            <ListItem 
                              key={fileIndex} 
                              sx={{ px: 0, py: 0.5 }}
                              secondaryAction={
                                canCancel ? (
                                  <IconButton
                                    edge="end"
                                    size="small"
                                    onClick={() => onCancelFile(item.id, fileItem.fileName)}
                                  >
                                    <CloseIcon fontSize="small" />
                                  </IconButton>
                                ) : fileStatus === 'completed' ? (
                                  <CheckCircleIcon 
                                    fontSize="small" 
                                    color="success"
                                    sx={{ fontSize: 16 }}
                                  />
                                ) : fileStatus === 'skipped' ? (
                                  <Typography variant="caption" color="warning.main" sx={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <SkipNextIcon sx={{ fontSize: 16 }} />
                                    건너뜀
                                  </Typography>
                                ) : fileStatus === 'error' ? (
                                  <ErrorIcon 
                                    fontSize="small" 
                                    color="error"
                                    sx={{ fontSize: 16 }}
                                  />
                                ) : fileStatus === 'cancelled' ? (
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 12 }}>
                                    취소됨
                                  </Typography>
                                ) : null
                              }
                            >
                              <ListItemText
                                primary={fileItem.fileName}
                                primaryTypographyProps={{ variant: 'caption' }}
                                secondary={
                                  fileStatus === 'uploading' ? (
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                                      업로드 중...
                                    </Typography>
                                  ) : fileStatus === 'completed' ? (
                                    <Typography variant="caption" color="success.main" sx={{ fontSize: 11 }}>
                                      완료
                                    </Typography>
                                  ) : fileStatus === 'skipped' ? (
                                    <Typography variant="caption" color="warning.main" sx={{ fontSize: 11 }}>
                                      건너뜀
                                    </Typography>
                                  ) : fileStatus === 'error' ? (
                                    <Typography variant="caption" color="error.main" sx={{ fontSize: 11 }}>
                                      {fileItem.error || '업로드 실패'}
                                    </Typography>
                                  ) : fileStatus === 'cancelled' ? (
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                                      취소됨
                                    </Typography>
                                  ) : (
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                                      대기 중
                                    </Typography>
                                  )
                                }
                              />
                            </ListItem>
                          );
                        })}
                      </List>
                    </Box>
                  )}

                  {/* 건너뛴 항목 (중복) */}
                  {(Array.isArray(item.skippedPathsByConflict) && item.skippedPathsByConflict.length > 0) && (
                    <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                        <SkipNextIcon sx={{ fontSize: 16, color: 'warning.main' }} />
                        <Typography variant="caption" sx={{ fontWeight: 'medium', color: 'warning.main' }}>
                          건너뛴 항목: {(item.skippedCountByConflict ?? item.skippedPathsByConflict.length)}개
                        </Typography>
                      </Box>
                      <List dense sx={{ py: 0, maxHeight: 140, overflowY: 'auto', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
                        {item.skippedPathsByConflict.map((p, idx) => (
                          <ListItem key={idx} sx={{ px: 0, py: 0.25 }} secondaryAction={<SkipNextIcon sx={{ fontSize: 16, color: 'warning.main' }} />}>
                            <ListItemText
                              primary={p}
                              primaryTypographyProps={{ variant: 'caption', sx: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }}
                            />
                          </ListItem>
                        ))}
                      </List>
                    </Box>
                  )}

                  {/* 권한으로 제외된 항목 (하위호환: skippedPaths만 있으면 권한 제외로 간주) */}
                  {(() => {
                    const hasSkippedByPermission = Array.isArray(item.skippedPathsByPermission) && item.skippedPathsByPermission.length > 0;
                    const hasLegacySkipped = (typeof item.skippedCount === 'number' ? item.skippedCount : 0) > 0 || (Array.isArray(item.skippedPaths) && item.skippedPaths.length > 0);
                    const hasSkippedByConflict = Array.isArray(item.skippedPathsByConflict) && item.skippedPathsByConflict.length > 0;
                    return (hasSkippedByPermission || (hasLegacySkipped && !hasSkippedByConflict));
                  })() && (
                    <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                      {(() => {
                        const skippedPaths = Array.isArray(item.skippedPathsByPermission) && item.skippedPathsByPermission.length > 0
                          ? item.skippedPathsByPermission
                          : (Array.isArray(item.skippedPaths) ? item.skippedPaths : []);
                        const skippedCount = typeof item.skippedCountByPermission === 'number'
                          ? item.skippedCountByPermission
                          : (typeof item.skippedCount === 'number' ? item.skippedCount : skippedPaths.length);
                        const truncated = Boolean(item.skippedTruncated) || (typeof skippedCount === 'number' && skippedPaths.length < skippedCount);
                        return (
                          <>
                            <Typography variant="caption" sx={{ fontWeight: 'medium', color: 'warning.main', mb: 1, display: 'block' }}>
                              권한으로 제외된 항목: {skippedCount}개{truncated ? ' (일부만 표시됨)' : ''}
                            </Typography>
                            <List dense sx={{ py: 0, maxHeight: 140, overflowY: 'auto', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
                              {skippedPaths.map((p, idx) => (
                                <ListItem key={idx} sx={{ px: 0, py: 0.25 }}>
                                  <ListItemText
                                    primary={p}
                                    primaryTypographyProps={{ variant: 'caption', sx: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }}
                                  />
                                </ListItem>
                              ))}
                              {skippedPaths.length === 0 && (
                                <ListItem sx={{ px: 0, py: 0.25 }}>
                                  <ListItemText primary="(목록 없음)" primaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }} />
                                </ListItem>
                              )}
                            </List>
                          </>
                        );
                      })()}
                    </Box>
                  )}

                  {/* 실패 내역 리스트 */}
                  {item.status === 'error' && item.failedItems && item.failedItems.length > 0 && (
                    <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                      <Typography variant="caption" color="error" sx={{ fontWeight: 'medium', mb: 1, display: 'block' }}>
                        실패한 항목:
                      </Typography>
                      <List dense sx={{ py: 0, mb: 2 }}>
                        {item.failedItems.map((failedItem, failedIndex) => (
                          <ListItem key={failedIndex} sx={{ px: 0, py: 0.5 }}>
                            <ListItemText
                              primary={failedItem.fileName}
                              secondary={failedItem.error}
                              primaryTypographyProps={{ variant: 'caption' }}
                              secondaryTypographyProps={{ variant: 'caption', color: 'error' }}
                            />
                          </ListItem>
                        ))}
                      </List>
                      <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                        {onRetry && (
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<RefreshIcon />}
                            onClick={() => onRetry(item.id)}
                            sx={{ flex: 1 }}
                          >
                            재시도
                          </Button>
                        )}
                        <Button
                          variant="contained"
                          size="small"
                          onClick={() => onClose && onClose(item.id)}
                          sx={{ flex: 1 }}
                        >
                          확인
                        </Button>
                      </Box>
                    </Box>
                  )}
                </Box>
              </Box>
              );
              })}
            </Box>
          </Collapse>
        </Paper>
      </Box>
    );
  };

  return expanded ? renderExpandedUI() : renderMinimizedUI();
};

export default FileOperationProgress;

