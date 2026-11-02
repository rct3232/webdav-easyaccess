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

const GENERATION_KINDS = ['embed', 'features', 'caption', 'asr'];

const asArray = (value) => (Array.isArray(value) ? value : []);
const isNil = (value) => value === null || value === undefined;
const boolValue = (value) => value === true || String(value) === 'true';
const formatNumber = (value) =>
  isNil(value) || !Number.isFinite(Number(value)) ? '—' : String(Number(value));
const formatPercent = (value) =>
  isNil(value) || !Number.isFinite(Number(value)) ? '—' : `${Math.round(Number(value) * 100)}%`;
const formatText = (value) => (isNil(value) || value === '' ? '—' : String(value));
const formatDateTime = (value) => {
  if (isNil(value) || value === '') return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
};
const formatList = (value) => {
  const list = asArray(value).filter((item) => !isNil(item));
  return list.length > 0 ? list.join(' · ') : '—';
};
const formatObject = (value) => {
  if (!value || typeof value !== 'object') return '—';
  const entries = Object.entries(value);
  return entries.length > 0
    ? entries.map(([key, child]) => `${key}: ${formatText(child)}`).join(' · ')
    : '—';
};
const formatMediaKind = (bucket) => {
  if (!bucket || typeof bucket !== 'object') return '—';
  return [
    `${formatNumber(bucket.embedded)}/${formatNumber(bucket.media)}`,
    `missing ${formatNumber(bucket.missing)}`,
    `stale ${formatNumber(bucket.stale)}`,
  ].join(' · ');
};

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
      <Typography variant="body1">{formatText(value)}</Typography>
    </Box>
  );
}

function NotInstrumented({ items, testId }) {
  const { t } = useTranslation();
  const list = asArray(items);
  if (list.length === 0) return null;
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      display="block"
      data-testid={testId}
      sx={{ mt: 0.5 }}
    >
      {list
        .map((item) =>
          t('admin.aiPanel.notInstrumentedLine', {
            item: t(`admin.aiPanel.notInstrumentedLabels.${item}`, item),
          })
        )
        .join(' · ')}
    </Typography>
  );
}

function impactText(entry, t) {
  const metric = entry?.impact?.metric;
  if (!metric) return null;
  if (metric === 'not_instrumented') {
    return t('admin.aiPanel.gates.impactNotInstrumented');
  }
  const label = t(`admin.aiPanel.metrics.${metric}`, metric);
  if (entry.impact.count == null) {
    return t('admin.aiPanel.gates.impactNoData', { metric: label });
  }
  return t('admin.aiPanel.gates.impactMetric', { metric: label, count: entry.impact.count });
}

function GateCaption({ entry, state }) {
  const { t } = useTranslation();
  const parts = [entry.source];
  if (state) parts.push(t(`admin.aiPanel.gates.state.${state}`));
  const impact = impactText(entry, t);
  if (impact) parts.push(impact);
  return (
    <Typography variant="caption" color="text.secondary">
      {parts.filter(Boolean).join(' · ')}
    </Typography>
  );
}

function KillSwitchRow({ entry, busy, onSave }) {
  const { t } = useTranslation();
  const state = isNil(entry.value) ? 'unknown' : boolValue(entry.value) ? 'on' : 'off';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 2, mb: 1 }}>
      <Switch
        size="small"
        checked={state === 'on'}
        disabled={busy || state === 'unknown'}
        onChange={(event) => onSave(entry.key, event.target.checked ? 'true' : 'false')}
        inputProps={{ 'data-testid': `kill-switch-${entry.key}` }}
      />
      <Box>
        <Typography variant="body2">
          {t(`admin.aiPanel.gateKey.${entry.key}`, entry.key)}
        </Typography>
        <GateCaption entry={entry} state={state} />
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
        <GateCaption entry={entry} />
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

