import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  FormControlLabel,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import { startBlobMigration, getMigrationInfo } from '../../../services/migrationService';
import { getServerErrorDisplay } from '../../../utils/errorUtils';

const backendDisplayName = (t, backend) =>
  backend === 's3' ? t('migration.backendS3') : t('migration.backendWebdav');

const MigrationDialog = ({ open, onClose, onMessage }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [info, setInfo] = useState(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState('');
  const [mode, setMode] = useState('dry-run');
  const [s3Dest, setS3Dest] = useState({
    bucket: '',
    accessKey: '',
    secretKey: '',
    endpoint: '',
    region: 'us-east-1',
  });
  const [webdavDest, setWebdavDest] = useState({
    url: '',
    username: '',
    password: '',
    authType: 'auto',
    upstreamUrl: '',
  });
  const [missingFields, setMissingFields] = useState([]);
  const [formError, setFormError] = useState('');
  const [starting, setStarting] = useState(false);

  const destType = info && info.source === 'webdav' ? 's3' : 'webdav';
  const destConfig = destType === 's3' ? s3Dest : webdavDest;
  const startDisabled = starting || infoLoading || !info || Boolean(infoError);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setInfoLoading(true);
    setInfoError('');
    setInfo(null);
    getMigrationInfo()
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setInfoError(t('migration.infoLoadFail'));
      })
      .finally(() => {
        if (!cancelled) setInfoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  const handleClose = () => {
    onClose();
  };

  const handleStart = async () => {
    const requiredFields =
      destType === 's3' ? ['bucket', 'accessKey', 'secretKey'] : ['url', 'username', 'password'];
    const missing = requiredFields.filter((field) => !destConfig[field].trim());
    if (missing.length > 0) {
      setMissingFields(missing);
      setFormError(t('migration.requiredFields'));
      return;
    }
    setMissingFields([]);
    setFormError('');
    setStarting(true);
    const dest =
      destType === 's3'
        ? {
            type: 's3',
            bucket: s3Dest.bucket.trim(),
            accessKey: s3Dest.accessKey.trim(),
            secretKey: s3Dest.secretKey,
            endpoint: s3Dest.endpoint.trim() || undefined,
            region: s3Dest.region.trim() || 'us-east-1',
          }
        : {
            type: 'webdav',
            url: webdavDest.url.trim(),
            username: webdavDest.username.trim(),
            password: webdavDest.password,
            authType: webdavDest.authType || 'auto',
            upstreamUrl: webdavDest.upstreamUrl.trim() || undefined,
          };
    const payload = {
      mode,
      force: false,
      dest,
    };
    try {
      const data = await startBlobMigration(payload);
      if (!data || !data.jobId) throw new Error('missing jobId');
      onClose();
      navigate('/migration');
    } catch (error) {
      const errorData = error?.response?.data;
      const errorText =
        errorData?.errorCode === 'migrationInProgress'
          ? t('serverErrors.migrationInProgress')
          : getServerErrorDisplay(errorData, t) || t('migration.startFail');
      setFormError(errorText);
      if (onMessage) onMessage({ type: 'error', text: errorText });
    } finally {
      setStarting(false);
    }
  };

  const renderS3Fields = () => (
    <>
      <Typography variant="subtitle2" gutterBottom>
        {t('migration.destS3')}
      </Typography>
      <TextField
        fullWidth
        label={`${t('migration.bucket')} *`}
        value={s3Dest.bucket}
        onChange={(e) => setS3Dest({ ...s3Dest, bucket: e.target.value })}
        margin="normal"
        required
        error={missingFields.includes('bucket')}
        disabled={starting}
      />
      <TextField
        fullWidth
        label={`${t('migration.accessKey')} *`}
        value={s3Dest.accessKey}
        onChange={(e) => setS3Dest({ ...s3Dest, accessKey: e.target.value })}
        margin="normal"
        required
        error={missingFields.includes('accessKey')}
        disabled={starting}
      />
      <TextField
        fullWidth
        label={`${t('migration.secretKey')} *`}
        type="password"
        value={s3Dest.secretKey}
        onChange={(e) => setS3Dest({ ...s3Dest, secretKey: e.target.value })}
        margin="normal"
        required
        error={missingFields.includes('secretKey')}
        disabled={starting}
      />
      <TextField
        fullWidth
        label={t('migration.endpoint')}
        value={s3Dest.endpoint}
        onChange={(e) => setS3Dest({ ...s3Dest, endpoint: e.target.value })}
        margin="normal"
        disabled={starting}
      />
      <TextField
        fullWidth
        label={t('migration.region')}
        value={s3Dest.region}
        onChange={(e) => setS3Dest({ ...s3Dest, region: e.target.value })}
        margin="normal"
        disabled={starting}
      />
    </>
  );

  const renderWebdavFields = () => (
    <>
      <Typography variant="subtitle2" gutterBottom>
        {t('migration.destWebdav')}
      </Typography>
      <TextField
        fullWidth
        label={`${t('migration.url')} *`}
        value={webdavDest.url}
        onChange={(e) => setWebdavDest({ ...webdavDest, url: e.target.value })}
        margin="normal"
        required
        error={missingFields.includes('url')}
        disabled={starting}
      />
      <TextField
        fullWidth
        label={`${t('migration.username')} *`}
        value={webdavDest.username}
        onChange={(e) => setWebdavDest({ ...webdavDest, username: e.target.value })}
        margin="normal"
        required
        error={missingFields.includes('username')}
        disabled={starting}
      />
      <TextField
        fullWidth
        label={`${t('migration.password')} *`}
        type="password"
        value={webdavDest.password}
        onChange={(e) => setWebdavDest({ ...webdavDest, password: e.target.value })}
        margin="normal"
        required
        error={missingFields.includes('password')}
        disabled={starting}
      />
      <TextField
        select
        fullWidth
        label={t('migration.authType')}
        value={webdavDest.authType}
        onChange={(e) => setWebdavDest({ ...webdavDest, authType: e.target.value })}
        margin="normal"
        disabled={starting}
      >
        <MenuItem value="auto">{t('migration.authTypeAuto')}</MenuItem>
        <MenuItem value="digest">{t('migration.authTypeDigest')}</MenuItem>
      </TextField>
      <TextField
        fullWidth
        label={t('migration.upstreamUrl')}
        value={webdavDest.upstreamUrl}
        onChange={(e) => setWebdavDest({ ...webdavDest, upstreamUrl: e.target.value })}
        margin="normal"
        disabled={starting}
      />
    </>
  );

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth fullScreen>
      <DialogTitle>{t('migration.title')}</DialogTitle>
      <DialogContent>
        {infoLoading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2">{t('migration.infoLoading')}</Typography>
          </Box>
        )}

        {!infoLoading && info && (
          <Typography variant="body2" sx={{ mt: 1 }}>
            {t('migration.sourceLabel', { backend: backendDisplayName(t, info.source) })} →{' '}
            {t('migration.destinationLabel', { backend: backendDisplayName(t, destType) })}
          </Typography>
        )}

        {infoError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {infoError}
          </Alert>
        )}

        <FormControl component="fieldset" sx={{ mt: 1 }}>
          <FormLabel>{t('migration.mode')}</FormLabel>
          <RadioGroup row value={mode} onChange={(e) => setMode(e.target.value)}>
            <FormControlLabel
              value="dry-run"
              control={<Radio />}
              label={t('migration.modeDryRun')}
              disabled={starting}
            />
            <FormControlLabel
              value="apply"
              control={<Radio />}
              label={t('migration.modeApply')}
              disabled={starting}
            />
          </RadioGroup>
        </FormControl>

        {mode === 'apply' && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {t('migration.autoResumeNote')}
          </Typography>
        )}

        {info && !infoLoading && (
          <Box sx={{ mt: 2 }}>{destType === 's3' ? renderS3Fields() : renderWebdavFields()}</Box>
        )}

        {formError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {formError}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={starting}>
          {t('common.close')}
        </Button>
        <Button
          variant="contained"
          onClick={handleStart}
          disabled={startDisabled}
          startIcon={starting ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {starting ? t('migration.starting') : t('migration.start')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MigrationDialog;
