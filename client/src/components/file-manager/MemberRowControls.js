import React from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, MenuItem, ListItemIcon, ListItemText, Chip, Divider } from '@mui/material';
import {
  Block as ExcludeIcon,
  Public as PublishIcon,
  VisibilityOff as UnpublishIcon,
  Download as DownloadIcon,
  MyLocation as ShowOriginalIcon,
  Info as InfoIcon,
  Favorite as LikedIcon,
  FavoriteBorder as LikeIcon,
  PlaylistAdd as AddToOtherIcon,
} from '@mui/icons-material';

/**
 * MemberRowControls — the §3.2 exact control set for collection MEMBER rows
 * (docs/spec/client/components/file-manager/MemberRowControls.md). A
 * collection is a view, not a workspace: move/copy/rename/delete of the FILE
 * node are DELIBERATELY ABSENT here (invariant 1, grep-able spec invariant).
 * Single-row (`member`) and multi-select bulk (`selectedRows`) variants share
 * one component; revoked rows render nothing except dismiss (§3.2 — no
 * name/thumbnail exposure). All effects ride host callbacks.
 */
const MemberRowControls = ({
  open,
  member,
  selectedRows,
  collection,
  onExclude,
  onPublish,
  onDownload,
  onShowOriginal,
  onProperties,
  onToggleLike,
  onAddToOther,
  onClose,
  anchorEl = null,
  contextMenu = null,
}) => {
  const { t } = useTranslation();

  const menuAnchor = anchorEl
    ? { anchorEl, anchorReference: 'anchorEl' }
    : {
        anchorReference: 'anchorPosition',
        anchorPosition: {
          top: contextMenu?.mouseY ?? 0,
          left: contextMenu?.mouseX ?? 0,
        },
      };

  const handle = (callback, payload) => () => {
    onClose?.();
    if (callback) callback(payload);
  };

  const isBulk = selectedRows !== undefined && selectedRows !== null;
  const rows = isBulk ? selectedRows : [member];
  const target = isBulk ? selectedRows : member;

  // Single-row instance not yet opened (shell-owned single instance renders
  // closed with no member): nothing to show, no member field reads.
  if (!isBulk && member == null) {
    return null;
  }

  // Revoked rows: gray placeholder only — the menu offers nothing but dismiss
  // (§3.2: no name/thumbnail exposure after revocation).
  if (!isBulk && member && member.state === 'revoked') {
    return <Menu open={open} onClose={onClose} {...menuAnchor} />;
  }

  // Bulk: revoked/foreign rows ride along untouched — eligible ids are
  // filtered server-side (MemberRowControls.md §2.8, no client pre-filter).
  const publishable =
    collection &&
    collection.publish_mode !== 'auto' &&
    ['owner', 'editor'].includes(collection.granted_role) &&
    !(target && target.shared_excluded);
  const allPublished = isBulk && rows.every((row) => row.published);

  const items = [];
  if (isBulk) {
    if (onExclude && rows.length > 0) {
      items.push(
        <MenuItem
          key="batch-exclude"
          data-testid="member-batch-exclude"
          onClick={handle(onExclude, rows)}
        >
          <ListItemIcon>
            <ExcludeIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('fileManager.memberBatchExclude')}</ListItemText>
        </MenuItem>
      );
    }
    if (onPublish && publishable) {
      items.push(
        <MenuItem
          key="batch-publish"
          data-testid="member-batch-publish"
          onClick={handle(onPublish, rows)}
        >
          <ListItemIcon>
            {allPublished ? <UnpublishIcon fontSize="small" /> : <PublishIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>
            {t(allPublished ? 'fileManager.memberUnpublish' : 'fileManager.memberBatchPublish')}
          </ListItemText>
        </MenuItem>
      );
    }
    if (onAddToOther) {
      items.push(
        <MenuItem
          key="add-to-other"
          data-testid="member-add-to-other"
          onClick={handle(onAddToOther, rows)}
        >
          <ListItemIcon>
            <AddToOtherIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('fileManager.memberAddToOther')}</ListItemText>
        </MenuItem>
      );
    }
  } else {
    if (onExclude) {
      items.push(
        <MenuItem key="exclude" data-testid="member-exclude" onClick={handle(onExclude, member)}>
          <ListItemIcon>
            <ExcludeIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('fileManager.memberExclude')}</ListItemText>
        </MenuItem>
      );
    }
    if (onPublish && publishable) {
      items.push(
        <MenuItem key="publish" data-testid="member-publish" onClick={handle(onPublish, member)}>
          <ListItemIcon>
            {member.published ? (
              <UnpublishIcon fontSize="small" />
            ) : (
              <PublishIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText>
            {t(member.published ? 'fileManager.memberUnpublish' : 'fileManager.memberPublish')}
          </ListItemText>
        </MenuItem>
      );
    }
    if (onDownload) {
      items.push(
        <MenuItem key="download" data-testid="member-download" onClick={handle(onDownload, member)}>
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('fileManager.memberDownload')}</ListItemText>
        </MenuItem>
      );
    }
    if (onShowOriginal) {
      items.push(
        <MenuItem
          key="show-original"
          data-testid="member-show-original"
          onClick={handle(onShowOriginal, member)}
        >
          <ListItemIcon>
            <ShowOriginalIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('fileManager.memberShowOriginal')}</ListItemText>
        </MenuItem>
      );
    }
    if (onProperties) {
      items.push(
        <MenuItem
          key="properties"
          data-testid="member-properties"
          onClick={handle(onProperties, member)}
        >
          <ListItemIcon>
            <InfoIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('fileManager.memberProperties')}</ListItemText>
        </MenuItem>
      );
    }
    if (onToggleLike) {
      items.push(
        <MenuItem key="like" data-testid="like-toggle" onClick={handle(onToggleLike, member)}>
          <ListItemIcon>
            {member.liked ? (
              <LikedIcon fontSize="small" color="error" />
            ) : (
              <LikeIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText>
            {t(member.liked ? 'fileManager.memberUnlike' : 'fileManager.memberLike')}
          </ListItemText>
        </MenuItem>
      );
    }
  }

  const showNotSharedChip = !isBulk && member && member.shared_excluded;

  return (
    <Menu open={open} onClose={onClose} {...menuAnchor}>
      {showNotSharedChip && (
        <>
          <Chip
            data-testid="member-not-shared-chip"
            label={t('fileManager.memberNotShared')}
            size="small"
            color="default"
            sx={{ mx: 1.5, my: 0.5 }}
          />
          <Divider />
        </>
      )}
      {items}
    </Menu>
  );
};

export default MemberRowControls;
