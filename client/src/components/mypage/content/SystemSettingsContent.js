import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Typography,
  IconButton,
  CircularProgress,
  Alert,
  Snackbar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Switch,
} from '@mui/material';
import { CleaningServices as CleaningServicesIcon } from '@mui/icons-material';
import CategoryIcon from '@mui/icons-material/Category';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Storage from '@mui/icons-material/Storage';
import SyncAlt from '@mui/icons-material/SyncAlt';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import * as adminService from '../../../services/adminService';
import { getMigrationPresence } from '../../../services/migrationService';
import {
  getServerErrorDisplay,
  getServerMessageDisplay,
} from '../../../utils/errorUtils';
import {
  getShowHiddenFiles,
  setShowHiddenFiles as saveShowHiddenFiles,
} from '../../../utils/localStorage';
import { usePageHeader } from '../../../contexts/PageHeaderContext';
import MigrationDialog from './MigrationDialog';
import MetadataMigrationDialog from './MetadataMigrationDialog';
import SystemConfigEditor from './SystemConfigEditor';

const SystemSettingsContent = () => {
  const { t } = useTranslation();
  const { setTitle, setActions } = usePageHeader();

  const [tempSettings, setTempSettings] = useState({ registration_enabled: 'false' });
  const [registrationSaving, setRegistrationSaving] = useState(false);
  const [showHiddenFiles, setShowHiddenFiles] = useState(() => getShowHiddenFiles());
  const [message, setMessage] = useState({ type: '', text: '' });
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
  const [permissionCleanupLoading, setPermissionCleanupLoading] = useState(false);
  const [permissionCleanupConfirmOpen, setPermissionCleanupConfirmOpen] = useState(false);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [metadataMigrationOpen, setMetadataMigrationOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [configSyncOpen, setConfigSyncOpen] = useState(false);
  const [configSyncLoading, setConfigSyncLoading] = useState(false);
  const [configSyncApplying, setConfigSyncApplying] = useState(false);
  const [configSyncReport, setConfigSyncReport] = useState(null);
  const [configSyncError, setConfigSyncError] = useState('');
  const [backendHealth, setBackendHealth] = useState({});
  const [activeBackends, setActiveBackends] = useState(() => new Set());
  const [metadataPresence, setMetadataPresence] = useState(null);

  const loadSettings = useCallback(async () => {
    try {
      const data = await adminService.getSettings();
      setTempSettings(data);
    } catch (error) {
      setMessage({ type: 'error', text: t('admin.settingsLoadFail') });
    }
  }, [t]);

  const loadActiveBackends = useCallback(async () => {
    try {
      const data = await adminService.getConfigStatus();
      // Derive the backends actually in use so unused backends never alert (D3):
      // metadata backend = WEA_STORAGE_BACKEND, file backend = WEA_FILE_STORAGE.
      const cfg = data?.config || {};
      const active = new Set();
      if (cfg.WEA_STORAGE_BACKEND?.value === 'postgresql') active.add('postgresql');
      if (cfg.WEA_FILE_STORAGE?.value === 's3') active.add('s3');
      if (cfg.WEA_FILE_STORAGE?.value === 'webdav') active.add('webdav');
      setActiveBackends(active);
    } catch {
      setActiveBackends(new Set());
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const data = await adminService.getAdminHealth();
      setBackendHealth(data?.backends || {});
    } catch {
      setBackendHealth({});
    }
  }, []);

  const loadMigrationPresence = useCallback(async () => {
    try {
      const data = await getMigrationPresence();
      setMetadataPresence(data);
    } catch {
      setMetadataPresence(null);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadActiveBackends();
    loadHealth();
    loadMigrationPresence();
  }, [loadSettings, loadActiveBackends, loadHealth, loadMigrationPresence]);

  const handleToggleRegistration = async () => {
    const newValue = tempSettings.registration_enabled === 'true' ? 'false' : 'true';
    const nextSettings = { ...tempSettings, registration_enabled: newValue };
    setTempSettings(nextSettings);
    setRegistrationSaving(true);
    try {
      await adminService.updateSettings(nextSettings);
      setMessage({ type: 'success', text: t('admin.registrationSaveSuccess') });
    } catch (error) {
      setTempSettings((prev) => ({
        ...prev,
        registration_enabled: newValue === 'true' ? 'false' : 'true',
      }));
      setMessage({ type: 'error', text: t('admin.settingsSaveFail') });
    } finally {
      setRegistrationSaving(false);
    }
  };

  const handleCleanupOrphaned = async () => {
    setCleanupConfirmOpen(false);
    setCleanupLoading(true);
    try {
      const res = await adminService.cleanupOrphaned();
      const { results } = res;
      const totalCleaned =
        results.deletedPermissionFiles +
        results.deletedUserFiles +
        results.deletedEmailIndexFiles +
        results.cleanedPermissionRequests;
      let messageText;
      if (totalCleaned === 0) messageText = t('admin.noDataToClean');
      else if (results.errors?.length)
        messageText = t('admin.cleanupDonePartial', { count: totalCleaned });
      else messageText = t('admin.cleanupDone', { count: totalCleaned });
      setMessage({ type: results.errors?.length ? 'warning' : 'success', text: messageText });
    } catch (error) {
      setMessage({
        type: 'error',
        text: getServerErrorDisplay(error?.response?.data, t) || t('admin.orphanCleanupFail'),
      });
    } finally {
      setCleanupLoading(false);
    }
  };

  const handlePermissionCleanup = async () => {
    setPermissionCleanupConfirmOpen(false);
    setPermissionCleanupLoading(true);
    try {
      const res = await adminService.ensureHomeOwnerAdmin();
      const { updatedUsers, upgradedPaths, grantedPaths, errors } = res;
      const total = (upgradedPaths || 0) + (grantedPaths || 0);
      let messageText;
      if (total === 0 && (!errors || errors.length === 0))
        messageText = t('admin.noPermissionToFix');
      else if (errors?.length)
        messageText = t('admin.permissionCleanupDonePartial', {
          users: updatedUsers || 0,
          paths: total,
        });
      else
        messageText = t('admin.permissionCleanupDone', { users: updatedUsers || 0, paths: total });
      setMessage({ type: errors?.length ? 'warning' : 'success', text: messageText });
    } catch (error) {
      setMessage({
        type: 'error',
        text: getServerErrorDisplay(error?.response?.data, t) || t('admin.permissionCleanupFail'),
      });
    } finally {
      setPermissionCleanupLoading(false);
    }
  };

  const openConfigSync = async () => {
    setConfigSyncOpen(true);
    setConfigSyncLoading(true);
    setConfigSyncError('');
    setConfigSyncReport(null);
    try {
      const report = await adminService.getConfigSyncReport();
      setConfigSyncReport(report);
    } catch (error) {
      setConfigSyncError(
        getServerErrorDisplay(error?.response?.data, t) || t('admin.configSyncPreviewReportFail')
      );
    } finally {
      setConfigSyncLoading(false);
    }
  };

  const handleConfigSyncApply = async () => {
    setConfigSyncApplying(true);
    setConfigSyncError('');
    try {
      const res = await adminService.syncConfigFromEnv();
      setConfigSyncOpen(false);
      setConfigSyncReport(null);
      setMessage({
        type: 'success',
        text: getServerMessageDisplay(res, t) || t('admin.configSyncDone'),
      });
    } catch (error) {
      const text =
        getServerErrorDisplay(error?.response?.data, t) || t('admin.configSyncApplyFail');
      setConfigSyncError(text);
      setMessage({ type: 'error', text });
    } finally {
      setConfigSyncApplying(false);
    }
  };

  useEffect(() => {
    setTitle(t('admin.systemSettings'));
    setActions(null);
  }, [t, setTitle, setActions]);

  const failedBackends = Object.entries(backendHealth).filter(
    ([name, health]) => health?.status === 'fail' && activeBackends.has(name)
  );

  const syncSummary = configSyncReport?.summary;
  const configSyncActionable =
    (syncSummary?.drift || 0) > 0 || (syncSummary?.envOnly || 0) > 0;
  const syncFindings = configSyncReport?.findings || [];
  const toUpdateKeys = syncFindings.filter((f) => f.status === 'differs').map((f) => f.key);
  const toAddKeys = syncFindings.filter((f) => f.status === 'env-only').map((f) => f.key);

  return (
    <Box>
      {failedBackends.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }} data-testid="backend-health-card">
          <Typography variant="subtitle2">{t('admin.health.title')}</Typography>
          <Box component="ul" sx={{ mt: 1, mb: 0, pl: 3 }}>
            {failedBackends.map(([name, health]) => (
              <li key={name}>
                <Typography variant="body2">
                  {name}: {t('admin.health.fail')}
                  {health?.hint || health?.code
                    ? ` (${t('admin.health.hintPrefix')} ${health?.hint || health?.code})`
                    : ''}
                </Typography>
                {health?.lastCheckedAt ? (
                  <Typography variant="caption" color="text.secondary">
                    {t('admin.health.lastChecked', {
                      time: new Date(health.lastCheckedAt).toLocaleString(),
                    })}
                  </Typography>
                ) : null}
              </li>
            ))}
          </Box>
        </Alert>
      )}
      {metadataPresence?.otherHasData && (
        <Alert severity="warning" sx={{ mb: 3 }} data-testid="env-setup-needed-banner">
          <Typography variant="subtitle2">{t('admin.envSetupNeededTitle')}</Typography>
          <Typography variant="body2">
            {t('admin.envSetupNeededBody', {
              backend:
                metadataPresence.otherBackend === 'postgresql'
                  ? t('migrationPage.backendPostgresql')
                  : t('migrationPage.backendSqlite'),
            })}
          </Typography>
          <Button
            size="small"
            color="warning"
            variant="outlined"
            sx={{ mt: 1 }}
            onClick={() => setMetadataMigrationOpen(true)}
          >
            {t('admin.envSetupNeededAction')}
          </Button>
        </Alert>
      )}
      <Box
        sx={{ mt: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography variant="body1">{t('admin.registrationEnabled')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('admin.registrationEnabledDesc')}
          </Typography>
        </Box>
        <Switch
          checked={tempSettings.registration_enabled === 'true'}
          onChange={handleToggleRegistration}
          disabled={registrationSaving}
          color="primary"
          sx={{ ml: 2 }}
        />
      </Box>
      <Box
        sx={{ mt: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography variant="body1">{t('admin.showHiddenFiles')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('admin.showHiddenFilesDesc')}
          </Typography>
        </Box>
        <Switch
          checked={showHiddenFiles}
          onChange={(e) => {
            const newValue = e.target.checked;
            setShowHiddenFiles(newValue);
            saveShowHiddenFiles(newValue);
            setMessage({ type: 'success', text: t('admin.showHiddenFilesSaveSuccess') });
          }}
          color="primary"
          sx={{ ml: 2 }}
        />
      </Box>
      <Box
        sx={{ mt: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography variant="body1">{t('admin.dataCleanup')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('admin.dataCleanupDesc')}
          </Typography>
        </Box>
        <IconButton
          onClick={() => setCleanupConfirmOpen(true)}
          disabled={cleanupLoading}
          color="primary"
          sx={{ ml: 2 }}
          aria-label={t('admin.runCleanup')}
        >
          {cleanupLoading ? <CircularProgress size={24} /> : <CleaningServicesIcon />}
        </IconButton>
      </Box>
      <Box
        sx={{ mt: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography variant="body1">{t('admin.permissionCleanup')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('admin.permissionCleanupDesc')}
          </Typography>
        </Box>
        <IconButton
          onClick={() => setPermissionCleanupConfirmOpen(true)}
          disabled={permissionCleanupLoading}
          color="primary"
          sx={{ ml: 2 }}
          aria-label={t('admin.run')}
        >
          {permissionCleanupLoading ? <CircularProgress size={24} /> : <CategoryIcon />}
        </IconButton>
      </Box>
      <Box
        sx={{ mt: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography variant="body1">{t('admin.storageMigration')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('admin.storageMigrationDesc')}
          </Typography>
        </Box>
        <IconButton
          onClick={() => setMigrationOpen(true)}
          color="primary"
          sx={{ ml: 2 }}
          aria-label={t('admin.runMigration')}
        >
          <SyncAlt />
        </IconButton>
      </Box>
      <Box
        sx={{ mt: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography variant="body1">{t('admin.metadataMigration')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('admin.metadataMigrationDesc')}
          </Typography>
        </Box>
        <IconButton
          onClick={() => setMetadataMigrationOpen(true)}
          color="primary"
          sx={{ ml: 2 }}
          aria-label={t('admin.runMetadataMigration')}
        >
          <Storage />
        </IconButton>
      </Box>

      <Box
        sx={{ mt: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography variant="body1">{t('admin.configSyncFromEnv')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('admin.configSyncFromEnvDesc')}
          </Typography>
        </Box>
        <IconButton
          onClick={openConfigSync}
          disabled={configSyncApplying}
          color="primary"
          sx={{ ml: 2 }}
          aria-label={t('admin.runConfigSync')}
        >
          {configSyncApplying ? <CircularProgress size={24} /> : <AutorenewIcon />}
        </IconButton>
      </Box>

      <Accordion
        expanded={advancedOpen}
        onChange={(e, expanded) => setAdvancedOpen(expanded)}
        sx={{
          mt: 4,
          boxShadow: 'none',
          bgcolor: 'transparent',
          '&:before': { display: 'none' },
          '&.Mui-expanded': { margin: 0, mt: 4 },
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          aria-controls="advanced-settings-content"
          id="advanced-settings-header"
          sx={{ minHeight: 0, '&.Mui-expanded': { minHeight: 0 }, px: 0 }}
        >
          <Typography variant="h6">{t('admin.advancedSettings')}</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 0 }}>
          <SystemConfigEditor active={advancedOpen} onSnackbar={(msg) => setMessage(msg)} />
        </AccordionDetails>
      </Accordion>

      <Dialog open={cleanupConfirmOpen} onClose={() => setCleanupConfirmOpen(false)} fullScreen>
        <DialogTitle>{t('admin.orphanCleanupConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('admin.orphanCleanupConfirmBody')}
            <br />
            <br />
            {t('admin.orphanCleanupConfirmNote')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCleanupConfirmOpen(false)} color="primary">
            {t('common.cancel')}
          </Button>
          <Button onClick={handleCleanupOrphaned} color="error" variant="contained" autoFocus>
            {t('admin.runCleanup')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={permissionCleanupConfirmOpen}
        onClose={() => setPermissionCleanupConfirmOpen(false)}
        fullScreen
      >
        <DialogTitle>{t('admin.permissionCleanupConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('admin.permissionCleanupDesc')}
            <br />
            <br />
            {t('admin.permissionCleanupConfirmQuestion')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPermissionCleanupConfirmOpen(false)} color="primary">
            {t('common.cancel')}
          </Button>
          <Button onClick={handlePermissionCleanup} color="primary" variant="contained" autoFocus>
            {t('admin.run')}
          </Button>
        </DialogActions>
      </Dialog>

      <MigrationDialog
        open={migrationOpen}
        onClose={() => setMigrationOpen(false)}
        onMessage={(msg) => setMessage(msg)}
      />
      <MetadataMigrationDialog
        open={metadataMigrationOpen}
        onClose={() => setMetadataMigrationOpen(false)}
        onMessage={(msg) => setMessage(msg)}
      />

      <Dialog open={configSyncOpen} onClose={() => setConfigSyncOpen(false)} fullScreen>
        <DialogTitle>{t('admin.configSyncConfirmTitle')}</DialogTitle>
        <DialogContent>
          {configSyncLoading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <CircularProgress size={24} />
              <Typography>{t('admin.configSyncPreviewLoading')}</Typography>
            </Box>
          ) : configSyncError ? (
            <Alert severity="error">{configSyncError}</Alert>
          ) : configSyncReport ? (
            <>
              {configSyncActionable ? (
                <>
                  <DialogContentText>
                    {t('admin.configSyncPreviewChanges', {
                      updated: syncSummary.drift,
                      added: syncSummary.envOnly,
                    })}
                  </DialogContentText>
                  {toUpdateKeys.length > 0 && (
                    <DialogContentText>
                      {t('admin.configSyncPreviewUpdatedKeys', {
                        keys: toUpdateKeys.join(', '),
                      })}
                    </DialogContentText>
                  )}
                  {toAddKeys.length > 0 && (
                    <DialogContentText>
                      {t('admin.configSyncPreviewAddedKeys', { keys: toAddKeys.join(', ') })}
                    </DialogContentText>
                  )}
                </>
              ) : (
                <DialogContentText>{t('admin.configSyncPreviewNoChanges')}</DialogContentText>
              )}
              <DialogContentText color="text.secondary" sx={{ mt: 2 }}>
                {t('admin.configSyncConfirmScope')}
              </DialogContentText>
            </>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfigSyncOpen(false)} color="primary">
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleConfigSyncApply}
            color="primary"
            variant="contained"
            autoFocus
            disabled={
              configSyncLoading || !!configSyncError || !configSyncActionable || configSyncApplying
            }
            data-testid="config-sync-apply"
          >
            {t('admin.runConfigSync')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!message.text}
        autoHideDuration={6000}
        onClose={() => setMessage({ type: '', text: '' })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setMessage({ type: '', text: '' })}
          severity={message.type || 'info'}
          sx={{ width: '100%' }}
        >
          {message.text}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default SystemSettingsContent;
