/**
 * CollectionPropertiesDialog — collection properties on the FilePropertiesDialog
 * tab-bar idiom (docs/spec/client/components/dialogs/CollectionPropertiesDialog.md).
 * Pure view: Info (facts + inline name draft + member-sample slot), AI Info
 * (owner-only, capability-gated — absent-not-disabled) and the owner-only
 * Sharing tab (draft grants + the publish_mode radio with the exposure-explicit
 * copy). Every edit stays in this dialog's draft; the host (`FileManager`
 * shell, FileManager.md §7) performs the single atomic save — this component
 * imports NO services.
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
  DialogContentText,
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
 * rule/manual kind — it never earns an AI Info tab (§2.4: no gray AI
 * affordances for rule collections).
 */
const isAiDefinition = (definition) =>
  definition != null && typeof definition.kind === 'string' && definition.kind !== 'predicate';

/** Owner predicate: the wire never invents `granted_role:'owner'` (§12.1 P-4). */
const isOwnerRow = (collection) => collection?.granted_role == null;

const sameId = (left, right) => String(left) === String(right);

const snapshotOf = (collection) => ({
  name: collection?.name ?? '',
  publishMode: collection?.publish_mode ?? 'ask',
  pinned: collection?.pinned === true,
});

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
  onSave,
  grants = null,
  shareableUsers = [],
  preview = null,
  seedName,
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('info');
  const [nameDraft, setNameDraft] = useState('');
  const [publishModeDraft, setPublishModeDraft] = useState('ask');
  const [pinnedDraft, setPinnedDraft] = useState(false);
  const [baseline, setBaseline] = useState(null);
  const [grantsDraft, setGrantsDraft] = useState(null);
  const [baselineGrants, setBaselineGrants] = useState(null);
  const [pickerAnchor, setPickerAnchor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const owner = isOwnerRow(collection);
  const aiInfoAvailable =
    owner && aiFlags?.embed === true && isAiDefinition(collection?.definition);
  const sharingAvailable = owner;
  const collectionId = collection?.collection_id ?? null;

  // open/target switch seeds the baseline + draft. The draft deliberately does
  // NOT depend on `collection.name`: an external row refresh must never clobber
  // an in-progress edit (§2.3).
  useEffect(() => {
    if (!open) return;
    if (initialTab === 'sharing' && sharingAvailable) setActiveTab('sharing');
    else if (initialTab === 'ai' && aiInfoAvailable) setActiveTab('ai');
    else setActiveTab('info');
    const nextBaseline = snapshotOf(collection);
    setBaseline(nextBaseline);
    setNameDraft(nextBaseline.name);
    setPublishModeDraft(nextBaseline.publishMode);
    setPinnedDraft(nextBaseline.pinned);
    setGrantsDraft(null);
    setBaselineGrants(null);
    setPickerAnchor(null);
    setSaving(false);
    setConfirmClose(false);
    // `collection` fields are read only to seed the snapshot for this id;
    // later refreshes of the same row must not reset the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTab, sharingAvailable, aiInfoAvailable, collectionId]);

  // the host loads grants after open; seed the draft baseline once per open.
  useEffect(() => {
    if (!open || grants === null || grantsDraft !== null) return;
    const rows = grants.map((grant) => ({ ...grant }));
    setBaselineGrants(rows);
    setGrantsDraft(rows);
  }, [open, grants, grantsDraft]);

  const trimmedName = nameDraft.trim();
  const nameChanged = baseline != null && trimmedName !== baseline.name;
  const nameInvalid = trimmedName === '';
  const publishChanged = baseline != null && publishModeDraft !== baseline.publishMode;
  const pinnedChanged = baseline != null && pinnedDraft !== baseline.pinned;

  const grantsPlan = useMemo(() => {
    if (baselineGrants === null || grantsDraft === null) {
      return { upsert: [], revoke: [] };
    }
    const baselineRoles = new Map(
      baselineGrants.map((grant) => [String(grant.grantee_id), grant.role])
    );
    const draftIds = new Set(grantsDraft.map((grant) => String(grant.grantee_id)));
    const upsert = grantsDraft
      .filter((grant) => baselineRoles.get(String(grant.grantee_id)) !== grant.role)
      .map((grant) => ({ userId: grant.grantee_id, role: grant.role }));
    const revoke = baselineGrants
      .filter((grant) => !draftIds.has(String(grant.grantee_id)))
      .map((grant) => grant.grantee_id);
    return { upsert, revoke };
  }, [baselineGrants, grantsDraft]);

  const grantsChanged = grantsPlan.upsert.length > 0 || grantsPlan.revoke.length > 0;
  const dirty = nameChanged || publishChanged || pinnedChanged || grantsChanged;
  const canSave = dirty && !nameInvalid && !saving;

  const buildPlan = useCallback(() => {
    const plan = {};
    if (nameChanged) plan.name = trimmedName;
    if (publishChanged) plan.publishMode = publishModeDraft;
    if (pinnedChanged) plan.pinned = pinnedDraft;
    if (grantsChanged) plan.grants = { ...grantsPlan };
    return plan;
  }, [
    nameChanged,
    trimmedName,
    publishChanged,
    publishModeDraft,
    pinnedChanged,
    pinnedDraft,
    grantsChanged,
    grantsPlan,
  ]);

  const performSave = useCallback(async () => {
    if (saving || nameInvalid) return;
    const plan = buildPlan();
    if (Object.keys(plan).length === 0) {
      setConfirmClose(false);
      onClose?.();
      return;
    }
    setSaving(true);
    let ok = false;
    try {
      ok = (await onSave?.(plan)) === true;
    } catch {
      ok = false;
    } finally {
      setSaving(false);
    }
    setConfirmClose(false);
    if (ok) onClose?.();
  }, [saving, nameInvalid, buildPlan, onSave, onClose]);

  // Close/Escape/backdrop all funnel here: saving blocks the close, a dirty
  // draft opens the local three-action confirmation, a clean draft closes.
  const requestClose = useCallback(() => {
    if (saving) return;
    if (!dirty) {
      onClose?.();
      return;
    }
    setConfirmClose(true);
  }, [saving, dirty, onClose]);

  const cancelClosePrompt = useCallback(() => {
    if (saving) return;
    setConfirmClose(false);
  }, [saving]);

  const discardAndClose = useCallback(() => {
    if (saving) return;
    setConfirmClose(false);
    onClose?.();
  }, [saving, onClose]);

  const handleTabChange = useCallback((_event, nextTab) => {
    // the picker is tab-local chrome; a tab switch closes it
    setPickerAnchor(null);
    setActiveTab(nextTab);
  }, []);

  // -- Sharing: draft rows drive the picker's candidate filtering (viewer=READ,
  //    editor=WRITE) so an added user disappears from the available list
  //    immediately and never reappears until removed from the draft.
  const pickerPath = `collection-${collectionId}`;
  const folderPermissions = useMemo(() => {
    const inner = new Map();
    for (const grant of grantsDraft ?? [])
      inner.set(grant.grantee_id, grant.role === 'editor' ? PERMISSIONS.WRITE : PERMISSIONS.READ);
    return new Map([[pickerPath, inner]]);
  }, [grantsDraft, pickerPath]);
  const userInfoMap = useMemo(
    () => new Map((shareableUsers ?? []).map((user) => [user.id, user])),
    [shareableUsers]
  );
  const getUserName = useCallback(
    (id) => (shareableUsers ?? []).find((user) => sameId(user.id, id))?.username ?? '',
    [shareableUsers]
  );
  const noop = useCallback(() => {}, []);
  const handlePickerSelect = useCallback(
    (userId) => {
      setPickerAnchor(null);
      setGrantsDraft((rows) => {
        const current = rows ?? [];
        if (current.some((row) => sameId(row.grantee_id, userId))) return current;
        const baselineRow = (baselineGrants ?? []).find((row) => sameId(row.grantee_id, userId));
        if (baselineRow) {
          // Remove → re-add restores the user's baseline role (a no-op diff).
          return [...current, { ...baselineRow }];
        }
        const candidate = (shareableUsers ?? []).find((user) => sameId(user.id, userId));
        return [
          ...current,
          {
            grantee_id: userId,
            username: candidate?.username ?? '',
            role: 'viewer',
            created_at: null,
          },
        ];
      });
    },
    [baselineGrants, shareableUsers]
  );
  const handlePickerViewChange = useCallback((view) => {
    // the manage view is not offered in the collection context
    if (view === 'manage') setPickerAnchor(null);
  }, []);

  const toggleGrantRole = useCallback((granteeId) => {
    setGrantsDraft((rows) =>
      (rows ?? []).map((row) =>
        sameId(row.grantee_id, granteeId)
          ? { ...row, role: row.role === 'editor' ? 'viewer' : 'editor' }
          : row
      )
    );
  }, []);

  const removeGrant = useCallback((granteeId) => {
    setGrantsDraft((rows) => (rows ?? []).filter((row) => !sameId(row.grantee_id, granteeId)));
  }, []);

  const previewSample = preview && Array.isArray(preview.sample) ? preview.sample : [];
  const previewMore =
    preview && typeof preview.count === 'number'
      ? Math.max(0, preview.count - previewSample.length)
      : 0;

  return (
    <>
      <Dialog open={open} onClose={requestClose} maxWidth="sm" fullWidth>
        <DialogTitle>{t('dialogs.propertiesTitle')}</DialogTitle>
        {/* Tab bar between title and body (FilePropertiesDialog idiom) */}
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
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
                <TextField
                  data-testid="collection-name-field"
                  size="small"
                  fullWidth
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                />
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
                  label={t(PUBLISH_MODE_LABEL_KEYS[publishModeDraft] ?? 'dialogs.publishModeAsk')}
                />
              </FactRow>
              {pinnedDraft && (
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
                      onClick={() => setPinnedDraft(false)}
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
                      <Typography variant="subtitle2">
                        {t('dialogs.collectionItemCount')}
                      </Typography>
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
                <FactRow
                  testid="collection-ai-theta-row"
                  label={t('dialogs.collectionAiInfoTheta')}
                >
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
              <RadioGroup
                value={publishModeDraft}
                onChange={(event) => setPublishModeDraft(event.target.value)}
              >
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
                {t(PUBLISH_MODE_HELPER_KEYS[publishModeDraft] ?? 'dialogs.publishModeAskHelper')}
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
              {grantsDraft === null ? (
                <Skeleton
                  variant="rectangular"
                  height={48}
                  data-testid="collection-grants-loading"
                />
              ) : (
                <List dense disablePadding>
                  {grantsDraft.length === 0 && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      data-testid="collection-grants-empty"
                      sx={{ py: 1 }}
                    >
                      {t('dialogs.collectionGrantsEmpty')}
                    </Typography>
                  )}
                  {grantsDraft.map((grant) => (
                    <ListItem
                      key={`grant-${grant.grantee_id}`}
                      data-testid={`collection-grant-row-${grant.grantee_id}`}
                      disableGutters
                      secondaryAction={
                        <Button
                          size="small"
                          data-testid={`collection-grant-revoke-${grant.grantee_id}`}
                          onClick={() => removeGrant(grant.grantee_id)}
                        >
                          {t('dialogs.revokePermission')}
                        </Button>
                      }
                    >
                      <ListItemText
                        primary={
                          grant.username || t('dialogs.userIdFallback', { id: grant.grantee_id })
                        }
                        secondaryTypographyProps={{ component: 'div' }}
                        secondary={
                          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                            <Chip
                              size="small"
                              clickable
                              data-testid={`collection-grant-role-${grant.grantee_id}`}
                              title={t('dialogs.collectionGrantRoleToggle')}
                              onClick={() => toggleGrantRole(grant.grantee_id)}
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
                <Button
                  size="small"
                  variant="outlined"
                  data-testid="collection-grant-add"
                  startIcon={<ShareIcon />}
                  disabled={grantsDraft === null}
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
          {dirty && (
            <Button
              data-testid="collection-props-save"
              onClick={performSave}
              variant="outlined"
              color="primary"
              disabled={!canSave}
            >
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          )}
          <Button data-testid="collection-props-close" onClick={requestClose} disabled={saving}>
            {t('common.close')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Local three-action dirty-close prompt (ConfirmDialog is 2-action) */}
      <Dialog
        open={confirmClose}
        onClose={cancelClosePrompt}
        maxWidth="xs"
        fullWidth
        data-testid="collection-props-unsaved-dialog"
      >
        <DialogTitle>{t('dialogs.collectionUnsavedTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('dialogs.collectionUnsavedMessage')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button data-testid="collection-props-close-cancel" onClick={cancelClosePrompt}>
            {t('common.cancel')}
          </Button>
          <Button
            data-testid="collection-props-close-discard"
            color="error"
            onClick={discardAndClose}
            disabled={saving}
          >
            {t('dialogs.collectionDiscard')}
          </Button>
          <Button
            data-testid="collection-props-close-save"
            variant="contained"
            onClick={performSave}
            disabled={!canSave}
          >
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default CollectionPropertiesDialog;
