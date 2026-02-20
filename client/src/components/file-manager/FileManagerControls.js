import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  IconButton,
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Radio,
  RadioGroup,
  FormControlLabel,
  Divider,
  Typography,
} from '@mui/material';
import {
  Sort as SortIcon,
  CheckBox as CheckBoxIcon,
  CheckBoxOutlineBlank as CheckBoxOutlineBlankIcon,
  SelectAll as SelectAllIcon,
  Deselect as DeselectIcon,
  ViewList as ViewListIcon,
  ViewModule as ViewModuleIcon,
  ViewStream as ViewStreamIcon,
} from '@mui/icons-material';
import { VIEW_MODES, SORT_MODES } from '../../constants/fileManager';

const FileManagerControls = ({
  isMobile,
  selectionMode,
  handleToggleSelectionMode,
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
}) => {
  const { t } = useTranslation();
  return (
    <Box sx={{ px: 2, py: 0, display: 'flex', gap: 2, alignItems: 'center' }}>
      <IconButton
        onClick={(e) => setSortMenuAnchor(e.currentTarget)}
        title={t('fileManager.sort')}
      >
        <SortIcon />
      </IconButton>

      <IconButton
        color={selectionMode ? 'primary' : 'default'}
        onClick={handleToggleSelectionMode}
        disabled={selectionActionsDisabled}
        title={selectionMode ? t('fileManager.selectionMode') : t('fileManager.select')}
        sx={{
          backgroundColor: selectionMode ? 'primary.main' : 'transparent',
          color: selectionMode ? 'primary.contrastText' : 'inherit',
          '&:hover': {
            backgroundColor: selectionMode ? 'primary.dark' : 'action.hover',
          },
        }}
      >
        {selectionMode ? <CheckBoxIcon /> : <CheckBoxOutlineBlankIcon />}
      </IconButton>

      {selectionMode && (
        <>
          {isMobile ? (
            <>
              <IconButton size="small" onClick={handleSelectAll} title={t('fileManager.selectAll')} disabled={selectionActionsDisabled}>
                <SelectAllIcon />
              </IconButton>
              <IconButton size="small" onClick={handleDeselectAll} title={t('fileManager.deselectAll')} disabled={selectionActionsDisabled}>
                <DeselectIcon />
              </IconButton>
              <Typography variant="caption" sx={{ ml: 1, fontSize: '0.75rem' }}>
                {t('fileManager.selectedCount', { count: selectedFiles.size })}
              </Typography>
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
        </>
      )}

      <Box sx={{ flexGrow: 1 }} />

      {/* Sort Menu */}
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

      {/* 보기 모드 버튼 */}
      {selectionMode ? (
        <>
          <IconButton
            onClick={(e) => setViewModeMenuAnchor(e.currentTarget)}
            title={t('fileManager.viewMode')}
          >
            {viewMode === VIEW_MODES.LIST && <ViewStreamIcon />}
            {viewMode === VIEW_MODES.GRID && <ViewModuleIcon />}
            {viewMode === VIEW_MODES.DETAIL && <ViewListIcon />}
          </IconButton>
          <Menu
            anchorEl={viewModeMenuAnchor}
            open={Boolean(viewModeMenuAnchor)}
            onClose={() => setViewModeMenuAnchor(null)}
            anchorOrigin={{
              vertical: 'bottom',
              horizontal: 'right',
            }}
            transformOrigin={{
              vertical: 'top',
              horizontal: 'right',
            }}
          >
            <MenuItem
              onClick={() => {
                setViewMode(VIEW_MODES.LIST);
                if (saveViewMode) saveViewMode(VIEW_MODES.LIST);
                setViewModeMenuAnchor(null);
              }}
              selected={viewMode === VIEW_MODES.LIST}
            >
              <ListItemIcon>
                <ViewStreamIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t('fileManager.listView')}</ListItemText>
            </MenuItem>
            <MenuItem
              onClick={() => {
                setViewMode(VIEW_MODES.GRID);
                if (saveViewMode) saveViewMode(VIEW_MODES.GRID);
                setViewModeMenuAnchor(null);
              }}
              selected={viewMode === VIEW_MODES.GRID}
            >
              <ListItemIcon>
                <ViewModuleIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t('fileManager.gridView')}</ListItemText>
            </MenuItem>
            {!isMobile && (
              <MenuItem
                onClick={() => {
                  setViewMode(VIEW_MODES.DETAIL);
                  if (saveViewMode) saveViewMode(VIEW_MODES.DETAIL);
                  setViewModeMenuAnchor(null);
                }}
                selected={viewMode === VIEW_MODES.DETAIL}
              >
                <ListItemIcon>
                  <ViewListIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('fileManager.detailView')}</ListItemText>
              </MenuItem>
            )}
          </Menu>
        </>
      ) : (
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
      )}
    </Box>
  );
};

export default FileManagerControls;
