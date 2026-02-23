import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  IconButton,
  Button,
  Menu,
  Radio,
  RadioGroup,
  FormControlLabel,
  Divider,
  Typography,
} from '@mui/material';
import {
  Sort as SortIcon,
  SelectAll as SelectAllIcon,
  Deselect as DeselectIcon,
  ViewList as ViewListIcon,
  ViewModule as ViewModuleIcon,
  ViewStream as ViewStreamIcon,
  DriveFileMove as MoveIcon,
  ContentCopy as CopyIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { VIEW_MODES, SORT_MODES } from '../../constants/fileManager';

const FileManagerControls = ({
  isMobile,
  selectionMode,
  handleSelectAll,
  handleDeselectAll,
  selectedFiles,
  setSortMenuAnchor,
  sortMenuAnchor,
  sortMode,
  setSortMode,
  saveSortMode,
  setViewModeMenuAnchor,
  viewModeMenuAnchor,
  viewMode,
  setViewMode,
  saveViewMode,
  selectionActionsDisabled = false,
  handleBulkMove,
  handleBulkCopy,
  handleBulkDownload,
  openBulkDeleteDialog,
  bulkWritePermission = true,
  hasReadOnlyInSelection = false,
  bulkActionsDisabled = false,
  downloadOnly = false,
}) => {
  const { t } = useTranslation();

  const noSelection = selectedFiles.size === 0;
  const moveDeleteDisabled = bulkActionsDisabled || !bulkWritePermission || noSelection;
  const copyDisabled = bulkActionsDisabled || noSelection;
  const downloadDisabled = bulkActionsDisabled || noSelection;

  const showMobileReadOnlyBanner = isMobile && selectionMode && hasReadOnlyInSelection;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 2, py: 0, display: 'flex', gap: 2, alignItems: 'center' }}>
        {selectionMode ? (
          <>
            {isMobile ? (
              <>
                <IconButton size="small" onClick={handleSelectAll} title={t('fileManager.selectAll')} disabled={selectionActionsDisabled}>
                  <SelectAllIcon />
                </IconButton>
                <IconButton size="small" onClick={handleDeselectAll} title={t('fileManager.deselectAll')} disabled={selectionActionsDisabled}>
                  <DeselectIcon />
                </IconButton>
              </>
            ) : (
            <>
              <Button
                size="small"
                startIcon={<SelectAllIcon />}
                onClick={handleSelectAll}
                disabled={selectionActionsDisabled}
              >
                {t('fileManager.selectAll')}
              </Button>
              <Button
                size="small"
                startIcon={<DeselectIcon />}
                onClick={handleDeselectAll}
                disabled={selectionActionsDisabled}
              >
                {t('fileManager.deselectAll')}
              </Button>
              <Typography variant="body2" sx={{ ml: 1 }}>
                {t('fileManager.selectedCountFull', { count: selectedFiles.size })}
              </Typography>
            </>
          )}

          {!isMobile && hasReadOnlyInSelection && (
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', fontSize: '0.75rem' }}
            >
              {t('fileManager.readOnlyInSelection')}
            </Typography>
          )}

          <Box sx={{ flexGrow: 1 }} />

          {!downloadOnly && handleBulkMove && (
            <IconButton
              size="small"
              color="primary"
              onClick={handleBulkMove}
              disabled={moveDeleteDisabled}
              title={t('actions.move')}
            >
              <MoveIcon fontSize="small" />
            </IconButton>
          )}
          {!downloadOnly && handleBulkCopy && (
            <IconButton
              size="small"
              color="primary"
              onClick={handleBulkCopy}
              disabled={copyDisabled}
              title={t('actions.copy')}
            >
              <CopyIcon fontSize="small" />
            </IconButton>
          )}
          {handleBulkDownload && (
            <IconButton
              size="small"
              color="primary"
              onClick={handleBulkDownload}
              disabled={downloadDisabled}
              title={t('actions.download')}
            >
              <DownloadIcon fontSize="small" />
            </IconButton>
          )}
          {!downloadOnly && openBulkDeleteDialog && (
            <IconButton
              size="small"
              color="error"
              onClick={() => {
                const filePaths = Array.from(selectedFiles);
                if (filePaths.length > 0) {
                  openBulkDeleteDialog(filePaths);
                }
              }}
              disabled={moveDeleteDisabled}
              title={t('actions.delete')}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
        </>
      ) : (
        <>
          <IconButton
            onClick={(e) => setSortMenuAnchor(e.currentTarget)}
            title={t('fileManager.sort')}
          >
            <SortIcon />
          </IconButton>

          <Box sx={{ flexGrow: 1 }} />

          <Box sx={{ display: 'flex', gap: 1 }}>
            <IconButton
              color={viewMode === VIEW_MODES.LIST ? 'primary' : 'default'}
              onClick={() => {
                setViewMode(VIEW_MODES.LIST);
                if (saveViewMode) saveViewMode(VIEW_MODES.LIST);
              }}
              title={t('fileManager.listViewTitle')}
            >
              <ViewStreamIcon />
            </IconButton>
            <IconButton
              color={viewMode === VIEW_MODES.GRID ? 'primary' : 'default'}
              onClick={() => {
                setViewMode(VIEW_MODES.GRID);
                if (saveViewMode) saveViewMode(VIEW_MODES.GRID);
              }}
              title={t('fileManager.gridViewTitle')}
            >
              <ViewModuleIcon />
            </IconButton>
            {!isMobile && (
              <IconButton
                color={viewMode === VIEW_MODES.DETAIL ? 'primary' : 'default'}
                onClick={() => {
                  setViewMode(VIEW_MODES.DETAIL);
                  if (saveViewMode) saveViewMode(VIEW_MODES.DETAIL);
                }}
                title={t('fileManager.detailViewTitle')}
              >
                <ViewListIcon />
              </IconButton>
            )}
          </Box>
        </>
      )}

      {/* Sort Menu - only when !selectionMode */}
      {!selectionMode && (
        <Menu
          anchorEl={sortMenuAnchor}
          open={Boolean(sortMenuAnchor)}
          onClose={() => setSortMenuAnchor(null)}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'left',
          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'left',
          }}
        >
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
              {t('fileManager.sortByName')}
            </Typography>
            <RadioGroup
              value={sortMode}
              onChange={(e) => {
                const newMode = e.target.value;
                setSortMode(newMode);
                if (saveSortMode) saveSortMode(newMode);
                setSortMenuAnchor(null);
              }}
            >
              <FormControlLabel
                value={SORT_MODES.NAME_ASC}
                control={<Radio size="small" />}
                label={t('fileManager.asc')}
              />
              <FormControlLabel
                value={SORT_MODES.NAME_DESC}
                control={<Radio size="small" />}
                label={t('fileManager.desc')}
              />
            </RadioGroup>
          </Box>
          <Divider />
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
              {t('fileManager.sortByDate')}
            </Typography>
            <RadioGroup
              value={sortMode}
              onChange={(e) => {
                const newMode = e.target.value;
                setSortMode(newMode);
                if (saveSortMode) saveSortMode(newMode);
                setSortMenuAnchor(null);
              }}
            >
              <FormControlLabel
                value={SORT_MODES.DATE_ASC}
                control={<Radio size="small" />}
                label={t('fileManager.asc')}
              />
              <FormControlLabel
                value={SORT_MODES.DATE_DESC}
                control={<Radio size="small" />}
                label={t('fileManager.desc')}
              />
            </RadioGroup>
          </Box>
        </Menu>
      )}
      </Box>

      {showMobileReadOnlyBanner && (
        <Box
          sx={{
            px: 2,
            py: 0.5,
            bgcolor: 'action.hover',
            fontSize: '0.75rem',
            color: 'text.secondary',
          }}
        >
          {t('fileManager.readOnlyInSelection')}
        </Box>
      )}
    </Box>
  );
};

export default FileManagerControls;
