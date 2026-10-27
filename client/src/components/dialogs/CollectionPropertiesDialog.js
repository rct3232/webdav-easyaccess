/**
 * CollectionPropertiesDialog — collection properties on the FilePropertiesDialog
 * tab-bar idiom (docs/spec/client/components/dialogs/CollectionPropertiesDialog.md).
 * Pure view: Info (facts + inline rename + member-sample slot), AI Info
 * (owner-only, capability-gated — absent-not-disabled) and the owner-only
 * Sharing tab (grants CRUD through host callbacks + the publish_mode radio
 * with the exposure-explicit copy). The host (`FileManager` shell,
 * FileManager.md §7) performs every IO — this component imports NO services.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Radio,
  RadioGroup,
  Skeleton,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AutoAwesome as AutoAwesomeIcon,
  PushPin as PushPinIcon,
  Share as ShareIcon,
} from '@mui/icons-material';
import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import UserSelectionMenu from './UserSelectionMenu';
import { formatDate } from '../../utils/format';

const ORIGIN_LABEL_KEYS = {
  user: 'dialogs.collectionOriginUser',
  system: 'dialogs.collectionOriginSystem',
  seed: 'dialogs.collectionOriginSeed',
  search: 'dialogs.collectionOriginSearch',
};

const PUBLISH_MODE_LABEL_KEYS = {
  ask: 'dialogs.publishModeAsk',
  off: 'dialogs.publishModeOff',
  auto: 'dialogs.publishModeAuto',
};

const PUBLISH_MODE_HELPER_KEYS = {
  ask: 'dialogs.publishModeAskHelper',
  off: 'dialogs.publishModeOffHelper',
  auto: 'dialogs.publishModeAutoHelper',
};

const AI_KIND_LABEL_KEYS = {
  seed_vector: 'dialogs.collectionAiKindSeedVector',
  centroid: 'dialogs.collectionAiKindCentroid',
};

/**
 * AI-derived definition kinds (seed/vector/tag family). `predicate` is the
 * rule/manual kind — it never earns an AI Info tab (§2.3: no gray AI
 * affordances for rule collections).
 */
const isAiDefinition = (definition) =>
  definition != null && typeof definition.kind === 'string' && definition.kind !== 'predicate';

/** Owner predicate: the wire never invents `granted_role:'owner'` (§12.1 P-4). */
const isOwnerRow = (collection) => collection?.granted_role == null;

const FactRow = ({ testid, label, children }) => (
  <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', py: 0.5 }} data-testid={testid}>
    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>
      {label}
    </Typography>
    <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
  </Box>
);

