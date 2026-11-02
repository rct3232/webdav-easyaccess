import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import { pixelMiddleTruncate } from '../../utils/stringUtils';

const SAMPLE_TILE_CAP = 12;

// M-6 middle-truncation budget, mirrored from the seed dialog tiles (the
// dialog shares the seed idiom's `maxWidth="md"` paper and 4-column grid).
const TILE_NAME_BUDGET_PX = 190;
const TILE_NAME_FONT = '14px Inter, Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * SearchSaveDialog — the §2.6 save confirm dialog (the dialog IS the batch
 * approval, collectionsService.md §2.7): member preview (count + the
 * semantic rows' names) plus the batch-publish copy, mirroring the seed
 * dialog idiom. Pure presentation — the create fires through the host's
 * `onConfirm` (the hook's `saveFromResults`, useSearchResults.md §2.3).
 *
 * @param {boolean} open
 * @param {string} term — the committed query term (§4.10 name material)
 * @param {Array<{node_id: number, name: string|null}>} rows — Zone C rows
 * @param {Function} onClose
 * @param {Function} onConfirm
 */
const SearchSaveDialog = ({ open, term, rows, onClose, onConfirm }) => {
  const { t } = useTranslation();

  if (!open) return null;

  const totalCount = (rows || []).length;
  const sample = (rows || []).slice(0, SAMPLE_TILE_CAP);
  const moreCount = Math.max(totalCount - sample.length, 0);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle data-testid="search-save-dialog-title">
        {t('dialogs.searchSaveTitle')}
      </DialogTitle>
      <DialogContent data-testid="search-save-dialog">
        {term && (
          <Typography variant="body1" sx={{ mb: 2 }}>
            {term}
          </Typography>
        )}
        <Typography
          data-testid="search-save-member-count"
          variant="body2"
          color="text.secondary"
          sx={{ mb: 1 }}
        >
          {t('dialogs.searchSaveMemberCount', { count: totalCount })}
        </Typography>
        <Box
          data-testid="search-save-sample-grid"
          sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}
        >
          {sample.map((item) => (
            <Box
              key={item.node_id}
              data-testid="search-save-sample-tile"
              sx={{
                p: 1,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                whiteSpace: 'nowrap',
              }}
            >
              {pixelMiddleTruncate(item.name ?? '', TILE_NAME_BUDGET_PX, TILE_NAME_FONT)}
            </Box>
          ))}
        </Box>
        {moreCount > 0 && (
          <Typography
            data-testid="search-save-more-counter"
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ mt: 1 }}
          >
            {t('dialogs.seedMore', { count: moreCount })}
          </Typography>
        )}
        <Typography data-testid="search-save-publish-notice" variant="body2" sx={{ mt: 2 }}>
          {t('dialogs.seedPublishNotice')}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button data-testid="search-save-confirm" variant="contained" onClick={onConfirm}>
          {t('dialogs.searchSaveConfirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SearchSaveDialog;
