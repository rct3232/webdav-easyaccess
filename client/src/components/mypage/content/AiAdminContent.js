import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Snackbar,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

import { usePageHeader } from '../../../contexts/PageHeaderContext';
import { useMessage } from '../../../hooks/useMessage';
import { getServerErrorDisplay } from '../../../utils/errorUtils';
import { useAiAdminPanel } from '../../../pages/MyPage/hooks/useAiAdminPanel';
import ConfirmDialog from '../../dialogs/ConfirmDialog';

const SECTIONS = [
  ['pipeline', 'admin.aiPanel.sections.pipeline'],
  ['cost', 'admin.aiPanel.sections.cost'],
  ['evolution', 'admin.aiPanel.sections.evolution'],
  ['models', 'admin.aiPanel.sections.models'],
  ['coverage', 'admin.aiPanel.sections.coverage'],
  ['gates', 'admin.aiPanel.sections.gates'],
  ['launcher', 'admin.aiPanel.sections.launcher'],
  ['journal', 'admin.aiPanel.sections.journal'],
];

const asArray = (value) => (Array.isArray(value) ? value : []);
const asNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const percent = (value) => `${Math.round(asNumber(value) * 100)}%`;
const boolValue = (value) => value === true || String(value) === 'true';

function Section({ id, title, action, children }) {
  return (
    <Box component="section" id={`ai-panel-${id}`} sx={{ mt: 4 }} data-testid={`ai-section-${id}`}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="h6">{title}</Typography>
        {action}
      </Box>
      {children}
    </Box>
  );
}

function Metric({ label, value }) {
  return (
    <Box sx={{ minWidth: 110, mr: 2, mb: 1 }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="body1">{value}</Typography>
    </Box>
  );
}

function KillSwitchRow({ entry, busy, onSave }) {
  const { t } = useTranslation();
  const checked = boolValue(entry.value);
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 2, mb: 1 }}>
      <Switch
        size="small"
        checked={checked}
        disabled={busy}
        onChange={(event) => onSave(entry.key, event.target.checked ? 'true' : 'false')}
        inputProps={{ 'data-testid': `kill-switch-${entry.key}` }}
      />
      <Box>
        <Typography variant="body2">
          {t(`admin.aiPanel.gateKey.${entry.key}`, entry.key)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {entry.source}
          {entry.impact?.count != null
            ? ` · ${t('admin.aiPanel.gates.impact')}: ${entry.impact.count}`
            : ''}
        </Typography>
      </Box>
    </Box>
  );
}

function GateRow({ entry, busy, onSave }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(entry.value == null ? '' : String(entry.value));
  useEffect(() => {
    setValue(entry.value == null ? '' : String(entry.value));
  }, [entry.value]);

  return (
    <Box
      sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}
      data-testid={`gate-row-${entry.key}`}
    >
      <TextField
        size="small"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        inputProps={{ 'data-testid': `gate-input-${entry.key}` }}
        sx={{ width: 140 }}
      />
      <Box sx={{ flex: 1 }}>
        <Typography variant="body2">
          {t(`admin.aiPanel.gateKey.${entry.key}`, entry.key)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {entry.source}
          {entry.impact?.count != null
            ? ` · ${t('admin.aiPanel.gates.impact')}: ${entry.impact.count}`
            : ` · ${t('admin.aiPanel.notInstrumented')}`}
        </Typography>
      </Box>
      <Button
        size="small"
        disabled={busy || String(entry.value ?? '') === value}
        onClick={() => onSave(entry.key, value)}
      >
        {t('common.save')}
      </Button>
    </Box>
  );
}

