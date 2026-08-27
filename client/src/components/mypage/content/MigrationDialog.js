import React, { useState, useCallback, useRef, useEffect } from 'react';
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
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import {
  startBlobMigration,
  getBlobMigrationStatus,
  cancelBlobMigration,
  getMigrationInfo,
} from '../../../services/migrationService';
import { getServerErrorDisplay } from '../../../utils/errorUtils';

const POLL_INTERVAL_MS = 400;
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

const backendDisplayName = (t, backend) =>
  backend === 's3' ? t('migration.backendS3') : t('migration.backendWebdav');

const MigrationDialog = ({ open, onClose, onMessage }) => {
  const { t } = useTranslation();

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
  const [cancelling, setCancelling] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [popup, setPopup] = useState(null);
  const popupJobRef = useRef(null);
  const pollRef = useRef(null);

  const destType = info && info.source === 'webdav' ? 's3' : 'webdav';
  const destConfig = destType === 's3' ? s3Dest : webdavDest;
  const isRunning = Boolean(job && !TERMINAL_STATUSES.includes(job.status));
  const startDisabled = isRunning || starting || infoLoading || !info || Boolean(infoError);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

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

  useEffect(() => {
    if (!job || !TERMINAL_STATUSES.includes(job.status)) return;
    if (popupJobRef.current === job.jobId) return;
    let nextPopup = null;
    if (job.status === 'completed' && job.mode === 'apply') {
      nextPopup = 'restart';
    } else if (job.status === 'completed' && job.mode === 'dry-run') {
      nextPopup = 'dryRunDone';
    } else if (job.status === 'failed') {
      nextPopup = 'failed';
    } else if (job.status === 'cancelled') {
      nextPopup = 'cancelled';
    }
    if (nextPopup) {
      popupJobRef.current = job.jobId;
      setPopup(nextPopup);
    }
  }, [job]);

  const handleClose = () => {
    stopPolling();
    onClose();
  };

  const pollJob = useCallback(
    async (id) => {
      try {
        const status = await getBlobMigrationStatus(id);
        setJob(status);
        if (status && TERMINAL_STATUSES.includes(status.status)) {
          stopPolling();
          if (status.status === 'cancelled' && onMessage) {
            onMessage({ type: 'info', text: t('migration.cancelSuccess') });
          }
        }
        return status;
      } catch (error) {
        stopPolling();
        if (onMessage) {
          onMessage({ type: 'error', text: t('migration.statusLoadFail') });
        }
        return null;
      }
    },
    [onMessage, stopPolling, t]
  );

  const handleStart = async () => {
    const requiredFields = destType === 's3' ? ['bucket', 'accessKey', 'secretKey'] : ['url', 'username', 'password'];
    const missing = requiredFields.filter((field) => !destConfig[field].trim());
    if (missing.length > 0) {
      setMissingFields(missing);
      setFormError(t('migration.requiredFields'));
      return;
    }
    setMissingFields([]);
    setFormError('');
    setJob(null);
    setJobId(null);
    setPopup(null);
    popupJobRef.current = null;
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
      const nextJobId = data && data.jobId;
      if (!nextJobId) throw new Error('missing jobId');
      setJobId(nextJobId);
      const status = await pollJob(nextJobId);
      if (!status || !TERMINAL_STATUSES.includes(status.status)) {
        pollRef.current = setInterval(() => pollJob(nextJobId), POLL_INTERVAL_MS);
      }
    } catch (error) {
      const errorText = getServerErrorDisplay(error?.response?.data, t) || t('migration.startFail');
      setFormError(errorText);
      if (onMessage) onMessage({ type: 'error', text: errorText });
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    if (!jobId || cancelling) return;
    setCancelling(true);
    try {
      await cancelBlobMigration(jobId);
    } catch (error) {
      const errorText = getServerErrorDisplay(error?.response?.data, t) || t('migration.cancelFail');
      if (onMessage) onMessage({ type: 'error', text: errorText });
    } finally {
      setCancelling(false);
    }
  };

  const renderTerminalPopup = () => {
    if (!popup) return null;
    let title;
    let body;
    if (popup === 'restart') {
      title = t('migration.restartRequiredTitle');
      body = t('migration.restartRequiredBody');
    } else if (popup === 'dryRunDone') {
      title = t('migration.dryRunDoneTitle');
      body = t('migration.dryRunDoneBody', {
        copied: job?.results?.copied ?? 0,
        skipped: job?.results?.skipped ?? 0,
        failed: job?.results?.failed ?? 0,
      });
    } else if (popup === 'failed') {
      title = t('migration.failedTitle');
      body = t('migration.failedBody');
    } else {
      title = t('migration.cancelledTitle');
      body = t('migration.cancelledBody');
    }
    return (
      <Dialog open maxWidth="sm" fullWidth>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">{body}</Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setPopup(null)}>
            {t('migration.ok')}
          </Button>
        </DialogActions>
      </Dialog>
    );
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
        disabled={isRunning || starting}
      />
      <TextField
        fullWidth
        label={`${t('migration.accessKey')} *`}
        value={s3Dest.accessKey}
        onChange={(e) => setS3Dest({ ...s3Dest, accessKey: e.target.value })}
        margin="normal"
        required
        error={missingFields.includes('accessKey')}
        disabled={isRunning || starting}
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
        disabled={isRunning || starting}
      />
      <TextField
        fullWidth
        label={t('migration.endpoint')}
        value={s3Dest.endpoint}
        onChange={(e) => setS3Dest({ ...s3Dest, endpoint: e.target.value })}
        margin="normal"
        disabled={isRunning || starting}
      />
      <TextField
        fullWidth
        label={t('migration.region')}
        value={s3Dest.region}
        onChange={(e) => setS3Dest({ ...s3Dest, region: e.target.value })}
        margin="normal"
        disabled={isRunning || starting}
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
        disabled={isRunning || starting}
      />
      <TextField
        fullWidth
        label={`${t('migration.username')} *`}
        value={webdavDest.username}
        onChange={(e) => setWebdavDest({ ...webdavDest, username: e.target.value })}
        margin="normal"
        required
        error={missingFields.includes('username')}
        disabled={isRunning || starting}
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
        disabled={isRunning || starting}
      />
      <TextField
        select
        fullWidth
        label={t('migration.authType')}
        value={webdavDest.authType}
        onChange={(e) => setWebdavDest({ ...webdavDest, authType: e.target.value })}
        margin="normal"
        disabled={isRunning || starting}
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
        disabled={isRunning || starting}
      />
    </>
  );

  const renderProgress = () => {
    if (!jobId) return null;
    return (
      <Box sx={{ mt: 3 }}>
        <Typography variant="caption" color="text.secondary">
          {t('migration.jobId', { jobId })}
        </Typography>
        {job ? (
          <>
            <LinearProgress
              variant={job.total > 0 ? 'determinate' : 'indeterminate'}
              value={job.total > 0 ? Math.round((job.progress / job.total) * 100) : undefined}
              sx={{ mt: 1 }}
            />
            <Typography variant="body2" sx={{ mt: 1 }}>
              {t('migration.progress', { done: job.progress ?? 0, total: job.total ?? 0 })}
            </Typography>
            {job.current ? (
              <Typography variant="body2" color="text.secondary">
                {t('migration.current', { path: job.current })}
              </Typography>
            ) : null}
            <Box sx={{ display: 'flex', gap: 3, mt: 1 }}>
              <Typography variant="body2">{t('migration.copied', { count: job.results?.copied ?? 0 })}</Typography>
              <Typography variant="body2">{t('migration.skipped', { count: job.results?.skipped ?? 0 })}</Typography>
              <Typography variant="body2">{t('migration.failed', { count: job.results?.failed ?? 0 })}</Typography>
            </Box>
            {(job.status === 'running' || job.status === 'pending') && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                {t('migration.statusRunning')}
              </Typography>
            )}
            {job.status === 'completed' && (
              <Alert severity="success" sx={{ mt: 2 }}>
                {t('migration.statusCompleted')}
              </Alert>
            )}
            {job.status === 'cancelled' && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                {t('migration.statusCancelled')}
              </Alert>
            )}
            {job.status === 'failed' && (
              <Box sx={{ mt: 2 }}>
                <Alert severity="error">{t('migration.statusFailed')}</Alert>
                {job.errorMessage ? (
                  <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                    {job.errorMessage}
                  </Typography>
                ) : null}
                {job.results?.errors?.length > 0 && (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {t('migration.errorsTitle')}
                    </Typography>
                    <List dense>
                      {job.results.errors.slice(0, 5).map((err, idx) => (
                        <ListItem key={idx} dense sx={{ px: 0 }}>
                          <ListItemText primary={err.path || err.nodeId || '-'} secondary={err.error} />
                        </ListItem>
                      ))}
                    </List>
                  </Box>
                )}
              </Box>
            )}
          </>
        ) : (
          <CircularProgress size={20} sx={{ mt: 1 }} />
        )}
      </Box>
    );
  };

  return (
    <>
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
              <FormControlLabel value="dry-run" control={<Radio />} label={t('migration.modeDryRun')} disabled={isRunning || starting} />
              <FormControlLabel value="apply" control={<Radio />} label={t('migration.modeApply')} disabled={isRunning || starting} />
            </RadioGroup>
          </FormControl>

          {mode === 'apply' && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              {t('migration.autoResumeNote')}
            </Typography>
          )}

          {info && !infoLoading && <Box sx={{ mt: 2 }}>{destType === 's3' ? renderS3Fields() : renderWebdavFields()}</Box>}

          {formError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {formError}
            </Alert>
          )}

          {renderProgress()}
        </DialogContent>
        <DialogActions>
          {isRunning && (
            <Button color="error" onClick={handleCancel} disabled={cancelling} startIcon={cancelling ? <CircularProgress size={16} /> : null}>
              {cancelling ? t('migration.cancelling') : t('migration.cancelJob')}
            </Button>
          )}
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

      {renderTerminalPopup()}
    </>
  );
};

export default MigrationDialog;
