/**
 * StorageCleanupSuggestions — cleanup/duplicate suggestions as checkbox rows with
 * the SINGLE `Accept selected (N)` control (Q4 contract, docs/spec/client/
 * components/mypage/content/StorageCleanupSuggestions.md). The checkbox IS the
 * selection confirmation; accept sends only the checked node ids. Dismiss is
 * per-row and renders for persisted rows carrying an `id` when the host passes
 * `onDismiss` (docs/spec/client/components/mypage/content/
 * StorageCleanupSuggestions.md §2.2/§2.7).
 */
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Checkbox,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Skeleton,
  Typography,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { formatFileSize } from '../../../utils/format';

const KEEPER_FACTORS = ['activity', 'quality', 'name', 'centrality'];

function basename(path) {
  const segments = String(path || '')
    .split('/')
    .filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : String(path || '');
}

function capitalize(value) {
  const text = String(value || '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function reasonLabelKey(kind) {
  const camel = String(kind)
    .split(/[_-]/)
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
  return `mypage.suggestionsReason.${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

const StorageCleanupSuggestions = ({ suggestions = [], onAccept, onDismiss, loading = false }) => {
  const { t } = useTranslation();
  const [checked, setChecked] = useState(() => new Set());
  const [expandedKeepers, setExpandedKeepers] = useState(() => new Set());

  const toggle = useCallback((nodeId, isOn) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (isOn) next.add(nodeId);
      else next.delete(nodeId);
      return next;
    });
  }, []);

  const toggleKeeperDetail = useCallback((nodeId) => {
    setExpandedKeepers((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const handleAccept = useCallback(async () => {
    const nodeIds = [...checked];
    if (nodeIds.length === 0) return;
    const payload = await onAccept?.(nodeIds);
    // absorbed failure keeps the selection for retry (no toast lies)
    if (payload) setChecked(new Set());
  }, [checked, onAccept]);

  if (loading) {
    return (
      <Box>
        {[0, 1, 2].map((index) => (
          <Skeleton
            key={index}
            variant="rectangular"
            height={56}
            sx={{ mb: 1 }}
            data-testid="suggestion-skeleton"
          />
        ))}
      </Box>
    );
  }

  if (suggestions.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('mypage.suggestionsEmpty')}
      </Typography>
    );
  }

  const hasExpiringRows = suggestions.some((row) => row.expires_at != null);

  return (
    <Box>
      <List dense disablePadding>
        {suggestions.map((row) => (
          <ListItem
            key={`${row.kind}:${row.node_id}`}
            disablePadding
            sx={{ pl: 0 }}
            secondaryAction={
              row.id != null && onDismiss ? (
                <IconButton
                  edge="end"
                  size="small"
                  data-testid={`suggestion-dismiss-${row.id}`}
                  aria-label={t('mypage.suggestionsDismiss')}
                  onClick={() => onDismiss(row.id)}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              ) : undefined
            }
          >
            <Checkbox
              inputProps={{ 'data-testid': 'suggestion-checkbox' }}
              checked={checked.has(row.node_id)}
              onChange={(event) => toggle(row.node_id, event.target.checked)}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <ListItemText
                primary={basename(row.path)}
                secondary={
                  <>
                    {t(reasonLabelKey(row.reason?.kind || row.kind))} ·{' '}
                    {formatFileSize(row.size_bytes)}
                    {row.path ? ` · ${row.path}` : ''}
                  </>
                }
              />
              {row.reason?.keep ? (
                <Box sx={{ pl: 1.5, pb: 0.5 }}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    data-testid={`keeper-label-${row.node_id}`}
                  >
                    {t('mypage.suggestionsKeep', {
                      name: row.reason.keep.name,
                      basis: t(`mypage.suggestionsKeepBasis.${capitalize(row.reason.keep.basis)}`),
                    })}
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    aria-expanded={expandedKeepers.has(row.node_id)}
                    aria-controls={`keeper-detail-${row.node_id}`}
                    onClick={() => toggleKeeperDetail(row.node_id)}
                    sx={{ textTransform: 'none', minWidth: 0, px: 0 }}
                  >
                    {t('mypage.suggestionsKeepWhy')}
                  </Button>
                  {expandedKeepers.has(row.node_id) ? (
                    <Box
                      id={`keeper-detail-${row.node_id}`}
                      data-testid={`keeper-detail-${row.node_id}`}
                      sx={{ py: 0.5 }}
                    >
                      <Typography variant="caption" display="block" color="text.secondary">
                        {t('mypage.suggestionsKeepScore', {
                          score: row.reason.keep.relative_score,
                        })}
                      </Typography>
                      <Typography variant="caption" display="block" color="text.secondary">
                        {t('mypage.suggestionsKeepFactorsLabel')}
                      </Typography>
                      {KEEPER_FACTORS.map((factor) => {
                        const value = Number(row.reason.keep.factors?.[factor]);
                        const ratio = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
                        return (
                          <Box
                            key={factor}
                            sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}
                          >
                            <Typography variant="caption" sx={{ minWidth: 96 }}>
                              {t(`mypage.suggestionsKeepFactor.${capitalize(factor)}`)}
                            </Typography>
                            <LinearProgress
                              variant="determinate"
                              value={ratio * 100}
                              data-testid={`keeper-factor-${factor}`}
                              sx={{ flex: 1, height: 6, borderRadius: 3 }}
                            />
                            <Typography variant="caption" color="text.secondary">
                              {Math.round(ratio * 100)}%
                            </Typography>
                          </Box>
                        );
                      })}
                    </Box>
                  ) : null}
                </Box>
              ) : null}
            </Box>
          </ListItem>
        ))}
      </List>
      {checked.size > 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
          <Button
            variant="contained"
            color="error"
            data-testid="suggestions-accept"
            onClick={handleAccept}
          >
            {t('mypage.suggestionsAccept', { count: checked.size })}
          </Button>
        </Box>
      ) : null}
      {hasExpiringRows ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {t('mypage.suggestionsExpiryNote')}
        </Typography>
      ) : null}
    </Box>
  );
};

export default StorageCleanupSuggestions;
