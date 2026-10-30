/**
 * MergeProposalCard — the ONLY proposal UI in the product: one sticky card
 * between the collections toolbar and the list. The body presents the top
 * score-desc pending pair; a centered footer text expands the remaining pairs
 * in an accordion; desktop hover / mobile tap opens a NON-MODAL detail panel
 * with the collection-card 2×2 previews (B absorbed → A survivor) and a
 * one-line reason. `Merge` executes immediately: THE CARD IS THE CONFIRMATION
 * (no dialog). IO-free pure view: thumbnails arrive through the host
 * `thumbnailMap`/`onRequestThumbnails` props, all mutation intent rides
 * `onAction(suggestionId, action)` (MergeProposalCard.md §2.8).
 * @see docs/spec/client/components/file-manager/MergeProposalCard.md
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Card, IconButton, Paper, Popper, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import BlockIcon from '@mui/icons-material/Block';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import SnoozeIcon from '@mui/icons-material/Snooze';
import { useResponsive } from '../../hooks/useResponsive';
import { koObjectParticle, koWithParticle } from '../../utils/koParticleUtils';
import CollectionPreviewGrid from './CollectionPreviewGrid';
import PreviewTile from './PreviewTile';

const HOVER_OPEN_DELAY_MS = 200;
const HOVER_CLOSE_GRACE_MS = 300;

const focusRingSx = {
  outline: 'none',
  '&:focus-visible': {
    outline: '2px solid',
    outlineColor: 'primary.main',
    outlineOffset: 2,
    borderRadius: 1,
  },
};

const MergeProposalCard = ({
  suggestions = [],
  onAction,
  thumbnailMap = null,
  onRequestThumbnails,
}) => {
  const { t } = useTranslation();
  const { isMobile } = useResponsive();
  const [moreOpen, setMoreOpen] = useState(false);
  // { suggestionId, anchorEl }: the detail is portaled beside the anchored ROW
  // (never the card), so the accordion/card scroll clip cannot cut it off.
  const [detail, setDetail] = useState(null);
  const cardRef = useRef(null);
  const panelRef = useRef(null);
  const openTimerRef = useRef(null);
  const closeTimerRef = useRef(null);

  const topSuggestion = suggestions[0] ?? null;
  const remainingSuggestions = suggestions.slice(1);
  const detailSuggestion = useMemo(
    () =>
      detail
        ? (suggestions.find((row) => row.suggestion_id === detail.suggestionId) ?? null)
        : null,
    [detail, suggestions]
  );

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const closeDetail = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    setDetail(null);
  }, [clearOpenTimer, clearCloseTimer]);

  const openDetailNow = useCallback(
    (suggestion, anchorEl) => {
      if (!suggestion || !anchorEl) return;
      clearOpenTimer();
      clearCloseTimer();
      setDetail({ suggestionId: suggestion.suggestion_id, anchorEl });
    },
    [clearOpenTimer, clearCloseTimer]
  );

  // Hover intent: 200ms to open, 300ms grace before closing. The grace window
  // lets the pointer travel from the row into the panel; panel enter cancels.
  const scheduleOpen = useCallback(
    (suggestion, anchorEl) => {
      if (isMobile || !suggestion) return;
      clearOpenTimer();
      clearCloseTimer();
      openTimerRef.current = setTimeout(() => {
        openTimerRef.current = null;
        if (!anchorEl) return;
        setDetail({ suggestionId: suggestion.suggestion_id, anchorEl });
      }, HOVER_OPEN_DELAY_MS);
    },
    [isMobile, clearOpenTimer, clearCloseTimer]
  );

  const scheduleClose = useCallback(() => {
    if (isMobile) return;
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setDetail(null);
    }, HOVER_CLOSE_GRACE_MS);
  }, [isMobile, clearOpenTimer, clearCloseTimer]);

  const cancelScheduledClose = useCallback(() => {
    clearCloseTimer();
  }, [clearCloseTimer]);

  // A resolved/removed row must not leave an orphaned panel behind.
  useEffect(() => {
    if (!detail) return;
    if (!suggestions.some((row) => row.suggestion_id === detail.suggestionId)) {
      closeDetail();
    }
  }, [suggestions, detail, closeDetail]);

  // Collapsing the accordion closes a panel anchored to one of its rows.
  useEffect(() => {
    if (moreOpen || !detail) return;
    if (detail.suggestionId !== topSuggestion?.suggestion_id) closeDetail();
  }, [moreOpen, detail, topSuggestion, closeDetail]);

  useEffect(
    () => () => {
      clearOpenTimer();
      clearCloseTimer();
    },
    [clearOpenTimer, clearCloseTimer]
  );

  useEffect(() => {
    if (!detail) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeDetail();
    };
    const onPointerDown = (event) => {
      const target = event.target;
      if (panelRef.current?.contains(target)) return;
      if (cardRef.current?.contains(target)) return;
      closeDetail();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [detail, closeDetail]);

  const detailPreviewIds = useMemo(() => {
    if (!detailSuggestion) return [];
    const ids = [];
    (detailSuggestion.a_preview_items ?? []).forEach((row) => ids.push(row.node_id));
    (detailSuggestion.b_preview_items ?? []).forEach((row) => ids.push(row.node_id));
    (detailSuggestion.overlap_sample ?? []).forEach((pair) => {
      const nodeId = pair.a_node_id ?? pair.b_node_id;
      if (nodeId != null) ids.push(nodeId);
    });
    return [...new Set(ids.filter((id) => id != null))];
  }, [detailSuggestion]);

  useEffect(() => {
    if (detailPreviewIds.length === 0 || typeof onRequestThumbnails !== 'function') return;
    onRequestThumbnails(detailPreviewIds);
  }, [detailPreviewIds, onRequestThumbnails]);

  const questionFor = useCallback(
    (suggestion) =>
      t('fileManager.mergeQuestion', {
        absorbed: suggestion.b_name,
        survivor: suggestion.a_name,
        pObj: koObjectParticle(suggestion.b_name),
        pWith: koWithParticle(suggestion.a_name),
      }),
    [t]
  );

  const countsFor = useCallback(
    (suggestion) =>
      `${t('fileManager.mergeOverlapCount', { count: suggestion.overlap_count })} · ${t(
        'fileManager.mergeAfter',
        { count: suggestion.merged_count }
      )}`,
    [t]
  );

  const reasonFor = useCallback(
    (suggestion) => {
      const arbiterReason = suggestion?.recommendation?.reason;
      if (typeof arbiterReason === 'string' && arbiterReason.trim().length > 0) {
        return arbiterReason;
      }
      return t('fileManager.mergeReason', {
        overlap: suggestion?.overlap_count ?? 0,
        merged: suggestion?.merged_count ?? 0,
      });
    },
    [t]
  );

  const dispatchAction = useCallback(
    (suggestion, action) => {
      if (!suggestion) return;
      closeDetail();
      onAction?.(suggestion.suggestion_id, action);
    },
    [closeDetail, onAction]
  );

  const toggleMore = useCallback(() => setMoreOpen((open) => !open), []);

  const handleDisclosureKeyDown = (event, handler) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handler();
    }
  };

  if (!topSuggestion) return null;

  const renderSharedStrip = (suggestion) => {
    const sharedIds = [];
    (suggestion.overlap_sample ?? []).forEach((pair) => {
      const nodeId = pair.a_node_id ?? pair.b_node_id;
      if (nodeId != null && !sharedIds.includes(nodeId)) sharedIds.push(nodeId);
    });
    const shownIds = sharedIds.slice(0, 3);
    const remaining = Math.max(0, (suggestion.overlap_count ?? 0) - shownIds.length);
    if (shownIds.length === 0 && remaining === 0) return null;
    return (
      <Box
        data-testid="merge-detail-shared-strip"
        aria-label={t('fileManager.mergeSharedFiles')}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}
      >
        {shownIds.map((nodeId) => (
          <PreviewTile
            key={nodeId}
            item={{ node_id: nodeId }}
            thumbnailMap={thumbnailMap}
            testId={`merge-shared-${nodeId}`}
            iconFontSize={14}
            sx={{ width: 24, height: 24, borderRadius: 0.5, flexShrink: 0 }}
          />
        ))}
        {remaining > 0 ? (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="merge-shared-more"
            sx={{
              ml: 0.25,
              px: 0.5,
              py: 0.25,
              borderRadius: 0.5,
              bgcolor: 'action.hover',
              fontWeight: 600,
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
            }}
          >
            +{remaining}
          </Typography>
        ) : null}
      </Box>
    );
  };

  const renderDetail = (suggestion) => (
    <Paper
      id="merge-detail-panel"
      ref={panelRef}
      elevation={8}
      data-testid="merge-detail-panel"
      role="region"
      aria-label={questionFor(suggestion)}
      onMouseEnter={cancelScheduledClose}
      onMouseLeave={isMobile ? undefined : scheduleClose}
      sx={{
        width: { xs: 'calc(100vw - 16px)', sm: 'min(920px, calc(100vw - 48px))' },
        maxHeight: 'min(70vh, 520px)',
        overflowY: 'auto',
        p: { xs: 1, sm: 1.5 },
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Typography
          variant="subtitle1"
          component="h3"
          data-testid="merge-detail-title"
          sx={{ flex: 1, minWidth: 0, fontWeight: 600 }}
        >
          {questionFor(suggestion)}
        </Typography>
        <IconButton
          size="small"
          data-testid="merge-detail-close"
          aria-label={t('fileManager.mergeClose')}
          onClick={closeDetail}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box
        data-testid="merge-detail-tiles"
        sx={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: { xs: 1, sm: 2 },
          mt: 1.5,
          width: '100%',
        }}
      >
        <Box
          data-testid="merge-detail-preview-b"
          aria-label={t('fileManager.mergePreview', { name: suggestion.b_name })}
          sx={{
            flex: '1 1 0',
            minWidth: 0,
            maxWidth: 200,
            aspectRatio: '1 / 1',
            overflow: 'hidden',
            bgcolor: 'grey.100',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          <CollectionPreviewGrid
            items={suggestion.b_preview_items}
            thumbnailMap={thumbnailMap}
            testIdPrefix="merge-preview-b"
            emptyTestId="merge-preview-b-empty"
          />
        </Box>
        <Box
          data-testid="merge-detail-arrow"
          aria-hidden="true"
          sx={{ alignSelf: 'center', color: 'text.secondary', display: 'flex', flexShrink: 0 }}
        >
          <ArrowForwardIcon />
        </Box>
        <Box
          data-testid="merge-detail-preview-a"
          aria-label={t('fileManager.mergePreview', { name: suggestion.a_name })}
          sx={{
            flex: '1 1 0',
            minWidth: 0,
            maxWidth: 200,
            aspectRatio: '1 / 1',
            overflow: 'hidden',
            bgcolor: 'grey.100',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          <CollectionPreviewGrid
            items={suggestion.a_preview_items}
            thumbnailMap={thumbnailMap}
            testIdPrefix="merge-preview-a"
            emptyTestId="merge-preview-a-empty"
          />
        </Box>
      </Box>

      <Box
        data-testid="merge-detail-footer"
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: 'center',
          justifyContent: 'center',
          gap: { xs: 0.75, sm: 1 },
          mt: 1.5,
        }}
      >
        {renderSharedStrip(suggestion)}
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="merge-detail-reason"
          title={reasonFor(suggestion)}
          sx={{
            flex: '0 1 auto',
            minWidth: 0,
            maxWidth: '100%',
            alignSelf: { xs: 'stretch', sm: 'auto' },
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'center',
          }}
        >
          {reasonFor(suggestion)}
        </Typography>
      </Box>
    </Paper>
  );

  const renderSuggestionItem = (suggestion, index) => {
    const rowOpen = detail?.suggestionId === suggestion.suggestion_id;
    const isFirst = index === 0;
    const suggestionId = suggestion.suggestion_id;
    const bodyTestId = isFirst ? 'merge-card-body' : `merge-suggestion-row-${suggestionId}`;
    const actionsTestId = isFirst ? 'merge-card-actions' : `merge-row-actions-${suggestionId}`;
    const actionTestId = (action) =>
      isFirst ? `merge-${action}` : `merge-row-${action}-${suggestionId}`;
    const textTestId = isFirst ? 'merge-card-body-text' : `merge-row-text-${suggestionId}`;

    return (
      <Box
        key={suggestionId}
        data-testid={bodyTestId}
        data-merge-row={suggestionId}
        onMouseEnter={
          isMobile ? undefined : (event) => scheduleOpen(suggestion, event.currentTarget)
        }
        onMouseLeave={isMobile ? undefined : scheduleClose}
        onClick={(event) => {
          if (!isMobile || event.target.closest('button')) return;
          if (rowOpen) closeDetail();
          else openDetailNow(suggestion, event.currentTarget);
        }}
        sx={{
          px: 1.5,
          py: 1,
          borderTop: index > 0 ? 1 : 0,
          borderColor: 'divider',
          bgcolor: rowOpen ? 'action.hover' : 'transparent',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { xs: 'stretch', sm: 'center' },
            gap: 1,
          }}
        >
          <Box
            role="button"
            tabIndex={0}
            aria-label={t('fileManager.mergeDetailsAria')}
            aria-expanded={rowOpen}
            aria-controls="merge-detail-panel"
            data-testid={textTestId}
            onKeyDown={(event) =>
              handleDisclosureKeyDown(event, () => {
                if (rowOpen) closeDetail();
                else
                  openDetailNow(
                    suggestion,
                    event.currentTarget.closest('[data-merge-row]') ?? event.currentTarget
                  );
              })
            }
            sx={{
              flex: '1 1 auto',
              minWidth: 0,
              cursor: isMobile ? 'pointer' : 'default',
              ...focusRingSx,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                flexWrap: 'wrap',
                columnGap: 1,
                rowGap: 0.25,
              }}
            >
              <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
                {questionFor(suggestion)}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="span">
                · {countsFor(suggestion)}
              </Typography>
            </Box>
          </Box>
          <Box
            data-testid={actionsTestId}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              flexShrink: 0,
              flexWrap: 'wrap',
              justifyContent: { xs: 'flex-end', sm: 'flex-end' },
            }}
          >
            <Tooltip title={t('fileManager.mergeLater')}>
              <IconButton
                size="small"
                data-testid={actionTestId('later')}
                aria-label={t('fileManager.mergeLater')}
                onClick={(event) => {
                  event.stopPropagation();
                  dispatchAction(suggestion, 'later');
                }}
                sx={{ color: 'text.secondary' }}
              >
                <SnoozeIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('fileManager.mergeKeepSeparate')}>
              <IconButton
                size="small"
                data-testid={actionTestId('keep-separate')}
                aria-label={t('fileManager.mergeKeepSeparate')}
                onClick={(event) => {
                  event.stopPropagation();
                  dispatchAction(suggestion, 'keep-separate');
                }}
                sx={{ color: 'text.secondary' }}
              >
                <BlockIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('fileManager.mergeAccept')}>
              <IconButton
                size="small"
                color="primary"
                data-testid={actionTestId('accept')}
                aria-label={t('fileManager.mergeAccept')}
                onClick={(event) => {
                  event.stopPropagation();
                  dispatchAction(suggestion, 'merge');
                }}
              >
                <MergeTypeIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Box>
    );
  };

  const visibleSuggestions = moreOpen ? suggestions : [topSuggestion];

  return (
    <>
      <Card
        ref={cardRef}
        data-testid="merge-proposal-card"
        variant="outlined"
        onMouseLeave={isMobile ? undefined : scheduleClose}
        sx={{
          position: 'relative',
          zIndex: 1,
          minHeight: 68,
          borderRadius: 2,
          bgcolor: 'background.paper',
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 200px)' }}>
          <Box
            id="merge-suggestion-list"
            data-testid="merge-suggestion-list"
            sx={{
              flex: '1 1 auto',
              overflowY: moreOpen ? 'auto' : 'visible',
              maxHeight: moreOpen ? (isMobile ? '50vh' : '40vh') : undefined,
              // Keep the last row clear of the footer when scrolled to the end.
              pb: moreOpen ? 1 : 0,
            }}
          >
            {visibleSuggestions.map(renderSuggestionItem)}
          </Box>
          {remainingSuggestions.length > 0 ? (
            <Box
              role="button"
              tabIndex={0}
              aria-expanded={moreOpen}
              aria-controls="merge-suggestion-list"
              data-testid="merge-more-toggle"
              onClick={toggleMore}
              onKeyDown={(event) => handleDisclosureKeyDown(event, toggleMore)}
              sx={{
                py: 0.75,
                px: 1.5,
                textAlign: 'center',
                typography: 'caption',
                color: 'text.secondary',
                cursor: 'pointer',
                borderTop: 1,
                borderColor: 'divider',
                flexShrink: 0,
                ...focusRingSx,
              }}
            >
              {t('fileManager.mergeMore', { count: remainingSuggestions.length })}
            </Box>
          ) : null}
        </Box>
      </Card>
      {detailSuggestion && detail?.anchorEl ? (
        <Popper
          open
          role="presentation"
          anchorEl={detail.anchorEl}
          placement="bottom-start"
          modifiers={[
            { name: 'offset', options: { offset: [0, 8] } },
            {
              name: 'flip',
              enabled: true,
              options: {
                fallbackPlacements: ['top-start'],
                boundary: 'viewport',
                rootBoundary: 'viewport',
                padding: 8,
              },
            },
            {
              name: 'preventOverflow',
              enabled: true,
              options: {
                boundary: 'viewport',
                rootBoundary: 'viewport',
                altAxis: false,
                padding: 8,
                tether: false,
              },
            },
          ]}
          sx={{ zIndex: (theme) => theme.zIndex.modal - 1 }}
        >
          {renderDetail(detailSuggestion)}
        </Popper>
      ) : null}
    </>
  );
};

export default MergeProposalCard;
