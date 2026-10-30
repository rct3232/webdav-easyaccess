/**
 * MergeProposalCard — the ONLY proposal UI in the product: one sticky card
 * between the collections toolbar and the list. The body presents the top
 * score-desc pending pair; a centered footer text expands the remaining pairs
 * in an accordion; desktop hover / mobile tap opens a NON-MODAL detail panel
 * with the real sample tiles (B absorbed → shared → A survivor) and a
 * one-line reason. `Merge` executes immediately: THE CARD IS THE CONFIRMATION
 * (no dialog). IO-free pure view: thumbnails arrive through the host
 * `thumbnailMap`/`onRequestThumbnails` props, all mutation intent rides
 * `onAction(suggestionId, action)` (MergeProposalCard.md §2.8).
 * @see docs/spec/client/components/file-manager/MergeProposalCard.md
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  Paper,
  Popper,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { useResponsive } from '../../hooks/useResponsive';
import { koObjectParticle, koWithParticle } from '../../utils/koParticleUtils';

const HOVER_OPEN_DELAY_MS = 200;
const HOVER_CLOSE_GRACE_MS = 300;
const OVERLAP_SAMPLE_CAP = 8;
const UNIQUE_SAMPLE_CAP = 4;

const detailTileSx = {
  width: { xs: 56, sm: 84 },
  height: { xs: 56, sm: 84 },
  borderRadius: 1.5,
  objectFit: 'cover',
  flexShrink: 0,
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
        anchorEl: anchorEl ?? cardRef.current,
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
          anchorEl: anchorEl ?? cardRef.current,
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
    (detailSuggestion.overlap_sample ?? []).forEach((pair) => ids.push(pair.a_node_id));
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

  const renderSharedTile = (pair) => {
    const url = thumbUrlOf(pair.a_node_id);
    if (url) {
      return (
        <Box
          component="img"
          key={`shared-${pair.a_node_id}`}
          data-testid={`merge-sample-tile-${pair.a_node_id}`}
          src={url}
          alt=""
          sx={detailTileSx}
        />
      );
    }
    // Zero fabrication: a sample without a loaded image stays a plain tile.
    return (
      <Box
        key={`shared-${pair.a_node_id}`}
        data-testid={`merge-sample-tile-${pair.a_node_id}`}
        sx={detailPlaceholderSx}
        aria-hidden="true"
      >
        <InsertDriveFileOutlinedIcon fontSize="small" />
      </Box>
    );
  };

  const renderUniqueTile = (row, side) => {
    const url = thumbUrlOf(row.node_id);
    return (
      <Box
        key={`unique-${side}-${row.node_id}`}
        data-testid={`merge-unique-${side}-${row.node_id}`}
        sx={{ width: { xs: 56, sm: 84 }, minWidth: 0, flexShrink: 0 }}
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

  const topQuestion = questionFor(topSuggestion);
  const topOpen = detail?.suggestionId === topSuggestion.suggestion_id;

  return (
    <>
      <Card
        ref={cardRef}
        variant="outlined"
        data-testid="merge-proposal-card"
        onMouseLeave={isMobile ? undefined : scheduleClose}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          bgcolor: 'background.paper',
        }}
      >
        <CardContent
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { xs: 'stretch', sm: 'center' },
            gap: 1.5,
            width: '100%',
            py: 1.25,
            '&:last-child': { pb: 1.25 },
          }}
        >
          <Box
            role="button"
            tabIndex={0}
            aria-label={t('fileManager.mergeDetailsAria')}
            aria-expanded={topOpen}
            aria-controls="merge-detail-panel"
            data-testid="merge-card-body"
            onMouseEnter={isMobile ? undefined : () => scheduleOpen(topSuggestion, cardRef.current)}
            onClick={() => {
              if (isMobile) openDetailNow(topSuggestion, cardRef.current);
            }}
            onKeyDown={(event) =>
              handleDisclosureKeyDown(event, () => openDetailNow(topSuggestion, cardRef.current))
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
                {topQuestion}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="span">
                · {countsFor(topSuggestion)}
              </Typography>
            </Box>
          </Box>
          <Box
            data-testid="merge-card-actions"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              flexShrink: 0,
              flexWrap: 'wrap',
              justifyContent: { xs: 'flex-start', sm: 'flex-end' },
            }}
          >
            <Button
              variant="contained"
              size="small"
              data-testid="merge-accept"
              onClick={() => dispatchAction(topSuggestion, 'merge')}
            >
              {t('fileManager.mergeAccept')}
            </Button>
            <Button
              variant="outlined"
              size="small"
              data-testid="merge-keep-separate"
              onClick={() => dispatchAction(topSuggestion, 'keep-separate')}
            >
              {t('fileManager.mergeKeepSeparate')}
            </Button>
            <Button
              size="small"
              data-testid="merge-later"
              onClick={() => dispatchAction(topSuggestion, 'later')}
            >
              {t('fileManager.mergeLater')}
            </Button>
          </Box>
        </CardContent>

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
              ...focusRingSx,
            }}
          >
            {t('fileManager.mergeMore', { count: remainingSuggestions.length })}
          </Box>
        ) : null}

        {remainingSuggestions.length > 0 && moreOpen ? (
          <Box
            id="merge-suggestion-list"
            data-testid="merge-suggestion-list"
            sx={{
              maxHeight: '40vh',
              overflowY: 'auto',
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            {remainingSuggestions.map((suggestion) => {
              const rowOpen = detail?.suggestionId === suggestion.suggestion_id;
              return (
                <Box
                  key={suggestion.suggestion_id}
                  role="button"
                  tabIndex={0}
                  aria-expanded={rowOpen}
                  aria-controls="merge-detail-panel"
                  data-testid={`merge-suggestion-row-${suggestion.suggestion_id}`}
                  onMouseEnter={
                    isMobile ? undefined : (event) => scheduleOpen(suggestion, event.currentTarget)
                  }
                  onMouseLeave={isMobile ? undefined : scheduleClose}
                  onClick={(event) => {
                    if (isMobile) openDetailNow(suggestion, event.currentTarget);
                  }}
                  onKeyDown={(event) =>
                    handleDisclosureKeyDown(event, () =>
                      openDetailNow(suggestion, event.currentTarget)
                    )
                  }
                  sx={{
                    px: 1.5,
                    py: 1,
                    borderTop: 1,
                    borderColor: 'divider',
                    cursor: isMobile ? 'pointer' : 'default',
                    bgcolor: rowOpen ? 'action.hover' : 'transparent',
                    ...focusRingSx,
                  }}
                >
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1, rowGap: 0.25 }}>
                    <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
                      {questionFor(suggestion)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="span">
                      · {countsFor(suggestion)}
                    </Typography>
                  </Box>
                </Box>
              );
            })}
          </Box>
        ) : null}
      </Card>

      {detailSuggestion ? (
        <Popper
          open
          role="presentation"
          anchorEl={detail?.anchorEl ?? cardRef.current}
          placement="bottom-start"
          modifiers={[
            { name: 'offset', options: { offset: [0, 8] } },
            {
              name: 'flip',
              enabled: true,
              options: { fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] },
            },
            {
              name: 'preventOverflow',
              enabled: true,
              options: { altAxis: true, padding: 8 },
            },
          ]}
          sx={{ zIndex: (theme) => theme.zIndex.modal - 1, maxWidth: '100vw' }}
        >
          <Paper
            id="merge-detail-panel"
            ref={panelRef}
            elevation={8}
            data-testid="merge-detail-panel"
            role="region"
            aria-label={questionFor(detailSuggestion)}
            onMouseEnter={cancelScheduledClose}
            onMouseLeave={isMobile ? undefined : scheduleClose}
            sx={{
              width: { xs: 'calc(100vw - 24px)', sm: 'min(880px, calc(100vw - 48px))' },
              maxHeight: '70vh',
              overflow: 'auto',
              p: 2,
              borderRadius: 2,
              border: 1,
              borderColor: 'divider',
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
                {questionFor(detailSuggestion)}
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

            {/* B (absorbed) unique tiles → shared tiles → A (survivor) unique
                tiles, left-to-right. Each group is aria-labelled; the visible
                detail keeps only the title (MergeProposalCard.md §2.5). */}
            <Box
              data-testid="merge-detail-tiles"
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: { xs: 1, sm: 2 },
                mt: 1.5,
                width: '100%',
              }}
            >
              <Box
                data-testid="merge-detail-unique-b"
                aria-label={t('fileManager.mergeUnique', { name: detailSuggestion.b_name })}
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 1,
                  flex: '0 1 auto',
                  maxWidth: '30%',
                  alignContent: 'flex-start',
                }}
              >
                {(detailSuggestion.b_unique_sample ?? [])
                  .slice(0, UNIQUE_SAMPLE_CAP)
                  .map((row) => renderUniqueTile(row, 'b'))}
              </Box>
              <Box
                data-testid="merge-detail-shared"
                aria-label={t('fileManager.mergeShared')}
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 1,
                  flex: '1 1 auto',
                  minWidth: 0,
                  justifyContent: 'center',
                  alignContent: 'flex-start',
                }}
              >
                {(detailSuggestion.overlap_sample ?? [])
                  .slice(0, OVERLAP_SAMPLE_CAP)
                  .map(renderSharedTile)}
              </Box>
              <Box
                data-testid="merge-detail-unique-a"
                aria-label={t('fileManager.mergeUnique', { name: detailSuggestion.a_name })}
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 1,
                  flex: '0 1 auto',
                  maxWidth: '30%',
                  alignContent: 'flex-start',
                  justifyContent: 'flex-end',
                }}
              >
                {(detailSuggestion.a_unique_sample ?? [])
                  .slice(0, UNIQUE_SAMPLE_CAP)
                  .map((row) => renderUniqueTile(row, 'a'))}
              </Box>
            </Box>

            <Box
              data-testid="merge-detail-actions"
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 0.5,
                flexWrap: 'wrap',
                mt: 1.5,
              }}
            >
              <Button
                variant="contained"
                size="small"
                data-testid="merge-detail-accept"
                onClick={() => dispatchAction(detailSuggestion, 'merge')}
              >
                {t('fileManager.mergeAccept')}
              </Button>
              <Button
                variant="outlined"
                size="small"
                data-testid="merge-detail-keep-separate"
                onClick={() => dispatchAction(detailSuggestion, 'keep-separate')}
              >
                {t('fileManager.mergeKeepSeparate')}
              </Button>
              <Button
                size="small"
                data-testid="merge-detail-later"
                onClick={() => dispatchAction(detailSuggestion, 'later')}
              >
                {t('fileManager.mergeLater')}
              </Button>
            </Box>

            <Typography
              variant="body2"
              color="text.secondary"
              data-testid="merge-detail-reason"
              title={reasonFor(detailSuggestion)}
              sx={{
                display: 'block',
                mt: 1.5,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textAlign: 'center',
              }}
            >
              {reasonFor(detailSuggestion)}
            </Typography>
          </Paper>
        </Popper>
      ) : null}
    </>
  );
};

export default MergeProposalCard;
