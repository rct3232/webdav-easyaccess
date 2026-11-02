import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  IconButton,
  Button,
  Menu,
  MenuItem,
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
  Restore as RestoreIcon,
  DeleteForever as DeleteForeverIcon,
  DeleteSweep as DeleteSweepIcon,
  PlaylistAdd as PlaylistAddIcon,
  HighlightOff as HighlightOffIcon,
  PushPin as PushPinIcon,
  Archive as ArchiveIcon,
} from '@mui/icons-material';
import { VIEW_MODES, SORT_MODES, COLLECTION_SORT_OPTIONS } from '../../constants/fileManager';

const collectionSortLabelKey = (option) =>
  `fileManager.collectionsSort${option.charAt(0).toUpperCase()}${option.slice(1)}`;

const FileManagerControls = ({
  isMobile,
  selectionMode,
  handleSelectAll,
  handleDeselectAll,
  selectedFiles,
  sortMode,
  setSortMode,
  sortSurface = 'files',
  collectionSort,
  onCollectionSortChange,
  viewMode,
  setViewMode,
  selectionActionsDisabled = false,
  handleBulkMove,
  handleBulkCopy,
  handleBulkDownload,
  openBulkDeleteDialog,
  bulkWritePermission = true,
  hasReadOnlyInSelection = false,
  bulkActionsDisabled = false,
  downloadOnly = false,
  trashMode = false,
  handleBulkRestore,
  handleBulkPurge,
  onEmptyTrash,
  onBulkAddToCollection,
  onBulkMemberExclude,
  memberMode = false,
  sortHidden = false,
  viewModeHidden = false,
  collectionsMode = false,
  collectionsArchiveView = false,
  onCollectionsBulkAction,
}) => {
  const { t } = useTranslation();
  const [sortMenuAnchor, setSortMenuAnchor] = useState(null);

  const noSelection = selectedFiles.size === 0;
  const moveDeleteDisabled = bulkActionsDisabled || !bulkWritePermission || noSelection;
  const copyDisabled = bulkActionsDisabled || noSelection;
  const multiSelectedOnMobile = isMobile && selectedFiles.size > 1;
  const downloadDisabled = bulkActionsDisabled || noSelection || multiSelectedOnMobile;

  const showMobileReadOnlyBanner = isMobile && selectionMode && hasReadOnlyInSelection;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 2, py: 0, display: 'flex', gap: 2, alignItems: 'center' }}>
        {selectionMode ? (
          <>
            {isMobile ? (
              <>
                <IconButton
                  size="small"
                  onClick={handleSelectAll}
                  title={t('fileManager.selectAll')}
                  data-testid="bulk-action-select-all"
                  disabled={selectionActionsDisabled}
                >
                  <SelectAllIcon />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={handleDeselectAll}
                  title={t('fileManager.deselectAll')}
                  data-testid="bulk-action-deselect-all"
                  disabled={selectionActionsDisabled}
                >
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
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                {t('fileManager.readOnlyInSelection')}
              </Typography>
            )}

            <Box sx={{ flexGrow: 1 }} />

            {/* P-3 collections selection cluster: count-INDEPENDENT fixed set by
                surface (files philosophy). Active view: Pin · Unpin · Archive;
                archive view: Restore · Delete permanently. Bulk execution is
                shell-owned (loop of the single-collection calls); archive and
                permanent-delete route through the confirms hosted by
                CollectionsListView. */}
            {collectionsMode ? (
              <>
                {!collectionsArchiveView ? (
                  <>
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => onCollectionsBulkAction?.('pin')}
                      disabled={noSelection}
                      title={t('fileManager.cardMenuPin')}
                      data-testid="bulk-collections-pin"
                    >
                      <PushPinIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => onCollectionsBulkAction?.('unpin')}
                      disabled={noSelection}
                      title={t('fileManager.cardMenuUnpin')}
                      data-testid="bulk-collections-unpin"
                    >
                      <PushPinIcon fontSize="small" sx={{ transform: 'rotate(45deg)' }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => onCollectionsBulkAction?.('archive')}
                      disabled={noSelection}
                      title={t('fileManager.cardMenuArchive')}
                      data-testid="bulk-collections-archive"
                    >
                      <ArchiveIcon fontSize="small" />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => onCollectionsBulkAction?.('restore')}
                      disabled={noSelection}
                      title={t('fileManager.cardMenuRestore')}
                      data-testid="bulk-collections-restore"
                    >
                      <RestoreIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => onCollectionsBulkAction?.('delete-permanent')}
                      disabled={noSelection}
                      title={t('fileManager.cardMenuDelete')}
                      data-testid="bulk-collections-delete-permanent"
                    >
                      <DeleteForeverIcon fontSize="small" />
                    </IconButton>
                  </>
                )}
              </>
            ) : (
              <>
                {trashMode && handleBulkRestore && (
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={() => handleBulkRestore(Array.from(selectedFiles))}
                    disabled={moveDeleteDisabled}
                    title={t('actions.restore')}
                    data-testid="trash-bulk-restore"
                  >
                    <RestoreIcon fontSize="small" />
                  </IconButton>
                )}
                {trashMode && handleBulkPurge && (
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleBulkPurge(Array.from(selectedFiles))}
                    disabled={moveDeleteDisabled}
                    title={t('actions.purge')}
                    data-testid="trash-bulk-purge"
                  >
                    <DeleteForeverIcon fontSize="small" />
                  </IconButton>
                )}

                {memberMode && onBulkMemberExclude && (
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={() => onBulkMemberExclude(Array.from(selectedFiles))}
                    disabled={bulkActionsDisabled || noSelection}
                    title={t('fileManager.memberBatchExclude')}
                    data-testid="bulk-member-exclude"
                  >
                    <HighlightOffIcon fontSize="small" />
                  </IconButton>
                )}
                {!trashMode && !downloadOnly && onBulkAddToCollection && (
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={() => onBulkAddToCollection(Array.from(selectedFiles))}
                    disabled={bulkActionsDisabled || noSelection}
                    title={t(
                      memberMode ? 'fileManager.memberAddToOther' : 'fileManager.addToCollection'
                    )}
                    data-testid="bulk-collection-add"
                  >
                    <PlaylistAddIcon fontSize="small" />
                  </IconButton>
                )}

                {!memberMode && !trashMode && !downloadOnly && handleBulkMove && (
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={handleBulkMove}
                    disabled={moveDeleteDisabled}
                    title={t('actions.move')}
                    data-testid="bulk-action-move"
                  >
                    <MoveIcon fontSize="small" />
                  </IconButton>
                )}
                {!memberMode && !trashMode && !downloadOnly && handleBulkCopy && (
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={handleBulkCopy}
                    disabled={copyDisabled}
                    title={t('actions.copy')}
                    data-testid="bulk-action-copy"
                  >
                    <CopyIcon fontSize="small" />
                  </IconButton>
                )}
                {!memberMode && !trashMode && handleBulkDownload && (
                  <IconButton
                    size="small"
                    color="primary"
                    onClick={handleBulkDownload}
                    disabled={downloadDisabled}
                    title={t('actions.download')}
                    data-testid="bulk-action-download"
                  >
                    <DownloadIcon fontSize="small" />
                  </IconButton>
                )}
                {!memberMode && !trashMode && !downloadOnly && openBulkDeleteDialog && (
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
                    data-testid="bulk-action-delete"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                )}
              </>
            )}
          </>
        ) : (
          <>
            {!sortHidden && (
              <IconButton
                onClick={(e) => setSortMenuAnchor(e.currentTarget)}
                title={t('fileManager.sort')}
                data-testid="file-manager-sort"
              >
                <SortIcon />
              </IconButton>
            )}

            <Box sx={{ flexGrow: 1 }} />

            {/* P-3 toggle hiding: view-mode buttons are surface-inert for the
                collections list (grid-parity cards) and members (P-4 owns member
                view modes); the members surface also hides the sort button. */}
            {!viewModeHidden && (
              <Box sx={{ display: 'flex', gap: 1 }}>
                <IconButton
                  color={viewMode === VIEW_MODES.LIST ? 'primary' : 'default'}
                  onClick={() => {
                    setViewMode(VIEW_MODES.LIST);
                  }}
                  title={t('fileManager.listViewTitle')}
                  data-testid="view-mode-list"
                >
                  <ViewStreamIcon />
                </IconButton>
                <IconButton
                  color={viewMode === VIEW_MODES.GRID ? 'primary' : 'default'}
                  onClick={() => {
                    setViewMode(VIEW_MODES.GRID);
                  }}
                  title={t('fileManager.gridViewTitle')}
                  data-testid="view-mode-grid"
                >
                  <ViewModuleIcon />
                </IconButton>
                {!isMobile && (
                  <IconButton
                    color={viewMode === VIEW_MODES.DETAIL ? 'primary' : 'default'}
                    onClick={() => {
                      setViewMode(VIEW_MODES.DETAIL);
                    }}
                    title={t('fileManager.detailViewTitle')}
                    data-testid="view-mode-detail"
                  >
                    <ViewListIcon />
                  </IconButton>
                )}
                {onEmptyTrash && (
                  <IconButton
                    color="error"
                    onClick={onEmptyTrash}
                    title={t('actions.emptyTrash')}
                    aria-label={t('actions.emptyTrash')}
                    data-testid="trash-empty"
                    sx={{ minWidth: 44, minHeight: 44 }}
                  >
                    <DeleteSweepIcon />
                  </IconButton>
                )}
              </Box>
            )}
          </>
        )}

        {/* Sort Menu - only when !selectionMode; content swaps by surface (P-2):
            files → 4 radios (persisted client sortMode), collections → flat 5
            server options (no direction radios; ephemeral; server bakes ASC/DESC).
            P-3: never mounted while the sort button itself is hidden (members). */}
        {!selectionMode && !sortHidden && (
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
            {sortSurface === 'collections' ? (
              COLLECTION_SORT_OPTIONS.map((option) => (
                <MenuItem
                  key={option}
                  data-testid={`collections-sort-option-${option}`}
                  selected={option === collectionSort}
                  onClick={() => {
                    setSortMenuAnchor(null);
                    if (onCollectionSortChange) onCollectionSortChange(option);
                  }}
                >
                  {t(collectionSortLabelKey(option))}
                </MenuItem>
              ))
            ) : (
              <>
                <Box sx={{ px: 2, py: 1 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    {t('fileManager.sortByName')}
                  </Typography>
                  <RadioGroup
                    value={sortMode}
                    onChange={(e) => {
                      const newMode = e.target.value;
                      setSortMode(newMode);
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
              </>
            )}
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

export default React.memo(FileManagerControls);
