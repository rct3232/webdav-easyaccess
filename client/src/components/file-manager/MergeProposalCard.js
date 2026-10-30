/**
 * MergeProposalCard — the ONLY proposal UI in the product: one sticky card
 * between the collections toolbar and the list. The body presents the top
 * score-desc pending pair; a centered footer text expands the remaining pairs
 * in an accordion; desktop hover / mobile tap opens a NON-MODAL detail panel
 * with the real sample tiles (B absorbed → A survivor) and a
 * one-line reason. `Merge` executes immediately: THE CARD IS THE CONFIRMATION
 * (no dialog). IO-free pure view: thumbnails arrive through the host
 * `thumbnailMap`/`onRequestThumbnails` props, all mutation intent rides
 * `onAction(suggestionId, action)` (MergeProposalCard.md §2.8).
 * @see docs/spec/client/components/file-manager/MergeProposalCard.md
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Card, IconButton, Paper, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { useResponsive } from '../../hooks/useResponsive';
import { koObjectParticle, koWithParticle } from '../../utils/koParticleUtils';

const HOVER_OPEN_DELAY_MS = 200;
const HOVER_CLOSE_GRACE_MS = 300;
const UNIQUE_SAMPLE_CAP = 4;

function resolveDetailPlacement(anchorEl) {
  const rect = anchorEl?.getBoundingClientRect?.();
  if (!rect) return 'below';
  // Inline detail: keep it next to the hovered item, preferring below but
  // flipping above when the lower viewport half cannot fit it.
  return rect.bottom + 340 > window.innerHeight ? 'above' : 'below';
}

const detailTileSx = {
  width: '100%',
  maxWidth: { xs: 72, sm: 180 },
  height: 'auto',
  aspectRatio: '1 / 1',
  borderRadius: 2,
  objectFit: 'cover',
  display: 'block',
  bgcolor: 'action.hover',
};

const detailPlaceholderSx = {
  ...detailTileSx,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'text.disabled',
};

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
  const [detail, setDetail] = useState(null); // { suggestionId, anchorEl }
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
      if (!suggestion) return;
      clearOpenTimer();
      clearCloseTimer();
      setDetail({
        suggestionId: suggestion.suggestion_id,
        placement: resolveDetailPlacement(anchorEl),
      });
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
        setDetail({
          suggestionId: suggestion.suggestion_id,
          placement: resolveDetailPlacement(anchorEl),
        });
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

  const detailSampleIds = useMemo(() => {
    if (!detailSuggestion) return [];
    const ids = [];
    (detailSuggestion.a_unique_sample ?? []).forEach((row) => ids.push(row.node_id));
    (detailSuggestion.b_unique_sample ?? []).forEach((row) => ids.push(row.node_id));
    return [...new Set(ids.filter((id) => id != null))];
  }, [detailSuggestion]);

  useEffect(() => {
    if (detailSampleIds.length === 0 || typeof onRequestThumbnails !== 'function') return;
    onRequestThumbnails(detailSampleIds);
  }, [detailSampleIds, onRequestThumbnails]);

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

  const thumbUrlOf = useCallback(
    (nodeId) => {
      if (!thumbnailMap || typeof thumbnailMap.get !== 'function') return null;
      return thumbnailMap.get(nodeId) ?? thumbnailMap.get(Number(nodeId)) ?? null;
    },
    [thumbnailMap]
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

  const renderUniqueTile = (row, side) => {
    const url = thumbUrlOf(row.node_id);
    return (
      <Box
        key={`unique-${side}-${row.node_id}`}
        data-testid={`merge-unique-${side}-${row.node_id}`}
        sx={{ minWidth: 0 }}
      >
        {url ? (
          <Box component="img" src={url} alt="" sx={detailTileSx} />
        ) : (
          <Box sx={detailPlaceholderSx} aria-hidden="true">
            <InsertDriveFileOutlinedIcon fontSize="small" />
          </Box>
        )}
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          component="div"
          sx={{ mt: 0.25 }}
          title={row.name ?? ''}
        >
          {row.name}
        </Typography>
      </Box>
    );
  };

  if (!topSuggestion) return null;

  const renderDetail = (suggestion) => (
    <Paper
      id="merge-detail-panel"
      ref={panelRef}
      elevation={0}
      data-testid="merge-detail-panel"
      role="region"
      aria-label={questionFor(suggestion)}
      onMouseEnter={cancelScheduledClose}
      onMouseLeave={isMobile ? undefined : scheduleClose}
      sx={{
        mt: 1,
        mb: 1,
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
          alignItems: 'stretch',
          gap: { xs: 1, sm: 2 },
          mt: 1.5,
          width: '100%',
        }}
      >
        <Box
          data-testid="merge-detail-unique-b"
          aria-label={t('fileManager.mergeUnique', { name: suggestion.b_name })}
          sx={{
            flex: '1 1 0',
            minWidth: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 1,
            justifyItems: 'center',
            alignContent: 'flex-start',
          }}
        >
          {(suggestion.b_unique_sample ?? [])
            .slice(0, UNIQUE_SAMPLE_CAP)
            .map((row) => renderUniqueTile(row, 'b'))}
        </Box>
        <Box
          data-testid="merge-detail-arrow"
          aria-hidden="true"
          sx={{ alignSelf: 'center', color: 'text.secondary', display: 'flex', flexShrink: 0 }}
        >
          <ArrowForwardIcon />
        </Box>
        <Box
          data-testid="merge-detail-unique-a"
          aria-label={t('fileManager.mergeUnique', { name: suggestion.a_name })}
          sx={{
            flex: '1 1 0',
            minWidth: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 1,
            justifyItems: 'center',
            alignContent: 'flex-start',
          }}
        >
          {(suggestion.a_unique_sample ?? [])
            .slice(0, UNIQUE_SAMPLE_CAP)
            .map((row) => renderUniqueTile(row, 'a'))}
        </Box>
      </Box>

      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="merge-detail-reason"
        title={reasonFor(suggestion)}
        sx={{
          display: 'block',
          mt: 1.5,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'center',
        }}
      >
        {reasonFor(suggestion)}
      </Typography>
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
        {rowOpen && detail?.placement === 'above' ? renderDetail(suggestion) : null}
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
                else openDetailNow(suggestion, event.currentTarget);
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
            <Button
              variant="contained"
              size="small"
              data-testid={actionTestId('accept')}
              onClick={(event) => {
                event.stopPropagation();
                dispatchAction(suggestion, 'merge');
              }}
            >
              {t('fileManager.mergeAccept')}
            </Button>
            <Button
              variant="outlined"
              size="small"
              data-testid={actionTestId('keep-separate')}
              onClick={(event) => {
                event.stopPropagation();
                dispatchAction(suggestion, 'keep-separate');
              }}
            >
              {t('fileManager.mergeKeepSeparate')}
            </Button>
            <Button
              size="small"
              data-testid={actionTestId('later')}
              onClick={(event) => {
                event.stopPropagation();
                dispatchAction(suggestion, 'later');
              }}
            >
              {t('fileManager.mergeLater')}
            </Button>
          </Box>
        </Box>
        {rowOpen && detail?.placement === 'below' ? renderDetail(suggestion) : null}
      </Box>
    );
  };

  const visibleSuggestions = moreOpen ? suggestions : [topSuggestion];

  return (
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
            maxHeight: moreOpen ? '40vh' : undefined,
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
  );
};

export default MergeProposalCard;
