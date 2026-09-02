import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Typography,
} from '@mui/material';
import { getBlobMigrationStatus, getMigrationStatus } from '../../services/migrationService';
import { formatDate } from '../../utils/format';

const POLL_INTERVAL_MS = 400;
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

const BACKEND_LABEL_KEYS = {
  webdav: 'migrationPage.backendWebdav',
  s3: 'migrationPage.backendS3',
  sqlite: 'migrationPage.backendSqlite',
  postgresql: 'migrationPage.backendPostgresql',
};

const STATUS_COLOR = {
  pending: 'info',
  running: 'primary',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
};

const formatElapsed = (ms) => {
  if (ms == null || Number.isNaN(ms)) return '-';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
};

const MigrationPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [job, setJob] = useState(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [popup, setPopup] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const jobIdRef = useRef(null);
  const popupJobRef = useRef(null);
  const pollRef = useRef(null);

  const goToSettings = useCallback(() => {
    navigate('/mypage', { state: { category: 'admin-settings' } });
  }, [navigate]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollJob = useCallback(async () => {
    const id = jobIdRef.current;
    if (!id) return null;
    try {
      const next = await getBlobMigrationStatus(id);
      setJob(next);
      if (next && TERMINAL_STATUSES.includes(next.status)) stopPolling();
      return next;
    } catch {
      stopPolling();
      setLoadError(t('migrationPage.statusLoadFail'));
      return null;
    }
  }, [stopPolling, t]);

  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      try {
        const data = await getMigrationStatus();
        if (cancelled) return;
        setStatus(data);
        const active = Boolean(data && data.active);
        if (!active || !data.jobId) return;
        jobIdRef.current = data.jobId;
        setJobLoading(true);
        try {
          const initial = await getBlobMigrationStatus(data.jobId);
          if (cancelled) return;
          setJob(initial);
          if (!initial || !TERMINAL_STATUSES.includes(initial.status)) {
            pollRef.current = setInterval(() => {
              pollJob();
            }, POLL_INTERVAL_MS);
          }
        } catch {
          if (!cancelled) setLoadError(t('migrationPage.statusLoadFail'));
        } finally {
          if (!cancelled) setJobLoading(false);
        }
      } catch {
        if (!cancelled) setLoadError(t('migrationPage.statusLoadFail'));
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    };

    resolve();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [pollJob, stopPolling, t]);

  useEffect(() => {
    if (!job || !TERMINAL_STATUSES.includes(job.status)) return;
    const jobKey = job.id ?? job.jobId;
    if (!jobKey || popupJobRef.current === jobKey) return;
    popupJobRef.current = jobKey;
    setPopup(job.status);
  }, [job]);

  useEffect(() => {
    if (!job || TERMINAL_STATUSES.includes(job.status)) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const active = Boolean(status && status.active);
  const jobId = (job && (job.id ?? job.jobId)) || status?.jobId || null;

  const startedAt = job?.startedAt || job?.createdAt || status?.startedAt || null;
  const completedAt = job?.completedAt || null;
  const elapsedMs = (() => {
    if (!startedAt) return null;
    const start = new Date(startedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : now;
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    return Math.max(0, end - start);
  })();

  const type = job?.type || status?.type || null;
  const direction = job?.direction || null;
  const statusText = job?.status || null;

  const formatDirection = (dir) => {
    if (typeof dir !== 'string' || !dir.includes('-to-')) return dir || '';
    const [from, to] = dir.split('-to-');
    const fromKey = BACKEND_LABEL_KEYS[from];
    const toKey = BACKEND_LABEL_KEYS[to];
    if (fromKey && toKey) return `${t(fromKey)} → ${t(toKey)}`;
    return dir;
  };

  const jobProgress = job?.progress;
  const percent = (() => {
    if (jobProgress && jobProgress.percent != null) {
      return Math.min(100, Math.max(0, jobProgress.percent));
    }
    if (jobProgress && jobProgress.total) {
      return Math.min(
        100,
        Math.max(0, Math.round((jobProgress.progress / jobProgress.total) * 100))
      );
    }
    if (typeof job?.progress === 'number' && job?.total) {
      return Math.min(100, Math.max(0, Math.round((job.progress / job.total) * 100)));
    }
    return 0;
  })();
  const currentLabel =
    (jobProgress && (jobProgress.currentLabel || jobProgress.current)) || job?.current || null;
  const resultsCounters =
    job?.results &&
    (job.results.copied != null || job.results.failed != null || job.results.skipped != null)
      ? {
          copied: job.results.copied ?? 0,
          failed: job.results.failed ?? 0,
          skipped: job.results.skipped ?? 0,
        }
      : null;
  const counters = jobProgress?.counters || resultsCounters;

  const renderHeader = () => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, flexWrap: 'wrap' }}>
      <Typography variant="h5">{t('migrationPage.title')}</Typography>
      {type && (
        <Chip
          size="small"
          label={
            type === 'metadata' ? t('migrationPage.typeMetadata') : t('migrationPage.typeBlobs')
          }
          color={type === 'metadata' ? 'secondary' : 'primary'}
        />
      )}
      <Box sx={{ flexGrow: 1 }} />
      {startedAt && (
        <Typography variant="body2" color="text.secondary">
          {t('migrationPage.elapsed', { time: formatElapsed(elapsedMs) })}
        </Typography>
      )}
    </Box>
  );

  const renderOverview = () => (
    <Paper elevation={0} variant="outlined" sx={{ p: 3, mb: 2 }}>
      <Typography variant="h6" gutterBottom>
        {t('migrationPage.overviewTitle')}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="body1">{formatDirection(direction)}</Typography>
        {statusText && (
          <Chip
            size="small"
            label={t(
              `migrationPage.status${statusText.charAt(0).toUpperCase()}${statusText.slice(1)}`
            )}
            color={STATUS_COLOR[statusText] || 'default'}
          />
        )}
      </Box>
      <Box sx={{ mt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {t('migrationPage.startedAt', { time: startedAt ? formatDate(startedAt) : '-' })}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('migrationPage.elapsed', { time: formatElapsed(elapsedMs) })}
        </Typography>
      </Box>
    </Paper>
  );

  const renderProgress = () => (
    <Paper elevation={0} variant="outlined" sx={{ p: 3, mb: 2 }}>
      <Typography variant="h6" gutterBottom>
        {t('migrationPage.progressTitle')}
      </Typography>
      <LinearProgress variant="determinate" value={percent} sx={{ mb: 1 }} />
      <Typography variant="body1">{percent}%</Typography>
      {currentLabel && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('migrationPage.currentOperation', { label: currentLabel })}
        </Typography>
      )}
      {counters && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t('migrationPage.counters', {
            copied: counters.copied ?? 0,
            failed: counters.failed ?? 0,
            skipped: counters.skipped ?? 0,
          })}
        </Typography>
      )}
    </Paper>
  );

  const renderAlerts = () => {
    if (!job) return null;
    if (job.status === 'failed') {
      const reason = job.error || job.errorMessage;
      return (
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography variant="body2">{t('migrationPage.failedAlert')}</Typography>
          {reason ? (
            <Typography variant="body2" sx={{ mt: 1 }}>
              {t('migrationPage.errorReason', { reason })}
            </Typography>
          ) : null}
        </Alert>
      );
    }
    if (job.status === 'cancelled') {
      return (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2">{t('migrationPage.cancelledAlert')}</Typography>
        </Alert>
      );
    }
    return null;
  };

  const renderTerminalModal = () => {
    if (!popup) return null;
    let title;
    let body;
    if (popup === 'completed') {
      title = t('migrationPage.terminalCompletedTitle');
      if (type === 'metadata') {
        const [, to] = typeof direction === 'string' ? direction.split('-to-') : [];
        const toKey = to ? BACKEND_LABEL_KEYS[to] : null;
        body = t('migrationPage.terminalCompletedMetadataBody', {
          backend: toKey ? t(toKey) : t('migrationPage.backendPostgresql'),
        });
      } else if (job?.configPersist?.persisted?.length) {
        body = t('migrationPage.terminalCompletedBlobsPersistedBody', {
          keys: job.configPersist.persisted.join(', '),
        });
      } else if (job?.configPersist?.skippedEnvSourced?.length) {
        body = t('migrationPage.terminalCompletedBlobsEnvSourcedBody', {
          keys: job.configPersist.skippedEnvSourced.join(', '),
        });
      } else {
        body = t('migrationPage.terminalCompletedBlobsDefaultBody');
      }
    } else if (popup === 'failed') {
      title = t('migrationPage.terminalFailedTitle');
      const reason = job?.error || job?.errorMessage;
      body = reason
        ? `${t('migrationPage.terminalFailedBody')} ${reason}`
        : t('migrationPage.terminalFailedBody');
    } else {
      title = t('migrationPage.terminalCancelledTitle');
      body = t('migrationPage.terminalCancelledBody');
    }
    return (
      <Dialog open maxWidth="sm" fullWidth>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">{body}</Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={goToSettings}>
            {t('migrationPage.goToSettings')}
          </Button>
        </DialogActions>
      </Dialog>
    );
  };

  if (statusLoading) {
    return (
      <Container maxWidth="md">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (loadError) {
    return (
      <Container maxWidth="md">
        <Paper elevation={0} sx={{ p: 4, mt: 4 }}>
          {renderHeader()}
          <Alert severity="error">{loadError}</Alert>
          <Button variant="contained" sx={{ mt: 2 }} onClick={goToSettings}>
            {t('migrationPage.goToSettings')}
          </Button>
        </Paper>
      </Container>
    );
  }

  if (!active) {
    return (
      <Container maxWidth="md">
        <Paper elevation={0} sx={{ p: 4, mt: 4, textAlign: 'center' }}>
          {renderHeader()}
          <Typography variant="h6" gutterBottom>
            {t('migrationPage.emptyTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('migrationPage.emptyBody')}
          </Typography>
          <Button variant="contained" onClick={goToSettings}>
            {t('migrationPage.goToSettings')}
          </Button>
        </Paper>
      </Container>
    );
  }

  if (!jobId) {
    return (
      <Container maxWidth="md">
        <Paper elevation={0} sx={{ p: 4, mt: 4 }}>
          {renderHeader()}
          <Alert severity="warning">{t('migrationPage.noJob')}</Alert>
          <Button variant="contained" sx={{ mt: 2 }} onClick={goToSettings}>
            {t('migrationPage.goToSettings')}
          </Button>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="md">
      <Paper elevation={0} sx={{ p: 4, mt: 4 }}>
        {renderHeader()}
        {jobLoading && !job ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : job ? (
          <>
            {renderOverview()}
            {renderProgress()}
            {renderAlerts()}
          </>
        ) : (
          <Alert severity="error">{t('migrationPage.statusLoadFail')}</Alert>
        )}
      </Paper>
      {renderTerminalModal()}
    </Container>
  );
};

export default MigrationPage;
