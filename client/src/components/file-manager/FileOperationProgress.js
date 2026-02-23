import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Drawer,
  Paper,
  Typography,
  LinearProgress,
  IconButton,
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
  ErrorOutline as ErrorIcon,
  WarningAmber as WarningIcon,
  Refresh as RefreshIcon,
  Close as CloseIcon,
  SkipNext as SkipNextIcon,
  Cancel as CancelIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
} from '@mui/icons-material';
import { useResponsive } from '../../hooks/useResponsive';
import { checkmarkAnimation, progressCompleteAnimation } from './FileOperationProgress/styles';
import ProgressSummary from './FileOperationProgress/ProgressSummary';
import { getServerErrorDisplay } from '../../utils/errorUtils';

const FileOperationProgress = ({
  items,
  drawerOpen,
  onDrawerOpen,
  onDrawerClose,
  onClose,
  onRetry,
  onCancelFile,
  onCancelAll,
  showError,
  showWarning,
}) => {
  const { t } = useTranslation();
  const [expandedItemIndex, setExpandedItemIndex] = useState(null);
  const { isMobile } = useResponsive();

  const prevItemIdsRef = React.useRef(new Set());
  const toastedItemIdsRef = React.useRef(new Set());

  const getStatusTextForItem = (item) => {
    if (item.status === 'warning') {
      return item.errorCode ? getServerErrorDisplay(item, t) : (item.error || t('fileManager.statusExcluded'));
    }
    if (item.status === 'error') {
      const msg = item.errorCode ? getServerErrorDisplay(item, t) : (item.error || t('common.unknownError'));
      return t('fileManager.errorWithMessage', { message: msg });
    }
    return '';
  };

  // Toast on error/warning (once per item)
  useEffect(() => {
    if (!showError || !showWarning) return;
    items?.forEach((item) => {
      if (item.status !== 'error' && item.status !== 'warning') return;
      if (toastedItemIdsRef.current.has(item.id)) return;
      const text = getStatusTextForItem(item);
      if (!text) return;
      if (item.status === 'error') {
        showError(text);
      } else {
        showWarning(text);
      }
      toastedItemIdsRef.current.add(item.id);
    });
  }, [items, showError, showWarning, t]);

  // 새 작업 시작 시 접기, 에러/경고 시 해당 항목 펼치고 drawer 오픈
  useEffect(() => {
    const currentItemIds = new Set(items?.map(item => item.id) || []);
    const prevItemIds = prevItemIdsRef.current;

    const newItemIds = Array.from(currentItemIds).filter(id => !prevItemIds.has(id));
    if (newItemIds.length > 0) {
      const newItems = items?.filter(item => newItemIds.includes(item.id)) || [];
      const hasNewPreparing = newItems.some(item =>
        item.status === 'preparing' || item.status === 'processing' || item.status === 'downloading' || item.status === 'uploading'
      );
      if (hasNewPreparing) {
        setExpandedItemIndex(null);
      }
    }

    const errorOrWarningIndex = items?.findIndex(item => item.status === 'error' || item.status === 'warning');
    if (errorOrWarningIndex >= 0) {
      setExpandedItemIndex(errorOrWarningIndex);
      // Do not auto-open drawer on error/warning; user opens via chip click
    }

    prevItemIdsRef.current = currentItemIds;
  }, [items, onDrawerOpen]);

  // Reset expandedItemIndex when it points to a non-existent item
  useEffect(() => {
    if (expandedItemIndex != null && (!items || !items[expandedItemIndex])) {
      setExpandedItemIndex(null);
    }
  }, [items, expandedItemIndex]);

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
      return t('fileManager.statusPreparing');
    }
    if (item.status === 'downloading' || item.status === 'processing' || item.status === 'uploading') {
      return item.current || t('fileManager.statusProcessing');
    }
    if (item.status === 'completed') {
      return t('fileManager.statusCompleted');
    }
    if (item.status === 'warning') {
      return item.errorCode ? getServerErrorDisplay(item, t) : (item.error || t('fileManager.statusExcluded'));
    }
    if (item.status === 'error') {
      const msg = item.errorCode ? getServerErrorDisplay(item, t) : (item.error || t('common.unknownError'));
      return t('fileManager.errorWithMessage', { message: msg });
    }
    return t('fileManager.statusWaiting');
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

  const PROCESSING_STATUSES = ['preparing', 'processing', 'downloading', 'uploading'];
  const getRepresentativeProcessingItem = () => {
    if (!items?.length) return null;
    return items.find(item => PROCESSING_STATUSES.includes(item.status)) ?? null;
  };

  const BATCH_TYPES = ['copy', 'move', 'delete', 'upload', 'download', 'rename', 'createFolder'];
  const getMinimizedPrimaryLabel = () => {
    if (overallStatus === 'completed') return t('fileManager.statusCompleted');
    if (overallStatus === 'warning') return t('fileManager.statusExcluded');
    if (overallStatus === 'error') return overallProgress > 0 ? t('fileManager.statusPartialFail') : t('fileManager.statusFail');
    if (overallStatus === 'processing') {
      const rep = getRepresentativeProcessingItem();
      if (!rep) return t('fileManager.statusWorking');
      const cur = rep.current || '';
      const conflictLabel = t('fileManager.statusConflictCheck');
      const preparingLabel = t('fileManager.statusPreparing');
      if (cur.includes(conflictLabel)) return t('fileManager.statusPreparing');
      if (cur === '' || cur.includes(preparingLabel) || cur.includes(t('fileManager.statusUploadPreparing')) || cur.includes(t('fileManager.statusRetryPreparing'))) return t('fileManager.statusPreparing');
      if (overallProgress === 0 && BATCH_TYPES.includes(rep.type)) return t('fileManager.statusPreparing');
      const typeLabels = {
        delete: t('fileManager.statusDeleting'),
        copy: t('fileManager.statusCopying'),
        move: t('fileManager.statusMoving'),
        upload: t('fileManager.statusUploading'),
        download: t('fileManager.statusDownloading'),
        rename: t('fileManager.statusRenaming'),
        createFolder: t('fileManager.statusCreatingFolder'),
      };
      return typeLabels[rep.type] ?? t('fileManager.statusWorking');
    }
    return t('fileManager.statusWorking');
  };

  const getMinimizedSecondaryLabel = () => {
    if (overallStatus === 'completed') return '100%';
    if (overallStatus === 'warning') return '100%';
    if (overallStatus === 'error') return overallProgress > 0 ? `${overallProgress}%` : '0%';
    if (overallStatus === 'processing') {
      const rep = getRepresentativeProcessingItem();
      if (!rep) return `${overallProgress}%`;
      const cur = rep.current || '';
      const conflictLabel = t('fileManager.statusConflictCheck');
      const preparingLabel = t('fileManager.statusPreparing');
      if (cur.includes(conflictLabel)) return t('fileManager.statusConflictCheck');
      if (cur === '') return t('fileManager.statusProcessing');
      if (cur === preparingLabel) return t('fileManager.statusPreparing');
      if (cur.includes(t('fileManager.statusUploadPreparing'))) return t('fileManager.statusUploadPreparing');
      if (cur.includes(t('fileManager.statusRetryPreparing'))) return t('fileManager.statusRetryPreparing');
      if (overallProgress === 0 && BATCH_TYPES.includes(rep.type)) return t('fileManager.statusProcessing');
      return `${overallProgress}%`;
    }
    return `${overallProgress}%`;
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

  const renderMinimizedStatusIcon = () => {
    if (overallStatus === 'completed') {
      return <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />;
    }
    if (overallStatus === 'error') {
      return <ErrorIcon sx={{ color: 'error.main', fontSize: 20 }} />;
    }
    if (overallStatus === 'warning') {
      return <WarningIcon sx={{ color: 'warning.main', fontSize: 20 }} />;
    }
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
            : <Box sx={{ fontSize: 12 }}>{TypeIconComponent}</Box>}
        </Box>
      </Box>
    );
  };

  const shrinkChip = (
    <ProgressSummary
      variant="appbar"
      onOpenDrawer={onDrawerOpen}
      renderStatusIcon={renderMinimizedStatusIcon}
      primaryLabel={getMinimizedPrimaryLabel()}
      secondaryLabel={getMinimizedSecondaryLabel()}
    />
  );

  const renderExpandedItemContent = () => {
    const item = items[expandedItemIndex];
    if (!item) return null;
    const canShowDeterminate =
      (item.total ?? 0) > 0 &&
      item.status !== 'preparing' &&
      ['move', 'copy', 'delete', 'upload', 'download'].includes(item.type);
    return (
      <>
        <Box sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Box sx={{ flexShrink: 0, pb: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
              {item.status === 'completed' ? (
                <CheckCircleIcon sx={{ color: 'success.main', animation: `${checkmarkAnimation} 0.5s ease-in-out` }} />
              ) : item.status === 'warning' ? (
                <WarningIcon sx={{ color: 'warning.main' }} />
              ) : item.status === 'error' ? (
                <ErrorIcon sx={{ color: 'error.main' }} />
              ) : (
                getStatusIcon(item.type)
              )}
              <Typography variant="body2" sx={{ ml: 1, flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name || item.zipName}>
                {item.name || item.zipName || t('fileManager.workingFallback')}
              </Typography>
              {onCancelAll && (
                (item.type === 'upload' && item.cancellable !== false && (item.status === 'preparing' || item.status === 'processing' || item.status === 'uploading'))
                || ((item.type === 'delete' || item.type === 'move' || item.type === 'copy') && item.jobId && (item.status === 'preparing' || item.status === 'processing'))
              ) && (
                <Typography component="button" variant="caption" onClick={(e) => { e.stopPropagation(); onCancelAll(item.id); }} sx={{ ml: 0.5, color: 'text.secondary', fontSize: '0.75rem', cursor: 'pointer', border: 'none', background: 'none', padding: 0, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 0.5, '&:hover': { color: 'text.primary' } }}>
                  <CloseIcon fontSize="small" sx={{ fontSize: '0.875rem' }} />{t('fileManager.cancelOperation')}
                </Typography>
              )}
            </Box>
            {item.status === 'completed' ? (
              <Box sx={{ height: 6, borderRadius: 3, backgroundColor: 'success.main', opacity: 0.2, mb: 0.5, position: 'relative', overflow: 'hidden', '&::after': { content: '""', position: 'absolute', top: 0, left: 0, height: '100%', width: '100%', backgroundColor: 'success.main', animation: `${progressCompleteAnimation} 0.5s ease-in-out` } }} />
            ) : (
              <LinearProgress variant={canShowDeterminate ? 'determinate' : 'indeterminate'} value={canShowDeterminate ? getProgress(item) : undefined} sx={{ mb: 0.5, height: 6, borderRadius: 3, ...(item.status === 'error' && { '& .MuiLinearProgress-bar': { backgroundColor: 'error.main' } }), ...(item.status === 'warning' && { '& .MuiLinearProgress-bar': { backgroundColor: 'warning.main' } }) }} />
            )}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary">{getStatusText(item)}</Typography>
              {(item.total > 0 || item.type === 'move' || item.type === 'copy' || item.type === 'delete') && item.status !== 'completed' && (
                <Typography variant="caption" color="text.secondary">
                  {item.type === 'upload' ? `${item.progress}/${item.total}` : (item.type === 'move' || item.type === 'copy' || item.type === 'delete' ? `${item.progress}/${item.total} (${Math.round((item.progress / item.total) * 100)}%)` : item.percentage !== undefined ? `${Math.round(item.percentage)}%` : `${formatBytes(item.progress)} / ${formatBytes(item.total)}`)}
                </Typography>
              )}
            </Box>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', mt: 1, scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
            {item.type === 'upload' && item.fileItems && item.fileItems.length > 0 && (
              <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                <List dense sx={{ py: 0 }}>
                  {item.fileItems.map((fileItem, fileIndex) => {
                    const fileStatus = fileItem.status;
                    const canCancel = item.cancellable !== false && fileStatus === 'pending' && onCancelFile;
                    return (
                      <ListItem
                        key={fileIndex}
                        sx={{ px: 0, py: 0.25 }}
                        secondaryAction={
                          <Box sx={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {canCancel ? (
                              <IconButton edge="end" size="small" onClick={() => onCancelFile(item.id, fileItem.fileName)} sx={{ p: 0, minWidth: 24, minHeight: 24 }}>
                                <CloseIcon fontSize="small" sx={{ fontSize: 16 }} />
                              </IconButton>
                            ) : fileStatus === 'uploading' ? (
                              <CircularProgress size={16} variant="indeterminate" />
                            ) : fileStatus === 'completed' ? (
                              <CheckCircleIcon fontSize="small" color="success" sx={{ fontSize: 16 }} />
                            ) : fileStatus === 'skipped' ? (
                              <SkipNextIcon sx={{ fontSize: 16, color: 'warning.main' }} />
                            ) : fileStatus === 'error' ? (
                              <ErrorIcon fontSize="small" color="error" sx={{ fontSize: 16 }} />
                            ) : fileStatus === 'cancelled' ? (
                              <CancelIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                            ) : null}
                          </Box>
                        }
                      >
                        <ListItemText primary={fileItem.fileName} primaryTypographyProps={{ variant: 'caption' }} />
                      </ListItem>
                    );
                  })}
                </List>
              </Box>
            )}
            {(Array.isArray(item.skippedPathsByConflict) && item.skippedPathsByConflict.length > 0) && (
              <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                  <SkipNextIcon sx={{ fontSize: 16, color: 'warning.main' }} />
                  <Typography variant="caption" sx={{ fontWeight: 'medium', color: 'warning.main' }}>
                    {t('fileManager.bulkSkippedCount', { count: item.skippedCountByConflict ?? item.skippedPathsByConflict.length })}
                  </Typography>
                </Box>
                <List dense sx={{ py: 0, maxHeight: 140, overflowY: 'auto', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
                  {item.skippedPathsByConflict.map((p, idx) => (
                    <ListItem key={idx} sx={{ px: 0, py: 0.25 }} secondaryAction={
                      <Box sx={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <SkipNextIcon sx={{ fontSize: 16, color: 'warning.main' }} />
                      </Box>
                    }>
                      <ListItemText primary={p} primaryTypographyProps={{ variant: 'caption', sx: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }} />
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}
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
                        {t('fileManager.bulkExcludedByPermission', { count: skippedCount })}{truncated ? ` ${t('fileManager.bulkExcludedTruncated')}` : ''}
                      </Typography>
                      <List dense sx={{ py: 0, maxHeight: 140, overflowY: 'auto', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
                        {skippedPaths.map((p, idx) => (
                          <ListItem key={idx} sx={{ px: 0, py: 0.25 }}>
                            <ListItemText primary={p} primaryTypographyProps={{ variant: 'caption', sx: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }} />
                          </ListItem>
                        ))}
                        {skippedPaths.length === 0 && (
                          <ListItem sx={{ px: 0, py: 0.25 }}>
                            <ListItemText primary={t('common.noItems')} primaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }} />
                          </ListItem>
                        )}
                      </List>
                    </>
                  );
                })()}
              </Box>
            )}
            {item.status === 'error' && item.failedItems && item.failedItems.length > 0 && (
              <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" color="error" sx={{ fontWeight: 'medium', mb: 1, display: 'block' }}>
                  {t('fileManager.failedItemsLabel')}
                </Typography>
                <List dense sx={{ py: 0 }}>
                  {item.failedItems.map((failedItem, failedIndex) => (
                    <ListItem key={failedIndex} sx={{ px: 0, py: 0.25 }}>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', width: '100%', gap: 0.5 }}>
                        <Typography variant="caption" title={failedItem.fileName} sx={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {failedItem.fileName}
                        </Typography>
                        {failedItem.error != null && failedItem.error !== '' && (
                          <Typography variant="caption" component="span" title={failedItem.error} sx={{ flex: '0 1 auto', maxWidth: '100%', textAlign: 'right', fontSize: 11, color: 'error.main', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                            {failedItem.error}
                          </Typography>
                        )}
                      </Box>
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}
          </Box>
          {(item.status === 'error' || item.status === 'warning') && (
            <Box sx={{ display: 'flex', gap: 1, mt: 1, flexShrink: 0 }}>
              {item.status === 'error' && item.failedItems?.length > 0 && onRetry && (
                <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={() => onRetry(item.id)} sx={{ flex: 1 }}>
                  {t('fileManager.retry')}
                </Button>
              )}
              <Button variant="contained" size="small" onClick={() => onClose?.(item.id)} sx={{ flex: 1 }}>
                {t('common.confirm')}
              </Button>
            </Box>
          )}
        </Box>
        <Box
          component="button"
          onClick={() => setExpandedItemIndex(null)}
          sx={{
            width: '100%',
            py: 0.5,
            px: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.5,
            cursor: 'pointer',
            border: 'none',
            background: 'none',
            flexShrink: 0,
            borderTop: 1,
            borderColor: 'divider',
            '&:hover': { backgroundColor: 'action.hover' },
          }}
        >
          <KeyboardArrowUpIcon fontSize="small" />
          <Typography variant="caption">{t('common.collapse')}</Typography>
        </Box>
      </>
    );
  };

  const renderDrawerContent = () => (
    <Paper
      elevation={0}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 0,
        backgroundColor: 'background.paper',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', p: 2, pb: 1, flexShrink: 0, borderBottom: 1, borderColor: 'divider' }}>
        <IconButton size="small" onClick={onDrawerClose} aria-label={t('common.close')} sx={{ mr: 1 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
        <Typography variant="subtitle2" sx={{ flexGrow: 1, fontWeight: 'bold' }}>
          {t('fileManager.progressTitle')}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', p: 2, pt: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {expandedItemIndex === null || !items[expandedItemIndex]
          ? items.map((item, index) => {
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
                      {item.name || item.zipName || t('fileManager.workingFallback')}
                    </Typography>
                    {onCancelAll && (
                      (item.type === 'upload' && item.cancellable !== false && (item.status === 'preparing' || item.status === 'processing' || item.status === 'uploading'))
                      || ((item.type === 'delete' || item.type === 'move' || item.type === 'copy') && item.jobId && (item.status === 'preparing' || item.status === 'processing'))
                    ) && (
                      <Typography
                        component="button"
                        variant="caption"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCancelAll(item.id);
                        }}
                        sx={{
                          ml: 0.5,
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
                        {t('fileManager.cancelOperation')}
                      </Typography>
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
                  </Box>
                </Box>

                <Box
                  component="button"
                  onClick={() => setExpandedItemIndex(index)}
                  sx={{
                    width: '100%',
                    py: 0.5,
                    px: 1,
                    mt: 0.5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 0.5,
                    cursor: 'pointer',
                    border: 'none',
                    background: 'none',
                    borderTop: 1,
                    borderColor: 'divider',
                    '&:hover': { backgroundColor: 'action.hover' },
                  }}
                >
                  <KeyboardArrowDownIcon fontSize="small" />
                  <Typography variant="caption">{t('common.expand')}</Typography>
                </Box>
              </Box>
            );
          })
          : renderExpandedItemContent()}
      </Box>
    </Paper>
  );

  const slot = typeof document !== 'undefined' ? document.getElementById('file-progress-slot') : null;

  return (
    <>
      {!drawerOpen && slot && createPortal(shrinkChip, slot)}
      {drawerOpen && (
        <Drawer
          anchor="right"
          open={drawerOpen}
          onClose={onDrawerClose}
          variant="temporary"
          sx={{
            '& .MuiDrawer-paper': {
              width: isMobile ? '100%' : 400,
              maxWidth: '100%',
            },
          }}
        >
          {renderDrawerContent()}
        </Drawer>
      )}
    </>
  );
};

export default FileOperationProgress;

