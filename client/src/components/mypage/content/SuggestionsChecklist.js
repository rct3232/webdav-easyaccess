/**
 * SuggestionsChecklist — cleanup/duplicate suggestions as checkbox rows with
 * the SINGLE `Accept selected (N)` control (Q4 contract, docs/spec/client/
 * components/mypage/content/SuggestionsChecklist.md). The checkbox IS the
 * selection confirmation; accept sends only the checked node ids. Dismiss is
 * per-row and renders ONLY for persisted rows carrying an `id` (P0 computed
 * exact-dup rows have none — §2.7 as-built note).
 */
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Checkbox,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Skeleton,
  Typography,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { formatFileSize } from '../../../utils/format';

function basename(path) {
  const segments = String(path || '')
    .split('/')
    .filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : String(path || '');
}

function reasonLabelKey(kind) {
  const camel = String(kind)
    .split(/[_-]/)
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
  return `mypage.suggestionsReason.${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

const SuggestionsChecklist = ({ suggestions = [], onAccept, onDismiss, loading = false }) => {
  const { t } = useTranslation();
  const [checked, setChecked] = useState(() => new Set());

  const toggle = useCallback((nodeId, isOn) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (isOn) next.add(nodeId);
      else next.delete(nodeId);
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

  const hasPersistedRows = suggestions.some((row) => row.id != null);

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
      {hasPersistedRows ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {t('mypage.suggestionsExpiryNote')}
        </Typography>
      ) : null}
    </Box>
  );
};

export default SuggestionsChecklist;
