import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  TextField,
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Skeleton,
} from '@mui/material';
import { Add as AddIcon, Check as CheckIcon, AutoAwesome as SeedIcon } from '@mui/icons-material';
import { validateFileName } from '@webdav-easyaccess/shared/validation';
import { getValidationMessage } from '../../utils/validationMessage';
import { getFileIcon } from '../../utils/fileIconUtils';
import { previewCollection } from '../../services/collectionsRepository';

const SAMPLE_TILE_CAP = 12;

/**
 * AddToCollectionMenu — file-side collection entry points
 * (docs/spec/client/components/file-manager/AddToCollectionMenu.md):
 * `Add to collection` submenu (single + multi-select), inline New collection,
 * and the §4.5 seed confirm dialog (absent-not-disabled via seedItemVisible).
 * Mutations stay host callbacks; the only IO is the dry seed preview.
 */
const AddToCollectionMenu = ({
  open,
  targetNodes,
  collections,
  membershipIds = [],
  seedItemVisible = true,
  onAdd,
  onCreateAndAdd,
  onCreateSeed,
  onClose,
  anchorEl = null,
  contextMenu = null,
}) => {
  const { t } = useTranslation();
  const nodeIds = (targetNodes || []).map((node) => node.nodeId);
  const [creatingName, setCreatingName] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [seedDialogOpen, setSeedDialogOpen] = useState(false);

  const menuAnchor = anchorEl
    ? { anchorEl, anchorReference: 'anchorEl' }
    : {
        anchorReference: 'anchorPosition',
        anchorPosition: {
          top: contextMenu?.mouseY ?? 0,
          left: contextMenu?.mouseX ?? 0,
        },
      };

  const submitting = async (name) => {
    const invalid = validateFileName(name);
    if (invalid) {
      setCreateError(getValidationMessage(invalid, t));
      return;
    }
    setCreateError(null);
    setCreatingName(null);
    onClose?.();
    await onCreateAndAdd(name.trim(), nodeIds);
  };

  const startCreate = () => {
    setCreatingName('');
    setCreateError(null);
  };

  return (
    <>
      <Menu open={open && !seedDialogOpen} onClose={onClose} {...menuAnchor}>
        {(collections || []).map((collection) => {
          const checked = (membershipIds || []).includes(collection.collection_id);
          return (
            <MenuItem
              key={collection.collection_id}
              data-testid={`collection-option-${collection.collection_id}`}
              onClick={() => {
                onClose?.();
                onAdd(collection.collection_id, nodeIds);
              }}
            >
              <ListItemText
                primary={collection.name}
                secondary={
                  collection.item_count != null ? String(collection.item_count) : undefined
                }
              />
              {checked && (
                <ListItemIcon data-testid={`collection-checked-${collection.collection_id}`}>
                  <CheckIcon fontSize="small" />
                </ListItemIcon>
              )}
            </MenuItem>
          );
        })}
        <Divider />
        {creatingName === null ? (
          <MenuItem data-testid="new-collection-row" onClick={startCreate}>
            <ListItemIcon>
              <AddIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('fileManager.newCollectionInline')}</ListItemText>
          </MenuItem>
        ) : (
          <Box sx={{ px: 2, py: 1, minWidth: 240 }}>
            <TextField
              autoFocus
              inputProps={{ 'data-testid': 'new-collection-input' }}
              fullWidth
              size="small"
              value={creatingName}
              placeholder={t('fileManager.newCollectionInline')}
              onChange={(event) => setCreatingName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  submitting(creatingName);
                }
              }}
              error={Boolean(createError)}
            />
            {createError && (
              <Typography
                data-testid="new-collection-error"
                variant="caption"
                color="error"
                display="block"
              >
                {createError}
              </Typography>
            )}
          </Box>
        )}
        {seedItemVisible && (targetNodes || []).length === 1 && (
          <MenuItem
            data-testid="seed-create-row"
            onClick={() => {
              onClose?.();
              setSeedDialogOpen(true);
            }}
          >
            <ListItemIcon>
              <SeedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('fileManager.seedCreate')}</ListItemText>
          </MenuItem>
        )}
      </Menu>
      <SeedCollectionDialog
        open={seedDialogOpen}
        seedNode={(targetNodes || [])[0] || null}
        onClose={() => setSeedDialogOpen(false)}
        onCreateSeed={onCreateSeed}
      />
    </>
  );
};

/**
 * §4.5 seed confirm dialog: one dialog before any create; sample grid via
 * POST /collections/preview (the sole component IO), mandatory batch
 * publish-approval copy, Create gated on the preview resolving.
 */
const SeedCollectionDialog = ({ open, seedNode, onClose, onCreateSeed }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!open || !seedNode) return undefined;
    let cancelled = false;
    setName(t('dialogs.seedNameTemplate', { name: seedNode.name }));
    setPreview(null);
    setPreviewLoading(true);
    previewCollection({ seedNodeId: seedNode.nodeId })
      .then((payload) => {
        if (!cancelled) setPreview(payload);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, seedNode, t]);

  if (!open || !seedNode) return null;

  const sample = (preview?.sample || []).slice(0, SAMPLE_TILE_CAP);
  const moreCount =
    preview && typeof preview.count === 'number' ? Math.max(preview.count - sample.length, 0) : 0;
  const canCreate = Boolean(preview) && name.trim().length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { minHeight: 480 } }}
    >
      <DialogTitle data-testid="seed-dialog-title">{t('dialogs.seedDialogTitle')}</DialogTitle>
      <DialogContent data-testid="seed-dialog">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          {getFileIcon({ name: seedNode.name, basename: seedNode.name, type: 'file' })}
          <Typography variant="body1">{seedNode.name}</Typography>
        </Box>
        <TextField
          inputProps={{ 'data-testid': 'seed-name-input' }}
          label={t('dialogs.newName')}
          fullWidth
          size="small"
          value={name}
          onChange={(event) => setName(event.target.value)}
          sx={{ mb: 2 }}
        />
        {previewLoading && (
          <Skeleton data-testid="seed-sample-skeleton" variant="rectangular" height={160} />
        )}
        {!previewLoading && preview && (
          <>
            <Box
              data-testid="seed-sample-grid"
              sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}
            >
              {sample.map((item) => (
                <Box
                  key={item.node_id}
                  data-testid="seed-sample-tile"
                  sx={{
                    p: 1,
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.name}
                </Box>
              ))}
            </Box>
            {moreCount > 0 && (
              <Typography
                data-testid="seed-more-counter"
                variant="caption"
                color="text.secondary"
                display="block"
                sx={{ mt: 1 }}
              >
                {t('dialogs.seedMore', { count: moreCount })}
              </Typography>
            )}
            <Typography data-testid="seed-publish-notice" variant="body2" sx={{ mt: 2 }}>
              {t('dialogs.seedPublishNotice')}
            </Typography>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          data-testid="seed-create-confirm"
          variant="contained"
          disabled={!canCreate}
          onClick={() => {
            onCreateSeed({ name: name.trim(), seedNodeId: seedNode.nodeId });
            onClose();
          }}
        >
          {t('dialogs.seedCreateConfirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AddToCollectionMenu;