const CollectionPropertiesDialog = ({
  open,
  onClose,
  collection,
  initialTab = 'info',
  aiFlags = { embed: false, chat: false },
  onPatch,
  grants = null,
  shareableUsers = [],
  preview = null,
  seedName,
  onGrant,
  onRevoke,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('info');
  const [nameDraft, setNameDraft] = useState('');
  const [grantRole, setGrantRole] = useState('viewer');
  const [pickerAnchor, setPickerAnchor] = useState(null);

  const owner = isOwnerRow(collection);
  const aiInfoAvailable =
    owner && aiFlags?.embed === true && isAiDefinition(collection?.definition);
  const sharingAvailable = owner;

  // tab reset on open / row switch; unavailable or unknown tabs fall back to
  // Info (§2.9) — absent-not-disabled applies to the tab STRIP, not the target.
  useEffect(() => {
    if (!open) return;
    if (initialTab === 'sharing' && sharingAvailable) setActiveTab('sharing');
    else if (initialTab === 'ai' && aiInfoAvailable) setActiveTab('ai');
    else setActiveTab('info');
    setNameDraft(collection?.name ?? '');
    setGrantRole('viewer');
    setPickerAnchor(null);
  }, [
    open,
    initialTab,
    sharingAvailable,
    aiInfoAvailable,
    collection?.name,
    collection?.collection_id,
  ]);

  // the radio follows the LIVE row (post-refresh), not a local copy
  const publishMode = collection?.publish_mode ?? 'ask';

  const handleRenameSave = useCallback(() => {
    const name = nameDraft.trim();
    if (!name || name === collection?.name) return;
    onPatch?.({ name });
  }, [nameDraft, collection?.name, onPatch]);

  const handlePublishModeChange = useCallback(
    (event) => onPatch?.({ publishMode: event.target.value }),
    [onPatch]
  );

  // -- Sharing: UserSelectionMenu picker (select-user view only — the grant
  //    list lives in the tab, so the manage view is never offered; Back
  //    closes the menu). Grants → permission values mirror the file-share
  //    derivation (viewer=READ, editor=WRITE) so the shared derivation
  //    filters already-granted candidates.
  const pickerPath = `collection-${collection?.collection_id}`;
  const folderPermissions = useMemo(() => {
    const inner = new Map();
    for (const grant of grants ?? [])
      inner.set(grant.grantee_id, grant.role === 'editor' ? PERMISSIONS.WRITE : PERMISSIONS.READ);
    return new Map([[pickerPath, inner]]);
  }, [grants, pickerPath]);
  const userInfoMap = useMemo(
    () => new Map((shareableUsers ?? []).map((user) => [user.id, user])),
    [shareableUsers]
  );
  const getUserName = useCallback(
    (id) => (shareableUsers ?? []).find((user) => user.id === id)?.username ?? '',
    [shareableUsers]
  );
  const noop = useCallback(() => {}, []);
  const handlePickerSelect = useCallback(
    (userId) => {
      setPickerAnchor(null);
      onGrant?.(userId, grantRole);
    },
    [onGrant, grantRole]
  );
  const handlePickerViewChange = useCallback((view) => {
    // the manage view is not offered in the collection context — a
    // view switch request (the picker's Back entry) closes the menu
    if (view === 'manage') setPickerAnchor(null);
  }, []);

  const previewSample = preview && Array.isArray(preview.sample) ? preview.sample : [];
  const previewMore =
    preview && typeof preview.count === 'number'
      ? Math.max(0, preview.count - previewSample.length)
      : 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('dialogs.propertiesTitle')}</DialogTitle>
      {/* Tab bar between title and body (FilePropertiesDialog idiom) */}
      <Tabs
        value={activeTab}
        onChange={(_event, nextTab) => setActiveTab(nextTab)}
        sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab
          data-testid="collection-props-tab-info"
          label={t('dialogs.collectionTabInfo')}
          value="info"
        />
        {aiInfoAvailable && (
          <Tab
            data-testid="collection-props-tab-ai"
            label={t('dialogs.collectionTabAi')}
            value="ai"
          />
        )}
        {sharingAvailable && (
          <Tab
            data-testid="collection-props-tab-sharing"
            label={t('dialogs.collectionTabSharing')}
            value="sharing"
          />
        )}
      </Tabs>
      <DialogContent>
        {activeTab === 'info' && collection && (
          <Box sx={{ py: 1 }}>
            <FactRow testid="collection-name-row" label={t('dialogs.collectionName')}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField
                  data-testid="collection-name-field"
                  size="small"
                  sx={{ flex: 1, minWidth: 0 }}
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                />
                <Button
                  data-testid="collection-rename-save"
                  size="small"
                  variant="outlined"
                  onClick={handleRenameSave}
                >
                  {t('dialogs.collectionRenameSave')}
                </Button>
              </Box>
            </FactRow>
            <FactRow testid="collection-origin-row" label={t('dialogs.collectionOrigin')}>
              <Chip
                size="small"
                data-testid="collection-origin-chip"
                label={t(ORIGIN_LABEL_KEYS[collection.origin] ?? 'dialogs.collectionOriginUser')}
              />
            </FactRow>
            <FactRow testid="collection-status-row" label={t('dialogs.collectionStatus')}>
              <Chip
                size="small"
                data-testid="collection-status-chip"
                label={
                  collection.status === 'archived'
                    ? t('dialogs.collectionStatusArchived')
                    : t('dialogs.collectionStatusActive')
                }
              />
              <Chip
                size="small"
                variant="outlined"
                data-testid="collection-publish-mode-chip"
                sx={{ ml: 1 }}
                label={t(
                  PUBLISH_MODE_LABEL_KEYS[collection.publish_mode] ?? 'dialogs.publishModeAsk'
                )}
              />
            </FactRow>
            {(collection.pinned || collection.pinned_by === 'auto') && (
              <FactRow testid="collection-pin-row" label={t('fileManager.collectionsUserPin')}>
                {collection.pinned_by === 'auto' ? (
                  <Chip
                    size="small"
                    data-testid="collection-autopin-chip"
                    icon={
                      <Box component="span" sx={{ position: 'relative', display: 'inline-flex' }}>
                        <PushPinIcon style={{ fontSize: 14 }} />
                        <AutoAwesomeIcon
                          style={{ fontSize: 9, position: 'absolute', top: -1, left: -1 }}
                        />
                      </Box>
                    }
                    label={t('dialogs.collectionPinnedAuto')}
                  />
                ) : (
                  <Chip
                    size="small"
                    data-testid="collection-userpin-chip"
                    icon={<PushPinIcon />}
                    label={t('dialogs.collectionPinnedUser')}
                  />
                )}
                <Tooltip title={t('dialogs.collectionUnpin')}>
                  <IconButton
                    size="small"
                    data-testid="collection-unpin"
                    aria-label={t('dialogs.collectionUnpin')}
                    onClick={() => onPatch?.({ pinned: false })}
                  >
                    <PushPinIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </FactRow>
            )}
            <FactRow testid="collection-item-count-row" label={t('dialogs.collectionItemCount')}>
              <Typography variant="body2" data-testid="collection-item-count">
                {collection.item_count ?? 0}
              </Typography>
            </FactRow>
            <FactRow testid="collection-created-at" label={t('dialogs.collectionCreatedAt')}>
              <Typography variant="body2">
                {collection.created_at ? formatDate(collection.created_at) : '—'}
              </Typography>
            </FactRow>
            <FactRow testid="collection-updated-at" label={t('dialogs.collectionUpdatedAt')}>
              <Typography variant="body2">
                {collection.updated_at ? formatDate(collection.updated_at) : '—'}
              </Typography>
            </FactRow>
            {collection.last_member_change_at && (
              <FactRow
                testid="collection-last-member-change"
                label={t('dialogs.collectionLastMemberChange')}
              >
                <Typography variant="body2">
                  {formatDate(collection.last_member_change_at)}
                </Typography>
              </FactRow>
            )}
            {owner && (
              <Box sx={{ mt: 1 }}>
                {preview === null && (
                  <Skeleton
                    variant="rectangular"
                    height={48}
                    data-testid="collection-preview-loading"
                  />
                )}
                {preview === false && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    data-testid="collection-preview-unavailable"
                  >
                    {t('dialogs.collectionPreviewUnavailable')}
                  </Typography>
                )}
                {preview && (
                  <Box data-testid="collection-preview">
                    <Typography variant="subtitle2">{t('dialogs.collectionItemCount')}</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                      {previewSample.map((item) => (
                        <Chip
                          key={item.node_id}
                          size="small"
                          variant="outlined"
                          data-testid={`collection-preview-sample-${item.node_id}`}
                          label={item.name}
                        />
                      ))}
                      {previewMore > 0 && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          data-testid="collection-preview-more"
                          sx={{ alignSelf: 'center' }}
                        >
                          {t('dialogs.collectionPreview', { count: previewMore })}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                )}
              </Box>
            )}
          </Box>
        )}

        {activeTab === 'ai' && aiInfoAvailable && collection?.definition && (
          <Box sx={{ py: 1 }} data-testid="collection-ai-facts">
            <FactRow testid="collection-ai-kind-row" label={t('dialogs.collectionAiInfoKind')}>
              <Chip
                size="small"
                label={
                  AI_KIND_LABEL_KEYS[collection.definition.kind]
                    ? t(AI_KIND_LABEL_KEYS[collection.definition.kind])
                    : collection.definition.kind
                }
              />
            </FactRow>
            {collection.definition.theta != null && (
              <FactRow testid="collection-ai-theta-row" label={t('dialogs.collectionAiInfoTheta')}>
                <Typography variant="body2">{collection.definition.theta}</Typography>
              </FactRow>
            )}
            {seedName && (
              <FactRow testid="collection-ai-seed-row" label={t('dialogs.collectionAiInfoSeed')}>
                <Typography variant="body2">{seedName}</Typography>
              </FactRow>
            )}
            <FactRow
              testid="collection-ai-provenance-row"
              label={t('dialogs.collectionAiInfoProvenance')}
            >
              <Typography variant="body2">
                {collection.name_locked
                  ? t('dialogs.collectionAiProvenanceLocked')
                  : t('dialogs.collectionAiProvenanceTemplate')}
              </Typography>
            </FactRow>
            {collection.last_member_change_at && (
              <FactRow
                testid="collection-ai-last-change"
                label={t('dialogs.collectionLastMemberChange')}
              >
                <Typography variant="body2">
                  {formatDate(collection.last_member_change_at)}
                </Typography>
              </FactRow>
            )}
          </Box>
        )}

        {activeTab === 'sharing' && sharingAvailable && collection && (
          <Box sx={{ py: 1 }}>
            <Typography variant="subtitle2">{t('dialogs.publishModeTitle')}</Typography>
            <RadioGroup value={publishMode} onChange={handlePublishModeChange}>
              <FormControlLabel
                control={<Radio data-testid="collection-publish-mode-ask" value="ask" />}
                label={t('dialogs.publishModeAsk')}
              />
              <FormControlLabel
                control={<Radio data-testid="collection-publish-mode-off" value="off" />}
                label={t('dialogs.publishModeOff')}
              />
              <FormControlLabel
                control={<Radio data-testid="collection-publish-mode-auto" value="auto" />}
                label={t('dialogs.publishModeAuto')}
              />
            </RadioGroup>
            <Typography
              variant="body2"
              color="text.secondary"
              data-testid="collection-publish-mode-help"
              sx={{ mb: 1 }}
            >
              {t(PUBLISH_MODE_HELPER_KEYS[publishMode] ?? 'dialogs.publishModeAskHelper')}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="collection-publish-mode-exposure-note"
            >
              {t('dialogs.publishModeExposureNote')}
            </Typography>

            <Divider sx={{ my: 1.5 }} />

            <Typography variant="subtitle2">{t('dialogs.collectionGrants')}</Typography>
            {grants === null ? (
              <Skeleton variant="rectangular" height={48} data-testid="collection-grants-loading" />
            ) : (
              <List dense disablePadding>
                {grants.length === 0 && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    data-testid="collection-grants-empty"
                    sx={{ py: 1 }}
                  >
                    {t('dialogs.collectionGrantsEmpty')}
                  </Typography>
                )}
                {grants.map((grant) => (
                  <ListItem
                    key={`grant-${grant.grantee_id}`}
                    data-testid={`collection-grant-row-${grant.grantee_id}`}
                    disableGutters
                    secondaryAction={
                      <Button
                        size="small"
                        data-testid={`collection-grant-revoke-${grant.grantee_id}`}
                        onClick={() => onRevoke?.(grant.grantee_id)}
                      >
                        {t('dialogs.revokePermission')}
                      </Button>
                    }
                  >
                    <ListItemText
                      primary={
                        grant.username || t('dialogs.userIdFallback', { id: grant.grantee_id })
                      }
                      secondary={
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                          <Chip
                            size="small"
                            data-testid={`collection-grant-role-${grant.grantee_id}`}
                            label={
                              grant.role === 'editor'
                                ? t('permissions.editor')
                                : t('permissions.viewer')
                            }
                          />
                          {grant.created_at && (
                            <Typography variant="caption" color="text.secondary">
                              {formatDate(grant.created_at)}
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {t('dialogs.collectionGrantRoleTitle')}
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={grantRole}
                onChange={(_event, nextRole) => {
                  if (nextRole != null) setGrantRole(nextRole);
                }}
              >
                <ToggleButton
                  value="viewer"
                  data-testid="collection-grant-role-viewer"
                  aria-label={t('permissions.viewer')}
                >
                  {t('permissions.viewer')}
                </ToggleButton>
                <ToggleButton
                  value="editor"
                  data-testid="collection-grant-role-editor"
                  aria-label={t('permissions.editor')}
                >
                  {t('permissions.editor')}
                </ToggleButton>
              </ToggleButtonGroup>
              <Button
                size="small"
                variant="outlined"
                data-testid="collection-grant-add"
                startIcon={<ShareIcon />}
                onClick={(event) => setPickerAnchor(event.currentTarget)}
              >
                {t('dialogs.addUser')}
              </Button>
            </Box>

            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 1.5 }}
              data-testid="collection-publish-initial-note"
            >
              {t('dialogs.collectionPublishInitialNote')}
            </Typography>

            <UserSelectionMenu
              folderMenuAnchor={pickerAnchor}
              onClose={() => setPickerAnchor(null)}
              folderMenuPath={pickerPath}
              folderPermissions={folderPermissions}
              isAdminMode={false}
              userInfoMap={userInfoMap}
              users={shareableUsers ?? []}
              getUserName={getUserName}
              handleTogglePermission={noop}
              handleRemoveUser={noop}
              folderMenuView="selectUser"
              setFolderMenuView={handlePickerViewChange}
              isShareMode={false}
              isReviewMode={false}
              handleUserSelect={handlePickerSelect}
            />
          </Box>
        )}
      </DialogContent>
      {/* Fixed bottom action bar — identical across tab switches */}
      <DialogActions>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} variant="contained">
          {t('common.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CollectionPropertiesDialog;