function CoverageBlock({ label, coverage }) {
  const { t } = useTranslation();
  if (!coverage) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('admin.aiPanel.notInstrumented')}
      </Typography>
    );
  }
  const totals = coverage.totals || {};
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2">{label}</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', mt: 0.5 }}>
        <Metric label={t('admin.aiPanel.coverage.embedded')} value={asNumber(totals.embedded)} />
        <Metric label={t('admin.aiPanel.coverage.missing')} value={asNumber(totals.missing)} />
        <Metric label={t('admin.aiPanel.coverage.stale')} value={asNumber(totals.stale)} />
      </Box>
      <Typography variant="caption" color="text.secondary">
        {Object.entries(coverage.by_source || {})
          .map(([source, count]) => `${source}: ${count}`)
          .join(' · ')}
      </Typography>
      {coverage.by_media_kind ? (
        <Typography variant="caption" color="text.secondary" display="block">
          {Object.entries(coverage.by_media_kind)
            .map(([kind, bucket]) => `${kind}: ${bucket.embedded}/${bucket.media}`)
            .join(' · ')}
        </Typography>
      ) : null}
    </Box>
  );
}

const AiAdminContent = () => {
  const { t } = useTranslation();
  const { setTitle, setActions } = usePageHeader();
  const message = useMessage();
  const navigate = useNavigate();
  const {
    summary,
    preview,
    journal,
    loading,
    error,
    busyKey,
    refresh,
    loadPreview,
    launch,
    saveSettings,
    probeRoles,
    undoJournal,
  } = useAiAdminPanel();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    setTitle(t('admin.aiPanel.title'));
    setActions(null);
  }, [t, setTitle, setActions]);

  const scrollTo = (section) => {
    const target = document.getElementById(`ai-panel-${section}`);
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const saveOne = async (key, value) => {
    try {
      await saveSettings({ [key]: value });
      message.showSuccess(t('admin.aiPanel.gates.saved'));
    } catch (err) {
      message.showError(
        getServerErrorDisplay(err?.response?.data, t) || t('admin.aiPanel.gates.saveFail')
      );
    }
  };

  const handlePreview = async () => {
    try {
      await loadPreview();
    } catch (err) {
      message.showError(
        getServerErrorDisplay(err?.response?.data, t) || t('admin.aiPanel.launcher.previewFail')
      );
    }
  };

  const handleLaunch = async () => {
    setLaunching(true);
    try {
      const result = await launch();
      setConfirmOpen(false);
      message.showSuccess(
        t('admin.aiPanel.launcher.launchSuccess', {
          count: asNumber(result?.enqueued),
          generation: result?.generation,
        })
      );
      scrollTo('pipeline');
    } catch (err) {
      setConfirmOpen(false);
      message.showError(
        getServerErrorDisplay(err?.response?.data, t) || t('admin.aiPanel.launcher.launchFail')
      );
    } finally {
      setLaunching(false);
    }
  };

  const handleProbe = async () => {
    try {
      const results = await probeRoles();
      const ok = results.filter((row) => row.ok).length;
      const text = t('admin.aiPanel.probe.done', { ok, total: results.length });
      if (ok === results.length) message.showSuccess(text);
      else message.showWarning(text);
    } catch (err) {
      message.showError(
        getServerErrorDisplay(err?.response?.data, t) || t('admin.aiPanel.probe.fail')
      );
    }
  };

  const handleUndo = async (actionId) => {
    try {
      await undoJournal(actionId);
      message.showSuccess(t('admin.aiPanel.journal.undoSuccess'));
    } catch (err) {
      message.showError(
        getServerErrorDisplay(err?.response?.data, t) || t('admin.aiPanel.journal.undoFail')
      );
    }
  };

  if (loading && !summary) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error && !summary) {
    return (
      <Box>
        <Alert
          severity="error"
          action={<Button onClick={refresh}>{t('admin.aiPanel.retry')}</Button>}
        >
          {getServerErrorDisplay(error?.response?.data, t) || t('admin.aiPanel.loadFail')}
        </Alert>
      </Box>
    );
  }

  if (!summary) return null;

  const pipeline = summary.pipeline || {};
  const queue = pipeline.queue || {};
  const cost = summary.cost || {};
  const evolution = summary.evolution || {};
  const models = summary.models || { roles: [], profiles: [] };
  const coverage = summary.coverage || {};
  const gates = summary.gates || { kill_switches: [], gates: [] };
  const launcher = summary.launcher || {};
  const busy = Boolean(busyKey);
  const launchDisabled =
    launching ||
    busy ||
    launcher.available === false ||
    !preview ||
    (preview.plan && preview.plan.union_count === 0);

  return (
    <Box data-testid="ai-admin-content">
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
        {SECTIONS.map(([id, key]) => (
          <Chip
            key={id}
            label={t(key)}
            size="small"
            onClick={() => scrollTo(id)}
            data-testid={`ai-anchor-${id}`}
          />
        ))}
        <Button size="small" onClick={refresh} disabled={busy}>
          {t('admin.aiPanel.refresh')}
        </Button>
        <Button size="small" onClick={handleProbe} disabled={busy}>
          {t('admin.aiPanel.probe.action')}
        </Button>
        <Button
          size="small"
          onClick={() => navigate('/mypage', { state: { category: 'admin-settings' } })}
        >
          {t('admin.aiPanel.openSystemSettings')}
        </Button>
      </Box>

      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          py: 1,
        }}
        data-testid="ai-kill-switches"
      >
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('admin.aiPanel.gates.killSwitches')}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
          {asArray(gates.kill_switches).map((entry) => (
            <KillSwitchRow key={entry.key} entry={entry} busy={busy} onSave={saveOne} />
          ))}
        </Box>
      </Box>

      <Section id="pipeline" title={t('admin.aiPanel.sections.pipeline')}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
          {['pending', 'running', 'done', 'failed', 'skipped', 'cancelled'].map((status) => (
            <Metric
              key={status}
              label={t(`admin.aiPanel.pipeline.queue.${status}`)}
              value={asNumber(queue[status])}
            />
          ))}
          <Metric
            label={t('admin.aiPanel.pipeline.failed24h')}
            value={asNumber(pipeline.failed_24h)}
          />
          <Metric
            label={t('admin.aiPanel.pipeline.failureRate')}
            value={percent(pipeline.failure_rate_24h)}
          />
        </Box>
        <Typography variant="subtitle2" sx={{ mt: 1 }}>
          {t('admin.aiPanel.pipeline.failedJobs')}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {t('admin.aiPanel.pipeline.failedJobsDisplayOnly')}
        </Typography>
        {asArray(pipeline.failed_jobs).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('admin.aiPanel.pipeline.noFailedJobs')}
          </Typography>
        ) : (
          <Table size="small" data-testid="failed-jobs-table">
            <TableHead>
              <TableRow>
                <TableCell>id</TableCell>
                <TableCell>{t('admin.aiPanel.pipeline.nodeId')}</TableCell>
                <TableCell>{t('admin.aiPanel.pipeline.kind')}</TableCell>
                <TableCell>{t('admin.aiPanel.pipeline.generation')}</TableCell>
                <TableCell>{t('admin.aiPanel.pipeline.attempt')}</TableCell>
                <TableCell>{t('admin.aiPanel.pipeline.lastError')}</TableCell>
                <TableCell>{t('admin.aiPanel.pipeline.finishedAt')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {asArray(pipeline.failed_jobs).map((job) => (
                <TableRow key={job.id}>
                  <TableCell>{job.id}</TableCell>
                  <TableCell>{job.node_id}</TableCell>
                  <TableCell>{job.kind}</TableCell>
                  <TableCell>{job.generation}</TableCell>
                  <TableCell>{job.attempt}</TableCell>
                  <TableCell sx={{ maxWidth: 260, wordBreak: 'break-all' }}>
                    {job.last_error || ''}
                  </TableCell>
                  <TableCell>{job.finished_at || ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Typography variant="subtitle2" sx={{ mt: 1 }}>
          {t('admin.aiPanel.pipeline.readiness')}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {asArray(pipeline.capabilities).map((row) => (
            <Chip
              key={row.capability}
              size="small"
              color={row.enabled ? 'success' : 'default'}
              label={`${row.capability}: ${row.enabled ? t('admin.aiPanel.on') : t('admin.aiPanel.off')}`}
            />
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          {t('admin.aiPanel.pipeline.breakerNotInstrumented')}
        </Typography>
      </Section>

      <Section id="cost" title={t('admin.aiPanel.sections.cost')}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('admin.aiPanel.cost.role')}</TableCell>
              <TableCell>{t('admin.aiPanel.cost.calls')}</TableCell>
              <TableCell>{t('admin.aiPanel.cost.inputChars')}</TableCell>
              <TableCell>{t('admin.aiPanel.cost.cached')}</TableCell>
              <TableCell>{t('admin.aiPanel.cost.degraded')}</TableCell>
              <TableCell>{t('admin.aiPanel.cost.failed429')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {asArray(cost.roles).map((row) => (
              <TableRow key={row.role}>
                <TableCell>{row.role}</TableCell>
                <TableCell>{asNumber(row.calls)}</TableCell>
                <TableCell>{asNumber(row.input_chars)}</TableCell>
                <TableCell>{asNumber(row.cached)}</TableCell>
                <TableCell>{asNumber(row.degraded)}</TableCell>
                <TableCell>{asNumber(row.failed_429)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          {t('admin.aiPanel.cost.caps', {
            calls: asNumber(cost.caps?.call_cap),
            tokens: asNumber(cost.caps?.token_cap),
          })}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {t('admin.aiPanel.cost.perUserNotInstrumented')}
        </Typography>
      </Section>

      <Section id="evolution" title={t('admin.aiPanel.sections.evolution')}>
        {evolution.latest_night_eval ? (
          <Box>
            <Typography variant="body2">
              {t('admin.aiPanel.evolution.latestNightEval', {
                id: evolution.latest_night_eval.id,
                status: evolution.latest_night_eval.status,
              })}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', mt: 0.5 }}>
              <Metric
                label={t('admin.aiPanel.evolution.users')}
                value={asNumber(evolution.latest_night_eval.totals?.users)}
              />
              <Metric
                label={t('admin.aiPanel.evolution.collections')}
                value={asNumber(evolution.latest_night_eval.totals?.collections)}
              />
              <Metric
                label={t('admin.aiPanel.evolution.mergeSuggested')}
                value={asNumber(evolution.latest_night_eval.totals?.merge_suggested)}
              />
            </Box>
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t('admin.aiPanel.evolution.none')}
          </Typography>
        )}
        <Typography variant="body2" sx={{ mt: 1 }}>
          {t('admin.aiPanel.evolution.pendingMerges', {
            count: asNumber(evolution.pending_merge_suggestions),
          })}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {t('admin.aiPanel.evolution.notInstrumented')}
        </Typography>
      </Section>

      <Section id="models" title={t('admin.aiPanel.sections.models')}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('admin.aiPanel.models.role')}</TableCell>
              <TableCell>{t('admin.aiPanel.models.active')}</TableCell>
              <TableCell>{t('admin.aiPanel.models.engine')}</TableCell>
              <TableCell>{t('admin.aiPanel.models.history')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {asArray(models.roles).map((row) => (
              <TableRow key={row.role}>
                <TableCell>{row.role}</TableCell>
                <TableCell>
                  {row.active ? row.active.model_name : t('admin.aiPanel.models.none')}
                </TableCell>
                <TableCell>{row.active ? row.active.engine : ''}</TableCell>
                <TableCell>{asArray(row.history).length}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {asArray(models.profiles).map((profile) => (
          <Box key={`${profile.role}-${profile.model_id}`} sx={{ mt: 1 }}>
            <Typography variant="body2">
              {t('admin.aiPanel.models.profile', {
                role: profile.role,
                model: profile.model_id,
              })}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              <Chip size="small" label={`dim ${profile.dim ?? '—'}`} />
              <Chip
                size="small"
                color={profile.calibrated ? 'success' : 'default'}
                label={t('admin.aiPanel.models.calibrated', {
                  value: profile.calibrated ? t('admin.aiPanel.on') : t('admin.aiPanel.off'),
                })}
              />
              {profile.pooling ? <Chip size="small" label={`pooling ${profile.pooling}`} /> : null}
              {profile.request_shape ? (
                <Chip size="small" label={`shape ${profile.request_shape}`} />
              ) : null}
            </Box>
          </Box>
        ))}
      </Section>

      <Section id="coverage" title={t('admin.aiPanel.sections.coverage')}>
        {coverage.available ? (
          <Box>
            <CoverageBlock label={t('admin.aiPanel.coverage.text')} coverage={coverage.text} />
            <CoverageBlock label={t('admin.aiPanel.coverage.media')} coverage={coverage.media} />
          </Box>
        ) : (
          <Alert severity="info">{t('admin.aiPanel.coverage.unavailable')}</Alert>
        )}
      </Section>

      <Section id="gates" title={t('admin.aiPanel.sections.gates')}>
        {asArray(gates.gates).map((entry) => (
          <GateRow key={entry.key} entry={entry} busy={busy} onSave={saveOne} />
        ))}
      </Section>

      <Section id="launcher" title={t('admin.aiPanel.sections.launcher')}>
        <Typography variant="body2" color="text.secondary">
          {t('admin.aiPanel.launcher.description')}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', mt: 1 }}>
          <Metric
            label={t('admin.aiPanel.launcher.model')}
            value={launcher.active_model_id ?? '—'}
          />
          <Metric
            label={t('admin.aiPanel.launcher.generation')}
            value={asNumber(launcher.generations?.embed)}
          />
          <Metric
            label={t('admin.aiPanel.launcher.cooldown')}
            value={asNumber(launcher.retry_after_seconds)}
          />
        </Box>
        {launcher.reason === 'active_run' ? (
          <Alert severity="info" sx={{ mb: 1 }}>
            {t('admin.aiPanel.launcher.activeRun')}
          </Alert>
        ) : null}
        {asNumber(launcher.retry_after_seconds) > 0 ? (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {t('admin.aiPanel.launcher.retryAfter', {
              seconds: asNumber(launcher.retry_after_seconds),
            })}
          </Alert>
        ) : null}
        {preview ? (
          <Box sx={{ mb: 1 }} data-testid="reembed-preview">
            <Typography variant="body2">
              {t('admin.aiPanel.launcher.previewCounts', {
                text: asNumber(preview.plan?.text_count),
                media: asNumber(preview.plan?.media_count),
                union: asNumber(preview.plan?.union_count),
              })}
            </Typography>
          </Box>
        ) : null}
        <Button variant="outlined" onClick={handlePreview} disabled={busy} sx={{ mr: 1 }}>
          {busyKey === 'preview' ? (
            <CircularProgress size={18} />
          ) : (
            t('admin.aiPanel.launcher.preview')
          )}
        </Button>
        <Button
          variant="contained"
          color="warning"
          onClick={() => setConfirmOpen(true)}
          disabled={launchDisabled}
        >
          {t('admin.aiPanel.launcher.launch')}
        </Button>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          {t('admin.aiPanel.launcher.cancelPendingHint')}
        </Typography>
      </Section>

      <Section id="journal" title={t('admin.aiPanel.sections.journal')}>
        {asArray(journal).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('admin.aiPanel.journal.empty')}
          </Typography>
        ) : (
          <Box>
            {asArray(journal).map((row) => (
              <Box
                key={row.action_id}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}
                data-testid="settings-journal-row"
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {row.subject} · {row.action}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {row.status} · {row.created_at}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  disabled={busy || row.status !== 'applied' || row.undo_available === false}
                  onClick={() => handleUndo(row.action_id)}
                >
                  {t('admin.aiPanel.journal.undo')}
                </Button>
              </Box>
            ))}
          </Box>
        )}
      </Section>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleLaunch}
        title={t('admin.aiPanel.launcher.confirmTitle')}
        message={t('admin.aiPanel.launcher.confirmBody', {
          text: asNumber(preview?.plan?.text_count ?? coverage.text?.totals?.missing ?? 0),
          media: asNumber(preview?.plan?.media_count ?? coverage.media?.totals?.missing ?? 0),
        })}
        confirmText={t('admin.aiPanel.launcher.confirm')}
        loading={launching}
      />

      <Snackbar
        open={message.message.show}
        autoHideDuration={message.message.type === 'error' ? 5000 : 3000}
        onClose={message.clearMessage}
        message={message.message.text}
      />
    </Box>
  );
};

export default AiAdminContent;