function CoverageBlock({ label, coverage, totalLabel, testId }) {
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
    <Box sx={{ mb: 2 }} data-testid={testId}>
      <Typography variant="subtitle2">{label}</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', mt: 0.5 }}>
        <Metric label={totalLabel} value={formatNumber(totals.files ?? totals.media)} />
        <Metric
          label={t('admin.aiPanel.coverage.embedded')}
          value={formatNumber(totals.embedded)}
        />
        <Metric label={t('admin.aiPanel.coverage.missing')} value={formatNumber(totals.missing)} />
        <Metric label={t('admin.aiPanel.coverage.stale')} value={formatNumber(totals.stale)} />
      </Box>
      <Typography
        variant="caption"
        color="text.secondary"
        display="block"
        data-testid={`${testId}-by-source`}
      >
        {t('admin.aiPanel.coverage.bySource')}: {formatObject(coverage.by_source)}
      </Typography>
      {coverage.by_media_kind ? (
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          data-testid={`${testId}-by-media-kind`}
        >
          {t('admin.aiPanel.coverage.byMediaKind')}:{' '}
          {Object.entries(coverage.by_media_kind)
            .map(([kind, bucket]) => `${kind}: ${formatMediaKind(bucket)}`)
            .join(' · ') || '—'}
        </Typography>
      ) : null}
      {coverage.by_capability ? (
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          data-testid={`${testId}-by-capability`}
        >
          {t('admin.aiPanel.coverage.byCapability')}:{' '}
          {t('admin.aiPanel.coverage.capabilityCounts', {
            enabled: formatNumber(coverage.by_capability.enabled),
            disabled: formatNumber(coverage.by_capability.disabled),
          })}
        </Typography>
      ) : null}
      {coverage.by_corpus ? (
        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          data-testid={`${testId}-by-corpus`}
        >
          {t('admin.aiPanel.coverage.byCorpus')}:{' '}
          {t('admin.aiPanel.coverage.corpusCounts', {
            caption: formatNumber(coverage.by_corpus.caption),
            transcript: formatNumber(coverage.by_corpus.transcript),
            none: formatNumber(coverage.by_corpus.none),
          })}
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
    journalError,
    loading,
    error,
    busyKey,
    refresh,
    refreshJournal,
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
          count: formatNumber(result?.enqueued),
          generation: formatNumber(result?.generation),
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
  const previewAvailable = preview ? preview.available !== false : false;
  const previewUnion = preview?.plan?.union_count;
  const launchDisabled =
    launching ||
    busy ||
    launcher.available === false ||
    !preview ||
    !previewAvailable ||
    (Number.isFinite(Number(previewUnion)) && Number(previewUnion) === 0);
  const launcherReason = launcher.reason
    ? t(`admin.aiPanel.reasons.${launcher.reason}`, launcher.reason)
    : null;
  const previewReason = preview?.reason
    ? t(`admin.aiPanel.reasons.${preview.reason}`, preview.reason)
    : null;
  const coverageReason = coverage.reason
    ? t(`admin.aiPanel.reasons.${coverage.reason}`, coverage.reason)
    : null;

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

      <Typography variant="caption" color="text.secondary" data-testid="ai-generated-at">
        {t('admin.aiPanel.generatedAt', { time: formatDateTime(summary.generated_at) })}
      </Typography>

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
              value={formatNumber(queue[status])}
            />
          ))}
          <Metric
            label={t('admin.aiPanel.pipeline.queue.total')}
            value={formatNumber(queue.total)}
          />
          <Metric
            label={t('admin.aiPanel.pipeline.failed24h')}
            value={formatNumber(pipeline.failed_24h)}
          />
          <Metric
            label={t('admin.aiPanel.pipeline.finished24h')}
            value={formatNumber(pipeline.finished_24h)}
          />
          <Metric
            label={t('admin.aiPanel.pipeline.failureRate')}
            value={formatPercent(pipeline.failure_rate_24h)}
          />
        </Box>
        <Typography variant="subtitle2" sx={{ mt: 1 }}>
          {t('admin.aiPanel.pipeline.failedJobs')}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {t('admin.aiPanel.pipeline.failedJobsDisplayOnly')}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {t('admin.aiPanel.pipeline.failedJobsLimit')}
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
                <TableCell>{t('admin.aiPanel.pipeline.status')}</TableCell>
                <TableCell>{t('admin.aiPanel.pipeline.attempt')}</TableCell>
                <TableCell>{t('admin.aiPanel.pipeline.lastError')}</TableCell>
                <TableCell>{t('admin.aiPanel.pipeline.createdAt')}</TableCell>
                <TableCell>{t('admin.aiPanel.pipeline.finishedAt')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {asArray(pipeline.failed_jobs).map((job, index) => (
                <TableRow key={job.id ?? index}>
                  <TableCell>{formatNumber(job.id)}</TableCell>
                  <TableCell>{formatNumber(job.node_id)}</TableCell>
                  <TableCell>{formatText(job.kind)}</TableCell>
                  <TableCell>{formatNumber(job.generation)}</TableCell>
                  <TableCell>{formatText(job.status)}</TableCell>
                  <TableCell>{formatNumber(job.attempt)}</TableCell>
                  <TableCell sx={{ maxWidth: 260, wordBreak: 'break-all' }}>
                    {formatText(job.last_error)}
                  </TableCell>
                  <TableCell>{formatDateTime(job.created_at)}</TableCell>
                  <TableCell>{formatDateTime(job.finished_at)}</TableCell>
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
          {pipeline.breaker_states?.instrumented
            ? t('admin.aiPanel.pipeline.breakerInstrumented')
            : t(
                `admin.aiPanel.pipeline.breakerReasons.${pipeline.breaker_states?.reason || 'unknown'}`,
                t('admin.aiPanel.pipeline.breakerNotInstrumented')
              )}
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
                <TableCell>{formatText(row.role)}</TableCell>
                <TableCell>{formatNumber(row.calls)}</TableCell>
                <TableCell>{formatNumber(row.input_chars)}</TableCell>
                <TableCell>{formatNumber(row.cached)}</TableCell>
                <TableCell>{formatNumber(row.degraded)}</TableCell>
                <TableCell>{formatNumber(row.failed_429)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          {t('admin.aiPanel.cost.caps', {
            calls: formatNumber(cost.caps?.call_cap),
            tokens: formatNumber(cost.caps?.token_cap),
          })}
        </Typography>
        {cost.per_user_top_n?.instrumented === false ? (
          <NotInstrumented items={['per_user_top_n']} testId="cost-not-instrumented" />
        ) : null}
      </Section>

      <Section id="evolution" title={t('admin.aiPanel.sections.evolution')}>
        {evolution.latest_night_eval ? (
          <Box>
            <Typography variant="body2">
              {t('admin.aiPanel.evolution.latestNightEval', {
                id: formatNumber(evolution.latest_night_eval.id),
                status: formatText(evolution.latest_night_eval.status),
              })}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', mt: 0.5 }}>
              <Metric
                label={t('admin.aiPanel.evolution.users')}
                value={formatNumber(evolution.latest_night_eval.totals?.users)}
              />
              <Metric
                label={t('admin.aiPanel.evolution.collections')}
                value={formatNumber(evolution.latest_night_eval.totals?.collections)}
              />
              <Metric
                label={t('admin.aiPanel.evolution.mergeSuggested')}
                value={formatNumber(evolution.latest_night_eval.totals?.merge_suggested)}
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
            count: formatNumber(evolution.pending_merge_suggestions),
          })}
        </Typography>
        <NotInstrumented items={evolution.not_instrumented} testId="evolution-not-instrumented" />
      </Section>

      <Section id="models" title={t('admin.aiPanel.sections.models')}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('admin.aiPanel.models.role')}</TableCell>
              <TableCell>{t('admin.aiPanel.models.id')}</TableCell>
              <TableCell>{t('admin.aiPanel.models.active')}</TableCell>
              <TableCell>{t('admin.aiPanel.models.provider')}</TableCell>
              <TableCell>{t('admin.aiPanel.models.engine')}</TableCell>
              <TableCell>{t('admin.aiPanel.models.history')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {asArray(models.roles).map((row) => (
              <TableRow key={row.role}>
                <TableCell>{formatText(row.role)}</TableCell>
                <TableCell>{formatNumber(row.active?.id)}</TableCell>
                <TableCell>
                  {row.active ? formatText(row.active.model_name) : t('admin.aiPanel.models.none')}
                </TableCell>
                <TableCell>{row.active ? formatText(row.active.provider) : '—'}</TableCell>
                <TableCell>{row.active ? formatText(row.active.engine) : '—'}</TableCell>
                <TableCell>{asArray(row.history).length}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {asArray(models.roles).map((row) => (
          <Box key={`history-${row.role}`} sx={{ mt: 1 }} data-testid={`model-history-${row.role}`}>
            <Typography variant="subtitle2">{t('admin.aiPanel.models.historyRows')}</Typography>
            {asArray(row.history).length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('admin.aiPanel.models.noHistory')}
              </Typography>
            ) : (
              asArray(row.history).map((model) => (
                <Typography
                  key={model.id}
                  variant="body2"
                  data-testid={`model-history-row-${model.id}`}
                >
                  {`#${formatNumber(model.id)} · ${formatText(model.model_name)} · ${formatText(
                    model.provider
                  )} · ${formatText(model.engine)}`}
                </Typography>
              ))
            )}
          </Box>
        ))}
        {asArray(models.profiles).map((profile) => (
          <Box key={`${profile.role}-${profile.model_id}`} sx={{ mt: 1 }}>
            <Typography variant="body2">
              {t('admin.aiPanel.models.profile', {
                role: profile.role,
                model: profile.model_id,
              })}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              <Chip size="small" label={`dim ${formatNumber(profile.dim)}`} />
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
              {profile.dtype ? <Chip size="small" label={`dtype ${profile.dtype}`} /> : null}
              {profile.mrl_dims ? (
                <Chip size="small" label={`mrl ${formatList(profile.mrl_dims)}`} />
              ) : null}
            </Box>
            {profile.text_prefixes ? (
              <Typography variant="caption" color="text.secondary" display="block">
                {t('admin.aiPanel.models.textPrefixes')}: {formatObject(profile.text_prefixes)}
              </Typography>
            ) : null}
          </Box>
        ))}
      </Section>

      <Section id="coverage" title={t('admin.aiPanel.sections.coverage')}>
        {coverage.available ? (
          <Box>
            <CoverageBlock
              label={t('admin.aiPanel.coverage.text')}
              coverage={coverage.text}
              totalLabel={t('admin.aiPanel.coverage.totalFiles')}
              testId="coverage-text"
            />
            <CoverageBlock
              label={t('admin.aiPanel.coverage.media')}
              coverage={coverage.media}
              totalLabel={t('admin.aiPanel.coverage.totalMedia')}
              testId="coverage-media"
            />
          </Box>
        ) : (
          <Alert severity="info" data-testid="coverage-unavailable">
            {coverageReason
              ? t('admin.aiPanel.coverage.unavailableReason', { reason: coverageReason })
              : t('admin.aiPanel.coverage.unavailable')}
          </Alert>
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
            value={formatNumber(launcher.active_model_id)}
          />
          <Metric
            label={t('admin.aiPanel.launcher.available')}
            value={t(
              launcher.available === false
                ? 'admin.aiPanel.launcher.unavailable'
                : 'admin.aiPanel.launcher.availableYes'
            )}
          />
          <Metric
            label={t('admin.aiPanel.launcher.activeJobs')}
            value={formatNumber(launcher.active_jobs)}
          />
          <Metric
            label={t('admin.aiPanel.launcher.cooldown')}
            value={formatNumber(launcher.retry_after_seconds)}
          />
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap' }} data-testid="launcher-generations">
          {GENERATION_KINDS.map((kind) => (
            <Metric
              key={kind}
              label={t(`admin.aiPanel.launcher.generationKinds.${kind}`)}
              value={formatNumber(launcher.generations?.[kind])}
            />
          ))}
        </Box>
        {launcher.available === false && launcherReason ? (
          <Alert severity="warning" sx={{ mb: 1 }} data-testid="launcher-unavailable">
            {launcherReason}
          </Alert>
        ) : null}
        {formatNumber(launcher.retry_after_seconds) !== '—' &&
        Number(launcher.retry_after_seconds) > 0 ? (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {t('admin.aiPanel.launcher.retryAfter', {
              seconds: formatNumber(launcher.retry_after_seconds),
            })}
          </Alert>
        ) : null}
        {preview ? (
          previewAvailable ? (
            <Box sx={{ mb: 1 }} data-testid="reembed-preview">
              <Typography variant="body2">
                {t('admin.aiPanel.launcher.previewCounts', {
                  text: formatNumber(preview.plan?.text_count),
                  media: formatNumber(preview.plan?.media_count),
                  union: formatNumber(preview.plan?.union_count),
                })}
              </Typography>
            </Box>
          ) : (
            <Alert severity="info" sx={{ mb: 1 }} data-testid="reembed-preview-unavailable">
              {t('admin.aiPanel.launcher.previewUnavailable', {
                reason: previewReason || t('admin.aiPanel.notInstrumented'),
              })}
            </Alert>
          )
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
        {journalError ? (
          <Alert
            severity="error"
            data-testid="journal-error"
            action={
              <Button size="small" onClick={refreshJournal}>
                {t('admin.aiPanel.retry')}
              </Button>
            }
          >
            {getServerErrorDisplay(journalError?.response?.data, t) ||
              t('admin.aiPanel.journal.loadFail')}
          </Alert>
        ) : asArray(journal).length === 0 ? (
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
                    {row.status} · {formatDateTime(row.created_at)}
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
          text:
            previewAvailable && !isNil(preview?.plan?.text_count)
              ? formatNumber(preview.plan.text_count)
              : '—',
          media:
            previewAvailable && !isNil(preview?.plan?.media_count)
              ? formatNumber(preview.plan.media_count)
              : '—',
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
