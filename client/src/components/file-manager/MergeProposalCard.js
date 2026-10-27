/**
 * MergeProposalCard — the ONLY proposal UI in the product: one card atop the
 * collection list (never stacked), 68px collapsed one-liner with the
 * overlapping-member thumbnail strip that expands into a REAL two-column
 * compare overlay (≤300px, rendered over the list — the list never shifts).
 * `Merge` executes immediately: THE CARD IS THE CONFIRMATION (no dialog).
 * `+N more` cycles the pending set; the recommendation row is an advisory
 * prefill only (the user still presses Merge). IO-free pure view: thumbnails
 * arrive through the host `thumbnailMap`/`onRequestThumbnails` props, all
 * mutation intent rides the pair-id callbacks (MergeProposalCard.md §2.7).
 * @see docs/spec/client/components/file-manager/MergeProposalCard.md
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Card, CardContent, Chip, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { koObjectParticle, koWithParticle } from '../../utils/koParticleUtils';

// Collapsed grammar height (spec §2.3) and the overlay ceiling (spec §2.4).
const CARD_MIN_HEIGHT_PX = 68;
const OVERLAY_MAX_HEIGHT_PX = 300;
const STRIP_TILE_PX = 36;

const stripTileSx = {
  width: STRIP_TILE_PX,
  height: STRIP_TILE_PX,
  borderRadius: 1,
  objectFit: 'cover',
  flexShrink: 0,
};

const placeholderTileSx = {
  ...stripTileSx,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  bgcolor: 'action.hover',
  color: 'text.disabled',
};

const MergeProposalCard = ({
  suggestion,
  remainingCount = 0,
  onCycle,
  onMerge,
  onKeepSeparate,
  onLater,
  thumbnailMap = null,
  onRequestThumbnails,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const overlapIds = useMemo(
    () => (suggestion?.overlap_sample ?? []).map((pair) => pair.a_node_id),
    [suggestion]
  );

  // Strip-visible effect: ask the host to batch-load the displayed sample ids
  // (the card never performs IO itself). Re-issued when the displayed row
  // cycles to a different pair.
  const suggestedId = suggestion?.suggestion_id ?? null;
  useEffect(() => {
    if (overlapIds.length > 0 && typeof onRequestThumbnails === 'function') {
      onRequestThumbnails(overlapIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedId]);

  const toggleExpanded = useCallback(() => setExpanded((open) => !open), []);
  const collapse = useCallback(() => setExpanded(false), []);

  useEffect(() => {
    if (!expanded) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') collapse();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [expanded, collapse]);

  if (!suggestion) return null;

  const {
    a_id: survivorId,
    a_name: survivorName,
    b_id: absorbedId,
    b_name: absorbedName,
    overlap_count: overlapCount,
    merged_count: mergedCount,
    recommendation,
    a_unique_sample: aUniqueSample = [],
    b_unique_sample: bUniqueSample = [],
    overlap_sample: overlapSample = [],
  } = suggestion;

  // ko particle picker (i18n.md particle rule): en templates simply do not
  // interpolate these params.
  const question = t('fileManager.mergeQuestion', {
    absorbed: absorbedName,
    survivor: survivorName,
    pObj: koObjectParticle(absorbedName),
    pWith: koWithParticle(survivorName),
  });

  const thumbUrlOf = (nodeId) => {
    if (!thumbnailMap || typeof thumbnailMap.get !== 'function') return null;
    return thumbnailMap.get(nodeId) ?? thumbnailMap.get(Number(nodeId)) ?? null;
  };

  const renderTile = (pair) => {
    const url = thumbUrlOf(pair.a_node_id);
    if (url) {
      return (
        <Box
          component="img"
          key={`tile-${pair.a_node_id}`}
          data-testid={`merge-sample-tile-${pair.a_node_id}`}
          src={url}
          alt=""
          sx={stripTileSx}
        />
      );
    }
    // Zero fabrication: a sample without a loaded image stays a plain tile.
    return (
      <Box
        key={`tile-${pair.a_node_id}`}
        data-testid={`merge-sample-tile-${pair.a_node_id}`}
        sx={placeholderTileSx}
        aria-hidden="true"
      />
    );
  };

  const renderUniqueRows = (rows, side) =>
    rows.map((row) => (
      <Typography
        key={`unique-${side}-${row.node_id}`}
        variant="body2"
        data-testid={`merge-unique-${side}-${row.node_id}`}
        sx={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {row.name}
      </Typography>
    ));

  return (
    <Card
      variant="outlined"
      data-testid="merge-proposal-card"
      sx={{
        minHeight: `${CARD_MIN_HEIGHT_PX}px`,
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
        zIndex: (theme) => theme.zIndex.appBar,
      }}
    >
      <CardContent
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          width: '100%',
          py: 1,
          '&:last-child': { pb: 1 },
        }}
      >
        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="body2" noWrap component="span" sx={{ fontWeight: 600 }}>
              {question}
            </Typography>
            <Typography variant="caption" color="text.secondary" component="span">
              · {t('fileManager.mergeOverlapCount', { count: overlapCount })} ·{' '}
              {t('fileManager.mergeAfter', { count: mergedCount })}
            </Typography>
          </Box>
          {recommendation ? (
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="merge-recommendation"
              sx={{ display: 'block' }}
            >
              {t('fileManager.mergeRecommendation', {
                verdict: recommendation.verdict,
                reason: recommendation.reason ?? '',
              })}
            </Typography>
          ) : null}
        </Box>
        <Box
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label={question}
          data-testid="merge-strip"
          onClick={toggleExpanded}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              toggleExpanded();
            }
          }}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', flexShrink: 0 }}
        >
          {overlapSample.map(renderTile)}
        </Box>
        {remainingCount > 0 ? (
          <Chip
            size="small"
            variant="outlined"
            data-testid="merge-cycle-chip"
            label={t('fileManager.mergeMore', { count: remainingCount })}
            onClick={() => onCycle && onCycle()}
          />
        ) : null}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          <Button
            variant="contained"
            size="small"
            data-testid="merge-accept"
            onClick={() => onMerge(survivorId, absorbedId)}
          >
            {t('fileManager.mergeAccept')}
          </Button>
          <Button
            variant="outlined"
            size="small"
            data-testid="merge-keep-separate"
            onClick={() => onKeepSeparate(survivorId, absorbedId)}
          >
            {t('fileManager.mergeKeepSeparate')}
          </Button>
          <Button
            size="small"
            data-testid="merge-later"
            onClick={() => onLater(survivorId, absorbedId)}
          >
            {t('fileManager.mergeLater')}
          </Button>
        </Box>
      </CardContent>

      {expanded ? (
        <>
          <Box
            data-testid="merge-compare-backdrop"
            onClick={collapse}
            sx={{ position: 'fixed', inset: 0, zIndex: (theme) => theme.zIndex.modal - 1 }}
          />
          <Box
            data-testid="merge-compare-overlay"
            sx={{
              position: 'fixed',
              top: 96,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 'min(560px, calc(100vw - 32px))',
              maxHeight: `${OVERLAY_MAX_HEIGHT_PX}px`,
              overflow: 'auto',
              zIndex: (theme) => theme.zIndex.modal,
            }}
          >
            <Card variant="elevation" elevation={8}>
              <CardContent>
                <Box
                  sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Typography variant="subtitle2" data-testid="merge-compare-heading">
                    {t('fileManager.mergeQuestion', {
                      absorbed: absorbedName,
                      survivor: survivorName,
                      pObj: koObjectParticle(absorbedName),
                      pWith: koWithParticle(survivorName),
                    })}
                  </Typography>
                  <IconButton
                    size="small"
                    data-testid="merge-compare-close"
                    aria-label={t('fileManager.mergeClose')}
                    onClick={collapse}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {t('fileManager.mergeShared')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', my: 0.5 }}>
                  {overlapSample.map(renderTile)}
                </Box>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2" noWrap data-testid="merge-side-a">
                      {survivorName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('fileManager.mergeUnique', { name: survivorName })}
                    </Typography>
                    {renderUniqueRows(aUniqueSample, 'a')}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2" noWrap data-testid="merge-side-b">
                      {absorbedName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('fileManager.mergeUnique', { name: absorbedName })}
                    </Typography>
                    {renderUniqueRows(bUniqueSample, 'b')}
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Box>
        </>
      ) : null}
    </Card>
  );
};

export default MergeProposalCard;
