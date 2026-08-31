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
import SyncAlt from '@mui/icons-material/SyncAlt';
import * as adminService from '../../../services/adminService';
import { getServerErrorDisplay } from '../../../utils/errorUtils';
import { getShowHiddenFiles, setShowHiddenFiles as saveShowHiddenFiles } from '../../../utils/localStorage';
import { usePageHeader } from '../../../contexts/PageHeaderContext';
import MigrationDialog from './MigrationDialog';
import SystemConfigEditor from './SystemConfigEditor';

const SystemSettingsContent = ({ onMessage }) => {
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [keyLostWarning, setKeyLostWarning] = useState(false);
  const [backendHealth, setBackendHealth] = useState({});

  const loadSettings = useCallback(async () => {
    try {
      const data = await adminService.getSettings();
      setTempSettings(data);
    } catch (error) {
      setMessage({ type: 'error', text: t('admin.settingsLoadFail') });
    }
  }, [t]);

  const loadKeyLostWarning = useCallback(async () => {
    try {
      const data = await adminService.getConfigStatus();
      setKeyLostWarning(Boolean(data?.key_lost_warning));
    } catch {
      setKeyLostWarning(false);
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

  useEffect(() => {
    loadSettings();
    loadKeyLostWarning();
    loadHealth();
  }, [loadSettings, loadKeyLostWarning, loadHealth]);

  const handleToggleRegistration = async () => {
    const newValue = tempSettings.registration_enabled === 'true' ? 'false' : 'true';
    const nextSettings = { ...tempSettings, registration_enabled: newValue };
    setTempSettings(nextSettings);
    setRegistrationSaving(true);
    try {
      await adminService.updateSettings(nextSettings);
      setMessage({ type: 'success', text: t('admin.registrationSaveSuccess') });
    } catch (error) {
      setTempSettings((prev) => ({ ...prev, registration_enabled: newValue === 'true' ? 'false' : 'true' }));
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
      else if (results.errors?.length) messageText = t('admin.cleanupDonePartial', { count: totalCleaned });
      else messageText = t('admin.cleanupDone', { count: totalCleaned });
      setMessage({ type: results.errors?.length ? 'warning' : 'success', text: messageText });
    } catch (error) {
      setMessage({ type: 'error', text: getServerErrorDisplay(error?.response?.data, t) || t('admin.orphanCleanupFail') });
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
      if (total === 0 && (!errors || errors.length === 0)) messageText = t('admin.noPermissionToFix');
      else if (errors?.length) messageText = t('admin.permissionCleanupDonePartial', { users: updatedUsers || 0, paths: total });
      else messageText = t('admin.permissionCleanupDone', { users: updatedUsers || 0, paths: total });
      setMessage({ type: errors?.length ? 'warning' : 'success', text: messageText });
    } catch (error) {
      setMessage({ type: 'error', text: getServerErrorDisplay(error?.response?.data, t) || t('admin.permissionCleanupFail') });
    } finally {
      setPermissionCleanupLoading(false);
    }
  };

  useEffect(() => {
    setTitle(t('admin.systemSettings'));
    setActions(null);
  }, [t, setTitle, setActions]);

  return (
    <Box>
      {Object.keys(backendHealth).length > 0 && (
        <Alert severity="info" sx={{ mb: 3 }} data-testid="backend-health-card">
          <Typography variant="subtitle2">{t('admin.health.title')}</Typography>
          <Box component="ul" sx={{ mt: 1, mb: 0, pl: 3 }}>
            {Object.entries(backendHealth).map(([name, health]) => {
              const status = health?.status || 'unknown';
              const statusLabel =
                status === 'ok' ? t('admin.health.ok')
                  : status === 'fail' ? t('admin.health.fail')
                    : t('admin.health.unknown');
              return (
                <li key={name}>
                  <Typography variant="body2">
                    {name}: {statusLabel}
                    {status === 'fail' && (health?.hint || health?.code) ? ` (${t('admin.health.hintPrefix')} ${health?.hint || health?.code})` : ''}
                  </Typography>
                  {health?.lastCheckedAt ? (
                    <Typography variant="caption" color="text.secondary">
                      {t('admin.health.lastChecked', { time: new Date(health.lastCheckedAt).toLocaleString() })}
                    </Typography>
                  ) : null}
                </li>
              );
            })}
          </Box>
        </Alert>
      )}
      {keyLostWarning && (
        <Alert severity="warning" sx={{ mb: 3 }} data-testid="key-lost-warning">
          <Typography variant="subtitle2">{t('admin.keyLostWarning')}</Typography>
          <Typography variant="body2">{t('admin.keyLostWarningDetail')}</Typography>
        </Alert>
      )}
      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body1">{t('admin.registrationEnabled')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('admin.registrationEnabledDesc')}</Typography>
        </Box>
        <Switch
          checked={tempSettings.registration_enabled === 'true'}
          onChange={handleToggleRegistration}
          disabled={registrationSaving}
          color="primary"
          sx={{ ml: 2 }}
        />
      </Box>
      <Box sx={{ mt: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body1">{t('admin.showHiddenFiles')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('admin.showHiddenFilesDesc')}</Typography>
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
      <Box sx={{ mt: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body1">{t('admin.dataCleanup')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('admin.dataCleanupDesc')}</Typography>
        </Box>
        <IconButton onClick={() => setCleanupConfirmOpen(true)} disabled={cleanupLoading} color="primary" sx={{ ml: 2 }} aria-label={t('admin.runCleanup')}>
          {cleanupLoading ? <CircularProgress size={24} /> : <CleaningServicesIcon />}
        </IconButton>
      </Box>
      <Box sx={{ mt: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body1">{t('admin.permissionCleanup')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('admin.permissionCleanupDesc')}</Typography>
        </Box>
        <IconButton onClick={() => setPermissionCleanupConfirmOpen(true)} disabled={permissionCleanupLoading} color="primary" sx={{ ml: 2 }} aria-label={t('admin.run')}>
          {permissionCleanupLoading ? <CircularProgress size={24} /> : <CategoryIcon />}
        </IconButton>
      </Box>
      <Box sx={{ mt: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body1">{t('admin.storageMigration')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('admin.storageMigrationDesc')}</Typography>
        </Box>
        <IconButton onClick={() => setMigrationOpen(true)} color="primary" sx={{ ml: 2 }} aria-label={t('admin.runMigration')}>
          <SyncAlt />
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

      <Dialog open={permissionCleanupConfirmOpen} onClose={() => setPermissionCleanupConfirmOpen(false)} fullScreen>
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

      <MigrationDialog open={migrationOpen} onClose={() => setMigrationOpen(false)} onMessage={(msg) => setMessage(msg)} />

      <Snackbar open={!!message.text} autoHideDuration={6000} onClose={() => setMessage({ type: '', text: '' })} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={() => setMessage({ type: '', text: '' })} severity={message.type || 'info'} sx={{ width: '100%' }}>
          {message.text}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default SystemSettingsContent;
