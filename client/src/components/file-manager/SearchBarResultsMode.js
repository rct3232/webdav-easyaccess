import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import {
  Close as CloseIcon,
  MoreVert as MoreVertIcon,
  Search as SearchIcon,
} from '@mui/icons-material';

import { applyHighlightRanges } from '../../utils/searchHighlight';

/**
 * Results-mode header + two-section rendering for server-wide search
 * (docs/spec/client/components/file-manager/SearchBarResultsMode.md).
 * Chrome only — no services/gateway imports; IO/state live in the host
 * (useSearchResults) and the shell wiring.
 *
 * Header grammar (§4.6): `🔍 "query" · N results [Save as collection][✕]` —
 * exactly ONE action button, hidden (absent, not gray) when the semantic
 * section is empty or unavailable. Empty sections render nothing (no header,
 * no "0 results" block); both empty ⇒ a single searchNoResults line + chips.
 */

function HighlightedName({ name, highlights }) {
  const segments = applyHighlightRanges(name ?? '', highlights ?? []);
  return (
    <>
      {segments.map((segment, index) =>
        segment.highlighted ? (
          <Box
            key={index}
            component="mark"
            data-testid="search-highlight-range"
            sx={{
              backgroundColor: 'secondary.light',
              color: 'inherit',
              borderRadius: 0.5,
              px: 0.25,
            }}
          >
            {segment.text}
          </Box>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        )
      )}
    </>
  );
}

const SearchBarResultsMode = ({
  query,
  counts,
  sections,
  canSaveToCollection,
  onSave,
  onExit,
  recentQueries = [],
  onChipSelect,
  onChipSave,
  onFilterChange,
  onRowOpen,
}) => {
  const { t } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuChip, setMenuChip] = useState(null);

  const nameMatches = Array.isArray(sections?.nameMatches) ? sections.nameMatches : [];
  const semantic = Array.isArray(sections?.semantic) ? sections.semantic : [];
  const hasResults = nameMatches.length > 0 || semantic.length > 0;

  const openChipMenu = (event, chip) => {
    setMenuAnchor(event.currentTarget);
    setMenuChip(chip);
  };

  const closeChipMenu = () => {
    setMenuAnchor(null);
    setMenuChip(null);
  };

  return (
    <Box data-testid="search-results-mode" sx={{ px: 1, py: 0.5 }}>
      {/* Header: 🔍 "query" · N results [Save as collection][✕] */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <SearchIcon color="primary" fontSize="small" />
        <Typography
          variant="subtitle1"
          sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {'"'}
          {query}
          {'"'}
        </Typography>
        <Typography
          data-testid="search-results-count"
          variant="subtitle2"
          color="text.secondary"
          sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          · {t('fileManager.searchResultsCount', { count: counts?.total ?? 0 })}
        </Typography>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {canSaveToCollection && (
            <Button
              data-testid="search-results-save"
              size="small"
              variant="outlined"
              onClick={onSave}
              sx={{ mr: 0.5, whiteSpace: 'nowrap' }}
            >
              {t('fileManager.searchSaveCollection')}
            </Button>
          )}
          <IconButton
            data-testid="search-results-exit"
            size="small"
            onClick={onExit}
            aria-label={t('fileManager.searchExit')}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      {/* Inline re-filter of the loaded results (uncontrolled affordance; the
          Enter re-submit stays in FloatingSearchBar — host wiring §3.2). */}
      <TextField
        size="small"
        fullWidth
        margin="dense"
        placeholder={t('fileManager.searchFilterPlaceholder')}
        inputProps={{ 'data-testid': 'search-results-filter' }}
        onChange={(event) => onFilterChange?.(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />

      {/* Chips row beneath the header; each chip ⋮ → re-search / save */}
      {recentQueries.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', py: 0.5 }}>
          {recentQueries.map((chip) => (
            <Chip
              key={chip.id}
              data-testid="search-chip"
              label={chip.query}
              size="small"
              onClick={() => onChipSelect?.(chip)}
              icon={<SearchIcon fontSize="small" />}
              deleteIcon={<MoreVertIcon data-testid="search-chip-menu" />}
              onDelete={(event) => openChipMenu(event, chip)}
            />
          ))}
        </Box>
      )}

      {/* Two-section result list (§4.6): name_matches first, semantic second;
          empty sections render nothing. */}
      {hasResults ? (
        <>
          {nameMatches.length > 0 && (
            <List data-testid="search-section-name" dense disablePadding>
              {nameMatches.map((row) => (
                <ListItem
                  key={row.node_id}
                  data-testid="search-result-row"
                  dense
                  button={Boolean(onRowOpen)}
                  onClick={onRowOpen ? () => onRowOpen(row) : undefined}
                >
                  <ListItemText
                    primary={<HighlightedName name={row.name} highlights={row.highlights} />}
                  />
                </ListItem>
              ))}
            </List>
          )}
          {semantic.length > 0 && (
            <List data-testid="search-section-semantic" dense disablePadding>
              {semantic.map((row) => (
                <ListItem
                  key={row.node_id}
                  data-testid="search-semantic-row"
                  dense
                  button={Boolean(onRowOpen)}
                  onClick={onRowOpen ? () => onRowOpen(row) : undefined}
                >
                  {/* Semantic rows are score-free plain names (§4.6) */}
                  <ListItemText primary={row.name} />
                </ListItem>
              ))}
            </List>
          )}
        </>
      ) : (
        <Typography
          data-testid="search-no-results"
          variant="body2"
          color="text.secondary"
          sx={{ py: 1 }}
        >
          {t('fileManager.searchNoResults')}
        </Typography>
      )}

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeChipMenu}>
        <MenuItem
          data-testid="search-chip-research"
          onClick={() => {
            closeChipMenu();
            onChipSelect?.(menuChip);
          }}
        >
          {t('fileManager.searchChipResearch')}
        </MenuItem>
        <MenuItem
          data-testid="search-chip-save"
          onClick={() => {
            closeChipMenu();
            onChipSave?.(menuChip);
          }}
        >
          {t('fileManager.searchSaveCollection')}
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default SearchBarResultsMode;
