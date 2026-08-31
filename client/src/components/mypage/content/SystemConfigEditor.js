import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import * as adminService from '../../../services/adminService';
import { getServerErrorDisplay, getServerMessageDisplay } from '../../../utils/errorUtils';

const SECRET_MASK = '****';

const GROUP_ORDER = ['fileStorage', 'serverSecurity', 'email', 'runtime'];

// Connection keys (D1): editing one blocks Save until a test with the pending
// values passes. Partitioned per active file-storage backend for the payload.
const CONNECTION_KEYS_BY_BACKEND = {
  s3: ['S3_BUCKET', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_ENDPOINT'],
  webdav: ['WEBDAV_URL', 'WEBDAV_USERNAME', 'WEBDAV_PASSWORD', 'WEBDAV_AUTH_TYPE'],
};

const CONNECTION_KEYS = new Set(
  Object.values(CONNECTION_KEYS_BY_BACKEND).reduce((acc, keys) => acc.concat(keys), [])
);

const GROUP_LABEL_KEYS = {
  metadata: 'admin.config.group.metadata',
  fileStorage: 'admin.config.group.fileStorage',
  serverSecurity: 'admin.config.group.serverSecurity',
  email: 'admin.config.group.email',
  runtime: 'admin.config.group.runtime',
};

// Display metadata only. The server registry (configRegistry.js) is
// authoritative for tier/secret/source; keys without an entry are skipped.
const CONFIG_DISPLAY_META = {
  // ── File storage ────────────────────────────────────────────────────────
  WEA_FILE_STORAGE: {
    labelKey: 'admin.config.key.WEA_FILE_STORAGE',
    group: 'fileStorage',
    inputType: 'select',
    options: [
      { value: 's3', labelKey: 'setup.fileS3' },
      { value: 'webdav', labelKey: 'setup.fileWebdav' },
    ],
  },
  S3_BUCKET: { labelKey: 'admin.config.key.S3_BUCKET', group: 'fileStorage', inputType: 'text' },
  AWS_REGION: { labelKey: 'admin.config.key.AWS_REGION', group: 'fileStorage', inputType: 'text' },
  AWS_ACCESS_KEY_ID: { labelKey: 'admin.config.key.AWS_ACCESS_KEY_ID', group: 'fileStorage', inputType: 'text' },
  AWS_SECRET_ACCESS_KEY: { labelKey: 'admin.config.key.AWS_SECRET_ACCESS_KEY', group: 'fileStorage', inputType: 'text' },
  S3_ENDPOINT: { labelKey: 'admin.config.key.S3_ENDPOINT', group: 'fileStorage', inputType: 'text' },
  WEBDAV_URL: { labelKey: 'admin.config.key.WEBDAV_URL', group: 'fileStorage', inputType: 'text' },
  WEBDAV_USERNAME: { labelKey: 'admin.config.key.WEBDAV_USERNAME', group: 'fileStorage', inputType: 'text' },
  WEBDAV_PASSWORD: { labelKey: 'admin.config.key.WEBDAV_PASSWORD', group: 'fileStorage', inputType: 'text' },
  WEBDAV_AUTH_TYPE: {
    labelKey: 'admin.config.key.WEBDAV_AUTH_TYPE',
    group: 'fileStorage',
    inputType: 'select',
    options: [
      { value: 'auto', labelKey: 'migration.authTypeAuto' },
      { value: 'digest', labelKey: 'migration.authTypeDigest' },
    ],
  },
  WEBDAV_UPSTREAM_URL: { labelKey: 'admin.config.key.WEBDAV_UPSTREAM_URL', group: 'fileStorage', inputType: 'text' },
  MAX_THUMBNAIL_SIZE: { labelKey: 'admin.config.key.MAX_THUMBNAIL_SIZE', group: 'fileStorage', inputType: 'number' },
  THUMBNAIL_CONCURRENCY_LIMIT: { labelKey: 'admin.config.key.THUMBNAIL_CONCURRENCY_LIMIT', group: 'fileStorage', inputType: 'number' },
  THUMBNAIL_TOKEN_SECRET: { labelKey: 'admin.config.key.THUMBNAIL_TOKEN_SECRET', group: 'fileStorage', inputType: 'text' },
  THUMBNAIL_TOKEN_EXPIRY: { labelKey: 'admin.config.key.THUMBNAIL_TOKEN_EXPIRY', group: 'fileStorage', inputType: 'text', helpKey: 'setup.expiresInHelp' },
  FFMPEG_PATH: { labelKey: 'admin.config.key.FFMPEG_PATH', group: 'fileStorage', inputType: 'text' },
  FFMPEG_INIT_TIMEOUT_MS: { labelKey: 'admin.config.key.FFMPEG_INIT_TIMEOUT_MS', group: 'fileStorage', inputType: 'number' },
  WEA_PREVIEW_TICKET_TTL_MS: { labelKey: 'admin.config.key.WEA_PREVIEW_TICKET_TTL_MS', group: 'fileStorage', inputType: 'number' },

  // ── Server & security ───────────────────────────────────────────────────
  PORT: { labelKey: 'admin.config.key.PORT', group: 'serverSecurity', inputType: 'number' },
  CORS_ORIGINS: { labelKey: 'admin.config.key.CORS_ORIGINS', group: 'serverSecurity', inputType: 'text', helpKey: 'admin.config.help.CORS_ORIGINS' },
  CORS_ORIGIN: { labelKey: 'admin.config.key.CORS_ORIGIN', group: 'serverSecurity', inputType: 'text' },
  LOGIN_RATE_LIMIT_MAX: { labelKey: 'admin.config.key.LOGIN_RATE_LIMIT_MAX', group: 'serverSecurity', inputType: 'number' },
  LOGIN_RATE_LIMIT_WINDOW_MS: { labelKey: 'admin.config.key.LOGIN_RATE_LIMIT_WINDOW_MS', group: 'serverSecurity', inputType: 'number' },
  JWT_EXPIRES_IN: { labelKey: 'admin.config.key.JWT_EXPIRES_IN', group: 'serverSecurity', inputType: 'text', helpKey: 'setup.expiresInHelp' },
  ADMIN_DEFAULT_PASSWORD: { labelKey: 'admin.config.key.ADMIN_DEFAULT_PASSWORD', group: 'serverSecurity', inputType: 'text' },
  WEA_DISABLE_DEFAULT_ADMIN: { labelKey: 'admin.config.key.WEA_DISABLE_DEFAULT_ADMIN', group: 'serverSecurity', inputType: 'switch' },
  HOSTNAME: { labelKey: 'admin.config.key.HOSTNAME', group: 'serverSecurity', inputType: 'text' },

  // ── Email ───────────────────────────────────────────────────────────────
  EMAIL_HOST: { labelKey: 'admin.config.key.EMAIL_HOST', group: 'email', inputType: 'text' },
  EMAIL_PORT: { labelKey: 'admin.config.key.EMAIL_PORT', group: 'email', inputType: 'number' },
  EMAIL_USER: { labelKey: 'admin.config.key.EMAIL_USER', group: 'email', inputType: 'text' },
  EMAIL_PASSWORD: { labelKey: 'admin.config.key.EMAIL_PASSWORD', group: 'email', inputType: 'text' },
  EMAIL_SECURE: { labelKey: 'admin.config.key.EMAIL_SECURE', group: 'email', inputType: 'switch' },
  EMAIL_FROM_NAME: { labelKey: 'admin.config.key.EMAIL_FROM_NAME', group: 'email', inputType: 'text' },

  // ── Runtime ─────────────────────────────────────────────────────────────
  GC_INTERVAL_MS: { labelKey: 'admin.config.key.GC_INTERVAL_MS', group: 'runtime', inputType: 'number' },
  GC_ORPHAN_TTL_DAYS: { labelKey: 'admin.config.key.GC_ORPHAN_TTL_DAYS', group: 'runtime', inputType: 'number' },
  REFRESH_TOKEN_EXPIRES_IN_DAYS: { labelKey: 'admin.config.key.REFRESH_TOKEN_EXPIRES_IN_DAYS', group: 'runtime', inputType: 'number' },
  USER_CACHE_TTL_MS: { labelKey: 'admin.config.key.USER_CACHE_TTL_MS', group: 'runtime', inputType: 'number' },
  PERMISSION_CACHE_TTL_MS: { labelKey: 'admin.config.key.PERMISSION_CACHE_TTL_MS', group: 'runtime', inputType: 'number' },
  PERMISSIONS_EXISTENCE_INDEX_TTL_MS: { labelKey: 'admin.config.key.PERMISSIONS_EXISTENCE_INDEX_TTL_MS', group: 'runtime', inputType: 'number' },
  PERMISSIONS_EXISTENCE_RECONCILE_BATCH_SIZE: { labelKey: 'admin.config.key.PERMISSIONS_EXISTENCE_RECONCILE_BATCH_SIZE', group: 'runtime', inputType: 'number' },
  PERMISSIONS_EXISTENCE_RECONCILE_CONCURRENCY: { labelKey: 'admin.config.key.PERMISSIONS_EXISTENCE_RECONCILE_CONCURRENCY', group: 'runtime', inputType: 'number' },
  WEA_SKIP_MIGRATION_WORKER: { labelKey: 'admin.config.key.WEA_SKIP_MIGRATION_WORKER', group: 'runtime', inputType: 'switch' },
  WEA_SKIP_BULK_WORKER: { labelKey: 'admin.config.key.WEA_SKIP_BULK_WORKER', group: 'runtime', inputType: 'switch' },
  WEA_SKIP_GC_SCHEDULER: { labelKey: 'admin.config.key.WEA_SKIP_GC_SCHEDULER', group: 'runtime', inputType: 'switch' },
};

const toStr = (value) => {
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (value === null || value === undefined) return '';
  return String(value);
};

// Mirrors the setup-wizard resolver: prefer a translation of the server
// errorCode; fall back to the raw message, then to the default key.
const resolveTestErrorMessage = (err, t, fallbackKey) => {
  if (err?.errorCode) {
    const translated = t(err.errorCode, { reason: err?.reason });
    if (translated && translated !== err.errorCode) return translated;
  }
  return err?.message || t(fallbackKey);
};

const SystemConfigEditor = ({ active, onSnackbar }) => {
  const { t } = useTranslation();

  const [config, setConfig] = useState(null);
  const [values, setValues] = useState({});
  const [revealedSecrets, setRevealedSecrets] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [restartRequiredKeys, setRestartRequiredKeys] = useState([]);
  const [appliedKeys, setAppliedKeys] = useState([]);
  const [connectionTest, setConnectionTest] = useState({ status: 'idle', message: '', reason: '' });
  const loadedRef = useRef(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await adminService.getConfig();
      setConfig(data);
      const nextValues = {};
      Object.keys(data).forEach((key) => {
        nextValues[key] = data[key]?.secret ? '' : toStr(data[key]?.value);
      });
      setValues(nextValues);
    } catch {
      setLoadError(t('admin.config.loadFail'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (active && !loadedRef.current) {
      loadedRef.current = true;
      loadConfig();
    }
  }, [active, loadConfig]);

  const handleRetry = () => {
    loadedRef.current = true;
    loadConfig();
  };

  const handleChange = (key, value) => {
    if (CONNECTION_KEYS.has(key)) {
      setConnectionTest({ status: 'idle', message: '', reason: '' });
    }
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const toggleReveal = (key) => {
    setRevealedSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const dirtyKeys = useMemo(() => {
    const keys = new Set();
    if (!config) return keys;
    Object.keys(CONFIG_DISPLAY_META).forEach((key) => {
      const entry = config[key];
      if (!entry) return;
      const current = values[key];
      if (entry.secret) {
        if (current && String(current).trim() !== '') keys.add(key);
      } else if (current !== toStr(entry.value)) {
        keys.add(key);
      }
    });
    return keys;
  }, [config, values]);

  const hasDirty = dirtyKeys.size > 0;

  const hasConnectionDirty = useMemo(() => {
    for (const key of dirtyKeys) {
      if (CONNECTION_KEYS.has(key)) return true;
    }
    return false;
  }, [dirtyKeys]);

  const handleTestConnection = async () => {
    const target = values.WEA_FILE_STORAGE ?? (toStr(config.WEA_FILE_STORAGE?.value) || 's3');
    const keys = CONNECTION_KEYS_BY_BACKEND[target] || [];
    const payload = {};
    keys.forEach((key) => {
      payload[key] = values[key] ?? toStr(config[key]?.value);
    });

    setConnectionTest({ status: 'testing', message: '', reason: '' });
    try {
      const res = await adminService.testConfig(target, payload);
      if (res && res.ok === false) {
        setConnectionTest({
          status: 'error',
          message: resolveTestErrorMessage(
            { errorCode: res.errorCode, message: res.message, reason: res.reason },
            t,
            'setup.testFail'
          ),
          reason: res.reason,
        });
        return;
      }
      setConnectionTest({ status: 'ok', message: t('setup.testOk'), reason: '' });
    } catch (err) {
      setConnectionTest({
        status: 'error',
        message: resolveTestErrorMessage(err, t, 'setup.testFail'),
        reason: err?.reason,
      });
    }
  };

  const handleSave = async () => {
    const changedValues = {};
    for (const key of dirtyKeys) {
      const value = values[key];
      const entry = config[key];
      if (entry?.secret && (value === null || value === undefined || String(value).trim() === '')) {
        continue;
      }
      changedValues[key] = value;
    }
    if (Object.keys(changedValues).length === 0) return;

    setSaving(true);
    try {
      const res = await adminService.updateConfig(changedValues);
      const successText = getServerMessageDisplay(res, t) || t('admin.config.saved');
      if (onSnackbar) onSnackbar({ type: 'success', text: successText });
      setRestartRequiredKeys(res?.restartRequired || []);
      setAppliedKeys(res?.applied || []);
      setRevealedSecrets({});
      setConnectionTest({ status: 'idle', message: '', reason: '' });
      await loadConfig();
    } catch (error) {
      if (onSnackbar) {
        onSnackbar({ type: 'error', text: getServerErrorDisplay(error?.response?.data, t) || t('admin.config.saveFail') });
      }
    } finally {
      setSaving(false);
    }
  };

  const renderTierBadge = (key, entry) => {
    if (entry.source === 'env' || entry.tier === 'T0') return null;
    const label = entry.tier === 'T1' ? t('admin.config.tierRestart') : t('admin.config.tierImmediate');
    return (
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mt: 0.5 }}
        data-testid={`config-tier-${key}`}
      >
        {label}
      </Typography>
    );
  };

  const renderSecretField = (key) => {
    const meta = CONFIG_DISPLAY_META[key];
    const entry = config[key];
    const readOnly = entry.source === 'env' || entry.tier === 'T0';
    const envNote = entry.source === 'env' ? t('admin.config.setInEnv') : '';
    const revealed = Boolean(revealedSecrets[key]);

    return (
      <Box sx={{ mb: 2 }}>
        <TextField
          fullWidth
          label={t(meta.labelKey)}
          value={SECRET_MASK}
          disabled
          helperText={envNote || t('admin.config.secretKeepExisting')}
          inputProps={{ 'data-testid': `config-input-${key}` }}
        />
        {!readOnly && (
          <Box sx={{ mt: 1 }}>
            <Button
              size="small"
              onClick={() => toggleReveal(key)}
              data-testid={`config-secret-toggle-${key}`}
            >
              {revealed ? t('common.cancel') : t('admin.config.setNewValue')}
            </Button>
            {revealed && (
              <TextField
                fullWidth
                size="small"
                type="password"
                label={t('admin.config.setNewValue')}
                value={values[key] ?? ''}
                onChange={(e) => handleChange(key, e.target.value)}
                margin="normal"
                autoFocus
                inputProps={{ 'data-testid': `config-secret-new-${key}` }}
              />
            )}
          </Box>
        )}
        {renderTierBadge(key, entry)}
      </Box>
    );
  };

  const renderSwitchField = (key) => {
    const meta = CONFIG_DISPLAY_META[key];
    const entry = config[key];
    const readOnly = entry.source === 'env' || entry.tier === 'T0';
    const helper = entry.source === 'env' ? t('admin.config.setInEnv') : meta.helpKey ? t(meta.helpKey) : '';

    return (
      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ flex: 1, mr: 2 }}>
            <Typography variant="body2">{t(meta.labelKey)}</Typography>
            {helper && (
              <Typography variant="caption" color="text.secondary">
                {helper}
              </Typography>
            )}
          </Box>
          <Switch
            checked={values[key] === 'true'}
            onChange={(e) => handleChange(key, e.target.checked ? 'true' : 'false')}
            disabled={readOnly || saving}
            color="primary"
            slotProps={{ input: { 'data-testid': `config-input-${key}` } }}
          />
        </Box>
        {renderTierBadge(key, entry)}
      </Box>
    );
  };

  const renderSelectField = (key) => {
    const meta = CONFIG_DISPLAY_META[key];
    const entry = config[key];
    const readOnly = entry.source === 'env' || entry.tier === 'T0';
    const helper = entry.source === 'env' ? t('admin.config.setInEnv') : meta.helpKey ? t(meta.helpKey) : '';

    return (
      <Box>
        <TextField
          select
          fullWidth
          size="small"
          label={t(meta.labelKey)}
          value={values[key] ?? ''}
          onChange={(e) => handleChange(key, e.target.value)}
          disabled={readOnly || saving}
          helperText={helper || undefined}
          margin="normal"
          inputProps={{ 'data-testid': `config-input-${key}` }}
        >
          {meta.options.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {t(option.labelKey)}
            </MenuItem>
          ))}
        </TextField>
        {renderTierBadge(key, entry)}
      </Box>
    );
  };

  const renderTextField = (key) => {
    const meta = CONFIG_DISPLAY_META[key];
    const entry = config[key];
    const readOnly = entry.source === 'env' || entry.tier === 'T0';
    const helper = entry.source === 'env' ? t('admin.config.setInEnv') : meta.helpKey ? t(meta.helpKey) : '';

    return (
      <Box>
        <TextField
          fullWidth
          size="small"
          type={meta.inputType === 'number' ? 'number' : 'text'}
          label={t(meta.labelKey)}
          value={values[key] ?? ''}
          onChange={(e) => handleChange(key, e.target.value)}
          disabled={readOnly || saving}
          helperText={helper || undefined}
          margin="normal"
          inputProps={{ 'data-testid': `config-input-${key}` }}
        />
        {renderTierBadge(key, entry)}
      </Box>
    );
  };

  const renderField = (key) => {
    const entry = config[key];
    if (entry.secret) return renderSecretField(key);
    const inputType = CONFIG_DISPLAY_META[key]?.inputType;
    if (inputType === 'switch') return renderSwitchField(key);
    if (inputType === 'select') return renderSelectField(key);
    return renderTextField(key);
  };

  if (!active) return null;

  if (loadError && !config) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={handleRetry}>{t('admin.config.retry')}</Button>}>
        {loadError}
      </Alert>
    );
  }

  if (!config) {
    if (loading) {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
          <CircularProgress size={16} />
          <Typography variant="body2">{t('common.loading')}</Typography>
        </Box>
      );
    }
    return null;
  }

  return (
    <Box>
      {GROUP_ORDER.map((group) => {
        const keys = Object.keys(CONFIG_DISPLAY_META).filter(
          (key) => CONFIG_DISPLAY_META[key].group === group && config[key]
        );
        if (keys.length === 0) return null;
        return (
          <Box key={group} sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              {t(GROUP_LABEL_KEYS[group])}
            </Typography>
            {group === 'fileStorage' && hasConnectionDirty && (
              <Box sx={{ mb: 2 }}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleTestConnection}
                  disabled={connectionTest.status === 'testing' || saving}
                  startIcon={connectionTest.status === 'testing' ? <CircularProgress size={14} color="inherit" /> : null}
                  data-testid="config-test-connection"
                >
                  {t('admin.config.connectionTest')}
                </Button>
                {connectionTest.status === 'testing' && (
                  <Typography variant="body2" sx={{ mt: 0.5 }} data-testid="config-connection-test-status">
                    {t('setup.testing')}
                  </Typography>
                )}
                {connectionTest.status === 'ok' && (
                  <Typography variant="body2" color="success.main" sx={{ mt: 0.5 }} data-testid="config-connection-test-status">
                    {connectionTest.message}
                  </Typography>
                )}
                {connectionTest.status === 'error' && (
                  <Box data-testid="config-connection-test-status">
                    <Typography variant="body2" color="error.main" sx={{ mt: 0.5 }}>
                      {connectionTest.message}
                    </Typography>
                    {connectionTest.reason && (
                      <Typography variant="caption" color="error.main" sx={{ display: 'block' }}>
                        {connectionTest.reason}
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            )}
            {keys.map((key) => (
              <React.Fragment key={key}>{renderField(key)}</React.Fragment>
            ))}
          </Box>
        );
      })}

      {appliedKeys.length > 0 && (
        <Alert severity="success" sx={{ mt: 2 }} data-testid="config-applied-banner">
          <Typography variant="subtitle2">{t('admin.config.appliedNow')}</Typography>
          <Typography variant="body2">
            {t('admin.config.appliedNowDetail', { keys: appliedKeys.join(', ') })}
          </Typography>
        </Alert>
      )}

      {restartRequiredKeys.length > 0 && (
        <Alert severity="warning" sx={{ mt: 2 }} data-testid="config-restart-banner">
          <Typography variant="subtitle2">{t('admin.config.restartRequired')}</Typography>
          <Typography variant="body2">
            {t('admin.config.restartRequiredDetail', { keys: restartRequiredKeys.join(', ') })}
          </Typography>
        </Alert>
      )}

      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        {hasConnectionDirty && connectionTest.status !== 'ok' && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mr: 2 }}
            data-testid="config-connection-test-required"
          >
            {t('admin.config.connectionTestRequired')}
          </Typography>
        )}
        <Button
          variant="contained"
          color="primary"
          onClick={handleSave}
          disabled={!hasDirty || saving || (hasConnectionDirty && connectionTest.status !== 'ok')}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
          data-testid="config-save"
        >
          {saving ? t('admin.config.saving') : t('admin.config.save')}
        </Button>
      </Box>
    </Box>
  );
};

export default SystemConfigEditor;
